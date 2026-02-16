import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/db";

const VALID_ROLES = [
  "resident",
  "owner",
  "tenant",
  "manager",
  "requester",
  "contact",
  "emergency_contact",
  "former_resident",
  "visitor",
  "employee",
  "other",
] as const;

type PersonPlaceRole = (typeof VALID_ROLES)[number];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/places/[id]/people
 *
 * Add a person to a place with a specified role.
 *
 * Body: { person_id: string, role: string, note?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  if (!placeId) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { person_id, role, note } = body as {
      person_id?: string;
      role?: string;
      note?: string;
    };

    // Validate required fields
    if (!person_id || !role) {
      return NextResponse.json(
        { error: "Both 'person_id' and 'role' are required" },
        { status: 400 }
      );
    }

    // Validate person_id is a valid UUID
    if (!UUID_REGEX.test(person_id)) {
      return NextResponse.json(
        { error: "person_id must be a valid UUID" },
        { status: 400 }
      );
    }

    // Validate role against enum values
    if (!VALID_ROLES.includes(role as PersonPlaceRole)) {
      return NextResponse.json(
        {
          error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate place exists
    const place = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1 AND merged_into_place_id IS NULL`,
      [placeId]
    );

    if (!place) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    // Validate person exists
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [person_id]
    );

    if (!person) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    // Insert relationship with ON CONFLICT DO NOTHING
    const relationship = await queryOne<{
      relationship_id: string;
      person_id: string;
      place_id: string;
      role: string;
      confidence: number;
      note: string | null;
      source_system: string;
      created_at: string;
    }>(
      // V2: Uses sot.person_place instead of sot.person_place_relationships, relationship_type instead of role
      `INSERT INTO sot.person_place (
         person_id, place_id, relationship_type, source_system, confidence, note, created_by
       ) VALUES (
         $1, $2, $3, 'atlas_ui', 0.9, $4, 'atlas_ui'
       )
       ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING
       RETURNING
         relationship_id,
         person_id,
         place_id,
         relationship_type::text AS role,
         confidence,
         note,
         source_system,
         created_at::text AS created_at`,
      [person_id, placeId, role, note || null]
    );

    // If ON CONFLICT fired, the relationship already exists
    if (!relationship) {
      return NextResponse.json(
        { error: "This person-place-role relationship already exists" },
        { status: 409 }
      );
    }

    // Log to entity_edits for audit trail
    await execute(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         new_value, edited_by, edit_source
       ) VALUES (
         'person_place_relationship', $1, 'create', 'created',
         to_jsonb($2::text), 'atlas_ui', 'web_ui'
       )`,
      [relationship.relationship_id, role]
    );

    return NextResponse.json({
      success: true,
      relationship,
    });
  } catch (error) {
    console.error("Error adding person to place:", error);
    return NextResponse.json(
      { error: "Failed to add person to place" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/places/[id]/people?person_id=...&role=...
 *
 * Remove a manually-added person-place relationship.
 * Only allows deleting relationships with source_system = 'atlas_ui'.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  if (!placeId) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const person_id = searchParams.get("person_id");
    const role = searchParams.get("role");

    // Validate required params
    if (!person_id || !role) {
      return NextResponse.json(
        { error: "Both 'person_id' and 'role' query parameters are required" },
        { status: 400 }
      );
    }

    // Validate person_id is a valid UUID
    if (!UUID_REGEX.test(person_id)) {
      return NextResponse.json(
        { error: "person_id must be a valid UUID" },
        { status: 400 }
      );
    }

    // Validate role against enum values
    if (!VALID_ROLES.includes(role as PersonPlaceRole)) {
      return NextResponse.json(
        {
          error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate place exists
    const place = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1 AND merged_into_place_id IS NULL`,
      [placeId]
    );

    if (!place) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    // Find the relationship (only atlas_ui source allowed for deletion)
    // V2: Uses sot.person_place instead of sot.person_place_relationships, relationship_type instead of role
    const existing = await queryOne<{
      relationship_id: string;
      source_system: string;
    }>(
      `SELECT relationship_id, source_system
       FROM sot.person_place
       WHERE person_id = $1 AND place_id = $2 AND relationship_type = $3`,
      [person_id, placeId, role]
    );

    if (!existing) {
      return NextResponse.json(
        { error: "Relationship not found" },
        { status: 404 }
      );
    }

    if (existing.source_system !== "atlas_ui") {
      return NextResponse.json(
        {
          error:
            "Cannot delete automated relationships. Only manually-added (atlas_ui) relationships can be removed.",
        },
        { status: 403 }
      );
    }

    // Log to entity_edits before deleting
    await execute(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         old_value, edited_by, edit_source
       ) VALUES (
         'person_place_relationship', $1, 'delete', 'deleted',
         to_jsonb($2::text), 'atlas_ui', 'web_ui'
       )`,
      [existing.relationship_id, role]
    );

    // Delete the relationship
    // V2: Uses sot.person_place instead of sot.person_place_relationships
    await execute(
      `DELETE FROM sot.person_place
       WHERE relationship_id = $1 AND source_system = 'atlas_ui'`,
      [existing.relationship_id]
    );

    return NextResponse.json({
      success: true,
      deleted_relationship_id: existing.relationship_id,
    });
  } catch (error) {
    console.error("Error removing person from place:", error);
    return NextResponse.json(
      { error: "Failed to remove person from place" },
      { status: 500 }
    );
  }
}
