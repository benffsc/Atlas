import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";
import { createHash } from "crypto";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";

interface EducationMaterial {
  material_id: string;
  title: string;
  description: string | null;
  category: string;
  file_type: string;
  storage_url: string;
  file_size_bytes: number;
  is_required: boolean;
  required_for_onboarding_status: string | null;
  display_order: number;
  is_active: boolean;
  view_count: number;
  download_count: number;
  created_at: string;
  updated_at: string;
}

// GET /api/trappers/materials - List education materials
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const requiredOnly = searchParams.get("required") === "true";
  const includeInactive = searchParams.get("include_inactive") === "true";

  try {
    let whereClause = "WHERE 1=1";
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (!includeInactive) {
      whereClause += " AND is_active = TRUE";
    }

    if (category) {
      whereClause += ` AND category = $${paramIndex++}`;
      params.push(category);
    }

    if (requiredOnly) {
      whereClause += " AND is_required = TRUE";
    }

    const materials = await queryRows<EducationMaterial>(
      `SELECT
        material_id,
        title,
        description,
        category,
        file_type,
        storage_url,
        file_size_bytes,
        is_required,
        required_for_onboarding_status,
        display_order,
        is_active,
        COALESCE(view_count, 0)::INT AS view_count,
        COALESCE(download_count, 0)::INT AS download_count,
        created_at::TEXT,
        updated_at::TEXT
      FROM ops.education_materials
      ${whereClause}
      ORDER BY display_order, category, title`,
      params
    );

    // Get category counts
    const categories = await queryRows<{ category: string; count: number }>(
      `SELECT category, COUNT(*)::INT AS count
       FROM ops.education_materials
       WHERE is_active = TRUE
       GROUP BY category
       ORDER BY category`
    );

    return NextResponse.json({
      materials,
      categories,
      total: materials.length,
    });
  } catch (error) {
    console.error("Error fetching materials:", error);
    return NextResponse.json(
      { error: "Failed to fetch materials" },
      { status: 500 }
    );
  }
}

// POST /api/trappers/materials - Upload new material (admin)
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string | null;
    const category = formData.get("category") as string || "general";
    const isRequired = formData.get("is_required") === "true";
    const requiredStatus = formData.get("required_for_onboarding_status") as string | null;
    const displayOrder = parseInt(formData.get("display_order") as string || "0", 10);

    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: "File is required" },
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
    const storedFilename = `${timestamp}_${hash}.${ext}`;

    // Determine file type from extension
    const fileTypeMap: Record<string, string> = {
      pdf: "pdf",
      doc: "document",
      docx: "document",
      mp4: "video",
      mov: "video",
      webm: "video",
      jpg: "image",
      jpeg: "image",
      png: "image",
      gif: "image",
    };
    const fileType = fileTypeMap[ext] || "other";

    // MIME type
    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
    };
    const mimeType = mimeTypes[ext] || "application/octet-stream";

    // Storage path
    const storagePath = `education/${category}/${storedFilename}`;
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
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 500 }
      );
    }

    // Insert into database
    const result = await queryOne<{ material_id: string }>(
      `INSERT INTO ops.education_materials (
        title, description, category, file_type, storage_url, file_size_bytes,
        original_filename, is_required, required_for_onboarding_status, display_order
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      RETURNING material_id`,
      [
        title,
        description,
        category,
        fileType,
        publicUrl,
        buffer.length,
        file.name,
        isRequired,
        requiredStatus,
        displayOrder,
      ]
    );

    return NextResponse.json({
      success: true,
      material_id: result?.material_id,
      storage_url: publicUrl,
    });
  } catch (error) {
    console.error("Error uploading material:", error);
    return NextResponse.json(
      { error: "Failed to upload material" },
      { status: 500 }
    );
  }
}

// PATCH /api/trappers/materials - Update material metadata
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { material_id, ...updates } = body;

    if (!material_id) {
      return NextResponse.json(
        { error: "material_id is required" },
        { status: 400 }
      );
    }

    const allowedFields = [
      "title",
      "description",
      "category",
      "is_required",
      "required_for_onboarding_status",
      "display_order",
      "is_active",
    ];

    const setClause: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (setClause.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    setClause.push(`updated_at = NOW()`);
    values.push(material_id);

    await query(
      `UPDATE ops.education_materials
       SET ${setClause.join(", ")}
       WHERE material_id = $${paramIndex}`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating material:", error);
    return NextResponse.json(
      { error: "Failed to update material" },
      { status: 500 }
    );
  }
}

// DELETE /api/trappers/materials - Archive material (soft delete)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const materialId = searchParams.get("material_id");

  if (!materialId) {
    return NextResponse.json(
      { error: "material_id is required" },
      { status: 400 }
    );
  }

  try {
    await query(
      `UPDATE ops.education_materials
       SET is_active = FALSE, updated_at = NOW()
       WHERE material_id = $1`,
      [materialId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error archiving material:", error);
    return NextResponse.json(
      { error: "Failed to archive material" },
      { status: 500 }
    );
  }
}
