import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

// POST /api/journal/[id]/restore - Restore an archived journal entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = getCurrentUser(request);
  const restoredBy = request.nextUrl.searchParams.get("restored_by") || user.displayName;

  try {
    requireValidUUID(id, "journal");
    const result = await queryOne<{ id: string }>(
      `UPDATE ops.journal_entries
       SET is_archived = FALSE,
           archived_at = NULL,
           archived_by_staff_id = NULL,
           archive_reason = NULL,
           archive_notes = NULL,
           updated_by = $2,
           updated_at = NOW(),
           meta = meta - 'archive_reason'
       WHERE id = $1 AND is_archived = TRUE
       RETURNING id`,
      [id, restoredBy]
    );

    if (!result) {
      const existing = await queryOne<{ is_archived: boolean }>(
        `SELECT is_archived FROM ops.journal_entries WHERE id = $1`,
        [id]
      );

      if (!existing) {
        return apiNotFound("journal entry", id);
      }

      if (!existing.is_archived) {
        return apiBadRequest("Journal entry is not archived");
      }
    }

    return apiSuccess({
      id,
      restored: true,
      success: true,
    });
  } catch (error) {
    console.error("Error restoring journal entry:", error);
    return apiServerError("Failed to restore journal entry");
  }
}
