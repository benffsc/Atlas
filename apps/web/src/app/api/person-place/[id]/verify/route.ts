import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// Valid relationship types for TNR taxonomy (from MIG_2514)
const VALID_RELATIONSHIP_TYPES = [
  // Residence types
  "resident",
  "property_owner",
  // Colony caretaker hierarchy
  "colony_caretaker",
  "colony_supervisor",
  "feeder",
  // Transport/logistics
  "transporter",
  // Referral/contact
  "referrer",
  "neighbor",
  // Work/volunteer
  "works_at",
  "volunteers_at",
  // Automated/unverified
  "contact_address",
  // Legacy
  "owner",
  "manager",
  "caretaker",
  "requester",
  "trapper_at",
] as const;

const VALID_VERIFICATION_METHODS = [
  "phone_call",
  "site_visit",
  "ui_button",
  "import_confirmed",
  "intake_form",
  "adopter_record",
] as const;

const VALID_FINANCIAL_COMMITMENTS = [
  "full",
  "limited",
  "emergency_only",
  "none",
] as const;

interface VerifyRequest {
  verified_by?: string;
  verification_method: string;
  relationship_type?: string;
  financial_commitment?: string;
  notes?: string;
}

/**
 * POST /api/person-place/[id]/verify
 *
 * Verify a person-place relationship with optional role update and financial commitment.
 * Uses the sot.verify_person_place() function from MIG_2514.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: personPlaceId } = await params;

  if (!personPlaceId) {
    return NextResponse.json(
      { error: "person_place_id is required" },
      { status: 400 }
    );
  }

  try {
    const body: VerifyRequest = await request.json();
    const {
      verified_by,
      verification_method,
      relationship_type,
      financial_commitment,
      notes,
    } = body;

    // Validate verification_method is required
    if (!verification_method) {
      return NextResponse.json(
        { error: "verification_method is required" },
        { status: 400 }
      );
    }

    // Validate verification_method
    if (!VALID_VERIFICATION_METHODS.includes(verification_method as typeof VALID_VERIFICATION_METHODS[number])) {
      return NextResponse.json(
        { error: `Invalid verification_method. Must be one of: ${VALID_VERIFICATION_METHODS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate relationship_type if provided
    if (relationship_type && !VALID_RELATIONSHIP_TYPES.includes(relationship_type as typeof VALID_RELATIONSHIP_TYPES[number])) {
      return NextResponse.json(
        { error: `Invalid relationship_type. Must be one of: ${VALID_RELATIONSHIP_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate financial_commitment if provided
    if (financial_commitment && !VALID_FINANCIAL_COMMITMENTS.includes(financial_commitment as typeof VALID_FINANCIAL_COMMITMENTS[number])) {
      return NextResponse.json(
        { error: `Invalid financial_commitment. Must be one of: ${VALID_FINANCIAL_COMMITMENTS.join(", ")}` },
        { status: 400 }
      );
    }

    // Check if person_place exists
    const existing = await queryOne<{ id: string; relationship_type: string; is_staff_verified: boolean }>(
      `SELECT id, relationship_type, COALESCE(is_staff_verified, FALSE) as is_staff_verified
       FROM sot.person_place
       WHERE id = $1`,
      [personPlaceId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: "Person-place relationship not found" },
        { status: 404 }
      );
    }

    // Try to use the verify function (from MIG_2514)
    // Fallback to direct update if function doesn't exist
    let result: { success: boolean; old_relationship_type: string; new_relationship_type: string; verified_at: string };
    try {
      const funcResult = await queryOne<{ verify_person_place: string }>(
        `SELECT sot.verify_person_place($1, $2, $3, $4, $5, $6)::text as verify_person_place`,
        [
          personPlaceId,
          verified_by || null,
          verification_method,
          relationship_type || null,
          financial_commitment || null,
          notes || null,
        ]
      );

      if (funcResult?.verify_person_place) {
        const parsed = JSON.parse(funcResult.verify_person_place);
        result = {
          success: parsed.success,
          old_relationship_type: parsed.old_relationship_type,
          new_relationship_type: parsed.new_relationship_type,
          verified_at: parsed.verified_at,
        };
      } else {
        throw new Error("Function returned no result");
      }
    } catch {
      // Fallback: direct update if function doesn't exist
      const newType = relationship_type || existing.relationship_type;

      await queryOne(
        `UPDATE sot.person_place
         SET is_staff_verified = TRUE,
             verified_at = NOW(),
             verified_by = $2,
             verification_method = $3,
             relationship_type = $4
         WHERE id = $1`,
        [personPlaceId, verified_by || null, verification_method, newType]
      );

      // Handle financial commitment separately
      if (financial_commitment || notes) {
        await queryOne(
          `INSERT INTO sot.person_place_details (person_place_id, financial_commitment, notes, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (person_place_id) DO UPDATE
           SET financial_commitment = COALESCE(EXCLUDED.financial_commitment, sot.person_place_details.financial_commitment),
               notes = COALESCE(EXCLUDED.notes, sot.person_place_details.notes),
               updated_at = NOW()`,
          [personPlaceId, financial_commitment || null, notes || null, verified_by || null]
        );
      }

      result = {
        success: true,
        old_relationship_type: existing.relationship_type,
        new_relationship_type: newType,
        verified_at: new Date().toISOString(),
      };
    }

    return NextResponse.json({
      success: true,
      person_place_id: personPlaceId,
      old_relationship_type: result.old_relationship_type,
      new_relationship_type: result.new_relationship_type,
      verified_at: result.verified_at,
      verification_method,
    });
  } catch (error) {
    console.error("Error verifying person-place relationship:", error);
    return NextResponse.json(
      { error: "Failed to verify relationship" },
      { status: 500 }
    );
  }
}
