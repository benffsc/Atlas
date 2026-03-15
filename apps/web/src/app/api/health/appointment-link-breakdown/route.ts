import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Appointment Link Breakdown Health Check
 *
 * Returns counts of fully linked vs partially linked appointments.
 *
 * GET /api/health/appointment-link-breakdown
 */
export async function GET() {
  try {
    const metrics = await queryOne<{
      total_appointments: number;
      fully_linked: number;
      missing_cat: number;
      missing_person: number;
      missing_place: number;
    }>(`
      SELECT
        COUNT(*)::int AS total_appointments,
        COUNT(*) FILTER (
          WHERE cat_id IS NOT NULL AND person_id IS NOT NULL AND place_id IS NOT NULL
        )::int AS fully_linked,
        COUNT(*) FILTER (WHERE cat_id IS NULL)::int AS missing_cat,
        COUNT(*) FILTER (WHERE person_id IS NULL)::int AS missing_person,
        COUNT(*) FILTER (WHERE place_id IS NULL)::int AS missing_place
      FROM ops.appointments
    `);

    const m = metrics!;
    return apiSuccess({
      total_appointments: m.total_appointments,
      fully_linked: m.fully_linked,
      missing_cat: m.missing_cat,
      missing_person: m.missing_person,
      missing_place: m.missing_place,
    });
  } catch (error) {
    console.error("Appointment link breakdown error:", error);
    return apiServerError("Failed to check appointment link breakdown");
  }
}
