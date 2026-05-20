import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

// GET /api/meetings/[id]/stats — auto-generate scoreboard data
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    requireValidUUID(id, "meeting");

    const meeting = await queryOne<{
      meeting_date: string | null;
    }>(
      `SELECT meeting_date FROM ops.trapper_meetings WHERE meeting_id = $1`,
      [id]
    );
    if (!meeting) return apiNotFound("meeting", id);

    // Find the previous meeting's date for "since last meeting" period
    const prevMeeting = await queryOne<{ meeting_date: string }>(
      `SELECT meeting_date FROM ops.trapper_meetings
       WHERE meeting_date < COALESCE($1::date, CURRENT_DATE)
         AND status != 'archived'
       ORDER BY meeting_date DESC LIMIT 1`,
      [meeting.meeting_date]
    );

    const meetingDate = meeting.meeting_date || new Date().toISOString().split("T")[0];
    const prevDate = prevMeeting?.meeting_date || new Date(new Date(meetingDate).getTime() - 90 * 86400000).toISOString().split("T")[0];
    const yearStart = `${meetingDate.substring(0, 4)}-01-01`;

    // Since last meeting stats
    const sinceLastMeeting = await queryOne<{
      spays: number;
      neuters: number;
      total_fixed: number;
      wellness_only: number;
      total_appointments: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE is_spay = true)::int AS spays,
         COUNT(*) FILTER (WHERE is_neuter = true)::int AS neuters,
         COUNT(*) FILTER (WHERE is_spay = true OR is_neuter = true)::int AS total_fixed,
         COUNT(*) FILTER (WHERE is_spay = false AND is_neuter = false)::int AS wellness_only,
         COUNT(*)::int AS total_appointments
       FROM ops.appointments
       WHERE appointment_date >= $1 AND appointment_date <= $2`,
      [prevDate, meetingDate]
    );

    // YTD stats
    const ytd = await queryOne<{
      spays: number;
      neuters: number;
      total_fixed: number;
      total_appointments: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE is_spay = true)::int AS spays,
         COUNT(*) FILTER (WHERE is_neuter = true)::int AS neuters,
         COUNT(*) FILTER (WHERE is_spay = true OR is_neuter = true)::int AS total_fixed,
         COUNT(*)::int AS total_appointments
       FROM ops.appointments
       WHERE appointment_date >= $1 AND appointment_date <= $2`,
      [yearStart, meetingDate]
    );

    // Requests resolved since last meeting
    const requestsSince = await queryOne<{ resolved: number }>(
      `SELECT COUNT(*)::int AS resolved FROM ops.requests
       WHERE resolved_at >= $1 AND resolved_at <= $2`,
      [prevDate, meetingDate]
    );

    // Active requests
    const activeRequests = await queryOne<{ active: number }>(
      `SELECT COUNT(*)::int AS active FROM ops.requests
       WHERE status NOT IN ('completed', 'cancelled')
         AND merged_into_request_id IS NULL`,
      []
    );

    return apiSuccess({
      period: {
        since_last_meeting: prevDate,
        meeting_date: meetingDate,
        year_start: yearStart,
      },
      since_last_meeting: sinceLastMeeting,
      ytd,
      requests_resolved: requestsSince?.resolved ?? 0,
      active_requests: activeRequests?.active ?? 0,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/stats] GET error:", error);
    return apiServerError("Failed to generate meeting stats");
  }
}
