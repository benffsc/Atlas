import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface NearbyPlaceRow {
  place_id: string;
  display_name: string;
  place_kind: string | null;
  formatted_address: string;
  cat_count: number;
  person_count: number;
  distance_meters: number;
}

interface AddressCheckRow {
  address_id: string;
  google_place_id: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");
  const googlePlaceId = searchParams.get("google_place_id");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 }
    );
  }

  try {
    // Check if this exact google_place_id already exists as an address
    let existingAddress: AddressCheckRow | null = null;
    let addressId: string | null = null;

    if (googlePlaceId) {
      const addressResult = await queryRows<AddressCheckRow>(
        `SELECT address_id, google_place_id
         FROM trapper.sot_addresses
         WHERE google_place_id = $1
         LIMIT 1`,
        [googlePlaceId]
      );
      existingAddress = addressResult[0] || null;
      addressId = existingAddress?.address_id || null;
    }

    // Find nearby places (within 100 meters)
    const nearbyPlaces = await queryRows<NearbyPlaceRow>(
      `SELECT
         p.place_id,
         p.display_name,
         p.place_kind::TEXT as place_kind,
         p.formatted_address,
         COALESCE((SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id), 0)::INT as cat_count,
         COALESCE((SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = p.place_id), 0)::INT as person_count,
         ST_Distance(
           p.location::geography,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
         )::INT as distance_meters
       FROM trapper.places p
       WHERE p.location IS NOT NULL
         AND ST_DWithin(
           p.location::geography,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           100  -- 100 meters
         )
       ORDER BY distance_meters ASC
       LIMIT 10`,
      [lat, lng]
    );

    return NextResponse.json({
      existing_places: nearbyPlaces,
      existing_address: existingAddress !== null,
      address_id: addressId,
    });
  } catch (error) {
    console.error("Error checking nearby places:", error);
    return NextResponse.json(
      { error: "Failed to check nearby places" },
      { status: 500 }
    );
  }
}
