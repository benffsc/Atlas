import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface PersonCatRelationship {
  cat_id: string;
  cat_name: string;
  microchip: string | null;
  relationship_type: string;
  confidence: string;
  context_notes: string | null;
  effective_date: string | null;
  appointment_id: string | null;
  appointment_date: string | null;
  appointment_number: string | null;
  source_system: string;
  data_source: string | null;
  created_at: string;
}

/**
 * GET /api/people/[id]/cats
 * Returns all cats linked to a person with enhanced relationship context
 * including brought_in_by relationships and context notes
 */
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
        pcr.cat_id,
        c.display_name AS cat_name,
        ci.id_value AS microchip,
        pcr.relationship_type,
        pc.confidence,
        pc.context_notes,
        pc.effective_date::TEXT,
        pc.appointment_id,
        a.appointment_date::TEXT,
        a.appointment_number,
        pc.source_system,
        c.data_source,
        pc.created_at::TEXT
      -- V2: Uses sot.person_cat instead of sot.person_cat_relationships
      FROM sot.person_cat pc
      JOIN sot.cats c ON c.cat_id = pc.cat_id
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
      LEFT JOIN ops.appointments a ON a.appointment_id = pc.appointment_id
      WHERE pc.person_id = $1
      ORDER BY
        CASE pc.relationship_type
          WHEN 'owner' THEN 1
          WHEN 'adopter' THEN 2
          WHEN 'fostering' THEN 3
          WHEN 'caretaker' THEN 4
          WHEN 'brought_in_by' THEN 5
          ELSE 6
        END,
        pc.effective_date DESC NULLS LAST,
        c.display_name
    `;

    const cats = await queryRows<PersonCatRelationship>(sql, [id]);

    // Group cats by cat_id and aggregate relationships
    const catMap = new Map<string, {
      cat_id: string;
      cat_name: string;
      microchip: string | null;
      data_source: string | null;
      relationships: {
        type: string;
        confidence: string;
        context_notes: string | null;
        effective_date: string | null;
        appointment_date: string | null;
        source_system: string;
      }[];
    }>();

    for (const row of cats) {
      if (!catMap.has(row.cat_id)) {
        catMap.set(row.cat_id, {
          cat_id: row.cat_id,
          cat_name: row.cat_name,
          microchip: row.microchip,
          data_source: row.data_source,
          relationships: [],
        });
      }
      catMap.get(row.cat_id)!.relationships.push({
        type: row.relationship_type,
        confidence: row.confidence,
        context_notes: row.context_notes,
        effective_date: row.effective_date,
        appointment_date: row.appointment_date,
        source_system: row.source_system,
      });
    }

    return NextResponse.json({
      person_id: id,
      cats: Array.from(catMap.values()),
      total_cats: catMap.size,
      total_relationships: cats.length,
    });
  } catch (error) {
    console.error("Error fetching person cats:", error);
    return NextResponse.json(
      { error: "Failed to fetch person cats" },
      { status: 500 }
    );
  }
}
