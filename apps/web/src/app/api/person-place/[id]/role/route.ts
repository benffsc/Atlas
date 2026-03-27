import { NextRequest } from "next/server";
import { queryOne, execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";
import { PERSON_PLACE_ROLE } from "@/lib/enums";

interface RoleUpdateRequest {
  relationship_type: string;
  edited_by?: string;
}

/**
 * PATCH /api/person-place/[id]/role
 *
 * Update the relationship type (role) for a person-place relationship.
 * Does NOT automatically verify - use /verify endpoint for that.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: personPlaceId } = await params;

  if (!personPlaceId) {
    return apiBadRequest("person_place_id is required");
  }

  try {
    requireValidUUID(personPlaceId, "person_place");
    const body: RoleUpdateRequest = await request.json();
    const { relationship_type, edited_by } = body;

    // Validate relationship_type is required
    if (!relationship_type) {
      return apiBadRequest("relationship_type is required");
    }

    // Validate relationship_type
    if (!PERSON_PLACE_ROLE.includes(relationship_type as typeof PERSON_PLACE_ROLE[number])) {
      return apiBadRequest(`Invalid relationship_type. Must be one of: ${PERSON_PLACE_ROLE.join(", ")}`);
    }

    // Check if person_place exists and get current type
    const existing = await queryOne<{
      id: string;
      relationship_type: string;
      person_id: string;
      place_id: string;
    }>(
      `SELECT id, relationship_type, person_id, place_id
       FROM sot.person_place
       WHERE id = $1`,
      [personPlaceId]
    );

    if (!existing) {
      return apiNotFound("Person-place relationship", personPlaceId);
    }

    const oldType = existing.relationship_type;

    // Don't update if same type
    if (oldType === relationship_type) {
      return apiSuccess({
        person_place_id: personPlaceId,
        relationship_type,
        changed: false,
        message: "Role is already set to this value",
      });
    }

    // Update relationship type
    await queryOne(
      `UPDATE sot.person_place
       SET relationship_type = $2
       WHERE id = $1`,
      [personPlaceId, relationship_type]
    );

    // Log to entity_edits for audit trail
    await execute(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         old_value, new_value, edited_by, edit_source
       ) VALUES (
         'person_place', $1, 'update', 'relationship_type',
         to_jsonb($2::text), to_jsonb($3::text), $4, 'web_ui'
       )`,
      [personPlaceId, oldType, relationship_type, edited_by || "atlas_ui"]
    );

    return apiSuccess({
      person_place_id: personPlaceId,
      old_relationship_type: oldType,
      new_relationship_type: relationship_type,
      changed: true,
    });
  } catch (error) {
    console.error("Error updating person-place role:", error);
    return apiServerError("Failed to update role");
  }
}

/**
 * GET /api/person-place/[id]/role
 *
 * Get details about a specific person-place relationship.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: personPlaceId } = await params;

  if (!personPlaceId) {
    return apiBadRequest("person_place_id is required");
  }

  try {
    requireValidUUID(personPlaceId, "person_place");
    const relationship = await queryOne<{
      id: string;
      person_id: string;
      place_id: string;
      relationship_type: string;
      is_staff_verified: boolean;
      verified_at: string | null;
      verification_method: string | null;
      confidence: number | null;
      source_system: string;
      created_at: string;
      // Person details
      person_name: string | null;
      // Place details
      place_name: string | null;
      formatted_address: string | null;
      // Financial details
      financial_commitment: string | null;
      is_primary_contact: boolean;
    }>(
      `SELECT
        pp.id,
        pp.person_id,
        pp.place_id,
        pp.relationship_type,
        COALESCE(pp.is_staff_verified, FALSE) as is_staff_verified,
        pp.verified_at::text,
        pp.verification_method,
        pp.confidence,
        pp.source_system,
        pp.created_at::text,
        p.display_name as person_name,
        pl.display_name as place_name,
        pl.formatted_address,
        ppd.financial_commitment,
        COALESCE(ppd.is_primary_contact, FALSE) as is_primary_contact
      FROM sot.person_place pp
      JOIN sot.people p ON p.person_id = pp.person_id
      JOIN sot.places pl ON pl.place_id = pp.place_id
      LEFT JOIN sot.person_place_details ppd ON ppd.person_place_id = pp.id
      WHERE pp.id = $1`,
      [personPlaceId]
    );

    if (!relationship) {
      return apiNotFound("Person-place relationship", personPlaceId);
    }

    return apiSuccess({
      relationship,
      valid_roles: PERSON_PLACE_ROLE,
    });
  } catch (error) {
    console.error("Error fetching person-place relationship:", error);
    return apiServerError("Failed to fetch relationship");
  }
}
