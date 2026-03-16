import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Clinic Classification Health Check
 *
 * Checks for places misclassified as clinics and active clinic contexts.
 * After MIG_930, only actual clinics (845 Todd Road) should be clinic-classified.
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.clinic_places < 5, data.active_clinic_contexts === 0
 *
 * GET /api/health/clinic-classification
 */
export async function GET() {
  try {
    const result = await queryOne<{
      clinic_places: number;
      active_clinic_contexts: number;
      misclassified: number;
      total_checked: number;
    }>(`
      SELECT
        -- Places with kind = 'clinic' or similar
        (SELECT COUNT(*)::int FROM sot.places
         WHERE merged_into_place_id IS NULL
           AND place_kind = 'clinic'
        ) AS clinic_places,

        -- Active clinic contexts (cat_place links to known clinic addresses)
        (SELECT COUNT(*)::int FROM sot.cat_place cp
         JOIN sot.places p ON p.place_id = cp.place_id
         WHERE p.merged_into_place_id IS NULL
           AND ops.is_clinic_address(p.formatted_address)
        ) AS active_clinic_contexts,

        -- Misclassified: non-clinic places incorrectly typed as clinic
        (SELECT COUNT(*)::int FROM sot.places
         WHERE merged_into_place_id IS NULL
           AND place_kind = 'clinic'
           AND NOT ops.is_clinic_address(formatted_address)
        ) AS misclassified,

        -- Total places checked
        (SELECT COUNT(*)::int FROM sot.places
         WHERE merged_into_place_id IS NULL
        ) AS total_checked
    `);

    return apiSuccess(result ?? {
      clinic_places: 0,
      active_clinic_contexts: 0,
      misclassified: 0,
      total_checked: 0,
    });
  } catch (error) {
    console.error("Clinic classification check error:", error);
    return apiServerError("Failed to check clinic classification");
  }
}
