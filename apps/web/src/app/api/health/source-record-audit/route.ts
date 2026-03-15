import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Source Record ID Audit Health Check
 *
 * Checks how many records have source_record_id populated (provenance tracking).
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.missing_source_record_pct < 5
 *
 * GET /api/health/source-record-audit
 */
export async function GET() {
  try {
    const result = await queryOne<{
      total_records: number;
      with_record_id: number;
      without_record_id: number;
      coverage_rate: number;
      missing_source_record_pct: number;
    }>(`
      WITH combined AS (
        SELECT
          CASE WHEN source_record_id IS NOT NULL AND source_record_id != '' THEN 1 ELSE 0 END AS has_id
        FROM sot.cats WHERE merged_into_cat_id IS NULL
        UNION ALL
        SELECT
          CASE WHEN source_record_id IS NOT NULL AND source_record_id != '' THEN 1 ELSE 0 END AS has_id
        FROM sot.people WHERE merged_into_person_id IS NULL
        UNION ALL
        SELECT
          CASE WHEN source_record_id IS NOT NULL AND source_record_id != '' THEN 1 ELSE 0 END AS has_id
        FROM sot.places WHERE merged_into_place_id IS NULL
      )
      SELECT
        COUNT(*)::int AS total_records,
        SUM(has_id)::int AS with_record_id,
        (COUNT(*) - SUM(has_id))::int AS without_record_id,
        CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * SUM(has_id) / COUNT(*), 1)
        END AS coverage_rate,
        CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * (COUNT(*) - SUM(has_id)) / COUNT(*), 1)
        END AS missing_source_record_pct
    `);

    return apiSuccess(result ?? {
      total_records: 0,
      with_record_id: 0,
      without_record_id: 0,
      coverage_rate: 0,
      missing_source_record_pct: 0,
    });
  } catch (error) {
    console.error("Source record audit error:", error);
    return apiServerError("Failed to audit source records");
  }
}
