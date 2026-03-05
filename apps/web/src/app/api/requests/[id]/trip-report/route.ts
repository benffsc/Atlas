import { NextRequest } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiBadRequest, apiNotFound, apiSuccess, apiServerError, apiUnauthorized } from "@/lib/api-response";

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
      FROM ops.trapper_trip_reports tr
      LEFT JOIN sot.people p ON p.person_id = tr.trapper_person_id
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
      FROM ops.requests
      WHERE request_id = $1
      `,
      [id]
    );

    return apiSuccess({
      reports,
      request: requestInfo,
      has_final_report: reports.some((r) => r.is_final_visit),
    });
  } catch (error) {
    console.error("Trip reports list error:", error);
    return apiServerError("Failed to fetch trip reports");
  }
}

function buildJournalBody(data: {
  trapperName: string;
  visitDate: string;
  catsTrapped: number;
  catsReturned: number;
  remainingEstimate?: number | null;
  catsSeen?: number | null;
  eartippedSeen?: number | null;
  moreSessionsNeeded?: string | null;
  isFinal?: boolean;
  siteNotes?: string | null;
}): string {
  const lines: string[] = [];
  const isTrapping = data.catsTrapped > 0;
  const header = isTrapping ? "Trapping Session" : "Field Report";
  lines.push(`**${header}** by ${data.trapperName} on ${data.visitDate}`);
  if (isTrapping) {
    lines.push(`Trapped: ${data.catsTrapped} | Returned: ${data.catsReturned}`);
  }
  if (data.catsSeen != null) {
    lines.push(`Cats seen: ${data.catsSeen}${data.eartippedSeen != null ? ` (${data.eartippedSeen} eartipped)` : ""}`);
  }
  if (data.remainingEstimate != null) {
    lines.push(`Estimated remaining: ${data.remainingEstimate}`);
  }
  if (data.moreSessionsNeeded && data.moreSessionsNeeded !== "unknown") {
    lines.push(`More sessions needed: ${data.moreSessionsNeeded}`);
  }
  if (data.isFinal) {
    lines.push("**Final visit for this request**");
  }
  if (data.siteNotes) {
    lines.push(`\nNotes: ${data.siteNotes}`);
  }
  return lines.join("\n");
}

/**
 * POST /api/requests/[id]/trip-report
 * Submit a new trip report with colony estimates, journal entry, and request updates
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Get authenticated staff
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized("Authentication required");
    }

    const { id: requestId } = await params;
    const body = await request.json();

    const {
      trapper_person_id,
      trapper_name,
      reported_by_name,
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
      // FFS-143: New session report fields
      remaining_estimate,
      estimate_confidence,
      update_request_estimate,
      trapper_total_estimate,
      more_sessions_needed,
    } = body;

    // Resolve display name: trapper name > reported_by_name > staff name
    const effectiveReporterName = trapper_name || reported_by_name || "Unknown reporter";

    // Fetch request with place_id for colony estimate + Chapman
    const requestData = await queryOne<{
      request_id: string;
      status: string;
      place_id: string | null;
      estimated_cat_count: number | null;
    }>(
      `SELECT request_id, status, place_id, estimated_cat_count FROM ops.requests WHERE request_id = $1`,
      [requestId]
    );

    if (!requestData) {
      return apiNotFound("Request", requestId);
    }

    const effectiveVisitDate = visit_date || new Date().toISOString().split("T")[0];

    // Insert the trip report with new FFS-143 columns
    const report = await queryOne<{ report_id: string; created_at: string }>(
      `
      INSERT INTO ops.trapper_trip_reports (
        request_id,
        trapper_person_id,
        reported_by_name,
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
        remaining_estimate,
        estimate_confidence,
        trapper_total_estimate,
        more_sessions_needed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING report_id, created_at
      `,
      [
        requestId,
        trapper_person_id || null,
        reported_by_name || effectiveReporterName,
        effectiveVisitDate,
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
        remaining_estimate ?? null,
        estimate_confidence || null,
        trapper_total_estimate ?? null,
        more_sessions_needed || null,
      ]
    );

    if (!report) {
      return apiServerError("Failed to insert trip report");
    }

    // If this is the final visit, link it to the request
    if (is_final_visit) {
      await query(
        `UPDATE ops.requests SET completion_report_id = $1 WHERE request_id = $2`,
        [report.report_id, requestId]
      );
    }

    // A. Update request estimate if requested
    if (update_request_estimate && remaining_estimate != null) {
      await query(
        `UPDATE ops.requests
         SET estimated_cat_count = $1, count_confidence = $2,
             last_activity_at = NOW(), last_activity_type = 'session_report'
         WHERE request_id = $3`,
        [remaining_estimate, estimate_confidence || null, requestId]
      );
    } else {
      // Still update activity timestamp
      await query(
        `UPDATE ops.requests
         SET last_activity_at = NOW(), last_activity_type = 'session_report'
         WHERE request_id = $1`,
        [requestId]
      );
    }

    // B. Write colony estimate if we have observation data and a place
    if (requestData.place_id && (cats_seen != null || trapper_total_estimate != null)) {
      try {
        await query(
          `INSERT INTO sot.colony_estimates (
            place_id, total_cats, eartip_count_observed, source_type,
            source_entity_type, source_entity_id, reported_by_person_id,
            observation_date, notes, source_system, source_record_id, created_by
          ) VALUES ($1, $2, $3, 'trapper_field_report', 'trip_report', $4, $5, $6, $7, 'atlas_ui', $8, $9)`,
          [
            requestData.place_id,
            trapper_total_estimate ?? cats_seen,
            eartipped_seen || null,
            report.report_id,
            trapper_person_id,
            effectiveVisitDate,
            site_notes || null,
            report.report_id,
            session.display_name || "Trip Report",
          ]
        );
      } catch (err) {
        console.error("Colony estimate write failed (non-fatal):", err);
      }
    }

    // C. Create journal entry
    let journalEntryId: string | null = null;
    try {
      const journalBody = buildJournalBody({
        trapperName: effectiveReporterName,
        visitDate: effectiveVisitDate,
        catsTrapped: cats_trapped || 0,
        catsReturned: cats_returned || 0,
        remainingEstimate: remaining_estimate,
        catsSeen: cats_seen,
        eartippedSeen: eartipped_seen,
        moreSessionsNeeded: more_sessions_needed,
        isFinal: is_final_visit,
        siteNotes: site_notes,
      });

      const journalResult = await queryOne<{ id: string }>(
        `INSERT INTO ops.journal_entries (
          body, entry_kind, primary_request_id, created_by,
          source_system, tags
        ) VALUES ($1, 'trap_attempt', $2, $3, 'atlas_ui', $4)
        RETURNING id`,
        [
          journalBody,
          requestId,
          session.display_name || "Trip Report",
          ["session_report", is_final_visit ? "final_visit" : "trapping"],
        ]
      );
      journalEntryId = journalResult?.id || null;
    } catch (err) {
      console.error("Journal entry creation failed (non-fatal):", err);
    }

    // D. Chapman estimate (try/catch, non-fatal)
    let chapmanEstimate: { estimated_population: number; ci_lower: number; ci_upper: number } | null = null;
    if (cats_seen != null && eartipped_seen != null && eartipped_seen > 0 && requestData.place_id) {
      try {
        chapmanEstimate = await queryOne<{
          estimated_population: number;
          ci_lower: number;
          ci_upper: number;
        }>(
          `SELECT estimated_population, ci_lower, ci_upper
           FROM beacon.calculate_chapman_estimate($1, $2, $3)`,
          [eartipped_seen, cats_seen, eartipped_seen > 0 ? eartipped_seen : 0]
        );
      } catch (err) {
        console.error("Chapman estimate failed (non-fatal):", err);
      }
    }

    return apiSuccess({
      report_id: report.report_id,
      journal_entry_id: journalEntryId,
      remaining_estimate: remaining_estimate ?? null,
      chapman_estimate: chapmanEstimate?.estimated_population ?? null,
      confidence_low: chapmanEstimate?.ci_lower ?? null,
      confidence_high: chapmanEstimate?.ci_upper ?? null,
      message: is_final_visit
        ? "Final trip report submitted. Request can now be completed."
        : "Trip report submitted successfully.",
    });
  } catch (error) {
    console.error("Trip report submit error:", error);
    return apiServerError("Failed to submit trip report");
  }
}
