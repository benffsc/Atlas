import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface PersonDetailRow {
  person_id: string;
  display_name: string;
  merged_into_person_id: string | null;
  created_at: string;
  updated_at: string;
  cats: object[] | null;
  places: object[] | null;
  person_relationships: object[] | null;
  cat_count: number;
  place_count: number;
}

export async function GET(
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
    const sql = `
      SELECT
        person_id,
        display_name,
        merged_into_person_id,
        created_at,
        updated_at,
        cats,
        places,
        person_relationships,
        cat_count,
        place_count
      FROM trapper.v_person_detail
      WHERE person_id = $1
    `;

    const person = await queryOne<PersonDetailRow>(sql, [id]);

    if (!person) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(person);
  } catch (error) {
    console.error("Error fetching person detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch person detail" },
      { status: 500 }
    );
  }
}
