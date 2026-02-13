import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

interface PlaceWithoutCoords {
  place_id: string;
  display_name: string;
  formatted_address: string;
}

interface GeocodingResult {
  place_id: string;
  display_name: string;
  status: "success" | "no_results" | "error";
  lat?: number;
  lng?: number;
  error?: string;
}

/**
 * GET /api/places/geocode-missing
 * Returns count of places needing geocoding
 */
export async function GET() {
  try {
    const result = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM sot.places
       WHERE location IS NULL
         AND formatted_address IS NOT NULL
         AND formatted_address != ''`
    );

    return NextResponse.json({
      places_needing_geocoding: result?.count || 0,
    });
  } catch (error) {
    console.error("Error checking places:", error);
    return NextResponse.json(
      { error: "Failed to check places" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/places/geocode-missing
 * Batch geocodes places that have addresses but no coordinates
 *
 * Body: { limit?: number } - max places to process (default 50)
 */
export async function POST(request: NextRequest) {
  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Google API key not configured (set GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY)" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(body.limit || 50, 100);

    // Get places without coordinates
    const places = await queryRows<PlaceWithoutCoords>(
      `SELECT place_id, display_name, formatted_address
       FROM sot.places
       WHERE location IS NULL
         AND formatted_address IS NOT NULL
         AND formatted_address != ''
       LIMIT $1`,
      [limit]
    );

    if (places.length === 0) {
      return NextResponse.json({
        message: "No places need geocoding",
        processed: 0,
        results: [],
      });
    }

    const results: GeocodingResult[] = [];

    for (const place of places) {
      try {
        // Call Google Geocoding API
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("address", place.formatted_address);
        url.searchParams.set("key", GOOGLE_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.status === "OK" && data.results && data.results.length > 0) {
          const location = data.results[0].geometry.location;
          const lat = location.lat;
          const lng = location.lng;

          // Update the place with coordinates
          await queryOne(
            `UPDATE sot.places
             SET location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                 updated_at = NOW()
             WHERE place_id = $3`,
            [lat, lng, place.place_id]
          );

          results.push({
            place_id: place.place_id,
            display_name: place.display_name,
            status: "success",
            lat,
            lng,
          });
        } else if (data.status === "ZERO_RESULTS") {
          results.push({
            place_id: place.place_id,
            display_name: place.display_name,
            status: "no_results",
          });
        } else {
          results.push({
            place_id: place.place_id,
            display_name: place.display_name,
            status: "error",
            error: data.status || "Unknown error",
          });
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        results.push({
          place_id: place.place_id,
          display_name: place.display_name,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const failCount = results.filter((r) => r.status !== "success").length;

    return NextResponse.json({
      message: `Geocoded ${successCount} places, ${failCount} failed`,
      processed: results.length,
      success: successCount,
      failed: failCount,
      results,
    });
  } catch (error) {
    console.error("Error geocoding places:", error);
    return NextResponse.json(
      { error: "Failed to geocode places" },
      { status: 500 }
    );
  }
}
