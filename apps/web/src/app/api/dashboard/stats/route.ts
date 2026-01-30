import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// Cache for 5 minutes
export const revalidate = 300;

interface DashboardStats {
  active_requests: number;
  pending_intake: number;
  cats_this_month: number;
  stale_requests: number;
  overdue_intake: number;
  unassigned_requests: number;
  needs_attention_total: number;
  requests_with_location: number;
}

export async function GET() {
  try {
    const stats = await queryOne<DashboardStats>(`
      WITH active AS (
        SELECT COUNT(*)::int AS cnt
        FROM trapper.sot_requests
        WHERE status NOT IN ('completed', 'cancelled')
      ),
      intake AS (
        SELECT COUNT(*)::int AS cnt
        FROM trapper.web_intake_submissions
        WHERE submission_status IN ('new', 'needs_review')
      ),
      cats AS (
        SELECT COUNT(*)::int AS cnt
        FROM trapper.sot_cats
        WHERE created_at >= date_trunc('month', CURRENT_DATE)
      ),
      stale AS (
        SELECT COUNT(*)::int AS cnt
        FROM trapper.sot_requests
        WHERE status NOT IN ('completed', 'cancelled', 'on_hold')
          AND updated_at < NOW() - INTERVAL '14 days'
      ),
      overdue AS (
        SELECT COUNT(*)::int AS cnt
        FROM trapper.web_intake_submissions
        WHERE submission_status IN ('new', 'needs_review')
          AND submitted_at < NOW() - INTERVAL '7 days'
      ),
      unassigned AS (
        SELECT COUNT(*)::int AS cnt
        FROM trapper.sot_requests
        WHERE status NOT IN ('completed', 'cancelled')
          AND assignment_status = 'pending'
      ),
      with_location AS (
        SELECT COUNT(*)::int AS cnt
        FROM trapper.sot_requests r
        JOIN trapper.places p ON p.place_id = r.place_id
        WHERE r.status NOT IN ('completed', 'cancelled')
          AND p.latitude IS NOT NULL
      )
      SELECT
        active.cnt AS active_requests,
        intake.cnt AS pending_intake,
        cats.cnt AS cats_this_month,
        stale.cnt AS stale_requests,
        overdue.cnt AS overdue_intake,
        unassigned.cnt AS unassigned_requests,
        (stale.cnt + overdue.cnt + unassigned.cnt) AS needs_attention_total,
        with_location.cnt AS requests_with_location
      FROM active, intake, cats, stale, overdue, unassigned, with_location
    `);

    return NextResponse.json(stats || {
      active_requests: 0,
      pending_intake: 0,
      cats_this_month: 0,
      stale_requests: 0,
      overdue_intake: 0,
      unassigned_requests: 0,
      needs_attention_total: 0,
      requests_with_location: 0,
    }, {
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
