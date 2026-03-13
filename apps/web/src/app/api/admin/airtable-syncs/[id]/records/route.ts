import { NextRequest } from "next/server";
import { queryOne, queryRows, query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID, parsePagination } from "@/lib/api-validation";

interface SyncRecordRow {
  record_id: string;
  config_name: string;
  run_id: string | null;
  airtable_record_id: string;
  raw_fields: unknown;
  mapped_fields: unknown;
  status: string;
  entity_id: string | null;
  match_type: string | null;
  rejection_reason: string | null;
  error_message: string | null;
  identity_result: unknown;
  processed_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

/** GET /api/admin/airtable-syncs/[id]/records — Paginated audit trail */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    const config = await queryOne<{ config_id: string }>(
      `SELECT config_id FROM ops.airtable_sync_configs WHERE config_id = $1`,
      [id]
    );
    if (!config) return apiNotFound("Sync config", id);

    const { limit, offset } = parsePagination(request.nextUrl.searchParams);

    // Filter by status (optional) and archive state
    const statusFilter = request.nextUrl.searchParams.get("status");
    const showArchived = request.nextUrl.searchParams.get("archived") === "true";

    let whereClause = "config_id = $1";
    const queryParams: unknown[] = [id];
    let paramIdx = 2;

    if (statusFilter && ["synced", "rejected", "error"].includes(statusFilter)) {
      whereClause += ` AND status = $${paramIdx}`;
      queryParams.push(statusFilter);
      paramIdx++;
    }

    if (!showArchived) {
      whereClause += " AND archived_at IS NULL";
    }

    const [records, countResult] = await Promise.all([
      queryRows<SyncRecordRow>(
        `SELECT record_id, config_name, run_id,
                airtable_record_id, raw_fields, mapped_fields,
                status, entity_id, match_type,
                rejection_reason, error_message, identity_result,
                processed_at, archived_at, archived_by
         FROM ops.airtable_sync_records
         WHERE ${whereClause}
         ORDER BY processed_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...queryParams, limit, offset]
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ops.airtable_sync_records WHERE ${whereClause}`,
        queryParams
      ),
    ]);

    const total = parseInt(countResult?.count || "0", 10);

    return apiSuccess({ records, total, limit, offset });
  } catch (error) {
    console.error("[ADMIN] Error fetching sync records:", error);
    return apiServerError("Failed to fetch sync records");
  }
}

/** PATCH /api/admin/airtable-syncs/[id]/records — Archive/unarchive records */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    const body = await request.json();
    const { record_ids, action } = body as {
      record_ids: string[];
      action: "archive" | "unarchive";
    };

    if (!record_ids || !Array.isArray(record_ids) || record_ids.length === 0) {
      return apiError("record_ids array is required", 400);
    }
    if (!["archive", "unarchive"].includes(action)) {
      return apiError("action must be 'archive' or 'unarchive'", 400);
    }

    for (const rid of record_ids) {
      requireValidUUID(rid, "sync_record");
    }

    if (action === "archive") {
      await query(
        `UPDATE ops.airtable_sync_records
         SET archived_at = NOW(), archived_by = $1
         WHERE config_id = $2 AND record_id = ANY($3) AND archived_at IS NULL`,
        [session.staff_id || null, id, record_ids]
      );
    } else {
      await query(
        `UPDATE ops.airtable_sync_records
         SET archived_at = NULL, archived_by = NULL
         WHERE config_id = $1 AND record_id = ANY($2) AND archived_at IS NOT NULL`,
        [id, record_ids]
      );
    }

    return apiSuccess({ action, count: record_ids.length });
  } catch (error) {
    console.error("[ADMIN] Error archiving sync records:", error);
    return apiServerError("Failed to archive sync records");
  }
}
