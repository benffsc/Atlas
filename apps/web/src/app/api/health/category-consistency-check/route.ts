import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Category Consistency Health Check
 *
 * Checks if the same appointment number always has the same category.
 *
 * GET /api/health/category-consistency-check
 */
export async function GET() {
  try {
    const result = await queryOne<{ inconsistencies: number }>(`
      SELECT COUNT(*)::int AS inconsistencies
      FROM (
        SELECT appointment_number
        FROM ops.appointments
        WHERE appointment_number IS NOT NULL
          AND appointment_source_category IS NOT NULL
        GROUP BY appointment_number
        HAVING COUNT(DISTINCT appointment_source_category) > 1
      ) dups
    `).catch(() => ({ inconsistencies: 0 }));

    return apiSuccess({
      inconsistencies: result?.inconsistencies ?? 0,
    });
  } catch (error) {
    console.error("Category consistency check error:", error);
    return apiServerError("Failed to check category consistency");
  }
}
