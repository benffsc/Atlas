import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

// POST /api/colonies/[id]/places - Link a place to colony
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const body = await request.json();
    const {
      place_id,
      relationship_type = "colony_site",
      is_primary = false,
      added_by,
    } = body;

    if (!place_id) {
      return NextResponse.json(
        { error: "place_id is required" },
        { status: 400 }
      );
    }

    if (!added_by?.trim()) {
      return NextResponse.json(
        { error: "added_by is required" },
        { status: 400 }
      );
    }

    // Verify colony exists
    const colony = await queryOne<{ colony_id: string }>(
      `SELECT colony_id FROM trapper.colonies WHERE colony_id = $1`,
      [colonyId]
    );

    if (!colony) {
      return NextResponse.json({ error: "Colony not found" }, { status: 404 });
    }

    // Verify place exists
    const place = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM trapper.places WHERE place_id = $1`,
      [place_id]
    );

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    // If this is being set as primary, unset other primaries first
    if (is_primary) {
      await queryOne(
        `UPDATE trapper.colony_places SET is_primary = FALSE WHERE colony_id = $1`,
        [colonyId]
      );
    }

    // Insert or update the link
    await queryOne(
      `INSERT INTO trapper.colony_places (colony_id, place_id, relationship_type, is_primary, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (colony_id, place_id) DO UPDATE SET
         relationship_type = EXCLUDED.relationship_type,
         is_primary = EXCLUDED.is_primary`,
      [colonyId, place_id, relationship_type, is_primary, added_by.trim()]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error linking place to colony:", error);
    return NextResponse.json(
      { error: "Failed to link place" },
      { status: 500 }
    );
  }
}

// DELETE /api/colonies/[id]/places?placeId=xxx - Unlink a place
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId");

  if (!placeId) {
    return NextResponse.json(
      { error: "placeId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const result = await queryOne<{ colony_id: string }>(
      `DELETE FROM trapper.colony_places
       WHERE colony_id = $1 AND place_id = $2
       RETURNING colony_id`,
      [colonyId, placeId]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Place link not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unlinking place:", error);
    return NextResponse.json(
      { error: "Failed to unlink place" },
      { status: 500 }
    );
  }
}
