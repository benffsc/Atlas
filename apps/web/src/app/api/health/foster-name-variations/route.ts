import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Foster Name Variations Health Check
 *
 * Detects foster account name patterns not in the known registry.
 *
 * GET /api/health/foster-name-variations
 */
export async function GET() {
  try {
    const KNOWN_PATTERNS = [
      "ff foster",
      "forgotten felines foster",
      "ffsc foster",
      "barn cat",
      "foster",
      "foster home",
      "forever foster",
      "rebooking",
    ];

    const rows = await queryRows<{ name_pattern: string; count: number }>(`
      SELECT
        LOWER(TRIM(COALESCE(
          a.payload->>'client_first_name',
          a.payload->>'Owner First Name',
          ''
        ))) AS name_pattern,
        COUNT(*)::int AS count
      FROM ops.appointments a
      WHERE a.appointment_source_category = 'foster_program'
      GROUP BY 1
      HAVING COUNT(*) >= 2
      ORDER BY count DESC
    `).catch(() => []);

    const unrecognized = rows
      .filter((r) => !KNOWN_PATTERNS.some((p) => r.name_pattern.includes(p)))
      .map((r) => r.name_pattern);

    return apiSuccess({
      known_patterns: KNOWN_PATTERNS.length,
      total_variations: rows.length,
      unrecognized_patterns: unrecognized,
    });
  } catch (error) {
    console.error("Foster name variations error:", error);
    return apiServerError("Failed to check foster name variations");
  }
}
