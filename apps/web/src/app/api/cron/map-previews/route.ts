import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiError, apiBadRequest } from "@/lib/api-response";

/**
 * Map Preview Generation Cron Job
 *
 * Generates Google Static Maps preview URLs for requests that:
 * 1. Have coordinates but no preview
 * 2. Have stale previews (> 7 days old)
 *
 * Run every 15 minutes via Vercel Cron.
 * Can also be triggered manually with ?force=true to regenerate all.
 */

// Allow up to 60 seconds for batch processing
export const maxDuration = 60;

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

interface QueuedRequest {
  request_id: string;
  place_id: string;
  latitude: number;
  longitude: number;
  summary: string | null;
  current_preview_url: string | null;
  preview_age_hours: number | null;
}

interface NearbyRequest {
  latitude: number;
  longitude: number;
  marker_size: string;
}

interface NearbyPlace {
  latitude: number;
  longitude: number;
  pin_style: string;
}

// Marker colors for requests (by colony size)
const REQUEST_MARKER_COLORS: Record<string, string> = {
  tiny: "gray",
  small: "blue",
  medium: "orange",
  large: "red",
};

const REQUEST_MARKER_SIZES: Record<string, string> = {
  tiny: "tiny",
  small: "small",
  medium: "mid",
  large: "normal",
};

// Marker colors for places (by pin style)
const PLACE_MARKER_COLORS: Record<string, string> = {
  disease: "0xdc2626",
  watch_list: "0x7c3aed",
  active: "0x16a34a",
  active_requests: "0x0d9488",
  minimal: "0x6b7280",
};

const PLACE_MARKER_SIZES: Record<string, string> = {
  disease: "small",
  watch_list: "small",
  active: "tiny",
  active_requests: "tiny",
  minimal: "tiny",
};

// Constants
const FIVE_MILES_METERS = 8047;
const NEARBY_PLACES_RADIUS = 5000;
const DISEASE_LOOKBACK_MONTHS = 36;

