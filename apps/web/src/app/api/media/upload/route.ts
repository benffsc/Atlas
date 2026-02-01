import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { createHash } from "crypto";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";

// Unified media upload endpoint
// Supports uploading to: requests, cats, places
// Supports single file or batch upload (multiple files)

type EntityType = "request" | "cat" | "place" | "annotation";

type ConfidenceLevel = "confirmed" | "likely" | "uncertain" | "unidentified";

interface UploadResult {
  media_id: string;
  storage_path: string;
  stored_filename: string;
  photo_group_id?: string;
}

interface BatchUploadResponse {
  success: boolean;
  results: UploadResult[];
  failed: Array<{ filename: string; error: string }>;
  photo_group_id?: string;
  total_uploaded: number;
}

// Entity validation queries
const entityQueries: Record<EntityType, string> = {
  request: "SELECT request_id FROM trapper.sot_requests WHERE request_id = $1",
  cat: "SELECT cat_id FROM trapper.sot_cats WHERE cat_id = $1",
  place: "SELECT place_id FROM trapper.places WHERE place_id = $1",
  annotation: "SELECT annotation_id FROM trapper.map_annotations WHERE annotation_id = $1",
};

// Storage path prefixes
const storagePathPrefix: Record<EntityType, string> = {
  request: "requests",
  cat: "cats",
  place: "places",
  annotation: "annotations",
};

// Helper: Get files from FormData (handles both single 'file' and multiple 'files[]')
function getFilesFromFormData(formData: FormData): File[] {
  const files: File[] = [];

  // Check for single file
  const singleFile = formData.get("file") as File | null;
  if (singleFile && singleFile instanceof File) {
    files.push(singleFile);
  }

  // Check for multiple files (files[])
  const multipleFiles = formData.getAll("files[]");
  for (const f of multipleFiles) {
    if (f instanceof File) {
      files.push(f);
    }
  }

  // Also check for 'files' without brackets
  const multipleFiles2 = formData.getAll("files");
  for (const f of multipleFiles2) {
    if (f instanceof File) {
      files.push(f);
    }
  }

  return files;
}

// Helper: Upload a single file and create database record
async function uploadSingleFile(
  file: File,
  entityType: EntityType,
  entityId: string,
  options: {
    mediaType: string;
    caption: string | null;
    notes: string | null;
    catDescription: string | null;
    uploadedBy: string;
    confidence: ConfidenceLevel;
    photoGroupId: string | null;
  }
): Promise<{ success: true; result: UploadResult } | { success: false; error: string }> {
  // Read file
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Generate storage filename
  const timestamp = Date.now();
  const hash = createHash("sha256").update(buffer).digest("hex").substring(0, 8);
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const storedFilename = `${entityId}_${timestamp}_${hash}.${ext}`;

  // Determine MIME type
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    pdf: "application/pdf",
  };
  const mimeType = mimeTypes[ext] || "application/octet-stream";

  // Storage path in bucket: {entity_type}s/{entity_id}/{filename}
  const storagePath = `${storagePathPrefix[entityType]}/${entityId}/${storedFilename}`;

  // Upload to Supabase Storage
  const uploadResult = await uploadFile(storagePath, buffer, mimeType);
  if (!uploadResult.success) {
    return { success: false, error: uploadResult.error || "Failed to upload to storage" };
  }
  const publicUrl = uploadResult.url || getPublicUrl(storagePath);

  // Build the INSERT query based on entity type
  const insertColumns = [
    "media_type",
    "original_filename",
    "stored_filename",
    "file_size_bytes",
    "mime_type",
    "storage_provider",
    "storage_path",
    "caption",
    "notes",
    "cat_description",
    "uploaded_by",
    "cat_identification_confidence",
    "photo_group_id",
  ];

  const insertValues: (string | number | null)[] = [
    options.mediaType,
    file.name,
    storedFilename,
    buffer.length,
    mimeType,
    "supabase",
    publicUrl,
    options.caption,
    options.notes,
    options.catDescription,
    options.uploadedBy,
    options.confidence,
    options.photoGroupId,
  ];

  // Annotations store photo_url directly — skip DB record, return storage URL
  if (entityType === "annotation") {
    return {
      success: true,
      result: {
        media_id: `annotation_${entityId}_${Date.now()}`,
        stored_filename: storedFilename,
        storage_path: publicUrl,
      },
    };
  }

  // Add entity-specific column
  let entityColumn: string;
  switch (entityType) {
    case "request":
      entityColumn = "request_id";
      break;
    case "cat":
      entityColumn = "direct_cat_id";
      break;
    case "place":
      entityColumn = "place_id";
      break;
    default:
      entityColumn = "request_id";
  }

  insertColumns.unshift(entityColumn);
  insertValues.unshift(entityId);

  const placeholders = insertValues.map((_, i) => {
    // Handle media_type enum cast (second placeholder after entity column)
    if (i === 1) return `$${i + 1}::trapper.media_type`;
    return `$${i + 1}`;
  });

  const sql = `
    INSERT INTO trapper.request_media (${insertColumns.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING media_id
  `;

  const result = await queryOne<{ media_id: string }>(sql, insertValues);

  if (!result) {
    return { success: false, error: "Failed to save media record" };
  }

  return {
    success: true,
    result: {
      media_id: result.media_id,
      stored_filename: storedFilename,
      storage_path: publicUrl,
      photo_group_id: options.photoGroupId || undefined,
    },
  };
}

