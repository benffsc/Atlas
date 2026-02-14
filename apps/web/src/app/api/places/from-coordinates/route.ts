import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface CreateFromCoordinatesBody {
  lat: number;
  lng: number;
  display_name?: string;
  place_kind?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateFromCoordinatesBody = await request.json();

    // Validate coordinates
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number' ||
        body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
      return NextResponse.json(
        { error: "Valid lat (-90..90) and lng (-180..180) are required" },
        { status: 400 }
      );
    }

    // Use centralized function — handles 10m dedup automatically
    const result = await queryOne<{ create_place_from_coordinates: string }>(
      `SELECT sot.create_place_from_coordinates($1, $2, $3, $4) AS create_place_from_coordinates`,
      [body.lat, body.lng, body.display_name || null, 'atlas_ui']
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create place" },
        { status: 500 }
      );
    }

    const placeId = result.create_place_from_coordinates;

    // Update place_kind if provided and not default
    if (body.place_kind && body.place_kind !== 'unknown') {
      await queryOne(
        `UPDATE sot.places SET place_kind = $1 WHERE place_id = $2`,
        [body.place_kind, placeId]
      );
    }

    // Fetch the created/found place details
    const place = await queryOne<{
      place_id: string;
      display_name: string | null;
      formatted_address: string | null;
      is_address_backed: boolean;
    }>(
      `SELECT place_id, display_name, formatted_address, is_address_backed
       FROM sot.places WHERE place_id = $1`,
      [placeId]
    );

    return NextResponse.json({
      place_id: placeId,
      display_name: place?.display_name || body.display_name || null,
      formatted_address: place?.formatted_address || null,
      is_existing: place?.is_address_backed === true,
      success: true,
    });
  } catch (error) {
    console.error("Error creating place from coordinates:", error);
    return NextResponse.json(
      { error: "Failed to create place" },
      { status: 500 }
    );
  }
}
