import { NextRequest } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest, apiConflict, apiForbidden } from "@/lib/api-response";

const VALID_ROLES = [
  "resident",
  "owner",
  "tenant",
  "manager",
  "requester",
  "contact",
  "emergency_contact",
  "former_resident",
  "visitor",
  "employee",
  "other",
] as const;

type PersonPlaceRole = (typeof VALID_ROLES)[number];


/**
 * POST /api/places/[id]/people
 *
 * Add a person to a place with a specified role.
 *
 * Body: { person_id: string, role: string, note?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  try {
    requireValidUUID(placeId, "place");

    const body = await request.json();
    const { person_id, role, note } = body as {
      person_id?: string;
      role?: string;
      note?: string;
    };

    // Validate required fields
    if (!person_id || !role) {
      return apiBadRequest("Both 'person_id' and 'role' are required");
    }

    // Validate person_id is a valid UUID
    requireValidUUID(person_id, "person");

    // Validate role against enum values
    if (!VALID_ROLES.includes(role as PersonPlaceRole)) {
      return apiBadRequest(`Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    }

    // Validate place exists
    const place = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1 AND merged_into_place_id IS NULL`,
      [placeId]
    );

    if (!place) {
      return apiNotFound("Place", placeId);
    }

    // Validate person exists
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [person_id]
    );

    if (!person) {
      return apiNotFound("Person", person_id);
    }

    // Insert relationship with ON CONFLICT DO NOTHING
    const relationship = await queryOne<{
      relationship_id: string;
      person_id: string;
      place_id: string;
      role: string;
      confidence: number;
      note: string | null;
      source_system: string;
      created_at: string;
    }>(
      // V2: Uses sot.person_place instead of sot.person_place_relationships, relationship_type instead of role
      `INSERT INTO sot.person_place (
         person_id, place_id, relationship_type, source_system, confidence, note, created_by
       ) VALUES (
         $1, $2, $3, 'atlas_ui', 0.9, $4, 'atlas_ui'
       )
       ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING
       RETURNING
         relationship_id,
         person_id,
         place_id,
         relationship_type::text AS role,
         confidence,
         note,
         source_system,
         created_at::text AS created_at`,
      [person_id, placeId, role, note || null]
    );

    // If ON CONFLICT fired, the relationship already exists
    if (!relationship) {
      return apiConflict("This person-place-role relationship already exists");
    }

    // Log to entity_edits for audit trail
    await execute(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         new_value, edited_by, edit_source
       ) VALUES (
         'person_place_relationship', $1, 'create', 'created',
         to_jsonb($2::text), 'atlas_ui', 'web_ui'
       )`,
      [relationship.relationship_id, role]
    );

    return apiSuccess({ relationship });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error adding person to place:", error);
    return apiServerError("Failed to add person to place");
  }
}

/**
 * DELETE /api/places/[id]/people?person_id=...&role=...
 *
 * Remove a manually-added person-place relationship.
 * Only allows deleting relationships with source_system = 'atlas_ui'.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  try {
    requireValidUUID(placeId, "place");

    const { searchParams } = new URL(request.url);
    const person_id = searchParams.get("person_id");
    const role = searchParams.get("role");

    // Validate required params
    if (!person_id || !role) {
      return apiBadRequest("Both 'person_id' and 'role' query parameters are required");
    }

    // Validate person_id is a valid UUID
    requireValidUUID(person_id, "person");

    // Validate role against enum values
    if (!VALID_ROLES.includes(role as PersonPlaceRole)) {
      return apiBadRequest(`Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    }

    // Validate place exists
    const place = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1 AND merged_into_place_id IS NULL`,
      [placeId]
    );

    if (!place) {
      return apiNotFound("Place", placeId);
    }

    // Find the relationship (only atlas_ui source allowed for deletion)
    // V2: Uses sot.person_place instead of sot.person_place_relationships, relationship_type instead of role
    const existing = await queryOne<{
      relationship_id: string;
      source_system: string;
    }>(
      `SELECT relationship_id, source_system
       FROM sot.person_place
       WHERE person_id = $1 AND place_id = $2 AND relationship_type = $3`,
      [person_id, placeId, role]
    );

    if (!existing) {
      return apiNotFound("Relationship", `${person_id}/${role}`);
    }

    if (existing.source_system !== "atlas_ui") {
      return apiForbidden("Cannot delete automated relationships. Only manually-added (atlas_ui) relationships can be removed.");
    }

    // Log to entity_edits before deleting
    await execute(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         old_value, edited_by, edit_source
       ) VALUES (
         'person_place_relationship', $1, 'delete', 'deleted',
         to_jsonb($2::text), 'atlas_ui', 'web_ui'
       )`,
      [existing.relationship_id, role]
    );

    // Delete the relationship
    // V2: Uses sot.person_place instead of sot.person_place_relationships
    await execute(
      `DELETE FROM sot.person_place
       WHERE relationship_id = $1 AND source_system = 'atlas_ui'`,
      [existing.relationship_id]
    );

    return apiSuccess({ deleted_relationship_id: existing.relationship_id });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error removing person from place:", error);
    return apiServerError("Failed to remove person from place");
  }
}

interface PersonAtPlace {
  person_place_id: string;
  person_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  relationship_type: string;
  is_staff_verified: boolean;
  verified_at: string | null;
  verification_method: string | null;
  financial_commitment: string | null;
  is_primary_contact: boolean;
  cat_count: number;
  source_system: string;
  created_at: string;
}

/**
 * GET /api/places/[id]/people
 *
 * List all people associated with a place, with verification status.
 * Uses the sot.get_people_at_place() function from MIG_2514.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  try {
    requireValidUUID(placeId, "place");

    // Validate place exists
    const place = await queryOne<{ place_id: string; display_name: string | null; formatted_address: string | null }>(
      `SELECT place_id, display_name, formatted_address
       FROM sot.places
       WHERE place_id = $1 AND merged_into_place_id IS NULL`,
      [placeId]
    );

    if (!place) {
      return apiNotFound("Place", placeId);
    }

    // Get people at this place using the helper function
    // Fallback to direct query if function doesn't exist yet
    let people: PersonAtPlace[];
    try {
      people = await queryRows<PersonAtPlace>(
        `SELECT * FROM sot.get_people_at_place($1)`,
        [placeId]
      );
    } catch {
      // Fallback: direct query if function doesn't exist
      people = await queryRows<PersonAtPlace>(
        `SELECT
          pp.id as person_place_id,
          pp.person_id,
          p.display_name,
          p.first_name,
          p.last_name,
          pp.relationship_type,
          COALESCE(pp.is_staff_verified, FALSE) as is_staff_verified,
          pp.verified_at::text,
          pp.verification_method,
          ppd.financial_commitment,
          COALESCE(ppd.is_primary_contact, FALSE) as is_primary_contact,
          (SELECT COUNT(*) FROM sot.person_cat_relationships pcr WHERE pcr.person_id = pp.person_id)::int as cat_count,
          pp.source_system,
          pp.created_at::text
        FROM sot.person_place pp
        JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
        LEFT JOIN sot.person_place_details ppd ON ppd.person_place_id = pp.id
        WHERE pp.place_id = $1
        ORDER BY
          COALESCE(ppd.is_primary_contact, FALSE) DESC,
          COALESCE(pp.is_staff_verified, FALSE) DESC,
          pp.created_at DESC`,
        [placeId]
      );
    }

    // Count by verification status
    const verifiedCount = people.filter(p => p.is_staff_verified).length;
    const unverifiedCount = people.length - verifiedCount;

    return apiSuccess({
      place: {
        place_id: place.place_id,
        display_name: place.display_name,
        formatted_address: place.formatted_address,
      },
      people,
      summary: {
        total: people.length,
        verified: verifiedCount,
        unverified: unverifiedCount,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching people at place:", error);
    return apiServerError("Failed to fetch people at place");
  }
}
