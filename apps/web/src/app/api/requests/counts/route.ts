import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * GET /api/requests/counts
 *
 * Returns counts of requests by status and assignment for sidebar display.
 * Uses a single query with conditional aggregation for efficiency.
 */
export async function GET() {
  try {
    const counts = await queryOne<{
      new_count: number;
      working_count: number;
      paused_count: number;
      completed_count: number;
      needs_trapper_count: number;
      urgent_count: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('new', 'triaged')) as new_count,
        COUNT(*) FILTER (WHERE status IN ('working', 'scheduled', 'in_progress', 'active')) as working_count,
        COUNT(*) FILTER (WHERE status IN ('paused', 'on_hold')) as paused_count,
        COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled', 'partial', 'redirected', 'handed_off')) as completed_count,
        COUNT(*) FILTER (WHERE assignment_status = 'needs_trapper' AND status NOT IN ('completed', 'cancelled', 'partial', 'redirected', 'handed_off')) as needs_trapper_count,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('completed', 'cancelled', 'partial', 'redirected', 'handed_off')) as urgent_count
      FROM ops.requests
      WHERE merged_into_request_id IS NULL
    `);

    if (!counts) {
      return apiSuccess({
        new: 0,
        working: 0,
        paused: 0,
        completed: 0,
        needs_trapper: 0,
        urgent: 0,
      });
    }

    return apiSuccess({
      new: Number(counts.new_count) || 0,
      working: Number(counts.working_count) || 0,
      paused: Number(counts.paused_count) || 0,
      completed: Number(counts.completed_count) || 0,
      needs_trapper: Number(counts.needs_trapper_count) || 0,
      urgent: Number(counts.urgent_count) || 0,
    });
  } catch (error) {
    console.error("Error fetching request counts:", error);
    return apiServerError("Failed to fetch counts");
  }
}
