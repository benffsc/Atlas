import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

// Geocoding Cron Job
//
// Phase 1: Forward geocoding (address → coordinates) for places missing location
// Phase 2: Reverse geocoding (coordinates → address) for coordinate-only places
//
// Run every 5-10 minutes. Shares a budget of 50 API calls per run.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/geocode", "schedule": "every-5-min" }]

// Allow up to 60 seconds for batch processing
export const maxDuration = 60;

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

interface QueuedPlace {
  place_id: string;
  formatted_address: string;
  geocode_attempts: number;
}

interface ReverseQueuedPlace {
  place_id: string;
  lat: number;
  lng: number;
  display_name: string;
  geocode_attempts: number;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Google API key not configured" },
      { status: 500 }
    );
  }

  const startTime = Date.now();
  const BATCH_LIMIT = 50;

  try {
    // =====================================================================
    // Phase 1: Forward geocoding (address → coordinates)
    // =====================================================================
    const queue = await queryRows<QueuedPlace>(
      "SELECT * FROM trapper.get_geocoding_queue($1)",
      [BATCH_LIMIT]
    );

    let forwardSuccess = 0;
    let forwardFail = 0;

    for (const place of queue) {
      try {
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("address", place.formatted_address);
        url.searchParams.set("key", GOOGLE_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
          const { lat, lng } = data.results[0].geometry.location;
          const googleFormattedAddress = data.results[0].formatted_address;

          await queryOne(
            "SELECT trapper.record_geocoding_result($1, TRUE, $2, $3, NULL, $4)",
            [place.place_id, lat, lng, googleFormattedAddress]
          );
          forwardSuccess++;
        } else {
          const error = data.status === "ZERO_RESULTS"
            ? "Address not found"
            : data.error_message || data.status || "Unknown error";

          await queryOne(
            "SELECT trapper.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
            [place.place_id, error]
          );
          forwardFail++;
        }

        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        const error = err instanceof Error ? err.message : "Request failed";
        await queryOne(
          "SELECT trapper.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
          [place.place_id, error]
        );
        forwardFail++;
      }
    }

    // =====================================================================
    // Phase 2: Reverse geocoding (coordinates → address)
    // Processes coordinate-only places (from Google Maps data, pin placing)
    // =====================================================================
    const reverseBudget = Math.max(0, BATCH_LIMIT - queue.length);
    let reverseSuccess = 0;
    let reverseFail = 0;
    let reverseMerged = 0;

    if (reverseBudget > 0) {
      const reverseQueue = await queryRows<ReverseQueuedPlace>(
        "SELECT * FROM trapper.get_reverse_geocoding_queue($1)",
        [reverseBudget]
      );

      for (const place of reverseQueue) {
        try {
          const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
          url.searchParams.set("latlng", `${place.lat},${place.lng}`);
          url.searchParams.set("key", GOOGLE_API_KEY);

          const response = await fetch(url.toString());
          const data = await response.json();

          if (data.status === "OK" && data.results?.[0]?.formatted_address) {
            const googleAddress = data.results[0].formatted_address;

            const result = await queryOne<{ record_reverse_geocoding_result: { action: string } }>(
              "SELECT trapper.record_reverse_geocoding_result($1, TRUE, $2)",
              [place.place_id, googleAddress]
            );

            const action = result?.record_reverse_geocoding_result?.action;
            if (action === "merged") reverseMerged++;
            reverseSuccess++;
          } else {
            const error = data.status === "ZERO_RESULTS"
              ? "No address found for coordinates"
              : data.error_message || data.status || "Unknown error";

            await queryOne(
              "SELECT trapper.record_reverse_geocoding_result($1, FALSE, NULL, $2)",
              [place.place_id, error]
            );
            reverseFail++;
          }

          await new Promise((r) => setTimeout(r, 50));
        } catch (err) {
          const error = err instanceof Error ? err.message : "Request failed";
          await queryOne(
            "SELECT trapper.record_reverse_geocoding_result($1, FALSE, NULL, $2)",
            [place.place_id, error]
          );
          reverseFail++;
        }
      }
    }

    // Get updated stats
    const stats = await queryOne<{
      geocoded: number;
      pending: number;
      failed: number;
    }>("SELECT * FROM trapper.v_geocoding_stats");

    const reverseStats = await queryOne<{
      pending_reverse: number;
    }>("SELECT * FROM trapper.v_reverse_geocoding_stats");

    const totalProcessed = queue.length + reverseSuccess + reverseFail;

    return NextResponse.json({
      success: true,
      message: `Forward: ${forwardSuccess} geocoded, ${forwardFail} failed. Reverse: ${reverseSuccess} resolved (${reverseMerged} merged), ${reverseFail} failed.`,
      forward: {
        processed: queue.length,
        geocoded: forwardSuccess,
        failed: forwardFail,
        remaining: stats?.pending || 0,
      },
      reverse: {
        processed: reverseSuccess + reverseFail,
        resolved: reverseSuccess,
        merged: reverseMerged,
        failed: reverseFail,
        remaining: reverseStats?.pending_reverse || 0,
      },
      processed: totalProcessed,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Geocoding cron error:", error);
    return NextResponse.json(
      {
        error: "Geocoding failed",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
