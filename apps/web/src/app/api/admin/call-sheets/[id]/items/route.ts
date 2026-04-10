import { NextRequest } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import {
  withErrorHandling,
  ApiError,
  requireValidUUID,
} from "@/lib/api-validation";

interface NewCallSheetItem {
  contact_name: string;
  contact_phone?: string | null;
  contact_email?: string | null;
  place_id?: string | null;
  place_address?: string | null;
  request_id?: string | null;
  person_id?: string | null;
  context_summary?: string | null;
}

// POST: Add items to a call sheet (supports bulk)
export const POST = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;
    requireValidUUID(id, "call_sheet");

    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ApiError("items array is required and must not be empty", 400);
    }

    // Validate each item has contact_name
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as NewCallSheetItem;
      if (!item.contact_name || item.contact_name.trim() === "") {
        throw new ApiError(
          `items[${i}].contact_name is required and cannot be empty`,
          400
        );
      }
      // Validate optional UUIDs
      if (item.place_id) {
        requireValidUUID(item.place_id, `items[${i}].place_id`);
      }
      if (item.request_id) {
        requireValidUUID(item.request_id, `items[${i}].request_id`);
      }
      if (item.person_id) {
        requireValidUUID(item.person_id, `items[${i}].person_id`);
      }
    }

    const itemIds = await withTransaction(async (tx) => {
      // Verify sheet exists
      const sheet = await tx.queryOne<{ call_sheet_id: string }>(
        `SELECT call_sheet_id FROM ops.call_sheets WHERE call_sheet_id = $1`,
        [id]
      );

      if (!sheet) {
        throw new ApiError("Call sheet not found", 404);
      }

      // Get current max priority_order
      const maxOrder = await tx.queryOne<{ max_order: number }>(
        `SELECT COALESCE(MAX(priority_order), 0)::int AS max_order
         FROM ops.call_sheet_items
         WHERE call_sheet_id = $1`,
        [id]
      );

      let nextOrder = (maxOrder?.max_order ?? 0) + 1;
      const ids: string[] = [];

      for (const item of items as NewCallSheetItem[]) {
        const inserted = await tx.queryOne<{ item_id: string }>(
          `INSERT INTO ops.call_sheet_items (
            call_sheet_id, contact_name, contact_phone, contact_email,
            place_id, place_address, request_id, person_id,
            context_summary, priority_order, status, attempt_count
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, 'pending', 0
          )
          RETURNING item_id`,
          [
            id,
            item.contact_name.trim(),
            item.contact_phone || null,
            item.contact_email || null,
            item.place_id || null,
            item.place_address || null,
            item.request_id || null,
            item.person_id || null,
            item.context_summary || null,
            nextOrder++,
          ]
        );

        if (inserted) {
          ids.push(inserted.item_id);
        }
      }

      return ids;
    });

    return apiSuccess({ added: itemIds.length, item_ids: itemIds });
  }
);
