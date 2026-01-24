import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

interface QueuedPlace {
  place_id: string;
  formatted_address: string;
  geocode_attempts: number;
  has_active_request: boolean;
}

interface GeocodingResult {
  place_id: string;
  address: string;
  status: "success" | "failed" | "error";
  lat?: number;
  lng?: number;
  googleAddress?: string;
  error?: string;
  attempts: number;
}

/**
 * GET /api/places/geocode-queue
 * Returns geocoding queue stats
 */
export async function GET() {
  try {
    const stats = await queryOne<{
      geocoded: number;
      pending: number;
      failed: number;
      ready_to_process: number;
      active_requests_pending: number;
    }>("SELECT * FROM trapper.v_geocoding_stats");

    const failures = await queryRows<{
      place_id: string;
      formatted_address: string;
      geocode_error: string;
      failure_category: string;
    }>(
      "SELECT place_id, formatted_address, geocode_error, failure_category FROM trapper.v_geocoding_failures LIMIT 10"
    );

    return NextResponse.json({
      stats,
      recent_failures: failures,
    });
  } catch (error) {
    console.error("Error getting geocode stats:", error);
    return NextResponse.json(
      { error: "Failed to get geocoding stats" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/places/geocode-queue
 * Process the geocoding queue
 *
 * Body: { limit?: number } - max places to process (default 20)
 */
export async function POST(request: NextRequest) {
  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Google API key not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(body.limit || 20, 50);

    // Get places from queue
    const queue = await queryRows<QueuedPlace>(
      "SELECT * FROM trapper.get_geocoding_queue($1)",
      [limit]
    );

    if (queue.length === 0) {
      return NextResponse.json({
        message: "No places ready for geocoding",
        processed: 0,
        results: [],
      });
    }

    const results: GeocodingResult[] = [];

    for (const place of queue) {
      try {
        // Call Google Geocoding API
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("address", place.formatted_address);
        url.searchParams.set("key", GOOGLE_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
          const { lat, lng } = data.results[0].geometry.location;
          const googleFormattedAddress = data.results[0].formatted_address;

          // Record success - pass Google's canonical address for dedup
          await queryOne(
            "SELECT trapper.record_geocoding_result($1, TRUE, $2, $3, NULL, $4)",
            [place.place_id, lat, lng, googleFormattedAddress]
          );

          results.push({
            place_id: place.place_id,
            address: place.formatted_address,
            status: "success",
            lat,
            lng,
            googleAddress: googleFormattedAddress,
            attempts: place.geocode_attempts + 1,
          });
        } else {
          // Record failure
          const error = data.status === "ZERO_RESULTS"
            ? "Address not found"
            : data.error_message || data.status || "Unknown error";

          await queryOne(
            "SELECT trapper.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
            [place.place_id, error]
          );

          results.push({
            place_id: place.place_id,
            address: place.formatted_address,
            status: "failed",
            error,
            attempts: place.geocode_attempts + 1,
          });
        }

        // Rate limit
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        const error = err instanceof Error ? err.message : "Request failed";

        await queryOne(
          "SELECT trapper.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
          [place.place_id, error]
        );

        results.push({
          place_id: place.place_id,
          address: place.formatted_address,
          status: "error",
          error,
          attempts: place.geocode_attempts + 1,
        });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status !== "success").length;

    // Get updated stats
    const stats = await queryOne<{
      geocoded: number;
      pending: number;
      failed: number;
      active_requests_pending: number;
    }>("SELECT * FROM trapper.v_geocoding_stats");

    return NextResponse.json({
      message: `Processed ${results.length} places: ${successCount} success, ${failedCount} failed/retry`,
      processed: results.length,
      success: successCount,
      failed: failedCount,
      results,
      stats,
    });
  } catch (error) {
    console.error("Error processing geocode queue:", error);
    return NextResponse.json(
      { error: "Failed to process geocoding queue" },
      { status: 500 }
    );
  }
}
