import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

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
    requireValidUUID(id, "person");

    const submissions = await queryRows<Submission>(
      `SELECT
        s.submission_id,
        s.submitted_at,
        COALESCE(NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), ''), s.email) as submitter_name,
        s.email,
        s.phone,
        s.cats_address,
        s.cat_count_estimate,
        NULL::text as cat_count_text,
        s.situation_description,
        s.submission_status,
        NULL::timestamptz as appointment_date,
        s.triage_category,
        (s.migrated_at IS NOT NULL AND s.source_raw_id IS NOT NULL) as is_legacy,
        NULL::text as legacy_status,
        NULL::text as legacy_submission_status,
        NULL::timestamptz as legacy_appointment_date,
        s.request_id::text as created_request_id,
        COALESCE(s.place_id, s.matched_place_id) as place_id
      FROM ops.intake_submissions s
      WHERE s.matched_person_id = $1
      ORDER BY s.submitted_at DESC
      LIMIT 50`,
      [id]
    );

    return apiSuccess({
      person_id: id,
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching person submissions:", error);
    return apiServerError("Failed to fetch submissions");
  }
}
