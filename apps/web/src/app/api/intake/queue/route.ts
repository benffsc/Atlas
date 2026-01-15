import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  ownership_status: string;
  cat_count_estimate: number | null;
  fixed_status: string;
  has_kittens: boolean | null;
  has_medical_concerns: boolean | null;
  is_emergency: boolean;
  situation_description: string | null;
  triage_category: string | null;
  triage_score: number | null;
  triage_reasons: unknown;
  status: string;
  final_category: string | null;
  created_request_id: string | null;
  age: unknown;
  overdue: boolean;
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  legacy_notes: string | null;
  legacy_source_id: string | null;
  review_notes: string | null;
  matched_person_id: string | null;
  // Source tracking
  intake_source: string | null;
  // Geocoding
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_confidence: string | null;
  // Contact tracking
  last_contacted_at: string | null;
  last_contact_method: string | null;
  contact_attempt_count: number | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const statusFilter = searchParams.get("status_filter");
  const sourceFilter = searchParams.get("source"); // 'legacy', 'new', or ''
  const mode = searchParams.get("mode"); // 'attention', 'recent', 'legacy', or ''
  const includeOld = searchParams.get("include_old") === "true";

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Filter by category
    if (category) {
      conditions.push(`triage_category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    // Mode-based filtering (new approach)
    if (mode === "attention") {
      // "Needs Attention" tab: Actionable items only
      // Include: New submissions OR legacy that's NOT done (Booked/Complete/Declined)
      conditions.push(`status IN ('new', 'triaged')`);
      conditions.push(`(
        -- New submissions (not legacy)
        is_legacy = FALSE
        OR
        -- Legacy that still needs action (Pending Review or contacted but waiting)
        (is_legacy = TRUE AND (
          legacy_submission_status IS NULL
          OR legacy_submission_status = 'Pending Review'
          OR (legacy_submission_status NOT IN ('Booked', 'Complete', 'Declined'))
        ))
      )`);
    } else if (mode === "recent") {
      // "All Recent" tab: Everything from recent period including booked
      conditions.push(`(
        is_legacy = FALSE
        OR submitted_at >= '2025-10-01'
        OR legacy_submission_status IN ('Pending Review', 'Booked')
      )`);
    } else if (mode === "all") {
      // "All Submissions" tab: Everything, no filters
      // Just exclude archived/request_created unless they want those too
      conditions.push(`status NOT IN ('archived', 'request_created')`);
    } else if (mode === "legacy") {
      // "Legacy" tab: All legacy data
      conditions.push(`is_legacy = TRUE`);
    } else {
      // Fallback to old behavior for backwards compatibility
      if (statusFilter === "active") {
        conditions.push(`status IN ('new', 'triaged')`);
        conditions.push(`(is_legacy = FALSE OR legacy_submission_status IS NULL OR legacy_submission_status NOT IN ('Complete', 'Declined'))`);
        if (!includeOld) {
          conditions.push(`(is_legacy = FALSE OR submitted_at >= '2025-10-01')`);
        }
      } else if (statusFilter && statusFilter !== "") {
        conditions.push(`status = $${paramIndex}`);
        params.push(statusFilter);
        paramIndex++;
      }

      // Filter by source (legacy vs new form)
      if (sourceFilter === "legacy") {
        conditions.push(`is_legacy = TRUE`);
      } else if (sourceFilter === "new") {
        conditions.push(`is_legacy = FALSE`);
      }

      // When viewing all (no status filter), still hide old legacy unless requested
      if (!statusFilter && !includeOld) {
        conditions.push(`(is_legacy = FALSE OR submitted_at >= '2025-10-01' OR legacy_submission_status IN ('Pending Review', 'Booked'))`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT
        submission_id,
        submitted_at,
        submitter_name,
        email,
        phone,
        cats_address,
        cats_city,
        ownership_status,
        cat_count_estimate,
        fixed_status,
        has_kittens,
        has_medical_concerns,
        is_emergency,
        situation_description,
        triage_category,
        triage_score,
        triage_reasons,
        status,
        final_category,
        created_request_id,
        age::text as age,
        overdue,
        is_legacy,
        legacy_status,
        legacy_submission_status,
        legacy_appointment_date,
        legacy_notes,
        legacy_source_id,
        review_notes,
        matched_person_id,
        intake_source,
        geo_formatted_address,
        geo_latitude,
        geo_longitude,
        geo_confidence,
        last_contacted_at,
        last_contact_method,
        contact_attempt_count
      FROM trapper.v_intake_triage_queue
      ${whereClause}
      ORDER BY
        is_emergency DESC,
        submitted_at DESC
      LIMIT 500
    `;

    const submissions = await queryRows<IntakeSubmission>(sql, params);

    return NextResponse.json({ submissions });
  } catch (err) {
    console.error("Error fetching queue:", err);
    return NextResponse.json(
      { error: "Failed to fetch submissions" },
      { status: 500 }
    );
  }
}
