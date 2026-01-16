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
  matched_person_id: string | null;
  matched_person_name: string | null;
}

/**
 * GET /api/places/[id]/submissions
 * Returns all web intake submissions linked to this place
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const submissions = await queryRows<Submission>(
      `SELECT
        w.submission_id,
        w.submitted_at,
        (w.first_name || ' ' || w.last_name) as submitter_name,
        w.email,
        w.phone,
        w.cats_address,
        w.cat_count_estimate,
        w.cat_count_text,
        w.situation_description,
        w.submission_status,
        w.appointment_date,
        w.triage_category,
        w.is_legacy,
        w.legacy_status,
        w.legacy_submission_status,
        w.legacy_appointment_date,
        w.created_request_id,
        w.matched_person_id,
        p.display_name as matched_person_name
      FROM trapper.web_intake_submissions w
      LEFT JOIN trapper.sot_people p ON p.person_id = w.matched_person_id
      WHERE w.place_id = $1 OR w.matched_place_id = $1
      ORDER BY w.submitted_at DESC
      LIMIT 50`,
      [id]
    );

    return NextResponse.json({
      place_id: id,
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    console.error("Error fetching place submissions:", error);
    return NextResponse.json(
      { error: "Failed to fetch submissions" },
      { status: 500 }
    );
  }
}
