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
  // Unified status (new)
  submission_status: string | null;
  appointment_date: string | null;
  priority_override: string | null;
  // Native status (kept for transition)
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
  // Custom fields (dynamic)
  custom_fields: Record<string, unknown> | null;
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
      // Unified status (primary)
      'submission_status',
      'appointment_date',
      'priority_override',
      // Native status (kept for transition)
      'status',
      // Legacy fields (kept for backward compatibility)
      'legacy_status',
      'legacy_submission_status',
      'legacy_appointment_date',
      'legacy_notes',
      'review_notes',
      'matched_person_id',
      'final_category',
      // Contact tracking
      'last_contacted_at',
      'last_contact_method',
      'contact_attempt_count',
      // Address fields (for corrections)
      'cats_address',
      'cats_city',
      'cats_zip',
    ];

    // Track if address fields are being updated
    const addressFieldsUpdated = ['cats_address', 'cats_city', 'cats_zip'].some(f => f in body);

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

    // If address is being corrected, clear old geo data and place link
    // so the re-linking function can properly deduplicate
    if (addressFieldsUpdated) {
      updates.push(`geo_formatted_address = NULL`);
      updates.push(`geo_latitude = NULL`);
      updates.push(`geo_longitude = NULL`);
      updates.push(`geo_confidence = NULL`);
      updates.push(`place_id = NULL`);
      updates.push(`matched_place_id = NULL`);
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

    // If address was corrected, re-link to proper place with deduplication
    if (addressFieldsUpdated && updated) {
      try {
        // This function handles deduplication via find_or_create_place_deduped
        // and queues for geocoding if needed
        await queryOne(
          `SELECT trapper.link_intake_submission_to_place($1)`,
          [id]
        );

        // Fetch the updated submission with new place link
        const refreshed = await queryOne<IntakeSubmission>(`
          SELECT w.*,
                 p.formatted_address as geo_formatted_address,
                 ST_Y(p.location::geometry) as geo_latitude,
                 ST_X(p.location::geometry) as geo_longitude,
                 CASE WHEN p.location IS NOT NULL THEN 'geocoded' ELSE NULL END as geo_confidence
          FROM trapper.web_intake_submissions w
          LEFT JOIN trapper.places p ON p.place_id = w.place_id
          WHERE w.submission_id = $1
        `, [id]);

        return NextResponse.json({
          submission: refreshed,
          address_relinked: true,
        });
      } catch (linkErr) {
        console.error("Place re-linking error:", linkErr);
        // Return the updated submission even if relinking failed
        return NextResponse.json({
          submission: updated,
          address_relinked: false,
          relink_error: "Failed to re-link place, please try again",
        });
      }
    }

    return NextResponse.json({ submission: updated });
  } catch (err) {
    console.error("Error updating submission:", err);
    return NextResponse.json(
      { error: "Failed to update submission" },
      { status: 500 }
    );
  }
}
