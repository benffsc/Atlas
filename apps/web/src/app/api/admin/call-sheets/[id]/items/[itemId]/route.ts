import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import {
  withErrorHandling,
  ApiError,
  requireValidUUID,
  requireValidEnum,
} from "@/lib/api-validation";
import { ENTITY_ENUMS } from "@/lib/enums";

// Disposition -> auto-derived status mapping
const DISPOSITION_STATUS_MAP: Record<string, string> = {
  // Dead ends
  wrong_number: "dead_end",
  disconnected: "dead_end",
  not_interested: "dead_end",
  already_resolved: "dead_end",
  do_not_contact: "dead_end",
  referred_elsewhere: "dead_end",
  // Follow ups
  scheduled_callback: "follow_up",
  needs_more_info: "follow_up",
  // Conversions
  scheduled_trapping: "converted",
  appointment_booked: "converted",
};

// PATCH: Update item (disposition, notes, follow_up_at, status)
export const PATCH = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; itemId: string }> }
  ) => {
    const { id, itemId } = await params;
    requireValidUUID(id, "call_sheet");
    requireValidUUID(itemId, "call_sheet_item");

    const body = await request.json();
    const { disposition, notes, follow_up_at, status: statusOverride } = body;

    // Validate enums if provided
    if (disposition !== undefined) {
      requireValidEnum(
        disposition,
        ENTITY_ENUMS.CALL_DISPOSITION,
        "disposition"
      );
    }
    if (statusOverride !== undefined) {
      requireValidEnum(
        statusOverride,
        ENTITY_ENUMS.CALL_SHEET_ITEM_STATUS,
        "status"
      );
    }

    // Verify item exists and belongs to this sheet
    const existing = await queryOne<{
      item_id: string;
      call_sheet_id: string;
      attempt_count: number;
    }>(
      `SELECT item_id, call_sheet_id, attempt_count
       FROM ops.call_sheet_items
       WHERE item_id = $1 AND call_sheet_id = $2`,
      [itemId, id]
    );

    if (!existing) {
      return apiNotFound("call_sheet_item", itemId);
    }

    // Build dynamic UPDATE
    const setClauses: string[] = [];
    const params_arr: unknown[] = [];
    let paramIdx = 1;

    if (disposition !== undefined) {
      setClauses.push(`disposition = $${paramIdx++}`);
      params_arr.push(disposition);

      // Auto-increment attempt_count
      setClauses.push(`attempt_count = $${paramIdx++}`);
      params_arr.push(existing.attempt_count + 1);

      // Auto-set last_attempted_at
      setClauses.push(`last_attempted_at = NOW()`);

      // Auto-derive status from disposition (unless explicit override)
      if (!statusOverride) {
        const derivedStatus =
          DISPOSITION_STATUS_MAP[disposition] || "attempted";
        setClauses.push(`status = $${paramIdx++}`);
        params_arr.push(derivedStatus);
      }
    }

    if (statusOverride !== undefined) {
      setClauses.push(`status = $${paramIdx++}`);
      params_arr.push(statusOverride);
    }

    if (notes !== undefined) {
      setClauses.push(`notes = $${paramIdx++}`);
      params_arr.push(notes);
    }

    if (follow_up_at !== undefined) {
      setClauses.push(`follow_up_at = $${paramIdx++}`);
      params_arr.push(follow_up_at);
    }

    if (setClauses.length === 0) {
      throw new ApiError("No fields to update", 400);
    }

    setClauses.push(`updated_at = NOW()`);

    await queryOne(
      `UPDATE ops.call_sheet_items
       SET ${setClauses.join(", ")}
       WHERE item_id = $${paramIdx}`,
      [...params_arr, itemId]
    );

    // Check if all items on this sheet are done — auto-complete sheet if so
    const pendingItems = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM ops.call_sheet_items
       WHERE call_sheet_id = $1
         AND status IN ('pending', 'follow_up')`,
      [id]
    );

    if (pendingItems && pendingItems.count === 0) {
      await queryOne(
        `UPDATE ops.call_sheets
         SET status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE call_sheet_id = $1 AND status != 'completed'`,
        [id]
      );
    }

    return apiSuccess({ updated: true });
  }
);

// DELETE: Remove item from sheet
export const DELETE = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; itemId: string }> }
  ) => {
    const { id, itemId } = await params;
    requireValidUUID(id, "call_sheet");
    requireValidUUID(itemId, "call_sheet_item");

    const deleted = await queryOne<{ item_id: string }>(
      `DELETE FROM ops.call_sheet_items
       WHERE item_id = $1 AND call_sheet_id = $2
       RETURNING item_id`,
      [itemId, id]
    );

    if (!deleted) {
      return apiNotFound("call_sheet_item", itemId);
    }

    return apiSuccess({ deleted: true });
  }
);
