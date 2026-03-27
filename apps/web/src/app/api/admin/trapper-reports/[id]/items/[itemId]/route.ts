import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne, execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiForbidden, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * GET /api/admin/trapper-reports/[id]/items/[itemId]
 * Get a single item with full details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiForbidden("Admin access required");
  }

  const { id, itemId } = await params;

  try {
    requireValidUUID(id, "trapper_report");
    requireValidUUID(itemId, "item");
    const item = await queryOne(
      `
      SELECT
        i.item_id::text,
        i.submission_id::text,
        i.item_type,
        i.target_entity_type,
        i.target_entity_id::text,
        i.match_confidence,
        i.match_candidates,
        i.extracted_text,
        i.extracted_data,
        i.review_status,
        i.final_entity_id::text,
        i.final_data,
        i.committed_at,
        i.commit_result,
        i.created_at,
        -- Entity details
        CASE i.target_entity_type
          WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = i.target_entity_id)
          WHEN 'place' THEN (SELECT formatted_address FROM sot.places WHERE place_id = i.target_entity_id)
          WHEN 'request' THEN (
            SELECT 'Request at ' || COALESCE(pl.formatted_address, 'unknown') || ' (' || r.status::text || ')'
            FROM ops.requests r
            LEFT JOIN sot.places pl ON pl.place_id = r.place_id
            WHERE r.request_id = i.target_entity_id
          )
        END as target_entity_name
      FROM ops.trapper_report_items i
      WHERE i.submission_id = $1 AND i.item_id = $2
      `,
      [id, itemId]
    );

    if (!item) {
      return apiNotFound("Item", itemId);
    }

    return apiSuccess(item);
  } catch (error) {
    console.error("Error fetching item:", error);
    return apiServerError("Failed to fetch item");
  }
}

/**
 * PATCH /api/admin/trapper-reports/[id]/items/[itemId]
 * Update item review status
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiForbidden("Admin access required");
  }

  const { id, itemId } = await params;
  const body = await request.json();
  const { review_status, final_entity_id, final_data } = body;

  // Validate status
  const validStatuses = ["pending", "approved", "rejected", "needs_clarification"];
  if (review_status && !validStatuses.includes(review_status)) {
    return apiBadRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  try {
    requireValidUUID(id, "trapper_report");
    requireValidUUID(itemId, "item");
    // Verify item belongs to submission
    const item = await queryOne<{ item_id: string }>(
      `SELECT item_id::text FROM ops.trapper_report_items WHERE submission_id = $1 AND item_id = $2`,
      [id, itemId]
    );

    if (!item) {
      return apiNotFound("Item", itemId);
    }

    await execute(
      `
      UPDATE ops.trapper_report_items
      SET
        review_status = COALESCE($1, review_status),
        final_entity_id = COALESCE($2::uuid, final_entity_id),
        final_data = COALESCE($3::jsonb, final_data)
      WHERE item_id = $4
      `,
      [
        review_status,
        final_entity_id || null,
        final_data ? JSON.stringify(final_data) : null,
        itemId,
      ]
    );

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Error updating item:", error);
    return apiServerError("Failed to update item");
  }
}
