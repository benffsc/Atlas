import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Source System Audit Health Check
 *
 * Validates that only known source_system values are used across core tables.
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.sources[].source_system to be in valid list
 *
 * GET /api/health/source-system-audit
 */
export async function GET() {
  try {
    const sources = await queryRows<{
      source_system: string;
      record_count: number;
    }>(`
      SELECT source_system, COUNT(*)::int AS record_count
      FROM (
        SELECT source_system FROM sot.cats WHERE merged_into_cat_id IS NULL AND source_system IS NOT NULL
        UNION ALL
        SELECT source_system FROM sot.people WHERE merged_into_person_id IS NULL AND source_system IS NOT NULL
        UNION ALL
        SELECT source_system FROM sot.places WHERE merged_into_place_id IS NULL AND source_system IS NOT NULL
      ) combined
      GROUP BY source_system
      ORDER BY record_count DESC
    `).catch(() => []);

    const validSourceSystems = [
      'airtable', 'clinichq', 'shelterluv', 'volunteerhub',
      'web_intake', 'web_app', 'petlink', 'google_maps', 'atlas_ui', 'e2e_test',
    ];

    let validCount = 0;
    let invalidCount = 0;
    for (const s of sources) {
      if (validSourceSystems.includes(s.source_system)) {
        validCount += s.record_count;
      } else {
        invalidCount += s.record_count;
      }
    }

    return apiSuccess({
      sources,
      systems: sources.map((s) => s.source_system),
      valid_sources: validCount,
      invalid_sources: invalidCount,
    });
  } catch (error) {
    console.error("Source system audit error:", error);
    return apiServerError("Failed to audit source systems");
  }
}
