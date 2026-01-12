import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface JournalEntryRow {
  id: string;
  entry_kind: string;
  title: string | null;
  body: string;
  primary_cat_id: string | null;
  primary_person_id: string | null;
  primary_place_id: string | null;
  primary_request_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  occurred_at: string | null;
  is_archived: boolean;
  is_pinned: boolean;
  edit_count: number;
  tags: string[];
  cat_name?: string;
  person_name?: string;
  place_name?: string;
}

// GET /api/journal/[id] - Get a single journal entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const entry = await queryOne<JournalEntryRow>(
      `SELECT
        je.id,
        je.entry_kind::TEXT AS entry_kind,
        je.title,
        je.body,
        je.primary_cat_id,
        je.primary_person_id,
        je.primary_place_id,
        je.primary_request_id,
        je.created_by,
        je.created_at,
        je.updated_by,
        je.updated_at,
        je.occurred_at,
        je.is_archived,
        je.is_pinned,
        je.edit_count,
        je.tags,
        c.display_name AS cat_name,
        p.display_name AS person_name,
        pl.display_name AS place_name
      FROM trapper.journal_entries je
      LEFT JOIN trapper.sot_cats c ON c.cat_id = je.primary_cat_id
      LEFT JOIN trapper.sot_people p ON p.person_id = je.primary_person_id
      LEFT JOIN trapper.places pl ON pl.place_id = je.primary_place_id
      WHERE je.id = $1`,
      [id]
    );

    if (!entry) {
      return NextResponse.json(
        { error: "Journal entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(entry);
  } catch (error) {
    console.error("Error fetching journal entry:", error);
    return NextResponse.json(
      { error: "Failed to fetch journal entry" },
      { status: 500 }
    );
  }
}

// PATCH /api/journal/[id] - Update a journal entry
interface UpdateEntryBody {
  body?: string;
  title?: string;
  entry_kind?: string;
  occurred_at?: string;
  tags?: string[];
  is_pinned?: boolean;
  updated_by?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const data: UpdateEntryBody = await request.json();

    // Build dynamic update
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.body !== undefined) {
      updates.push(`body = $${paramIndex}`);
      values.push(data.body.trim());
      paramIndex++;
    }

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(data.title?.trim() || null);
      paramIndex++;
    }

    if (data.entry_kind !== undefined) {
      updates.push(`entry_kind = $${paramIndex}::trapper.journal_entry_kind`);
      values.push(data.entry_kind);
      paramIndex++;
    }

    if (data.occurred_at !== undefined) {
      updates.push(`occurred_at = $${paramIndex}`);
      values.push(data.occurred_at || null);
      paramIndex++;
    }

    if (data.tags !== undefined) {
      updates.push(`tags = $${paramIndex}`);
      values.push(data.tags);
      paramIndex++;
    }

    if (data.is_pinned !== undefined) {
      updates.push(`is_pinned = $${paramIndex}`);
      values.push(data.is_pinned);
      paramIndex++;
    }

    // Always update updated_by and updated_at
    const updatedBy = data.updated_by || "app_user"; // TODO: Get from auth context
    updates.push(`updated_by = $${paramIndex}`);
    values.push(updatedBy);
    paramIndex++;

    if (updates.length === 1) {
      // Only updated_by was added, no actual changes
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(id);

    const result = await queryOne<{ id: string }>(
      `UPDATE trapper.journal_entries
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING id`,
      values
    );

    if (!result) {
      return NextResponse.json(
        { error: "Journal entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: result.id,
      success: true,
    });
  } catch (error) {
    console.error("Error updating journal entry:", error);
    return NextResponse.json(
      { error: "Failed to update journal entry" },
      { status: 500 }
    );
  }
}

// DELETE /api/journal/[id] - Archive a journal entry (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get optional reason from query params
  const reason = request.nextUrl.searchParams.get("reason");
  const archivedBy = request.nextUrl.searchParams.get("archived_by") || "app_user";

  try {
    const result = await queryOne<{ id: string }>(
      `UPDATE trapper.journal_entries
       SET is_archived = TRUE,
           updated_by = $2,
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('archive_reason', $3)
       WHERE id = $1 AND is_archived = FALSE
       RETURNING id`,
      [id, archivedBy, reason]
    );

    if (!result) {
      // Check if it exists but is already archived
      const existing = await queryOne<{ is_archived: boolean }>(
        `SELECT is_archived FROM trapper.journal_entries WHERE id = $1`,
        [id]
      );

      if (!existing) {
        return NextResponse.json(
          { error: "Journal entry not found" },
          { status: 404 }
        );
      }

      if (existing.is_archived) {
        return NextResponse.json(
          { error: "Journal entry is already archived" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      id,
      archived: true,
      success: true,
    });
  } catch (error) {
    console.error("Error archiving journal entry:", error);
    return NextResponse.json(
      { error: "Failed to archive journal entry" },
      { status: 500 }
    );
  }
}
