import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface UpdateAddressRequest {
  // Path 1: PlaceResolver provides an existing Atlas place_id
  place_id?: string;
  // Path 2: Legacy Google data (AddressAutocomplete)
  google_place_id?: string;
  formatted_address?: string;
  lat?: number;
  lng?: number;
  address_components?: AddressComponent[];
}

function extractComponent(components: AddressComponent[], type: string): string | null {
  const comp = components.find(c => c.types.includes(type));
  return comp?.long_name || null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpdateAddressRequest = await request.json();

    let placeId: string;
    let addressId: string;
    let formattedAddress: string;

    if (body.place_id) {
      // ── Path 1: PlaceResolver provides an existing Atlas place_id ──
      const place = await queryOne<{
        place_id: string;
        formatted_address: string;
        address_id: string | null;
        lat: number | null;
        lng: number | null;
      }>(
        `SELECT place_id, formatted_address, address_id,
                ST_Y(geometry::geometry) as lat, ST_X(geometry::geometry) as lng
         FROM sot.places WHERE place_id = $1 AND merged_into_place_id IS NULL`,
        [body.place_id]
      );

      if (!place) {
        return NextResponse.json(
          { error: "Place not found or has been merged" },
          { status: 404 }
        );
      }

      placeId = place.place_id;
      formattedAddress = place.formatted_address || "";

      if (place.address_id) {
        addressId = place.address_id;
      } else {
        // Place has no sot_address — create a minimal one
        const addrResult = await queryOne<{ address_id: string }>(
          `INSERT INTO sot.addresses (formatted_address, country)
           VALUES ($1, 'USA')
           ON CONFLICT (formatted_address) DO UPDATE SET formatted_address = EXCLUDED.formatted_address
           RETURNING address_id`,
          [formattedAddress]
        );
        addressId = addrResult?.address_id || "";
        if (!addressId) {
          return NextResponse.json(
            { error: "Failed to create address record" },
            { status: 500 }
          );
        }
      }
    } else if (body.google_place_id && body.formatted_address) {
      // ── Path 2: Legacy Google data (AddressAutocomplete) ──
      const streetNumber = extractComponent(body.address_components || [], "street_number");
      const route = extractComponent(body.address_components || [], "route");
      const locality = extractComponent(body.address_components || [], "locality");
      const adminArea1 = extractComponent(body.address_components || [], "administrative_area_level_1");
      const adminArea2 = extractComponent(body.address_components || [], "administrative_area_level_2");
      const postalCode = extractComponent(body.address_components || [], "postal_code");
      const country = extractComponent(body.address_components || [], "country") || "US";

      const addressResult = await queryOne<{ address_id: string }>(
        `SELECT trapper.upsert_address_from_google_place($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS address_id`,
        [
          body.google_place_id,
          body.formatted_address,
          body.lat,
          body.lng,
          streetNumber,
          route,
          locality,
          adminArea1,
          adminArea2,
          postalCode,
          country,
        ]
      );

      if (!addressResult?.address_id) {
        return NextResponse.json(
          { error: "Failed to create or find address" },
          { status: 500 }
        );
      }
      addressId = addressResult.address_id;

      const placeResult = await queryOne<{ place_id: string }>(
        `SELECT sot.find_or_create_place_deduped($1, $2, $3, $4, $5) AS place_id`,
        [body.formatted_address, null, body.lat, body.lng, "atlas_ui"]
      );

      if (!placeResult?.place_id) {
        return NextResponse.json(
          { error: "Failed to create or find place" },
          { status: 500 }
        );
      }
      placeId = placeResult.place_id;
      formattedAddress = body.formatted_address;
    } else {
      return NextResponse.json(
        { error: "Either place_id or google_place_id + formatted_address required" },
        { status: 400 }
      );
    }

    // Atomically relink: ends old relationship, creates new one, updates primary_address_id, logs audit
    const relinkResult = await queryOne<{ relink_person_primary_address: string }>(
      `SELECT trapper.relink_person_primary_address($1, $2, $3, $4)`,
      [id, placeId, addressId, "web_user"]
    );

    return NextResponse.json({
      success: true,
      address_id: addressId,
      place_id: placeId,
      relationship_id: relinkResult?.relink_person_primary_address,
      formatted_address: formattedAddress,
    });
  } catch (error) {
    console.error("Error updating person address:", error);
    return NextResponse.json(
      { error: "Failed to update address" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    // Atomically unlink: ends resident relationship, clears primary_address_id, logs audit
    await query(
      `SELECT trapper.unlink_person_primary_address($1, $2)`,
      [id, "web_user"]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing person address:", error);
    return NextResponse.json(
      { error: "Failed to remove address" },
      { status: 500 }
    );
  }
}
