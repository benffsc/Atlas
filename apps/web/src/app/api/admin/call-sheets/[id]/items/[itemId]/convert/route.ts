import { NextRequest } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import {
  withErrorHandling,
  ApiError,
  requireValidUUID,
} from "@/lib/api-validation";

// POST: Convert a successful call to a trapping assignment or new request
export const POST = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; itemId: string }> }
  ) => {
    const { id, itemId } = await params;
    requireValidUUID(id, "call_sheet");
    requireValidUUID(itemId, "call_sheet_item");

    const body = await request.json();
    const { convert_to, request_id, trapper_person_id } = body;

    if (!convert_to) {
      throw new ApiError("convert_to is required", 400);
    }

    const validConvertTypes = ["request_assignment", "new_request"] as const;
    if (!validConvertTypes.includes(convert_to)) {
      throw new ApiError(
        `convert_to must be one of: ${validConvertTypes.join(", ")}`,
        400
      );
    }

    const entityId = await withTransaction(async (tx) => {
      // Verify item exists and belongs to this sheet
      const item = await tx.queryOne<{
        item_id: string;
        call_sheet_id: string;
        status: string;
        request_id: string | null;
        person_id: string | null;
      }>(
        `SELECT item_id, call_sheet_id, status, request_id, person_id
         FROM ops.call_sheet_items
         WHERE item_id = $1 AND call_sheet_id = $2`,
        [itemId, id]
      );

      if (!item) {
        throw new ApiError("Call sheet item not found", 404);
      }

      // Fetch the sheet to get the assigned trapper
      const sheet = await tx.queryOne<{
        assigned_to_person_id: string | null;
      }>(
        `SELECT assigned_to_person_id FROM ops.call_sheets WHERE call_sheet_id = $1`,
        [id]
      );

      if (convert_to === "request_assignment") {
        // Determine which request to assign to
        const targetRequestId = request_id || item.request_id;
        if (!targetRequestId) {
          throw new ApiError(
            "request_id is required for request_assignment (item has no linked request)",
            400
          );
        }
        requireValidUUID(targetRequestId, "request_id");

        // Determine trapper — explicit param > sheet assignee
        const trapperPersonId =
          trapper_person_id || sheet?.assigned_to_person_id;
        if (!trapperPersonId) {
          throw new ApiError(
            "trapper_person_id is required (sheet has no assigned trapper)",
            400
          );
        }
        requireValidUUID(trapperPersonId, "trapper_person_id");

        // Create trapper assignment
        const assignment = await tx.queryOne<{ id: string }>(
          `INSERT INTO ops.request_trapper_assignments (
            request_id, trapper_person_id, assignment_type, status,
            notes, source_system, assigned_at
          ) VALUES (
            $1::uuid, $2::uuid, 'primary', 'active',
            'Converted from call sheet', 'atlas_ui', NOW()
          )
          RETURNING id`,
          [targetRequestId, trapperPersonId]
        );

        if (!assignment) {
          throw new ApiError("Failed to create trapper assignment", 500);
        }

        // Update the call sheet item
        await tx.query(
          `UPDATE ops.call_sheet_items
           SET converted_to_type = 'request_assignment',
               converted_to_id = $1,
               converted_at = NOW(),
               status = 'converted',
               updated_at = NOW()
           WHERE item_id = $2`,
          [assignment.id, itemId]
        );

        return assignment.id;
      }

      // convert_to === "new_request" is a placeholder for future expansion
      throw new ApiError(
        "new_request conversion is not yet implemented",
        501
      );
    });

    return apiSuccess({ converted: true, entity_id: entityId });
  }
);
