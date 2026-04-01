import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export async function GET() {
  try {
    const stats = await queryOne<{
      total_volunteers: number;
      active_volunteers: number;
      matched_volunteers: number;
      unmatched_volunteers: number;
      last_sync: string | null;
      trappers: number;
      fosters: number;
    }>(`
      SELECT
        COUNT(*)::INT as total_volunteers,
        COUNT(*) FILTER (WHERE is_active)::INT as active_volunteers,
        COUNT(*) FILTER (WHERE matched_person_id IS NOT NULL)::INT as matched_volunteers,
        COUNT(*) FILTER (WHERE matched_person_id IS NULL)::INT as unmatched_volunteers,
        MAX(synced_at)::TEXT as last_sync,
        COUNT(*) FILTER (WHERE skills ? 'trapping')::INT as trappers,
        COUNT(*) FILTER (WHERE skills ? 'fostering')::INT as fosters
      FROM source.volunteerhub_volunteers
    `);

    return apiSuccess(stats);
  } catch (error) {
    console.error("[VH-STATS] Error:", error);
    return apiServerError("Failed to fetch VH stats");
  }
}
