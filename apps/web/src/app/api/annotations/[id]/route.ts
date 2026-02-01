import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// PATCH /api/annotations/[id] - Update an annotation
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.label !== undefined) {
      updates.push(`label = $${paramIndex}`);
      values.push(body.label.trim().substring(0, 100));
      paramIndex++;
    }

    if (body.note !== undefined) {
      updates.push(`note = $${paramIndex}`);
      values.push(body.note?.substring(0, 2000) || null);
      paramIndex++;
    }

    if (body.annotation_type !== undefined) {
      const validTypes = ["general", "colony_sighting", "trap_location", "hazard", "feeding_site", "other"];
      if (!validTypes.includes(body.annotation_type)) {
        return NextResponse.json(
          { error: "Invalid annotation_type" },
          { status: 400 }
        );
      }
      updates.push(`annotation_type = $${paramIndex}`);
      values.push(body.annotation_type);
      paramIndex++;
    }

    if (body.photo_url !== undefined) {
      updates.push(`photo_url = $${paramIndex}`);
      values.push(body.photo_url);
      paramIndex++;
    }

    if (body.expires_at !== undefined) {
      updates.push(`expires_at = $${paramIndex}`);
      values.push(body.expires_at);
      paramIndex++;
    }

    if (body.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      values.push(body.is_active);
      paramIndex++;
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(id);

    const result = await queryOne<{ annotation_id: string }>(
      `UPDATE trapper.map_annotations
       SET ${updates.join(", ")}
       WHERE annotation_id = $${paramIndex} AND is_active = TRUE
       RETURNING annotation_id`,
      values
    );

    if (!result) {
      return NextResponse.json(
        { error: "Annotation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, annotation_id: result.annotation_id });
  } catch (error) {
    console.error("Error updating annotation:", error);
    return NextResponse.json(
      { error: "Failed to update annotation" },
      { status: 500 }
    );
  }
}

// DELETE /api/annotations/[id] - Soft-delete an annotation
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await queryOne<{ annotation_id: string }>(
      `UPDATE trapper.map_annotations
       SET is_active = FALSE
       WHERE annotation_id = $1 AND is_active = TRUE
       RETURNING annotation_id`,
      [id]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Annotation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting annotation:", error);
    return NextResponse.json(
      { error: "Failed to delete annotation" },
      { status: 500 }
    );
  }
}
