import { queryOne } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling } from "@/lib/api-validation";

const STALE_THRESHOLD_HOURS = 6;

/**
 * GET /api/equipment/sync-status
 * Returns Airtable sync metadata for the equipment transition UI.
 */
export const GET = withErrorHandling(async () => {
  const [lastSyncRow, lastResultRow, transitionRow, counts] = await Promise.all([
    queryOne<{ value: string }>(
      `SELECT value FROM ops.app_config WHERE key = 'equipment.last_sync_at'`
    ),
    queryOne<{ value: string }>(
      `SELECT value FROM ops.app_config WHERE key = 'equipment.last_sync_result'`
    ),
    queryOne<{ value: string }>(
      `SELECT value FROM ops.app_config WHERE key = 'equipment.transition_active'`
    ),
    queryOne<{ total: number; atlas_only: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE source_system = 'atlas_ui')::int AS atlas_only
       FROM ops.equipment`
    ),
  ]);

  const lastSyncAt = lastSyncRow?.value || null;
  const minutesAgo = lastSyncAt
    ? Math.round((Date.now() - new Date(lastSyncAt).getTime()) / 60000)
    : null;

  return apiSuccess({
    last_sync_at: lastSyncAt,
    last_sync_result: lastResultRow?.value ? JSON.parse(lastResultRow.value) : null,
    minutes_ago: minutesAgo,
    is_stale: minutesAgo === null || minutesAgo > STALE_THRESHOLD_HOURS * 60,
    atlas_only_count: counts?.atlas_only || 0,
    total_equipment: counts?.total || 0,
    transition_active: transitionRow?.value === "true",
  });
});
