import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiNotFound, apiServerError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface NearbyRequest {
  request_id: string;
  latitude: number;
  longitude: number;
  distance_meters: number;
  estimated_cat_count: number | null;
  marker_size: string;
  status: string;
}

interface NearbyPlace {
  place_id: string;
  latitude: number;
  longitude: number;
  distance_meters: number;
  cat_count: number;
  disease_risk: boolean;
  watch_list: boolean;
  active_request_count: number;
  pin_style: string;
}

// Industry standard: radius in meters
const FIVE_MILES_METERS = 8047;
const NEARBY_PLACES_RADIUS = 5000; // 5km for places (tighter radius)

interface RequestCoords {
  place_id: string;
  latitude: number;
  longitude: number;
  summary: string;
}

// Marker colors for requests (by colony size)
const REQUEST_MARKER_COLORS = {
  tiny: "gray",    // < 2 cats
  small: "blue",   // 2-6 cats
  medium: "orange", // 7-19 cats
  large: "red",    // 20+ cats
};

const REQUEST_MARKER_SIZES = {
  tiny: "tiny",
  small: "small",
  medium: "mid",
  large: "normal",
};

// Marker colors for places (by pin style)
const PLACE_MARKER_COLORS = {
  disease: "0xdc2626",     // Red for disease risk
  watch_list: "0x7c3aed",  // Purple for watch list
  active: "0x16a34a",      // Green for active (has cats)
  active_requests: "0x0d9488", // Teal for active requests
  minimal: "0x6b7280",     // Gray for minimal
};

const PLACE_MARKER_SIZES = {
  disease: "small",
  watch_list: "small",
  active: "tiny",
  active_requests: "tiny",
  minimal: "tiny",
};

/**
 * GET /api/requests/[id]/map
 * Returns a Google Static Maps URL with nearby request AND place markers
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  // Default to 2x resolution for retina displays
  const scale = parseInt(searchParams.get("scale") || "2");
  const width = parseInt(searchParams.get("width") || "400");
  const height = parseInt(searchParams.get("height") || "250");
  const zoom = parseInt(searchParams.get("zoom") || "14");

  // Get request coordinates and place_id (join with places to get coordinates)
  const requestData = await queryOne<RequestCoords>(
    `SELECT
       r.place_id::text as place_id,
       ST_Y(p.location::geometry) as latitude,
       ST_X(p.location::geometry) as longitude,
       r.summary
     FROM ops.requests r
     LEFT JOIN sot.places p ON r.place_id = p.place_id
     WHERE r.request_id = $1`,
    [id]
  );

  if (!requestData || !requestData.latitude || !requestData.longitude) {
    return apiNotFound("Request", id);
  }

  // Fetch both nearby requests AND nearby places in parallel
  const [nearbyRequests, nearbyPlaces] = await Promise.all([
    queryRows<NearbyRequest>(
      `SELECT * FROM ops.nearby_requests($1, $2, $3, $4, $5)`,
      [requestData.latitude, requestData.longitude, FIVE_MILES_METERS, id, 50]
    ),
    queryRows<NearbyPlace>(
      `SELECT * FROM ops.nearby_places($1, $2, $3, $4, $5)`,
      [requestData.latitude, requestData.longitude, NEARBY_PLACES_RADIUS, requestData.place_id, 30]
    ),
  ]);

  // Build Google Static Maps URL
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return apiServerError("Google Maps API key not configured");
  }

  const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
  const params_list: string[] = [
    `center=${requestData.latitude},${requestData.longitude}`,
    `zoom=${zoom}`,
    `size=${width}x${height}`,
    `scale=${scale}`,
    `maptype=roadmap`,
    `key=${apiKey}`,
  ];

  // Add center marker (the current request) - always visible, larger, green with X label
  params_list.push(
    `markers=color:green%7Csize:mid%7Clabel:X%7C${requestData.latitude},${requestData.longitude}`
  );

  // Group nearby places by pin_style (disease/watch_list get priority)
  const placeGroups: Record<string, { lat: number; lng: number }[]> = {
    disease: [],
    watch_list: [],
    active: [],
    active_requests: [],
    minimal: [],
  };

  for (const place of nearbyPlaces) {
    const style = place.pin_style as keyof typeof placeGroups;
    if (placeGroups[style]) {
      placeGroups[style].push({ lat: place.latitude, lng: place.longitude });
    }
  }

  // Add place markers (disease and watch_list first - they're most important)
  for (const style of ["disease", "watch_list", "active"] as const) {
    const locations = placeGroups[style];
    if (locations.length === 0) continue;

    const color = PLACE_MARKER_COLORS[style];
    const markerSize = PLACE_MARKER_SIZES[style];
    const coords = locations.map((l) => `${l.lat},${l.lng}`).join("%7C");

    params_list.push(`markers=color:${color}%7Csize:${markerSize}%7C${coords}`);
  }

  // Group nearby requests by marker size
  const requestGroups: Record<string, { lat: number; lng: number }[]> = {
    large: [],
    medium: [],
    small: [],
    tiny: [],
  };

  for (const req of nearbyRequests) {
    const size = req.marker_size as keyof typeof requestGroups;
    if (requestGroups[size]) {
      requestGroups[size].push({ lat: req.latitude, lng: req.longitude });
    }
  }

  // Add request markers (large colonies are most important)
  for (const [size, locations] of Object.entries(requestGroups)) {
    if (locations.length === 0) continue;

    const color = REQUEST_MARKER_COLORS[size as keyof typeof REQUEST_MARKER_COLORS];
    const markerSize = REQUEST_MARKER_SIZES[size as keyof typeof REQUEST_MARKER_SIZES];
    const coords = locations.map((l) => `${l.lat},${l.lng}`).join("%7C");

    params_list.push(`markers=color:${color}%7Csize:${markerSize}%7C${coords}`);
  }

  const mapUrl = `${baseUrl}?${params_list.join("&")}`;

  // Return the data with cache headers
  const response = apiSuccess({
    map_url: mapUrl,
    center: {
      latitude: requestData.latitude,
      longitude: requestData.longitude,
    },
    // Combined count for backward compatibility
    nearby_count: nearbyRequests.length + nearbyPlaces.length,
    // Detailed breakdown
    nearby_requests: {
      count: nearbyRequests.length,
      by_size: {
        large: requestGroups.large.length,
        medium: requestGroups.medium.length,
        small: requestGroups.small.length,
        tiny: requestGroups.tiny.length,
      },
    },
    nearby_places: {
      count: nearbyPlaces.length,
      by_style: {
        disease: placeGroups.disease.length,
        watch_list: placeGroups.watch_list.length,
        active: placeGroups.active.length,
      },
    },
    // Legacy field for backward compatibility
    nearby_by_size: {
      large: requestGroups.large.length,
      medium: requestGroups.medium.length,
      small: requestGroups.small.length,
      tiny: requestGroups.tiny.length,
    },
  });

  // Add cache headers (coordinates don't change often)
  response.headers.set(
    "Cache-Control",
    "public, max-age=3600, stale-while-revalidate=86400"
  );

  return response;
}
