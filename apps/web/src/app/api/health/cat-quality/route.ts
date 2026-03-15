import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Cat Data Quality Health Check
 *
 * Reports on cat microchip coverage.
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.with_microchip, data.total_unmerged_cats
 *   chipRate = (data.with_microchip / data.total_unmerged_cats) * 100 > 95
 *
 * GET /api/health/cat-quality
 */
export async function GET() {
  try {
    const result = await queryOne<{
      total_unmerged_cats: number;
      with_microchip: number;
      cats_with_microchip: number;
      total_cats: number;
      microchip_rate: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
        ) AS total_unmerged_cats,

        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
           AND microchip_id IS NOT NULL
           AND microchip_id != ''
        ) AS with_microchip,

        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
           AND microchip_id IS NOT NULL
           AND microchip_id != ''
        ) AS cats_with_microchip,

        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
        ) AS total_cats,

        CASE
          WHEN (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) = 0 THEN 0
          ELSE ROUND(100.0 *
            (SELECT COUNT(*) FROM sot.cats
             WHERE merged_into_cat_id IS NULL
               AND microchip_id IS NOT NULL AND microchip_id != '') /
            (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL)
          , 1)
        END AS microchip_rate
    `);

    return apiSuccess(result ?? {
      total_unmerged_cats: 0,
      with_microchip: 0,
      cats_with_microchip: 0,
      total_cats: 0,
      microchip_rate: 0,
    });
  } catch (error) {
    console.error("Cat quality check error:", error);
    return apiServerError("Failed to check cat quality");
  }
}
