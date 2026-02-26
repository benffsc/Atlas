import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

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

  if (!personId) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
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
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
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

    return NextResponse.json({
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
    console.error("Error fetching places for person:", error);
    return NextResponse.json(
      { error: "Failed to fetch places for person" },
      { status: 500 }
    );
  }
}
