import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { parsePagination, requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import type { EquipmentCollectionTaskRow } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/collections
 * List equipment collection tasks with optional status filter
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`collection_status = $${paramIdx}`);
    params.push(status);
    paramIdx++;
  }

  if (search) {
    conditions.push(`(person_name ILIKE $${paramIdx} OR equipment_description ILIKE $${paramIdx} OR phone ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  // Default: exclude resolved unless explicitly requested
  if (!searchParams.has("include_resolved")) {
    conditions.push(`resolved_at IS NULL`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const tasks = await queryRows<EquipmentCollectionTaskRow>(
    `SELECT * FROM ops.equipment_collection_tasks ${whereClause}
     ORDER BY
       CASE collection_status
         WHEN 'pending' THEN 1
         WHEN 'contacted' THEN 2
         WHEN 'will_return' THEN 3
         WHEN 'do_not_collect' THEN 4
         WHEN 'no_traps' THEN 5
         WHEN 'collected' THEN 6
         ELSE 7
       END,
       created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, limit, offset]
  );

  const countResult = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM ops.equipment_collection_tasks ${whereClause}`,
    params
  );

  return apiSuccess(
    { tasks },
    { total: countResult?.total || 0, limit, offset }
  );
});

/**
 * PATCH /api/equipment/collections
 * Update a collection task (status, notes, outreach)
 */
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const { task_id, collection_status, notes, outreach_method } = body;

  if (!task_id) {
    throw new ApiError("task_id is required", 400);
  }
  requireValidUUID(task_id, "collection_task");

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (collection_status !== undefined) {
    updates.push(`collection_status = $${paramIdx}`);
    values.push(collection_status);
    paramIdx++;

    // Auto-set resolved_at for terminal statuses
    if (collection_status === "collected" || collection_status === "no_traps") {
      updates.push(`resolved_at = NOW()`);
    }

    // Track last contact for outreach statuses
    if (collection_status === "contacted" || collection_status === "will_return") {
      updates.push(`last_contacted_at = NOW()`);
    }
  }

  if (notes !== undefined) {
    updates.push(`notes = $${paramIdx}`);
    values.push(notes);
    paramIdx++;
  }

  if (outreach_method !== undefined) {
    updates.push(`outreach_method = $${paramIdx}`);
    values.push(outreach_method);
    paramIdx++;
  }

  if (updates.length === 0) {
    throw new ApiError("No valid fields to update", 400);
  }

  updates.push(`updated_at = NOW()`);
  values.push(task_id);

  const result = await queryOne<{ task_id: string }>(
    `UPDATE ops.equipment_collection_tasks
     SET ${updates.join(", ")}
     WHERE task_id = $${paramIdx}
     RETURNING task_id`,
    values
  );

  if (!result) {
    return apiNotFound("collection_task", task_id);
  }

  return apiSuccess({ task_id: result.task_id });
});
