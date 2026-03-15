import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Missing Cat Analysis Health Check
 *
 * Analyzes appointments missing cat links and categorizes reasons.
 * Used by data-quality-comprehensive.spec.ts
 *
 * GET /api/health/missing-cat-analysis
 */
export async function GET() {
  try {
    const result = await queryOne<{
      total: number;
      non_tnr_service: number;
      no_microchip: number;
      unexplained: number;
      cats_without_microchip: number;
      cats_without_place: number;
      total_cats: number;
    }>(`
      SELECT
        -- Appointments missing cat links
        (SELECT COUNT(*)::int FROM ops.appointments
         WHERE cat_id IS NULL) AS total,

        -- Non-TNR services (exam, treatment, etc.) - no cat link expected
        (SELECT COUNT(*)::int FROM ops.appointments
         WHERE cat_id IS NULL
           AND appointment_source_category IS NOT NULL
           AND appointment_source_category NOT IN ('regular', 'foster_program', 'county_scas', 'lmfm')
        ) AS non_tnr_service,

        -- Missing microchip (cat exists but no chip - euthanasia, kittens, etc.)
        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
           AND (microchip_id IS NULL OR microchip_id = '')
        ) AS cats_without_microchip,

        -- Appointments missing cat link where no microchip data available
        (SELECT COUNT(*)::int FROM ops.appointments a
         WHERE a.cat_id IS NULL
           AND EXISTS (
             SELECT 1 FROM ops.appointments a2
             WHERE a2.appointment_id = a.appointment_id
               AND a2.microchip IS NULL
           )
        ) AS no_microchip,

        -- Unexplained: has microchip data but still no cat link
        (SELECT COUNT(*)::int FROM ops.appointments a
         WHERE a.cat_id IS NULL
           AND a.microchip IS NOT NULL
           AND a.microchip != ''
        ) AS unexplained,

        -- Cats without place links
        (SELECT COUNT(*)::int FROM sot.cats c
         WHERE c.merged_into_cat_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM sot.cat_place WHERE cat_id = c.cat_id)
        ) AS cats_without_place,

        -- Total cats
        (SELECT COUNT(*)::int FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_cats
    `);

    return apiSuccess(result ?? {
      total: 0,
      non_tnr_service: 0,
      no_microchip: 0,
      unexplained: 0,
      cats_without_microchip: 0,
      cats_without_place: 0,
      total_cats: 0,
    });
  } catch (error) {
    console.error("Missing cat analysis error:", error);
    return apiServerError("Failed to analyze missing cat links");
  }
}
