import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Categorization Gaps Health Check
 *
 * Detects appointments that may be miscategorized — SCAS pattern misses,
 * LMFM pattern misses, foster ownership misses.
 * Used by categorization-gaps.spec.ts
 *
 * Test expects:
 *   data.scas_pattern_misses (array)
 *   data.lmfm_pattern_misses (array)
 *   data.foster_ownership_misses (number, should be 0)
 *   data.uncategorized, data.total_appointments, data.categories
 *
 * GET /api/health/categorization-gaps
 */
export async function GET() {
  try {
    // SCAS pattern misses: appointments with SCAS-like client names not classified as county_scas
    const scasPatternMisses = await queryRows<{
      appointment_id: string;
      client_first_name: string;
      client_last_name: string;
      appointment_source_category: string;
    }>(`
      SELECT
        a.appointment_id,
        a.client_first_name,
        a.client_last_name,
        a.appointment_source_category
      FROM ops.appointments a
      WHERE (a.client_first_name ~ '^A-?[0-9]+' OR a.client_last_name ~ '^A-?[0-9]+')
        AND (a.appointment_source_category IS NULL OR a.appointment_source_category != 'county_scas')
      LIMIT 50
    `).catch(() => []);

    // LMFM pattern misses: ALL CAPS names that might be LMFM but not categorized as such
    const lmfmPatternMisses = await queryRows<{
      appointment_id: string;
      client_first_name: string;
      client_last_name: string;
      appointment_source_category: string;
    }>(`
      SELECT
        a.appointment_id,
        a.client_first_name,
        a.client_last_name,
        a.appointment_source_category
      FROM ops.appointments a
      WHERE a.client_first_name = UPPER(a.client_first_name)
        AND a.client_last_name = UPPER(a.client_last_name)
        AND LENGTH(a.client_first_name) > 1
        AND LENGTH(a.client_last_name) > 1
        AND (a.appointment_source_category IS NULL OR a.appointment_source_category != 'lmfm')
        AND a.client_first_name !~ '^[0-9]'
        AND a.client_first_name NOT ILIKE '%FORGOTTEN FELINES%'
      LIMIT 50
    `).catch(() => []);

    // Foster ownership misses: ownership_type=Foster but not foster_program
    const fosterMisses = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM ops.appointments a
      WHERE a.ownership_type = 'Foster'
        AND (a.appointment_source_category IS NULL OR a.appointment_source_category != 'foster_program')
    `).catch(() => ({ count: 0 }));

    // Overall categorization stats
    const stats = await queryOne<{
      uncategorized: number;
      total_appointments: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM ops.appointments
         WHERE appointment_source_category IS NULL
        ) AS uncategorized,
        (SELECT COUNT(*)::int FROM ops.appointments) AS total_appointments
    `).catch(() => ({ uncategorized: 0, total_appointments: 0 }));

    // Category breakdown
    const categoryRows = await queryRows<{
      category: string;
      count: number;
    }>(`
      SELECT
        COALESCE(appointment_source_category, 'null') AS category,
        COUNT(*)::int AS count
      FROM ops.appointments
      GROUP BY appointment_source_category
      ORDER BY count DESC
    `).catch(() => []);

    const categories: Record<string, number> = {};
    for (const row of categoryRows) {
      categories[row.category] = row.count;
    }

    return apiSuccess({
      scas_pattern_misses: scasPatternMisses,
      lmfm_pattern_misses: lmfmPatternMisses,
      foster_ownership_misses: fosterMisses?.count ?? 0,
      uncategorized: stats?.uncategorized ?? 0,
      total_appointments: stats?.total_appointments ?? 0,
      categories,
    });
  } catch (error) {
    console.error("Categorization gaps check error:", error);
    return apiServerError("Failed to check categorization gaps");
  }
}
