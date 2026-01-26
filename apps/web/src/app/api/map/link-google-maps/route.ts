import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

/**
 * Link Google Maps Entries API
 *
 * POST - Link Google Maps entries to nearest SOT places within radius
 *
 * Body params:
 *   - max_distance_m: number (default 100) - maximum distance in meters
 *
 * This links unattached Google Maps entries to nearby SOT places,
 * allowing them to be "absorbed" into place pins on the map.
 */

interface LinkResult {
  linked: number;
  already_linked: number;
  too_far: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const maxDistance = Math.min(Math.max(body.max_distance_m || 100, 10), 500);

    const result = await queryOne<LinkResult>(`
      SELECT * FROM trapper.link_google_maps_to_places($1)
    `, [maxDistance]);

    if (!result) {
      return NextResponse.json(
        { error: "Linking function not available - run MIG_722 first" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      linked: result.linked,
      already_linked: result.already_linked,
      too_far: result.too_far,
      max_distance_m: maxDistance,
      message: `Linked ${result.linked} entries to nearby places (${result.already_linked} were already linked, ${result.too_far} are too far)`,
    });
  } catch (error) {
    console.error("Error linking Google Maps entries:", error);
    // Check if it's because the function doesn't exist
    if (error instanceof Error && error.message.includes("does not exist")) {
      return NextResponse.json(
        { error: "Linking function not available - run MIG_722 migration first" },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Failed to link Google Maps entries" },
      { status: 500 }
    );
  }
}
