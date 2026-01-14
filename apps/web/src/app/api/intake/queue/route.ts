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
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const statusFilter = searchParams.get("status_filter");
  const sourceFilter = searchParams.get("source"); // 'legacy' or 'new'
  const includeOld = searchParams.get("include_old") === "true"; // Include pre-October 2025 legacy

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

    // Filter by status
    if (statusFilter === "active") {
      conditions.push(`status IN ('new', 'triaged')`);
      // Exclude legacy "Complete" and "Declined" from active queue - they're done
      conditions.push(`(is_legacy = FALSE OR legacy_submission_status IS NULL OR legacy_submission_status NOT IN ('Complete', 'Declined'))`);
      // Exclude old legacy data (before Oct 2025) unless explicitly requested
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
        geo_confidence
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
