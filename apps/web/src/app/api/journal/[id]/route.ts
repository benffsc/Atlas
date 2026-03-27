import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { requireValidUUID, parseBody } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest, apiError } from "@/lib/api-response";
import { UpdateJournalEntrySchema } from "@/lib/schemas";
import { JOURNAL_ARCHIVE_REASON, JOURNAL_ARCHIVE_REASONS_REQUIRING_NOTES, type JournalArchiveReason } from "@/lib/enums";

interface JournalEntryRow {
  id: string;
  entry_kind: string;
  title: string | null;
  body: string;
  primary_cat_id: string | null;
  primary_person_id: string | null;
  primary_place_id: string | null;
  primary_request_id: string | null;
  primary_annotation_id: string | null;
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
  annotation_label?: string;
}

// GET /api/journal/[id] - Get a single journal entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "journal entry");

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
        je.primary_annotation_id,
        je.created_by,
        je.created_at,
        je.updated_by,
        je.updated_at,
        je.occurred_at,
        je.is_archived,
        je.is_pinned,
        je.edit_count,
        je.tags,
        c.name AS cat_name,
        p.display_name AS person_name,
        pl.display_name AS place_name,
        ma.label AS annotation_label
      FROM ops.journal_entries je
      LEFT JOIN sot.cats c ON c.cat_id = je.primary_cat_id
      LEFT JOIN sot.people p ON p.person_id = je.primary_person_id
      LEFT JOIN sot.places pl ON pl.place_id = je.primary_place_id
      LEFT JOIN ops.map_annotations ma ON ma.annotation_id = je.primary_annotation_id
      WHERE je.id = $1`,
      [id]
    );

    if (!entry) {
      return apiNotFound("Journal entry", id);
    }

    return apiSuccess(entry);
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Error fetching journal entry:", error);
    return apiServerError("Failed to fetch journal entry");
  }
}

// PATCH /api/journal/[id] - Update a journal entry
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "journal entry");

    // Validate request body with Zod schema
    const parsed = await parseBody(request, UpdateJournalEntrySchema);
    if ("error" in parsed) return parsed.error;
    const data = parsed.data;

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
      updates.push(`entry_kind = $${paramIndex}`);
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
    const user = getCurrentUser(request);
    const updatedBy = data.updated_by || user.displayName;
    updates.push(`updated_by = $${paramIndex}`);
    values.push(updatedBy);
    paramIndex++;

    if (updates.length === 1) {
      // Only updated_by was added, no actual changes
      return apiBadRequest("No fields to update");
    }

    values.push(id);

    const result = await queryOne<{ id: string }>(
      `UPDATE ops.journal_entries
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING id`,
      values
    );

    if (!result) {
      return apiNotFound("Journal entry", id);
    }

    return apiSuccess({ id: result.id });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Error updating journal entry:", error);
    return apiServerError("Failed to update journal entry");
  }
}

interface ArchiveBody {
  reason: JournalArchiveReason;
  notes?: string;
}

// DELETE /api/journal/[id] - Archive a journal entry (soft delete)
// Requires reason in request body for accountability
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = getCurrentUser(request);

  try {
    requireValidUUID(id, "journal entry");

    // Parse request body for archive reason
    let body: ArchiveBody;
    try {
      body = await request.json();
    } catch {
      return apiBadRequest("Request body required with archive reason");
    }

    // Validate reason is provided
    if (!body.reason) {
      return apiBadRequest(`Archive reason is required. Must be one of: ${JOURNAL_ARCHIVE_REASON.join(", ")}`);
    }

    // Validate reason is from predefined list
    if (!JOURNAL_ARCHIVE_REASON.includes(body.reason as JournalArchiveReason)) {
      return apiBadRequest(`Invalid archive reason. Must be one of: ${JOURNAL_ARCHIVE_REASON.join(", ")}`);
    }

    // Validate notes are provided for reasons that require them
    if (JOURNAL_ARCHIVE_REASONS_REQUIRING_NOTES.includes(body.reason as (typeof JOURNAL_ARCHIVE_REASONS_REQUIRING_NOTES)[number]) && !body.notes?.trim()) {
      return apiBadRequest(`Notes are required when archive reason is "${body.reason}"`);
    }

    const result = await queryOne<{ id: string }>(
      `UPDATE ops.journal_entries
       SET is_archived = TRUE,
           archived_at = NOW(),
           archived_by_staff_id = $2,
           archive_reason = $3,
           archive_notes = $4,
           updated_by = $5,
           updated_at = NOW(),
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('archive_reason', $3::TEXT)
       WHERE id = $1 AND is_archived IS NOT TRUE
       RETURNING id`,
      [id, user.staffId, body.reason, body.notes?.trim() || null, user.displayName]
    );

    if (!result) {
      // Check if it exists but is already archived
      const existing = await queryOne<{ is_archived: boolean }>(
        `SELECT is_archived FROM ops.journal_entries WHERE id = $1`,
        [id]
      );

      if (!existing) {
        return apiNotFound("Journal entry", id);
      }

      if (existing.is_archived) {
        return apiBadRequest("Journal entry is already archived");
      }
    }

    return apiSuccess({ id, archived: true, reason: body.reason });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Error archiving journal entry:", error);
    return apiServerError("Failed to archive journal entry");
  }
}
