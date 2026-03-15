import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Microchip Format Validation Health Check
 *
 * Validates microchip IDs follow standard formats (9, 10, or 15 digit).
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.valid_format, data.total_microchips, data.invalid_formats (array)
 *   validRate = (data.valid_format / data.total_microchips) * 100 > 99
 *
 * GET /api/health/microchip-validation
 */
export async function GET() {
  try {
    const counts = await queryOne<{
      total_microchips: number;
      valid_format: number;
      invalid_format: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
           AND microchip_id IS NOT NULL AND microchip_id != ''
        ) AS total_microchips,

        -- Valid: 9, 10, or 15 alphanumeric characters (standard formats)
        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
           AND microchip_id IS NOT NULL AND microchip_id != ''
           AND microchip_id ~ '^[0-9A-Fa-f]{9,15}$'
        ) AS valid_format,

        (SELECT COUNT(*)::int FROM sot.cats
         WHERE merged_into_cat_id IS NULL
           AND microchip_id IS NOT NULL AND microchip_id != ''
           AND NOT (microchip_id ~ '^[0-9A-Fa-f]{9,15}$')
        ) AS invalid_format
    `);

    // Fetch a sample of invalid formats for investigation
    const invalidSamples = await queryRows<{ microchip_id: string }>(`
      SELECT DISTINCT microchip_id
      FROM sot.cats
      WHERE merged_into_cat_id IS NULL
        AND microchip_id IS NOT NULL AND microchip_id != ''
        AND NOT (microchip_id ~ '^[0-9A-Fa-f]{9,15}$')
      LIMIT 10
    `).catch(() => []);

    return apiSuccess({
      total_microchips: counts?.total_microchips ?? 0,
      valid_format: counts?.valid_format ?? 0,
      invalid_format: counts?.invalid_format ?? 0,
      invalid_formats: invalidSamples.map((r) => r.microchip_id),
    });
  } catch (error) {
    console.error("Microchip validation error:", error);
    return apiServerError("Failed to validate microchip formats");
  }
}