// POST /api/media/upload - Upload media to any entity
// Supports single file (backward compatible) or batch upload (multiple files)
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Get files (handles both single and multiple)
    const files = getFilesFromFormData(formData);

    // Required fields
    const entityType = formData.get("entity_type") as EntityType | null;
    const entityId = formData.get("entity_id") as string | null;

    // Optional fields
    const mediaType = formData.get("media_type") as string || "site_photo";
    const caption = formData.get("caption") as string || null;
    const notes = formData.get("notes") as string || null;
    const catDescription = formData.get("cat_description") as string || null;
    const uploadedBy = formData.get("uploaded_by") as string || "app_user";

    // New batch upload fields
    const createPhotoGroup = formData.get("create_photo_group") === "true";
    const photoGroupName = formData.get("photo_group_name") as string || null;
    const confidence = (formData.get("cat_identification_confidence") as ConfidenceLevel) || "unidentified";

    // Validation
    if (files.length === 0) {
      return NextResponse.json(
        { error: "No file(s) provided" },
        { status: 400 }
      );
    }

    if (!entityType || !["request", "cat", "place", "annotation"].includes(entityType)) {
      return NextResponse.json(
        { error: "Invalid entity_type. Must be 'request', 'cat', 'place', or 'annotation'" },
        { status: 400 }
      );
    }

    if (!entityId) {
      return NextResponse.json(
        { error: "entity_id is required" },
        { status: 400 }
      );
    }

    // Validate media type
    const validMediaTypes = ["cat_photo", "site_photo", "evidence", "map_screenshot", "document", "other"];
    if (!validMediaTypes.includes(mediaType)) {
      return NextResponse.json(
        { error: "Invalid media_type" },
        { status: 400 }
      );
    }

    // Validate confidence level
    const validConfidence: ConfidenceLevel[] = ["confirmed", "likely", "uncertain", "unidentified"];
    if (!validConfidence.includes(confidence)) {
      return NextResponse.json(
        { error: "Invalid cat_identification_confidence. Must be 'confirmed', 'likely', 'uncertain', or 'unidentified'" },
        { status: 400 }
      );
    }

    // Verify entity exists
    const entityExists = await queryOne<Record<string, string>>(
      entityQueries[entityType],
      [entityId]
    );

    if (!entityExists) {
      return NextResponse.json(
        { error: `${entityType} not found` },
        { status: 404 }
      );
    }

    // Check storage availability
    if (!isStorageAvailable()) {
      return NextResponse.json(
        { error: "Storage not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    // Create photo group if requested (for batch uploads with grouping)
    let photoGroupId: string | null = null;
    if (createPhotoGroup && files.length > 0 && entityType === "request") {
      const groupName = photoGroupName || `Photo group ${new Date().toLocaleDateString()}`;
      const groupResult = await queryOne<{ create_photo_group: string }>(
        `SELECT trapper.create_photo_group($1, $2, $3) AS create_photo_group`,
        [entityId, groupName, uploadedBy]
      );
      photoGroupId = groupResult?.create_photo_group || null;
    }

    // Upload options
    const uploadOptions = {
      mediaType,
      caption,
      notes,
      catDescription,
      uploadedBy,
      confidence,
      photoGroupId,
    };

    // Single file - return simple response for backward compatibility
    if (files.length === 1) {
      const result = await uploadSingleFile(files[0], entityType, entityId, uploadOptions);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        ...result.result,
      });
    }

    // Batch upload - process all files sequentially
    const results: UploadResult[] = [];
    const failed: Array<{ filename: string; error: string }> = [];

    for (const file of files) {
      const result = await uploadSingleFile(file, entityType, entityId, uploadOptions);

      if (result.success) {
        results.push(result.result);
      } else {
        failed.push({ filename: file.name, error: result.error });
      }
    }

    const response: BatchUploadResponse = {
      success: results.length > 0,
      results,
      failed,
      total_uploaded: results.length,
    };

    if (photoGroupId) {
      response.photo_group_id = photoGroupId;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error uploading media:", error);
    return NextResponse.json(
      { error: "Failed to upload media", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
