/**
 * GET /api/health/intake-geocoding
 *
 * Part of FFS-1181 Follow-Up Phase 4. Health check endpoint for the
 * intake geocoding queue. Returns:
 *
 *   {
 *     pending, ok, failed, zero_results, unreachable, manual_override, skipped,
 *     oldest_pending_age_minutes,
 *     cache_hit_rate_24h
 *   }
 *
 * Public endpoint — safe to hit from uptime monitors.
 */

import { apiSuccess, apiServerError } from "@/lib/api-response";
import { queryOne } from "@/lib/db";

export async function GET() {
  try {
    const health = await queryOne<{
      pending: number;
      ok: number;
      failed: number;
      zero_results: number;
      unreachable: number;
      manual_override: number;
      skipped: number;
      oldest_pending_age_minutes: number | null;
    }>(`SELECT * FROM ops.v_intake_geocoding_health`);

    // Rough 24h cache hit rate from ops.geocode_cache hit_count bumps
    // over 24h window. This is an approximation — a true rolling window
    // would require a separate event log.
    const cacheStats = await queryOne<{
      total_hits: number;
      entries_touched_24h: number;
    }>(
      `SELECT
         COALESCE(SUM(hit_count), 0)::INT AS total_hits,
         COUNT(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '24 hours')::INT
           AS entries_touched_24h
       FROM ops.geocode_cache`
    );

    return apiSuccess({
      ...health,
      cache: {
        total_hits_lifetime: cacheStats?.total_hits ?? 0,
        entries_touched_24h: cacheStats?.entries_touched_24h ?? 0,
      },
    });
  } catch (err) {
    console.error("health/intake-geocoding error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Health check failed"
    );
  }
}
