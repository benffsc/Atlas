import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * LMFM Marker Audit Health Check
 *
 * Checks that appointments with $LMFM marker are categorized as lmfm.
 * Used by categorization-gaps.spec.ts
 *
 * Test expects: data.marker_without_category === 0
 *
 * GET /api/health/lmfm-marker-audit
 */
export async function GET() {
  try {
    // ops.appointments uses client_name (combined), owner_first_name, owner_last_name (MIG_2401, MIG_2802)
    const result = await queryOne<{
      lmfm_count: number;
      marker_without_category: number;
      potential_misses: number;
    }>(`
      SELECT
        -- Total appointments categorized as lmfm
        (SELECT COUNT(*)::int FROM ops.appointments
         WHERE appointment_source_category = 'lmfm'
        ) AS lmfm_count,

        -- Appointments with $LMFM in notes/name but NOT categorized as lmfm
        (SELECT COUNT(*)::int FROM ops.appointments
         WHERE (
           client_name ILIKE '%$LMFM%'
           OR notes ILIKE '%$LMFM%'
         )
         AND (appointment_source_category IS NULL OR appointment_source_category != 'lmfm')
        ) AS marker_without_category,

        -- Potential LMFM misses (ALL CAPS names not categorized)
        (SELECT COUNT(*)::int FROM ops.appointments
         WHERE owner_first_name = UPPER(owner_first_name)
           AND owner_last_name = UPPER(owner_last_name)
           AND LENGTH(owner_first_name) > 1
           AND LENGTH(owner_last_name) > 1
           AND (appointment_source_category IS NULL OR appointment_source_category != 'lmfm')
           AND owner_first_name !~ '^[0-9]'
        ) AS potential_misses
    `);

    return apiSuccess(result ?? {
      lmfm_count: 0,
      marker_without_category: 0,
      potential_misses: 0,
    });
  } catch (error) {
    console.error("LMFM marker audit error:", error);
    return apiServerError("Failed to audit LMFM markers");
  }
}
