import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

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

interface QueuedIntakeSubmission {
  submission_id: string;
  cats_address: string;
  cats_city: string | null;
  cats_zip: string | null;
  attempts: number;
}

interface GeocodeCacheHit {
  lat: string | number;
  lng: string | number;
  formatted_address: string | null;
  status: "ok" | "zero_results";
}

/** Build a normalized address string used both as Google input and cache key. */
function buildIntakeAddress(
  address: string,
  city: string | null,
  zip: string | null
): string {
  const parts = [address.trim()];
  if (city && city.trim()) parts.push(city.trim());
  parts.push("CA"); // FFSC service area — statewide fallback
  if (zip && zip.trim()) parts.push(zip.trim());
  return parts.join(", ");
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  if (!GOOGLE_API_KEY) {
    return apiServerError("Google API key not configured");
  }

  const startTime = Date.now();
  const BATCH_LIMIT = 50;

  try {
    // =====================================================================
    // Phase 1: Forward geocoding (address → coordinates)
    // =====================================================================
    const queue = await queryRows<QueuedPlace>(
      "SELECT * FROM ops.get_geocoding_queue($1)",
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
            "SELECT ops.record_geocoding_result($1, TRUE, $2, $3, NULL, $4)",
            [place.place_id, lat, lng, googleFormattedAddress]
          );
          forwardSuccess++;
        } else {
          const error = data.status === "ZERO_RESULTS"
            ? "Address not found"
            : data.error_message || data.status || "Unknown error";

          await queryOne(
            "SELECT ops.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
            [place.place_id, error]
          );
          forwardFail++;
        }

        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        const error = err instanceof Error ? err.message : "Request failed";
        await queryOne(
          "SELECT ops.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
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
        "SELECT * FROM ops.get_reverse_geocoding_queue($1)",
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
              "SELECT ops.record_reverse_geocoding_result($1, TRUE, $2)",
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
              "SELECT ops.record_reverse_geocoding_result($1, FALSE, NULL, $2)",
              [place.place_id, error]
            );
            reverseFail++;
          }

          await new Promise((r) => setTimeout(r, 50));
        } catch (err) {
          const error = err instanceof Error ? err.message : "Request failed";
          await queryOne(
            "SELECT ops.record_reverse_geocoding_result($1, FALSE, NULL, $2)",
            [place.place_id, error]
          );
          reverseFail++;
        }
      }
    }

    // =====================================================================
    // Phase 3: Intake submission geocoding (FFS-1181 follow-up Phase 4)
    //
    // Pulls from ops.get_intake_geocoding_queue(N), checks ops.geocode_cache
    // first (30–60% hit rate expected at current volume), calls Google on
    // cache miss, writes result via ops.record_intake_geocoding_result()
    // which handles retry scheduling + cache persistence.
    // =====================================================================
    const intakeBudget = Math.max(0, BATCH_LIMIT - queue.length - (reverseSuccess + reverseFail));
    let intakeSuccess = 0;
    let intakeZero = 0;
    let intakeFail = 0;
    let intakeCacheHits = 0;

    if (intakeBudget > 0) {
      const intakeQueue = await queryRows<QueuedIntakeSubmission>(
        "SELECT * FROM ops.get_intake_geocoding_queue($1)",
        [intakeBudget]
      );

      for (const sub of intakeQueue) {
        const addressStr = buildIntakeAddress(
          sub.cats_address,
          sub.cats_city,
          sub.cats_zip
        );

        // Normalize for cache key (matches ops.normalize_address_for_cache)
        const cacheKey = addressStr.toLowerCase().replace(/\s+/g, " ").trim();

        try {
          // Cache lookup first
          const cached = await queryOne<GeocodeCacheHit>(
            "SELECT * FROM ops.lookup_geocode_cache($1)",
            [cacheKey]
          );

          if (cached) {
            intakeCacheHits++;
            if (cached.status === "ok") {
              await queryOne(
                "SELECT ops.record_intake_geocoding_result($1, 'ok', $2, $3, $4, NULL, $5)",
                [
                  sub.submission_id,
                  cached.lat,
                  cached.lng,
                  cached.formatted_address,
                  cacheKey,
                ]
              );
              intakeSuccess++;
            } else {
              await queryOne(
                "SELECT ops.record_intake_geocoding_result($1, 'zero_results', NULL, NULL, NULL, 'cached ZERO_RESULTS', $2)",
                [sub.submission_id, cacheKey]
              );
              intakeZero++;
            }
            continue;
          }

          // Cache miss → call Google
          const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
          url.searchParams.set("address", addressStr);
          url.searchParams.set("key", GOOGLE_API_KEY);

          const response = await fetch(url.toString());
          const data = await response.json();

          if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
            const { lat, lng } = data.results[0].geometry.location;
            const googleFormattedAddress = data.results[0].formatted_address;

            await queryOne(
              "SELECT ops.record_intake_geocoding_result($1, 'ok', $2, $3, $4, NULL, $5)",
              [sub.submission_id, lat, lng, googleFormattedAddress, cacheKey]
            );
            intakeSuccess++;
          } else if (data.status === "ZERO_RESULTS") {
            await queryOne(
              "SELECT ops.record_intake_geocoding_result($1, 'zero_results', NULL, NULL, NULL, $2, $3)",
              [sub.submission_id, "ZERO_RESULTS", cacheKey]
            );
            intakeZero++;
          } else {
            const error =
              data.error_message || data.status || "Unknown error";
            await queryOne(
              "SELECT ops.record_intake_geocoding_result($1, 'unreachable', NULL, NULL, NULL, $2, NULL)",
              [sub.submission_id, error]
            );
            intakeFail++;
          }

          await new Promise((r) => setTimeout(r, 50));
        } catch (err) {
          const error = err instanceof Error ? err.message : "Request failed";
          await queryOne(
            "SELECT ops.record_intake_geocoding_result($1, 'unreachable', NULL, NULL, NULL, $2, NULL)",
            [sub.submission_id, error]
          );
          intakeFail++;
        }
      }
    }

    // Get updated stats
    const stats = await queryOne<{
      geocoded: number;
      pending: number;
      failed: number;
    }>("SELECT * FROM ops.v_geocoding_stats");

    const reverseStats = await queryOne<{
      pending_reverse: number;
    }>("SELECT * FROM ops.v_reverse_geocoding_stats");

    const intakeStats = await queryOne<{
      pending: number;
      ok: number;
      failed: number;
    }>("SELECT * FROM ops.v_intake_geocoding_health");

    const totalProcessed =
      queue.length +
      reverseSuccess +
      reverseFail +
      intakeSuccess +
      intakeZero +
      intakeFail;

    return apiSuccess({
      message:
        `Forward: ${forwardSuccess} geocoded, ${forwardFail} failed. ` +
        `Reverse: ${reverseSuccess} resolved (${reverseMerged} merged), ${reverseFail} failed. ` +
        `Intake: ${intakeSuccess} geocoded (${intakeCacheHits} cache hits), ${intakeZero} zero_results, ${intakeFail} failed.`,
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
      intake: {
        processed: intakeSuccess + intakeZero + intakeFail,
        geocoded: intakeSuccess,
        zero_results: intakeZero,
        failed: intakeFail,
        cache_hits: intakeCacheHits,
        remaining: intakeStats?.pending || 0,
      },
      processed: totalProcessed,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Geocoding cron error:", error);
    return apiServerError(error instanceof Error ? error.message : "Geocoding failed");
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
