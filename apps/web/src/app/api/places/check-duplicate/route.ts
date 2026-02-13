import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingPlace?: {
    place_id: string;
    display_name: string;
    formatted_address: string;
    place_kind: string | null;
    cat_count: number;
    request_count: number;
  };
  canAddUnit: boolean;
  normalizedAddress: string;
}

interface PlaceRow {
  place_id: string;
  display_name: string;
  formatted_address: string;
  place_kind: string | null;
  cat_count: number;
  request_count: number;
}

/**
 * GET /api/places/check-duplicate?address=...
 *
 * Checks if an address already exists in the database using normalized matching.
 * Used to prevent creating duplicate places with slight address variations.
 *
 * Returns:
 * - isDuplicate: true if a matching place exists
 * - existingPlace: the matching place if found
 * - canAddUnit: true if the address looks like a building that could have units added
 * - normalizedAddress: the normalized version of the input address
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get("address");

  if (!address || address.trim().length < 5) {
    return NextResponse.json(
      { error: "Address parameter required (minimum 5 characters)" },
      { status: 400 }
    );
  }

  try {
    // Get normalized address and check for duplicates
    const result = await queryOne<{
      normalized: string;
    }>(
      `SELECT sot.normalize_address($1) as normalized`,
      [address]
    );

    const normalizedAddress = result?.normalized || address.toLowerCase();

    // Find existing places with matching normalized address
    const existingPlaces = await queryRows<PlaceRow>(
      `SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        p.place_kind::TEXT,
        (SELECT COUNT(*) FROM sot.cat_place_relationships WHERE place_id = p.place_id)::INT as cat_count,
        (SELECT COUNT(*) FROM ops.requests WHERE place_id = p.place_id)::INT as request_count
      FROM sot.places p
      WHERE sot.normalize_address(p.formatted_address) = sot.normalize_address($1)
        AND p.merged_into_place_id IS NULL
      ORDER BY
        (SELECT COUNT(*) FROM sot.cat_place_relationships WHERE place_id = p.place_id) +
        (SELECT COUNT(*) FROM ops.requests WHERE place_id = p.place_id) DESC
      LIMIT 5`,
      [address]
    );

    if (existingPlaces.length === 0) {
      // No duplicate found
      return NextResponse.json({
        isDuplicate: false,
        canAddUnit: false,
        normalizedAddress,
      } as DuplicateCheckResult);
    }

    // Found duplicate(s)
    const bestMatch = existingPlaces[0];

    // Determine if this could be an apartment building that accepts units
    const canAddUnit = bestMatch.place_kind === "apartment_building" ||
      bestMatch.place_kind === "apartment_unit" ||
      // Check if address doesn't already have a unit
      !/\b(apt|apartment|unit|suite|ste|space|#)\s*[a-z0-9]/i.test(address);

    return NextResponse.json({
      isDuplicate: true,
      existingPlace: bestMatch,
      canAddUnit,
      normalizedAddress,
    } as DuplicateCheckResult);
  } catch (error) {
    console.error("Error checking duplicate:", error);
    return NextResponse.json(
      { error: "Failed to check for duplicate" },
      { status: 500 }
    );
  }
}
