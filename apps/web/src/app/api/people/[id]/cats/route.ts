import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

interface PersonCatRelationship {
  cat_id: string;
  cat_name: string;
  microchip: string | null;
  relationship_type: string;
  confidence: string;
  source_system: string;
  data_source: string | null;
  created_at: string;
  latest_appointment_date: string | null;
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

  try {
    requireValidUUID(id, "person");

    // Optional relationship type filter
    const { searchParams } = new URL(request.url);
    const relationshipFilter = searchParams.get("relationship");

    const relationshipClause = relationshipFilter
      ? `AND pc.relationship_type = $2`
      : "";
    const queryParams = relationshipFilter ? [id, relationshipFilter] : [id];

    const sql = `
      SELECT
        pc.cat_id,
        c.display_name AS cat_name,
        ci.id_value AS microchip,
        pc.relationship_type,
        pc.confidence,
        pc.source_system,
        c.data_source,
        pc.created_at::TEXT,
        la.appointment_date::TEXT AS latest_appointment_date
      FROM sot.person_cat pc
      JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
      LEFT JOIN LATERAL (
        SELECT a.appointment_date
        FROM ops.appointments a
        WHERE a.person_id = pc.person_id
          AND a.cat_id = pc.cat_id
        ORDER BY a.appointment_date DESC
        LIMIT 1
      ) la ON TRUE
      WHERE pc.person_id = $1
        ${relationshipClause}
      ORDER BY
        CASE pc.relationship_type
          WHEN 'owner' THEN 1
          WHEN 'adopter' THEN 2
          WHEN 'foster' THEN 3
          WHEN 'caretaker' THEN 4
          WHEN 'trapper' THEN 5
          ELSE 6
        END,
        pc.created_at DESC NULLS LAST,
        c.display_name
    `;

    const cats = await queryRows<PersonCatRelationship>(sql, queryParams);

    // Group cats by cat_id and aggregate relationships
    const catMap = new Map<string, {
      cat_id: string;
      cat_name: string;
      microchip: string | null;
      data_source: string | null;
      relationships: {
        type: string;
        confidence: string;
        latest_appointment_date: string | null;
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
        latest_appointment_date: row.latest_appointment_date,
        source_system: row.source_system,
      });
    }

    return apiSuccess({
      person_id: id,
      cats: Array.from(catMap.values()),
      total_cats: catMap.size,
      total_relationships: cats.length,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching person cats:", error);
    return apiServerError("Failed to fetch person cats");
  }
}
