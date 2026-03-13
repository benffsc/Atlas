import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID, parsePagination } from "@/lib/api-validation";

interface SyncRunRow {
  run_id: string;
  config_name: string;
  trigger_type: string;
  started_at: string;
  completed_at: string | null;
  records_found: number;
  records_synced: number;
  records_errored: number;
  results: unknown;
  duration_ms: number | null;
  error_summary: string | null;
}

/** GET /api/admin/airtable-syncs/[id]/runs — Paginated run history */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    // Verify config exists
    const config = await queryOne<{ config_id: string; name: string }>(
      `SELECT config_id, name FROM ops.airtable_sync_configs WHERE config_id = $1`,
      [id]
    );
    if (!config) return apiNotFound("Sync config", id);

    const { limit, offset } = parsePagination(request.nextUrl.searchParams);

    const [runs, countResult] = await Promise.all([
      queryRows<SyncRunRow>(
        `SELECT run_id, config_name, trigger_type,
                started_at, completed_at,
                records_found, records_synced, records_errored,
                results, duration_ms, error_summary
         FROM ops.airtable_sync_runs
         WHERE config_id = $1
         ORDER BY started_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ops.airtable_sync_runs WHERE config_id = $1`,
        [id]
      ),
    ]);

    const total = parseInt(countResult?.count || "0", 10);

    return apiSuccess({
      runs,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching sync runs:", error);
    return apiServerError("Failed to fetch sync runs");
  }
}
