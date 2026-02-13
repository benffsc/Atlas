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
    // Get all edges for this place (both directions)
    const edges = await queryRows<PlaceEdge>(`
      SELECT
        e.edge_id,
        e.place_id_a,
        e.place_id_b,
        e.relationship_type_id,
        rt.code AS relationship_code,
        rt.label AS relationship_label,
        e.direction,
        e.note,
        e.created_at,
        e.created_by,
        CASE
          WHEN e.place_id_a = $1 THEN e.place_id_b
          ELSE e.place_id_a
        END AS related_place_id,
        CASE
          WHEN e.place_id_a = $1 THEN pb.formatted_address
          ELSE pa.formatted_address
        END AS related_place_address,
        CASE
          WHEN e.place_id_a = $1 THEN pb.display_name
          ELSE pa.display_name
        END AS related_place_name
      FROM trapper.place_place_edges e
      JOIN trapper.relationship_types rt ON rt.id = e.relationship_type_id
      LEFT JOIN sot.places pa ON pa.place_id = e.place_id_a
      LEFT JOIN sot.places pb ON pb.place_id = e.place_id_b
      WHERE e.place_id_a = $1 OR e.place_id_b = $1
      ORDER BY e.created_at DESC
    `, [id]);

    // Get available relationship types
    const relationshipTypes = await queryRows<RelationshipType>(`
      SELECT id::text, code, label, description
      FROM trapper.relationship_types
      WHERE domain = 'place_place'
        AND active = true
      ORDER BY sort_order, label
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
    // Get relationship type ID
    const relType = await queryOne<{ id: string }>(`
      SELECT id::text FROM trapper.relationship_types
      WHERE code = $1 AND domain = 'place_place'
    `, [body.relationship_type]);

    if (!relType) {
      return NextResponse.json(
        { error: `Invalid relationship type: ${body.relationship_type}` },
        { status: 400 }
      );
    }

    // Check if edge already exists (in either direction)
    const existing = await queryOne<{ edge_id: string }>(`
      SELECT edge_id FROM trapper.place_place_edges
      WHERE (place_id_a = $1 AND place_id_b = $2)
         OR (place_id_a = $2 AND place_id_b = $1)
    `, [id, body.related_place_id]);

    if (existing) {
      return NextResponse.json(
        { error: "These places are already linked" },
        { status: 409 }
      );
    }

    // Create the edge
    const result = await queryOne<PlaceEdge>(`
      INSERT INTO trapper.place_place_edges (
        place_id_a,
        place_id_b,
        relationship_type_id,
        direction,
        note,
        created_by,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING edge_id, place_id_a, place_id_b, relationship_type_id, direction, note, created_at, created_by
    `, [
      id,
      body.related_place_id,
      relType.id,
      body.direction || 'bidirectional',
      body.note || null,
      body.created_by || 'web_user',
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
    // Check if edge exists and involves this place
    const existing = await queryOne<{
      edge_id: string;
      place_id_a: string;
      place_id_b: string;
      relationship_code: string;
    }>(`
      SELECT e.edge_id, e.place_id_a, e.place_id_b, rt.code AS relationship_code
      FROM trapper.place_place_edges e
      JOIN trapper.relationship_types rt ON rt.id = e.relationship_type_id
      WHERE e.edge_id = $1
        AND (e.place_id_a = $2 OR e.place_id_b = $2)
    `, [body.edge_id, id]);

    if (!existing) {
      return NextResponse.json(
        { error: "Edge not found or doesn't involve this place" },
        { status: 404 }
      );
    }

    // Delete the edge
    await queryOne(`
      DELETE FROM trapper.place_place_edges
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
