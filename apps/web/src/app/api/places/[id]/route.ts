import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";

interface PlaceDetailRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: object[] | null;
  people: object[] | null;
  place_relationships: object[] | null;
  cat_count: number;
  person_count: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        place_id,
        display_name,
        formatted_address,
        place_kind,
        is_address_backed,
        has_cat_activity,
        locality,
        postal_code,
        state_province,
        coordinates,
        created_at,
        updated_at,
        cats,
        people,
        place_relationships,
        cat_count,
        person_count
      FROM trapper.v_place_detail_v2
      WHERE place_id = $1
    `;

    const place = await queryOne<PlaceDetailRow>(sql, [id]);

    if (!place) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(place);
  } catch (error) {
    console.error("Error fetching place detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch place detail" },
      { status: 500 }
    );
  }
}

// Valid place kinds matching the database enum
const VALID_PLACE_KINDS = [
  "unknown",
  "residential_house",
  "apartment_unit",
  "apartment_building",
  "business",
  "clinic",
  "neighborhood",
  "outdoor_site",
] as const;

interface UpdatePlaceBody {
  display_name?: string;
  place_kind?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpdatePlaceBody = await request.json();

    // Validate place_kind if provided
    if (body.place_kind && !VALID_PLACE_KINDS.includes(body.place_kind as typeof VALID_PLACE_KINDS[number])) {
      return NextResponse.json(
        { error: `Invalid place_kind. Must be one of: ${VALID_PLACE_KINDS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate display_name if provided
    if (body.display_name !== undefined && body.display_name.trim() === "") {
      return NextResponse.json(
        { error: "display_name cannot be empty" },
        { status: 400 }
      );
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.display_name !== undefined) {
      updates.push(`display_name = $${paramIndex}`);
      values.push(body.display_name.trim());
      paramIndex++;
    }

    if (body.place_kind !== undefined) {
      updates.push(`place_kind = $${paramIndex}::trapper.place_kind`);
      values.push(body.place_kind);
      paramIndex++;
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add place_id to values
    values.push(id);

    const sql = `
      UPDATE trapper.places
      SET ${updates.join(", ")}
      WHERE place_id = $${paramIndex}
      RETURNING place_id, display_name, place_kind, is_address_backed
    `;

    const result = await queryOne<{
      place_id: string;
      display_name: string;
      place_kind: string;
      is_address_backed: boolean;
    }>(sql, values);

    if (!result) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      place: result,
    });
  } catch (error) {
    console.error("Error updating place:", error);
    return NextResponse.json(
      { error: "Failed to update place" },
      { status: 500 }
    );
  }
}
