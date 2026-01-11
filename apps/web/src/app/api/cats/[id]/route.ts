import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface CatDetailRow {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  quality_tier: string | null;
  quality_reason: string | null;
  notes: string | null;
  identifiers: object[];
  owners: object[];
  places: object[];
  created_at: string;
  updated_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        cat_id,
        display_name,
        sex,
        altered_status,
        breed,
        color,
        coat_pattern,
        microchip,
        quality_tier,
        quality_reason,
        notes,
        identifiers,
        owners,
        places,
        created_at,
        updated_at
      FROM trapper.v_cat_detail
      WHERE cat_id = $1
    `;

    const cat = await queryOne<CatDetailRow>(sql, [id]);

    if (!cat) {
      return NextResponse.json(
        { error: "Cat not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(cat);
  } catch (error) {
    console.error("Error fetching cat detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch cat detail" },
      { status: 500 }
    );
  }
}
