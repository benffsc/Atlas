import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

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
      FROM trapper.v_place_detail
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
