import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface UpdateAddressRequest {
  google_place_id: string;
  formatted_address: string;
  lat: number;
  lng: number;
  address_components: AddressComponent[];
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

    if (!body.google_place_id || !body.formatted_address) {
      return NextResponse.json(
        { error: "google_place_id and formatted_address are required" },
        { status: 400 }
      );
    }

    // Extract address components
    const streetNumber = extractComponent(body.address_components, "street_number");
    const route = extractComponent(body.address_components, "route");
    const locality = extractComponent(body.address_components, "locality");
    const adminArea1 = extractComponent(body.address_components, "administrative_area_level_1");
    const adminArea2 = extractComponent(body.address_components, "administrative_area_level_2");
    const postalCode = extractComponent(body.address_components, "postal_code");
    const country = extractComponent(body.address_components, "country") || "US";

    // Use the upsert function to get or create the address
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

    // Update the person's primary_address_id
    const updateResult = await query(
      `UPDATE trapper.sot_people
       SET primary_address_id = $1, updated_at = NOW()
       WHERE person_id = $2
       RETURNING person_id`,
      [addressResult.address_id, id]
    );

    if (updateResult.rowCount === 0) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      address_id: addressResult.address_id,
      formatted_address: body.formatted_address,
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
    const updateResult = await query(
      `UPDATE trapper.sot_people
       SET primary_address_id = NULL, updated_at = NOW()
       WHERE person_id = $1
       RETURNING person_id`,
      [id]
    );

    if (updateResult.rowCount === 0) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing person address:", error);
    return NextResponse.json(
      { error: "Failed to remove address" },
      { status: 500 }
    );
  }
}
