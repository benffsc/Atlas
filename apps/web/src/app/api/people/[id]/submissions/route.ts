import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface Submission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cat_count_estimate: number | null;
  cat_count_text: string | null;
  situation_description: string | null;
  // Unified status (single source of truth)
  submission_status: string | null;
  appointment_date: string | null;
  triage_category: string | null;
  is_legacy: boolean;
  // Legacy fields (read-only, kept for historical data)
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  created_request_id: string | null;
  place_id: string | null;
}

/**
 * GET /api/people/[id]/submissions
 * Returns all web intake submissions linked to this person
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const submissions = await queryRows<Submission>(
      `SELECT
        submission_id,
        submitted_at,
        (first_name || ' ' || last_name) as submitter_name,
        email,
        phone,
        cats_address,
        cat_count_estimate,
        cat_count_text,
        situation_description,
        submission_status,
        appointment_date,
        triage_category,
        is_legacy,
        legacy_status,
        legacy_submission_status,
        legacy_appointment_date,
        created_request_id,
        COALESCE(place_id, matched_place_id) as place_id
      FROM trapper.web_intake_submissions
      WHERE matched_person_id = $1
      ORDER BY submitted_at DESC
      LIMIT 50`,
      [id]
    );

    return NextResponse.json({
      person_id: id,
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    console.error("Error fetching person submissions:", error);
    return NextResponse.json(
      { error: "Failed to fetch submissions" },
      { status: 500 }
    );
  }
}
