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
  distance_meters: number;  // Industry standard: return distance
  estimated_cat_count: number | null;
  marker_size: string;
  status: string;
}

// Industry standard: radius in meters (~5 miles)
const FIVE_MILES_METERS = 8047;

interface RequestCoords {
  latitude: number;
  longitude: number;
  summary: string;
}

// Marker colors based on colony size
const MARKER_COLORS = {
  tiny: "gray",    // < 2 cats
  small: "blue",   // 2-6 cats
  medium: "orange", // 7-19 cats
  large: "red",    // 20+ cats
};

const MARKER_SIZES = {
  tiny: "tiny",
  small: "small",
  medium: "mid",
  large: "normal",
};

/**
 * GET /api/requests/[id]/map
 * Returns a Google Static Maps URL with nearby request markers
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  // Default to 2x resolution for retina displays
  const scale = parseInt(searchParams.get("scale") || "2");
  const width = parseInt(searchParams.get("width") || "400");
  const height = parseInt(searchParams.get("height") || "250");
  const zoom = parseInt(searchParams.get("zoom") || "14");

  // Get request coordinates (join with places to get coordinates)
  const requestData = await queryOne<RequestCoords>(
    `SELECT
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

  // Get nearby requests (industry standard: meters, not degrees)
  const nearby = await queryRows<NearbyRequest>(
    `SELECT * FROM ops.nearby_requests($1, $2, $3, $4, $5)`,
    [requestData.latitude, requestData.longitude, FIVE_MILES_METERS, id, 50]
  );

  // Build Google Static Maps URL
  // Try multiple possible env var names for the Google API key
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

  // Add center marker (the current request) - always visible, larger
  params_list.push(
    `markers=color:green%7Csize:mid%7Clabel:X%7C${requestData.latitude},${requestData.longitude}`
  );

  // Group nearby requests by marker size for efficiency
  const markerGroups: Record<string, { lat: number; lng: number }[]> = {
    large: [],
    medium: [],
    small: [],
    tiny: [],
  };

  for (const req of nearby) {
    const size = req.marker_size as keyof typeof markerGroups;
    if (markerGroups[size]) {
      markerGroups[size].push({ lat: req.latitude, lng: req.longitude });
    }
  }

  // Add markers for each group
  for (const [size, locations] of Object.entries(markerGroups)) {
    if (locations.length === 0) continue;

    const color = MARKER_COLORS[size as keyof typeof MARKER_COLORS];
    const markerSize = MARKER_SIZES[size as keyof typeof MARKER_SIZES];
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
    nearby_count: nearby.length,
    nearby_by_size: {
      large: markerGroups.large.length,
      medium: markerGroups.medium.length,
      small: markerGroups.small.length,
      tiny: markerGroups.tiny.length,
    },
  });

  // Add cache headers (coordinates don't change often)
  response.headers.set(
    "Cache-Control",
    "public, max-age=3600, stale-while-revalidate=86400"
  );

  return response;
}
