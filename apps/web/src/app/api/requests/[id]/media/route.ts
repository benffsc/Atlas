import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { createHash } from "crypto";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";

interface MediaRow {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  thumbnail_path: string | null;
  caption: string | null;
  notes: string | null;
  cat_description: string | null;
  linked_cat_id: string | null;
  uploaded_by: string;
  uploaded_at: string;
  is_archived: boolean;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/requests/[id]/media - List media for a request
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const media = await queryRows<MediaRow>(
      `SELECT
        media_id,
        media_type::TEXT,
        original_filename,
        storage_path,
        thumbnail_path,
        caption,
        notes,
        cat_description,
        linked_cat_id,
        uploaded_by,
        uploaded_at,
        is_archived
       FROM trapper.request_media
       WHERE request_id = $1
         AND NOT is_archived
       ORDER BY uploaded_at DESC`,
      [id]
    );

    return NextResponse.json({ media });
  } catch (error) {
    console.error("Error fetching media:", error);
    return NextResponse.json(
      { error: "Failed to fetch media" },
      { status: 500 }
    );
  }
}

// POST /api/requests/[id]/media - Upload new media
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    // Verify request exists
    const requestExists = await queryOne<{ request_id: string }>(
      `SELECT request_id FROM trapper.sot_requests WHERE request_id = $1`,
      [id]
    );

    if (!requestExists) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mediaType = formData.get("media_type") as string || "site_photo";
    const caption = formData.get("caption") as string || null;
    const notes = formData.get("notes") as string || null;
    const catDescription = formData.get("cat_description") as string || null;
    const uploadedBy = formData.get("uploaded_by") as string || "app_user";

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate media type
    const validTypes = ["cat_photo", "site_photo", "evidence", "map_screenshot", "document", "other"];
    if (!validTypes.includes(mediaType)) {
      return NextResponse.json(
        { error: "Invalid media type" },
        { status: 400 }
      );
    }

    // Read file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate storage filename
    const timestamp = Date.now();
    const hash = createHash("sha256").update(buffer).digest("hex").substring(0, 8);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const storedFilename = `${id}_${timestamp}_${hash}.${ext}`;

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

    // Storage path in bucket: requests/{request_id}/{filename}
    const storagePath = `requests/${id}/${storedFilename}`;
    let storageProvider = "supabase";
    let publicUrl = "";

    // Upload to Supabase Storage
    if (isStorageAvailable()) {
      const uploadResult = await uploadFile(storagePath, buffer, mimeType);
      if (!uploadResult.success) {
        return NextResponse.json(
          { error: uploadResult.error || "Failed to upload to storage" },
          { status: 500 }
        );
      }
      publicUrl = uploadResult.url || getPublicUrl(storagePath);
    } else {
      // Supabase not configured - return error in production
      return NextResponse.json(
        { error: "Storage not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    // Insert into database
    const result = await queryOne<{ media_id: string }>(
      `INSERT INTO trapper.request_media (
        request_id, media_type, original_filename, stored_filename,
        file_size_bytes, mime_type, storage_provider, storage_path,
        caption, notes, cat_description, uploaded_by
      ) VALUES (
        $1, $2::trapper.media_type, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING media_id`,
      [
        id,
        mediaType,
        file.name,
        storedFilename,
        buffer.length,
        mimeType,
        storageProvider,
        publicUrl,
        caption,
        notes,
        catDescription,
        uploadedBy,
      ]
    );

    return NextResponse.json({
      success: true,
      media_id: result?.media_id,
      stored_filename: storedFilename,
      storage_path: publicUrl,
    });
  } catch (error) {
    console.error("Error uploading media:", error);
    return NextResponse.json(
      { error: "Failed to upload media" },
      { status: 500 }
    );
  }
}

// DELETE /api/requests/[id]/media?media_id=xxx - Archive media
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  const mediaId = searchParams.get("media_id");
  const archivedBy = searchParams.get("archived_by") || "app_user";
  const reason = searchParams.get("reason");

  if (!mediaId) {
    return NextResponse.json(
      { error: "media_id required" },
      { status: 400 }
    );
  }

  try {
    const result = await queryOne<{ result: boolean }>(
      `SELECT trapper.archive_media($1, $2, $3) as result`,
      [mediaId, archivedBy, reason]
    );

    if (!result?.result) {
      return NextResponse.json(
        { error: "Media not found or already archived" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error archiving media:", error);
    return NextResponse.json(
      { error: "Failed to archive media" },
      { status: 500 }
    );
  }
}
