import { NextRequest } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest } from "@/lib/api-response";
import { logFieldEdit } from "@/lib/audit";

interface PlaceForPerson {
  person_place_id: string;
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  relationship_type: string;
  is_staff_verified: boolean;
  verified_at: string | null;
  verification_method: string | null;
  financial_commitment: string | null;
  is_primary_contact: boolean;
  source_system: string;
  created_at: string;
  // Place metadata
  latitude: number | null;
  longitude: number | null;
}

/**
 * GET /api/people/[id]/places
 *
 * List all places associated with a person, with verification status.
 * Uses the sot.get_places_for_person() function from MIG_2514.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: personId } = await params;

  try {
    requireValidUUID(personId, "person");

    // Validate person exists
    const person = await queryOne<{
      person_id: string;
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>(
      `SELECT person_id, display_name, first_name, last_name
       FROM sot.people
       WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [personId]
    );

    if (!person) {
      return apiNotFound("Person", personId);
    }

    // Get places for this person
    // Try the helper function first, fallback to direct query
    let places: PlaceForPerson[];
    try {
      places = await queryRows<PlaceForPerson>(
        `SELECT
          pp.id as person_place_id,
          pp.place_id,
          pl.display_name,
          pl.formatted_address,
          pp.relationship_type,
          COALESCE(pp.is_staff_verified, FALSE) as is_staff_verified,
          pp.verified_at::text,
          pp.verification_method,
          ppd.financial_commitment,
          COALESCE(ppd.is_primary_contact, FALSE) as is_primary_contact,
          pp.source_system,
          pp.created_at::text,
          ST_Y(pl.location::geometry) as latitude,
          ST_X(pl.location::geometry) as longitude
        FROM sot.person_place pp
        JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
        LEFT JOIN sot.person_place_details ppd ON ppd.person_place_id = pp.id
        WHERE pp.person_id = $1
        ORDER BY
          COALESCE(ppd.is_primary_contact, FALSE) DESC,
          COALESCE(pp.is_staff_verified, FALSE) DESC,
          pp.created_at DESC`,
        [personId]
      );
    } catch (err) {
      console.error("Error in places query:", err);
      places = [];
    }

    // Count by verification status
    const verifiedCount = places.filter(p => p.is_staff_verified).length;
    const unverifiedCount = places.length - verifiedCount;

    // Group by relationship type
    const byType: Record<string, number> = {};
    for (const place of places) {
      byType[place.relationship_type] = (byType[place.relationship_type] || 0) + 1;
    }

    return apiSuccess({
      person: {
        person_id: person.person_id,
        display_name: person.display_name,
        first_name: person.first_name,
        last_name: person.last_name,
      },
      places,
      summary: {
        total: places.length,
        verified: verifiedCount,
        unverified: unverifiedCount,
        by_type: byType,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching places for person:", error);
    return apiServerError("Failed to fetch places for person");
  }
}

/**
 * POST /api/people/[id]/places
 *
 * FFS-1028: Link a person to a place (e.g., save requester's home address
 * when changing a request's cat location). Staff-verified, confidence 1.0.
 *
 * Body: { place_id: UUID, relationship_type?: string, is_staff_verified?: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: personId } = await params;

  try {
    requireValidUUID(personId, "person");

    const body = await request.json();
    const { place_id, relationship_type = "resident", is_staff_verified = true } = body;

    if (!place_id || typeof place_id !== "string") {
      return apiBadRequest("place_id is required");
    }
    requireValidUUID(place_id, "place");

    // Verify both person and place exist
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [personId]
    );
    if (!person) return apiNotFound("Person", personId);

    const place = await queryOne<{ place_id: string; display_name: string | null; formatted_address: string | null }>(
      `SELECT place_id, display_name, formatted_address FROM sot.places WHERE place_id = $1 AND merged_into_place_id IS NULL`,
      [place_id]
    );
    if (!place) return apiNotFound("Place", place_id);

    // Upsert person_place
    const result = await queryOne<{ id: string }>(
      `INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system,
        is_staff_verified, verified_at, verification_method
      ) VALUES (
        $1, $2, $3,
        1.0, 'staff_verified', 'atlas_ui',
        $4, CASE WHEN $4 THEN NOW() ELSE NULL END, CASE WHEN $4 THEN 'request_update' ELSE NULL END
      )
      ON CONFLICT (person_id, place_id, relationship_type)
      DO UPDATE SET
        confidence = GREATEST(sot.person_place.confidence, 1.0),
        is_staff_verified = COALESCE($4, sot.person_place.is_staff_verified),
        verified_at = CASE WHEN $4 THEN NOW() ELSE sot.person_place.verified_at END,
        verification_method = CASE WHEN $4 THEN 'request_update' ELSE sot.person_place.verification_method END,
        updated_at = NOW()
      RETURNING id`,
      [personId, place_id, relationship_type, is_staff_verified]
    );

    await logFieldEdit("person", personId, "person_place", null, place_id, {
      editedBy: "web_user",
      editSource: "web_ui",
      reason: `Saved ${relationship_type} address: ${place.display_name || place.formatted_address}`,
    });

    return apiSuccess({
      person_place_id: result?.id,
      place_id,
      relationship_type,
      is_staff_verified,
      address: place.display_name || place.formatted_address,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error linking person to place:", error);
    return apiServerError("Failed to link person to place");
  }
}
