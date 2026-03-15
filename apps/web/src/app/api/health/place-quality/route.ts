import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Place Data Quality Health Check
 *
 * Reports on place geocoding coverage.
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.geocoded, data.total_unmerged_places
 *   geocodeRate = (data.geocoded / data.total_unmerged_places) * 100 > 99
 *
 * GET /api/health/place-quality
 */
export async function GET() {
  try {
    const result = await queryOne<{
      total_unmerged_places: number;
      geocoded: number;
      total_places: number;
      geocode_rate: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM sot.places
         WHERE merged_into_place_id IS NULL
        ) AS total_unmerged_places,

        (SELECT COUNT(*)::int FROM sot.places
         WHERE merged_into_place_id IS NULL
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL
        ) AS geocoded,

        (SELECT COUNT(*)::int FROM sot.places
         WHERE merged_into_place_id IS NULL
        ) AS total_places,

        CASE
          WHEN (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL) = 0 THEN 0
          ELSE ROUND(100.0 *
            (SELECT COUNT(*) FROM sot.places
             WHERE merged_into_place_id IS NULL
               AND latitude IS NOT NULL AND longitude IS NOT NULL) /
            (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL)
          , 1)
        END AS geocode_rate
    `);

    return apiSuccess(result ?? {
      total_unmerged_places: 0,
      geocoded: 0,
      total_places: 0,
      geocode_rate: 0,
    });
  } catch (error) {
    console.error("Place quality check error:", error);
    return apiServerError("Failed to check place quality");
  }
}
