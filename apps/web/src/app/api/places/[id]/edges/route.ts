import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { logFieldEdits } from "@/lib/audit";

interface PlaceEdge {
  edge_id: string;
  place_id_a: string;
  place_id_b: string;
  relationship_type_id: string;
  relationship_code: string;
  relationship_label: string;
  direction: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  // Related place details
  related_place_id: string;
  related_place_address: string | null;
  related_place_name: string | null;
}

interface RelationshipType {
  id: string;
  code: string;
  label: string;
  description: string | null;
}

// GET /api/places/[id]/edges - List place relationships
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // V2: Use V2 column names (place_id_from/to instead of place_id_a/b)
    // relationship_type is text, not FK to relationship_types table
    const edges = await queryRows<PlaceEdge>(`
      SELECT
        e.edge_id,
        e.place_id_from AS place_id_a,
        e.place_id_to AS place_id_b,
        e.relationship_type AS relationship_type_id,
        e.relationship_type AS relationship_code,
        COALESCE(rt.type_label, e.relationship_type) AS relationship_label,
        'bidirectional' AS direction,
        NULL::TEXT AS note,
        e.created_at,
        NULL::TEXT AS created_by,
        CASE
          WHEN e.place_id_from = $1 THEN e.place_id_to
          ELSE e.place_id_from
        END AS related_place_id,
        CASE
          WHEN e.place_id_from = $1 THEN pb.formatted_address
          ELSE pa.formatted_address
        END AS related_place_address,
        CASE
          WHEN e.place_id_from = $1 THEN pb.display_name
          ELSE pa.display_name
        END AS related_place_name
      FROM sot.place_place_edges e
      LEFT JOIN sot.relationship_types rt ON rt.type_key = e.relationship_type AND rt.applies_to = 'place_place'
      LEFT JOIN sot.places pa ON pa.place_id = e.place_id_from
      LEFT JOIN sot.places pb ON pb.place_id = e.place_id_to
      WHERE e.place_id_from = $1 OR e.place_id_to = $1
      ORDER BY e.created_at DESC
    `, [id]);

    // V2: relationship_types is in sot schema with different columns
    const relationshipTypes = await queryRows<RelationshipType>(`
      SELECT
        type_id::text AS id,
        type_key AS code,
        type_label AS label,
        description
      FROM sot.relationship_types
      WHERE applies_to = 'place_place'
        AND is_active = true
      ORDER BY type_label
    `);

    return NextResponse.json({
      edges,
      relationshipTypes,
    });
  } catch (err) {
    console.error("Error fetching place edges:", err);
    return NextResponse.json(
      { error: "Failed to fetch place relationships" },
      { status: 500 }
    );
  }
}

interface CreateEdgeBody {
  related_place_id: string;
  relationship_type: string;  // code like 'same_colony_site'
  direction?: string;
  note?: string;
  created_by?: string;
}

// POST /api/places/[id]/edges - Create a place relationship
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: CreateEdgeBody = await request.json();

  if (!body.related_place_id) {
    return NextResponse.json(
      { error: "related_place_id is required" },
      { status: 400 }
    );
  }

  if (!body.relationship_type) {
    return NextResponse.json(
      { error: "relationship_type is required" },
      { status: 400 }
    );
  }

  if (id === body.related_place_id) {
    return NextResponse.json(
      { error: "Cannot link a place to itself" },
      { status: 400 }
    );
  }

  try {
    // V2: Validate relationship type exists in sot.relationship_types
    const relType = await queryOne<{ type_key: string }>(`
      SELECT type_key FROM sot.relationship_types
      WHERE type_key = $1 AND applies_to = 'place_place'
    `, [body.relationship_type]);

    if (!relType) {
      return NextResponse.json(
        { error: `Invalid relationship type: ${body.relationship_type}` },
        { status: 400 }
      );
    }

    // V2: Check if edge already exists (in either direction) using place_id_from/to
    const existing = await queryOne<{ edge_id: string }>(`
      SELECT edge_id FROM sot.place_place_edges
      WHERE (place_id_from = $1 AND place_id_to = $2)
         OR (place_id_from = $2 AND place_id_to = $1)
    `, [id, body.related_place_id]);

    if (existing) {
      return NextResponse.json(
        { error: "These places are already linked" },
        { status: 409 }
      );
    }

    // V2: Create the edge using V2 column names
    const result = await queryOne<PlaceEdge>(`
      INSERT INTO sot.place_place_edges (
        place_id_from,
        place_id_to,
        relationship_type,
        evidence_type,
        confidence,
        created_at
      ) VALUES ($1, $2, $3, 'manual', 1.0, NOW())
      RETURNING
        edge_id,
        place_id_from AS place_id_a,
        place_id_to AS place_id_b,
        relationship_type AS relationship_type_id,
        'bidirectional' AS direction,
        NULL::TEXT AS note,
        created_at,
        NULL::TEXT AS created_by
    `, [
      id,
      body.related_place_id,
      body.relationship_type,
    ]);

    // Log the change
    await logFieldEdits("place", id, [{
      field: "place_edges",
      oldValue: null,
      newValue: {
        related_place_id: body.related_place_id,
        relationship_type: body.relationship_type,
        action: "linked",
      },
    }], {
      editedBy: body.created_by || "web_user",
      reason: "manual_place_link",
      editSource: "web_ui",
    });

    return NextResponse.json({ edge: result }, { status: 201 });
  } catch (err) {
    console.error("Error creating place edge:", err);
    return NextResponse.json(
      { error: "Failed to create place relationship" },
      { status: 500 }
    );
  }
}

interface DeleteEdgeBody {
  edge_id: string;
  deleted_by?: string;
  reason?: string;
}

// DELETE /api/places/[id]/edges - Remove a place relationship
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: DeleteEdgeBody = await request.json();

  if (!body.edge_id) {
    return NextResponse.json(
      { error: "edge_id is required" },
      { status: 400 }
    );
  }

  try {
    // V2: Check if edge exists using V2 column names
    const existing = await queryOne<{
      edge_id: string;
      place_id_a: string;
      place_id_b: string;
      relationship_code: string;
    }>(`
      SELECT
        e.edge_id,
        e.place_id_from AS place_id_a,
        e.place_id_to AS place_id_b,
        e.relationship_type AS relationship_code
      FROM sot.place_place_edges e
      WHERE e.edge_id = $1
        AND (e.place_id_from = $2 OR e.place_id_to = $2)
    `, [body.edge_id, id]);

    if (!existing) {
      return NextResponse.json(
        { error: "Edge not found or doesn't involve this place" },
        { status: 404 }
      );
    }

    // Delete the edge
    await queryOne(`
      DELETE FROM sot.place_place_edges
      WHERE edge_id = $1
    `, [body.edge_id]);

    // Log the change
    const relatedPlaceId = existing.place_id_a === id ? existing.place_id_b : existing.place_id_a;
    await logFieldEdits("place", id, [{
      field: "place_edges",
      oldValue: {
        related_place_id: relatedPlaceId,
        relationship_type: existing.relationship_code,
      },
      newValue: null,
    }], {
      editedBy: body.deleted_by || "web_user",
      reason: body.reason || "manual_unlink",
      editSource: "web_ui",
    });

    return NextResponse.json({ success: true, deleted_edge_id: body.edge_id });
  } catch (err) {
    console.error("Error deleting place edge:", err);
    return NextResponse.json(
      { error: "Failed to delete place relationship" },
      { status: 500 }
    );
  }
}
