import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Entity Linking Health Check
 *
 * Verifies critical entity linking invariants:
 * - Clinic address leakage = 0 (MIG_2430)
 * - Cat-place coverage metrics
 * - Skipped entity reasons
 *
 * GET /api/health/entity-linking
 */
export async function GET() {
  try {
    // Check clinic leakage (should always be 0)
    const clinicLeakage = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int as count
      FROM sot.cat_place_relationships cpr
      JOIN sot.places p ON p.id = cpr.place_id
      WHERE p.formatted_address ILIKE ANY(ARRAY[
        '%1814%Empire Industrial%',
        '%1820%Empire Industrial%',
        '%845 Todd%'
      ])
    `);

    // Cat-place coverage
    const coverage = await queryOne<{
      total_cats: number;
      cats_with_place: number;
      coverage_pct: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM sot.cats WHERE merged_into_cat_id IS NULL) as total_cats,
        (SELECT COUNT(DISTINCT cat_id)::int FROM sot.cat_place_relationships) as cats_with_place,
        CASE
          WHEN (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) = 0 THEN 0
          ELSE ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place_relationships)
            / (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 1)
        END as coverage_pct
    `);

    // Skipped entity summary
    const skippedSummary = await queryRows<{
      reason: string;
      count: number;
    }>(`
      SELECT reason, COUNT(*)::int as count
      FROM ops.entity_linking_skipped
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 10
    `).catch(() => []);

    // Recent linking runs
    const recentRuns = await queryRows<{
      started_at: string;
      duration_ms: number;
      cats_linked: number;
      cats_skipped: number;
    }>(`
      SELECT
        started_at::text,
        EXTRACT(EPOCH FROM (completed_at - started_at))::int * 1000 as duration_ms,
        (result->>'cats_linked')::int as cats_linked,
        (result->>'cats_skipped')::int as cats_skipped
      FROM ops.entity_linking_runs
      ORDER BY started_at DESC
      LIMIT 5
    `).catch(() => []);

    const isHealthy =
      (clinicLeakage?.count ?? 0) === 0 &&
      (coverage?.coverage_pct ?? 0) > 50;

    return apiSuccess({
      status: isHealthy ? "healthy" : "degraded",
      clinic_leakage: clinicLeakage?.count ?? 0,
      cat_place_coverage: {
        total_cats: coverage?.total_cats ?? 0,
        cats_with_place: coverage?.cats_with_place ?? 0,
        coverage_pct: coverage?.coverage_pct ?? 0,
      },
      skipped_reasons: skippedSummary,
      recent_runs: recentRuns,
    });
  } catch (error) {
    return apiServerError(error instanceof Error ? error.message : "Entity linking health check failed");
  }
}
