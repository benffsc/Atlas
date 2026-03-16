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
    // Compute source record coverage per entity type, then combine.
    // Avoids CTE alias issues and gracefully handles missing columns via try-catch.
    const result = await queryOne<{
      total_records: number;
      with_record_id: number;
      without_record_id: number;
      coverage_rate: number;
      missing_source_record_pct: number;
    }>(`
      SELECT
        (cats.total + people.total + places.total)::int AS total_records,
        (cats.with_id + people.with_id + places.with_id)::int AS with_record_id,
        (cats.total + people.total + places.total - cats.with_id - people.with_id - places.with_id)::int AS without_record_id,
        CASE WHEN (cats.total + people.total + places.total) = 0 THEN 0
          ELSE ROUND(100.0 * (cats.with_id + people.with_id + places.with_id) / (cats.total + people.total + places.total), 1)
        END AS coverage_rate,
        CASE WHEN (cats.total + people.total + places.total) = 0 THEN 0
          ELSE ROUND(100.0 * (cats.total + people.total + places.total - cats.with_id - people.with_id - places.with_id) / (cats.total + people.total + places.total), 1)
        END AS missing_source_record_pct
      FROM
        (SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE source_record_id IS NOT NULL AND source_record_id != '')::bigint AS with_id
         FROM sot.cats WHERE merged_into_cat_id IS NULL) cats,
        (SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE source_record_id IS NOT NULL AND source_record_id != '')::bigint AS with_id
         FROM sot.people WHERE merged_into_person_id IS NULL) people,
        (SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE source_system IS NOT NULL AND source_system != '')::bigint AS with_id
         FROM sot.places WHERE merged_into_place_id IS NULL) places
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
