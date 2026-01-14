import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  county: string | null;
  ownership_status: string;
  cat_count_estimate: number | null;
  fixed_status: string;
  has_kittens: boolean | null;
  has_medical_concerns: boolean | null;
  is_emergency: boolean;
  situation_description: string | null;
  how_long_feeding: string | null;
  triage_category: string | null;
  triage_score: number | null;
  triage_reasons: unknown;
  status: string;
  final_category: string | null;
  created_request_id: string | null;
  // Third-party report fields
  is_third_party_report: boolean | null;
  third_party_relationship: string | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  property_owner_email: string | null;
  // Legacy fields
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  legacy_notes: string | null;
  legacy_source_id: string | null;
  review_notes: string | null;
  matched_person_id: string | null;
  intake_source: string | null;
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_confidence: string | null;
  updated_at: string | null;
}

interface MatchedPerson {
  person_id: string;
  display_name: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const submission = await queryOne<IntakeSubmission>(`
      SELECT *
      FROM trapper.web_intake_submissions
      WHERE submission_id = $1
    `, [id]);

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Get matched person details if linked
    let matchedPerson: MatchedPerson | null = null;
    if (submission.matched_person_id) {
      matchedPerson = await queryOne<MatchedPerson>(`
        SELECT person_id, display_name
        FROM trapper.sot_people
        WHERE person_id = $1
      `, [submission.matched_person_id]);
    }

    return NextResponse.json({
      submission,
      matchedPerson,
    });
  } catch (err) {
    console.error("Error fetching submission:", err);
    return NextResponse.json(
      { error: "Failed to fetch submission" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Allowed fields to update
    const allowedFields = [
      'status',
      'legacy_status',
      'legacy_submission_status',
      'legacy_appointment_date',
      'legacy_notes',
      'review_notes',
      'matched_person_id',
      'final_category',
    ];

    for (const field of allowedFields) {
      if (field in body) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(body[field]);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const sql = `
      UPDATE trapper.web_intake_submissions
      SET ${updates.join(', ')}
      WHERE submission_id = $${paramIndex}
      RETURNING *
    `;

    const updated = await queryOne<IntakeSubmission>(sql, values);

    return NextResponse.json({ submission: updated });
  } catch (err) {
    console.error("Error updating submission:", err);
    return NextResponse.json(
      { error: "Failed to update submission" },
      { status: 500 }
    );
  }
}
