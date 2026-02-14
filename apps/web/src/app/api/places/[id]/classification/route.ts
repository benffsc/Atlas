import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/places/[id]/classification
 * Returns the current colony classification for a place
 */
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
    const result = await queryOne<{
      place_id: string;
      colony_classification: string;
      colony_classification_reason: string | null;
      colony_classification_set_by: string | null;
      colony_classification_set_at: string | null;
      authoritative_cat_count: number | null;
      authoritative_count_reason: string | null;
      authoritative_count_set_by: string | null;
      authoritative_count_set_at: string | null;
      allows_clustering: boolean;
      clustering_radius_meters: number | null;
    }>(
      `SELECT
        place_id,
        colony_classification::TEXT,
        colony_classification_reason,
        colony_classification_set_by,
        colony_classification_set_at,
        authoritative_cat_count,
        authoritative_count_reason,
        authoritative_count_set_by,
        authoritative_count_set_at,
        allows_clustering,
        clustering_radius_meters
      FROM sot.places
      WHERE place_id = $1`,
      [id]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching classification:", error);
    return NextResponse.json(
      { error: "Failed to fetch classification" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/places/[id]/classification
 * Sets the colony classification for a place
 */
export async function POST(
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
    const body = await request.json();
    const {
      classification,
      reason,
      set_by = "web_user",
      authoritative_count,
    } = body;

    // Validate classification
    const validClassifications = [
      "unknown",
      "individual_cats",
      "small_colony",
      "large_colony",
      "feeding_station",
    ];

    if (!classification || !validClassifications.includes(classification)) {
      return NextResponse.json(
        {
          error: `Invalid classification. Must be one of: ${validClassifications.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate authoritative_count if provided
    if (authoritative_count !== undefined && authoritative_count !== null) {
      if (typeof authoritative_count !== "number" || authoritative_count < 0) {
        return NextResponse.json(
          { error: "Authoritative count must be a non-negative number" },
          { status: 400 }
        );
      }
    }

    // Use the database function to set classification
    await query(
      `SELECT ops.set_colony_classification($1, $2, $3, $4, $5)`,
      [
        id,
        classification,
        reason || null,
        set_by,
        authoritative_count ?? null,
      ]
    );

    // Fetch the updated values
    const updated = await queryOne<{
      place_id: string;
      colony_classification: string;
      authoritative_cat_count: number | null;
      allows_clustering: boolean;
    }>(
      `SELECT
        place_id,
        colony_classification::TEXT,
        authoritative_cat_count,
        allows_clustering
      FROM sot.places
      WHERE place_id = $1`,
      [id]
    );

    return NextResponse.json({
      success: true,
      place_id: id,
      classification: updated?.colony_classification,
      authoritative_cat_count: updated?.authoritative_cat_count,
      allows_clustering: updated?.allows_clustering,
    });
  } catch (error) {
    console.error("Error setting classification:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to set classification", details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/places/[id]/classification
 * Clears the authoritative count (resets to estimate-based)
 */
export async function DELETE(
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
    await query(
      `UPDATE sot.places
       SET
         authoritative_cat_count = NULL,
         authoritative_count_reason = NULL,
         authoritative_count_set_by = NULL,
         authoritative_count_set_at = NULL
       WHERE place_id = $1`,
      [id]
    );

    return NextResponse.json({
      success: true,
      message: "Authoritative count cleared",
    });
  } catch (error) {
    console.error("Error clearing authoritative count:", error);
    return NextResponse.json(
      { error: "Failed to clear authoritative count" },
      { status: 500 }
    );
  }
}