async function generateMapUrl(
  requestId: string,
  placeId: string,
  latitude: number,
  longitude: number
): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;

  try {
    // Fetch nearby requests and places
    const [nearbyRequests, nearbyPlaces] = await Promise.all([
      queryRows<NearbyRequest>(
        `SELECT latitude, longitude, marker_size FROM ops.nearby_requests($1, $2, $3, $4, $5)`,
        [latitude, longitude, FIVE_MILES_METERS, requestId, 50]
      ),
      queryRows<NearbyPlace>(
        `SELECT latitude, longitude, pin_style FROM ops.nearby_places($1, $2, $3, $4, $5, $6)`,
        [latitude, longitude, NEARBY_PLACES_RADIUS, placeId, 30, DISEASE_LOOKBACK_MONTHS]
      ),
    ]);

    // Build Google Static Maps URL
    const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
    const params: string[] = [
      `center=${latitude},${longitude}`,
      `zoom=14`,
      `size=400x250`,
      `scale=2`,
      `maptype=roadmap`,
      `key=${GOOGLE_API_KEY}`,
    ];

    // Add center marker (the current request)
    params.push(
      `markers=color:green%7Csize:mid%7Clabel:X%7C${latitude},${longitude}`
    );

    // Group places by pin_style
    const placeGroups: Record<string, { lat: number; lng: number }[]> = {
      disease: [],
      watch_list: [],
      active: [],
      active_requests: [],
      minimal: [],
    };

    for (const place of nearbyPlaces) {
      const style = place.pin_style;
      if (placeGroups[style]) {
        placeGroups[style].push({ lat: place.latitude, lng: place.longitude });
      }
    }

    // Add place markers (disease and watch_list first)
    for (const style of ["disease", "watch_list", "active"] as const) {
      const locations = placeGroups[style];
      if (locations.length === 0) continue;

      const color = PLACE_MARKER_COLORS[style];
      const markerSize = PLACE_MARKER_SIZES[style];
      const coords = locations.map((l) => `${l.lat},${l.lng}`).join("%7C");

      params.push(`markers=color:${color}%7Csize:${markerSize}%7C${coords}`);
    }

    // Group requests by marker size
    const requestGroups: Record<string, { lat: number; lng: number }[]> = {
      large: [],
      medium: [],
      small: [],
      tiny: [],
    };

    for (const req of nearbyRequests) {
      const size = req.marker_size;
      if (requestGroups[size]) {
        requestGroups[size].push({ lat: req.latitude, lng: req.longitude });
      }
    }

    // Add request markers
    for (const [size, locations] of Object.entries(requestGroups)) {
      if (locations.length === 0) continue;

      const color = REQUEST_MARKER_COLORS[size];
      const markerSize = REQUEST_MARKER_SIZES[size];
      const coords = locations.map((l) => `${l.lat},${l.lng}`).join("%7C");

      params.push(`markers=color:${color}%7Csize:${markerSize}%7C${coords}`);
    }

    return `${baseUrl}?${params.join("&")}`;
  } catch (err) {
    console.error(`Failed to generate map for request ${requestId}:`, err);
    return null;
  }
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

  const searchParams = request.nextUrl.searchParams;
  const force = searchParams.get("force") === "true";
  const batchSize = parseInt(searchParams.get("batch") || "30");
  const maxAgeHours = force ? 0 : parseInt(searchParams.get("max_age") || "168"); // 7 days

  const startTime = Date.now();

  try {
    // Get queue of requests needing map previews
    const queue = await queryRows<QueuedRequest>(
      `SELECT * FROM ops.get_map_preview_queue($1, $2)`,
      [batchSize, maxAgeHours]
    );

    if (queue.length === 0) {
      return apiSuccess({
        message: "No requests need map preview generation",
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const req of queue) {
      try {
        const mapUrl = await generateMapUrl(
          req.request_id,
          req.place_id,
          req.latitude,
          req.longitude
        );

        if (mapUrl) {
          await queryOne(
            `SELECT ops.record_map_preview($1, $2)`,
            [req.request_id, mapUrl]
          );
          success++;
        } else {
          failed++;
          errors.push(`${req.request_id}: No URL generated`);
        }
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${req.request_id}: ${errorMsg}`);
      }
    }

    return apiSuccess({
      message: `Generated ${success} map previews`,
      processed: queue.length,
      success_count: success,
      failed_count: failed,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error("Map preview cron error:", err);
    return apiServerError(err instanceof Error ? err.message : "Map preview generation failed");
  }
}

// POST endpoint for manual refresh of specific requests
export async function POST(request: NextRequest) {
  // Verify auth
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  if (!GOOGLE_API_KEY) {
    return apiServerError("Google API key not configured");
  }

  try {
    const body = await request.json();
    const requestIds: string[] = body.request_ids || [];

    if (requestIds.length === 0) {
      return apiBadRequest("No request_ids provided");
    }

    // Limit to 50 at a time
    const idsToProcess = requestIds.slice(0, 50);

    // Get request coordinates
    const requests = await queryRows<{
      request_id: string;
      place_id: string;
      latitude: number;
      longitude: number;
    }>(
      `SELECT
         r.request_id::text,
         r.place_id::text,
         ST_Y(p.location::geometry) as latitude,
         ST_X(p.location::geometry) as longitude
       FROM ops.requests r
       JOIN sot.places p ON r.place_id = p.place_id
       WHERE r.request_id = ANY($1::uuid[])
         AND p.location IS NOT NULL`,
      [idsToProcess]
    );

    let success = 0;
    let failed = 0;

    for (const req of requests) {
      const mapUrl = await generateMapUrl(
        req.request_id,
        req.place_id,
        req.latitude,
        req.longitude
      );

      if (mapUrl) {
        await queryOne(
          `SELECT ops.record_map_preview($1, $2)`,
          [req.request_id, mapUrl]
        );
        success++;
      } else {
        failed++;
      }
    }

    return apiSuccess({
      requested: idsToProcess.length,
      found: requests.length,
      generated: success,
      failed,
    });
  } catch (err) {
    console.error("Map preview POST error:", err);
    return apiServerError(err instanceof Error ? err.message : "Map preview generation failed");
  }
}
