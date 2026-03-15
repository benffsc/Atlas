import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Category Distribution Health Check
 *
 * Reports appointment_source_category percentage breakdown.
 * Used by categorization-gaps.spec.ts
 *
 * Test expects:
 *   data.regular_pct > 80
 *   data.foster_pct < 10
 *   data.county_pct < 5
 *   data.lmfm_pct < 5
 *   data.null_pct === 0
 *   data.distribution (Record<string,number>), data.total
 *
 * GET /api/health/category-distribution
 */
export async function GET() {
  try {
    const result = await queryOne<{
      total: number;
      regular_count: number;
      foster_count: number;
      county_count: number;
      lmfm_count: number;
      other_internal_count: number;
      null_count: number;
      regular_pct: number;
      foster_pct: number;
      county_pct: number;
      lmfm_pct: number;
      null_pct: number;
    }>(`
      WITH counts AS (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE appointment_source_category = 'regular')::int AS regular_count,
          COUNT(*) FILTER (WHERE appointment_source_category = 'foster_program')::int AS foster_count,
          COUNT(*) FILTER (WHERE appointment_source_category = 'county_scas')::int AS county_count,
          COUNT(*) FILTER (WHERE appointment_source_category = 'lmfm')::int AS lmfm_count,
          COUNT(*) FILTER (WHERE appointment_source_category = 'other_internal')::int AS other_internal_count,
          COUNT(*) FILTER (WHERE appointment_source_category IS NULL)::int AS null_count
        FROM ops.appointments
      )
      SELECT
        total,
        regular_count,
        foster_count,
        county_count,
        lmfm_count,
        other_internal_count,
        null_count,
        CASE WHEN total = 0 THEN 0 ELSE ROUND(100.0 * regular_count / total, 1) END AS regular_pct,
        CASE WHEN total = 0 THEN 0 ELSE ROUND(100.0 * foster_count / total, 1) END AS foster_pct,
        CASE WHEN total = 0 THEN 0 ELSE ROUND(100.0 * county_count / total, 1) END AS county_pct,
        CASE WHEN total = 0 THEN 0 ELSE ROUND(100.0 * lmfm_count / total, 1) END AS lmfm_pct,
        CASE WHEN total = 0 THEN 0 ELSE ROUND(100.0 * null_count / total, 1) END AS null_pct
      FROM counts
    `);

    const distribution: Record<string, number> = {
      regular: result?.regular_count ?? 0,
      foster_program: result?.foster_count ?? 0,
      county_scas: result?.county_count ?? 0,
      lmfm: result?.lmfm_count ?? 0,
      other_internal: result?.other_internal_count ?? 0,
    };
    if ((result?.null_count ?? 0) > 0) {
      distribution["null"] = result?.null_count ?? 0;
    }

    return apiSuccess({
      total: result?.total ?? 0,
      distribution,
      regular_pct: Number(result?.regular_pct ?? 0),
      foster_pct: Number(result?.foster_pct ?? 0),
      county_pct: Number(result?.county_pct ?? 0),
      lmfm_pct: Number(result?.lmfm_pct ?? 0),
      null_pct: Number(result?.null_pct ?? 0),
    });
  } catch (error) {
    console.error("Category distribution check error:", error);
    return apiServerError("Failed to check category distribution");
  }
}
