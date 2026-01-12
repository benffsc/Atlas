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
  is_valid_name: boolean;
  primary_address_id: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  data_source: string | null;
  identifiers: object[] | null;
  entity_type: string | null;
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
    // Use original v_person_detail (all people) so direct links work,
    // but add is_valid_name flag so UI can show warning for suspect entries
    const sql = `
      SELECT
        pd.person_id,
        pd.display_name,
        pd.merged_into_person_id,
        pd.created_at,
        pd.updated_at,
        pd.cats,
        pd.places,
        pd.person_relationships,
        pd.cat_count,
        pd.place_count,
        trapper.is_valid_person_name(pd.display_name) AS is_valid_name,
        p.primary_address_id,
        a.formatted_address AS primary_address,
        a.locality AS primary_address_locality,
        p.data_source,
        p.entity_type,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id_type', pi.id_type,
            'id_value', pi.id_value_norm,
            'source_system', pi.source_system,
            'source_table', pi.source_table
          ) ORDER BY pi.id_type)
          FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id
        ) AS identifiers
      FROM trapper.v_person_detail pd
      JOIN trapper.sot_people p ON p.person_id = pd.person_id
      LEFT JOIN trapper.sot_addresses a ON a.address_id = p.primary_address_id
      WHERE pd.person_id = $1
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
