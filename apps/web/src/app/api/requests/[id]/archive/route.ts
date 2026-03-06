import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

/**
 * Archive reason codes — data hygiene only (FFS-155).
 * Operational closure reasons moved to CloseRequestModal / resolution_outcome.
 */
const ARCHIVE_REASONS = {
  duplicate: { label: "Duplicate Request", requiresNotes: false },
  merged: { label: "Merged Into Another Request", requiresNotes: true },
  invalid: { label: "Invalid/Spam Data", requiresNotes: false },
  test_data: { label: "Test Data", requiresNotes: false },
  other: { label: "Other Reason", requiresNotes: true },
} as const;

type ArchiveReasonCode = keyof typeof ARCHIVE_REASONS;

interface ArchiveRequestBody {
  reason: string;
  notes?: string | null;
}

/**
 * POST /api/requests/[id]/archive
 *
 * Archives a request with a reason. Archived requests are hidden from
 * the main list by default but can be shown with a toggle.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "request");

    const body: ArchiveRequestBody = await request.json();
    const { reason, notes } = body;

    // Validate reason is provided
    if (!reason) {
      return apiBadRequest("Archive reason is required");
    }

    // Validate reason is a known code
    if (!(reason in ARCHIVE_REASONS)) {
      return apiBadRequest(
        `Invalid archive reason. Must be one of: ${Object.keys(ARCHIVE_REASONS).join(", ")}`
      );
    }

    const reasonConfig = ARCHIVE_REASONS[reason as ArchiveReasonCode];

    // Validate notes are provided for reasons that require them
    if (reasonConfig.requiresNotes && (!notes || !notes.trim())) {
      return apiBadRequest(
        `Notes are required for archive reason "${reasonConfig.label}"`
      );
    }

    // Check request exists and get current state
    const existing = await queryOne<{
      request_id: string;
      summary: string | null;
      status: string;
      is_archived: boolean;
    }>(
      `SELECT request_id, summary, status::TEXT, COALESCE(is_archived, FALSE) as is_archived
       FROM ops.requests
       WHERE request_id = $1`,
      [id]
    );

    if (!existing) {
      return apiNotFound("Request", id);
    }

    if (existing.is_archived) {
      return apiBadRequest("Request is already archived");
    }

    // Archive the request
    const updated = await queryOne<{
      request_id: string;
      archived_at: string;
    }>(
      `UPDATE ops.requests
       SET is_archived = TRUE,
           archived_at = NOW(),
           archived_by = 'web_user',
           archive_reason = $2,
           archive_notes = $3,
           updated_at = NOW()
       WHERE request_id = $1
       RETURNING request_id, archived_at::TEXT`,
      [id, reason, notes?.trim() || null]
    );

    if (!updated) {
      return apiServerError("Failed to archive request");
    }

    // Log archive action in journal
    try {
      await queryOne(
        `INSERT INTO ops.journal_entries (
          primary_request_id, entry_kind, body, meta, created_at
        ) VALUES (
          $1, 'status_change', $2, $3, NOW()
        )`,
        [
          id,
          `Request archived: ${reasonConfig.label}`,
          JSON.stringify({
            action: "archive",
            reason_code: reason,
            reason_label: reasonConfig.label,
            notes: notes?.trim() || null,
          }),
        ]
      );
    } catch (journalErr) {
      // Don't fail the archive if journal entry fails
      console.error("Failed to create journal entry for archive:", journalErr);
    }

    return apiSuccess({
      request_id: id,
      archived: true,
      archived_at: updated.archived_at,
      reason: reason,
      reason_label: reasonConfig.label,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error archiving request:", error);
    return apiServerError("Failed to archive request");
  }
}

/**
 * DELETE /api/requests/[id]/archive
 *
 * Restores an archived request (un-archives it).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "request");

    // Check request exists and is archived
    const existing = await queryOne<{
      request_id: string;
      is_archived: boolean;
    }>(
      `SELECT request_id, COALESCE(is_archived, FALSE) as is_archived
       FROM ops.requests
       WHERE request_id = $1`,
      [id]
    );

    if (!existing) {
      return apiNotFound("Request", id);
    }

    if (!existing.is_archived) {
      return apiBadRequest("Request is not archived");
    }

    // Restore the request
    const updated = await queryOne<{ request_id: string }>(
      `UPDATE ops.requests
       SET is_archived = FALSE,
           archived_at = NULL,
           archived_by = NULL,
           archive_reason = NULL,
           archive_notes = NULL,
           updated_at = NOW()
       WHERE request_id = $1
       RETURNING request_id`,
      [id]
    );

    if (!updated) {
      return apiServerError("Failed to restore request");
    }

    // Log restore action in journal
    try {
      await queryOne(
        `INSERT INTO ops.journal_entries (
          primary_request_id, entry_kind, body, meta, created_at
        ) VALUES (
          $1, 'status_change', $2, $3, NOW()
        )`,
        [
          id,
          `Request restored from archive`,
          JSON.stringify({ action: "restore" }),
        ]
      );
    } catch (journalErr) {
      console.error("Failed to create journal entry for restore:", journalErr);
    }

    return apiSuccess({
      request_id: id,
      archived: false,
      restored: true,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error restoring request:", error);
    return apiServerError("Failed to restore request");
  }
}
