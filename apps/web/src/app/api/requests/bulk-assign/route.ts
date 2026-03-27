import { NextRequest } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { logFieldEdit } from "@/lib/audit";
import { apiSuccess, apiBadRequest } from "@/lib/api-response";
import { withErrorHandling, ApiError, requireValidUUID } from "@/lib/api-validation";

/**
 * POST /api/requests/bulk-assign
 *
 * Assign a trapper to multiple requests at once.
 * Body: { request_ids: string[], trapper_id: string, notes?: string }
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const { request_ids, trapper_id, notes } = body as {
    request_ids?: string[];
    trapper_id?: string;
    notes?: string;
  };

  if (!request_ids || !Array.isArray(request_ids) || request_ids.length === 0) {
    return apiBadRequest("request_ids must be a non-empty array");
  }
  if (request_ids.length > 50) {
    return apiBadRequest("Maximum 50 requests per bulk assignment");
  }
  if (!trapper_id) {
    return apiBadRequest("trapper_id is required");
  }

  requireValidUUID(trapper_id, "trapper");
  for (const rid of request_ids) {
    requireValidUUID(rid, "request");
  }

  // Verify trapper exists
  const trapper = await queryOne<{ person_id: string; display_name: string }>(
    `SELECT p.id AS person_id, p.display_name
     FROM sot.people p
     JOIN sot.trapper_profiles tp ON tp.person_id = p.id
     WHERE p.id = $1 AND p.merged_into_person_id IS NULL`,
    [trapper_id]
  );

  if (!trapper) {
    throw new ApiError("Trapper not found or not a registered trapper", 404);
  }

  const results: { request_id: string; status: "assigned" | "already_assigned" | "not_found" }[] = [];

  await withTransaction(async (client) => {
    for (const requestId of request_ids) {
      // Check request exists
      const req = await client.query(
        `SELECT id FROM ops.requests WHERE id = $1 AND merged_into_request_id IS NULL`,
        [requestId]
      );

      if (req.rows.length === 0) {
        results.push({ request_id: requestId, status: "not_found" });
        continue;
      }

      // Check if already assigned
      const existing = await client.query(
        `SELECT id FROM ops.request_trapper_assignments
         WHERE request_id = $1 AND trapper_person_id = $2 AND status = 'active'`,
        [requestId, trapper_id]
      );

      if (existing.rows.length > 0) {
        results.push({ request_id: requestId, status: "already_assigned" });
        continue;
      }

      // Create assignment
      await client.query(
        `INSERT INTO ops.request_trapper_assignments (request_id, trapper_person_id, assignment_type, notes, status, assigned_at)
         VALUES ($1, $2, 'primary', $3, 'active', NOW())`,
        [requestId, trapper_id, notes || null]
      );

      await logFieldEdit(
        "request",
        requestId,
        "trapper_assignment",
        null,
        trapper_id,
        { reason: `Bulk assigned to ${trapper.display_name}` }
      );

      results.push({ request_id: requestId, status: "assigned" });
    }
  });

  const assigned = results.filter(r => r.status === "assigned").length;
  const alreadyAssigned = results.filter(r => r.status === "already_assigned").length;

  return apiSuccess({
    results,
    summary: { assigned, already_assigned: alreadyAssigned, not_found: results.filter(r => r.status === "not_found").length },
    trapper: { id: trapper_id, name: trapper.display_name },
  });
});
