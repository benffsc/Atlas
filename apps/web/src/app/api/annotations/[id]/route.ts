import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

// GET /api/annotations/[id] - Get annotation details with journal entries
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const annotation = await queryOne<{
      annotation_id: string;
      label: string;
      note: string | null;
      photo_url: string | null;
      annotation_type: string;
      created_by: string;
      expires_at: string | null;
      is_active: boolean;
      created_at: string;
      lat: number;
      lng: number;
      journal_count: number;
    }>(
      `SELECT
        a.annotation_id,
        a.label,
        a.note,
        a.photo_url,
        a.annotation_type,
        a.created_by,
        a.expires_at::TEXT,
        a.is_active,
        a.created_at::TEXT,
        ST_Y(a.location::geometry) AS lat,
        ST_X(a.location::geometry) AS lng,
        (SELECT COUNT(*) FROM ops.journal_entries je
         WHERE je.primary_annotation_id = a.annotation_id AND je.is_archived = FALSE) AS journal_count
      FROM ops.map_annotations a
      WHERE a.annotation_id = $1`,
      [id]
    );

    if (!annotation) {
      return NextResponse.json(
        { error: "Annotation not found" },
        { status: 404 }
      );
    }

    // Fetch journal entries for this annotation
    const journalEntries = await queryRows<{
      id: string;
      entry_kind: string;
      title: string | null;
      body: string;
      created_by: string | null;
      created_at: string;
    }>(
      `SELECT
        id::TEXT,
        entry_kind::TEXT,
        title,
        body,
        created_by,
        created_at::TEXT
      FROM ops.journal_entries
      WHERE primary_annotation_id = $1 AND is_archived = FALSE
      ORDER BY created_at DESC
      LIMIT 50`,
      [id]
    );

    return NextResponse.json({
      ...annotation,
      journal_entries: journalEntries,
    });
  } catch (error) {
    console.error("Error fetching annotation:", error);
    return NextResponse.json(
      { error: "Failed to fetch annotation" },
      { status: 500 }
    );
  }
}

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
      `UPDATE ops.map_annotations
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
      `UPDATE ops.map_annotations
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
