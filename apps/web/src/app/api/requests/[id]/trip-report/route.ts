import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface TripReport {
  report_id: string;
  request_id: string;
  trapper_person_id: string;
  trapper_name: string | null;
  visit_date: string;
  arrival_time: string | null;
  departure_time: string | null;
  cats_trapped: number;
  cats_returned: number;
  traps_set: number | null;
  traps_retrieved: number | null;
  cats_seen: number | null;
  eartipped_seen: number | null;
  issues_encountered: string[];
  issue_details: string | null;
  site_notes: string | null;
  equipment_used: Record<string, unknown> | null;
  is_final_visit: boolean;
  submitted_from: string;
  created_at: string;
}

/**
 * GET /api/requests/[id]/trip-report
 * List trip reports for a request
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const reports = await queryRows<TripReport>(
      `
      SELECT
        tr.report_id,
        tr.request_id,
        tr.trapper_person_id,
        p.display_name as trapper_name,
        tr.visit_date,
        tr.arrival_time,
        tr.departure_time,
        tr.cats_trapped,
        tr.cats_returned,
        tr.traps_set,
        tr.traps_retrieved,
        tr.cats_seen,
        tr.eartipped_seen,
        tr.issues_encountered,
        tr.issue_details,
        tr.site_notes,
        tr.equipment_used,
        tr.is_final_visit,
        tr.submitted_from,
        tr.created_at
      FROM trapper.trapper_trip_reports tr
      LEFT JOIN trapper.sot_people p ON p.person_id = tr.trapper_person_id
      WHERE tr.request_id = $1
      ORDER BY tr.visit_date DESC, tr.created_at DESC
      `,
      [id]
    );

    // Get request info to check report requirement
    const requestInfo = await queryOne(
      `
      SELECT
        report_required_before_complete,
        completion_report_id,
        status
      FROM trapper.sot_requests
      WHERE request_id = $1
      `,
      [id]
    );

    return NextResponse.json({
      reports,
      request: requestInfo,
      has_final_report: reports.some((r) => r.is_final_visit),
    });
  } catch (error) {
    console.error("Trip reports list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch trip reports" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/requests/[id]/trip-report
 * Submit a new trip report
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Get authenticated staff
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: requestId } = await params;
    const body = await request.json();

    const {
      trapper_person_id,
      visit_date,
      arrival_time,
      departure_time,
      cats_trapped,
      cats_returned,
      traps_set,
      traps_retrieved,
      cats_seen,
      eartipped_seen,
      issues_encountered,
      issue_details,
      site_notes,
      equipment_used,
      is_final_visit,
      submitted_from,
    } = body;

    // Validate trapper_person_id
    if (!trapper_person_id) {
      return NextResponse.json(
        { error: "trapper_person_id is required" },
        { status: 400 }
      );
    }

    // Verify the request exists
    const requestExists = await queryOne(
      `SELECT request_id, status FROM trapper.sot_requests WHERE request_id = $1`,
      [requestId]
    );

    if (!requestExists) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    // Insert the trip report
    const report = await queryOne<{ report_id: string; created_at: string }>(
      `
      INSERT INTO trapper.trapper_trip_reports (
        request_id,
        trapper_person_id,
        visit_date,
        arrival_time,
        departure_time,
        cats_trapped,
        cats_returned,
        traps_set,
        traps_retrieved,
        cats_seen,
        eartipped_seen,
        issues_encountered,
        issue_details,
        site_notes,
        equipment_used,
        is_final_visit,
        submitted_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING report_id, created_at
      `,
      [
        requestId,
        trapper_person_id,
        visit_date || new Date().toISOString().split("T")[0],
        arrival_time || null,
        departure_time || null,
        cats_trapped || 0,
        cats_returned || 0,
        traps_set || null,
        traps_retrieved || null,
        cats_seen || null,
        eartipped_seen || null,
        issues_encountered || [],
        issue_details || null,
        site_notes || null,
        equipment_used ? JSON.stringify(equipment_used) : null,
        is_final_visit || false,
        submitted_from || "web_ui",
      ]
    );

    if (!report) {
      return NextResponse.json(
        { error: "Failed to insert trip report" },
        { status: 500 }
      );
    }

    // If this is the final visit, link it to the request
    if (is_final_visit) {
      await query(
        `UPDATE trapper.sot_requests SET completion_report_id = $1 WHERE request_id = $2`,
        [report.report_id, requestId]
      );
    }

    return NextResponse.json({
      success: true,
      report_id: report.report_id,
      message: is_final_visit
        ? "Final trip report submitted. Request can now be completed."
        : "Trip report submitted successfully.",
    });
  } catch (error) {
    console.error("Trip report submit error:", error);
    return NextResponse.json(
      { error: "Failed to submit trip report" },
      { status: 500 }
    );
  }
}
