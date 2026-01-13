import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface NearbyRequest {
  request_id: string;
  latitude: number;
  longitude: number;
  estimated_cat_count: number | null;
  marker_size: string;
  status: string;
}

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
  const width = parseInt(searchParams.get("width") || "300");
  const height = parseInt(searchParams.get("height") || "200");
  const zoom = parseInt(searchParams.get("zoom") || "14");

  // Get request coordinates
  const requestData = await queryOne<RequestCoords>(
    `SELECT latitude, longitude, summary
     FROM trapper.sot_requests
     WHERE request_id = $1`,
    [id]
  );

  if (!requestData || !requestData.latitude || !requestData.longitude) {
    return NextResponse.json(
      { error: "Request not found or has no coordinates" },
      { status: 404 }
    );
  }

  // Get nearby requests
  const nearby = await queryRows<NearbyRequest>(
    `SELECT * FROM trapper.nearby_requests($1, $2, 0.07, $3)`,
    [requestData.latitude, requestData.longitude, id]
  );

  // Build Google Static Maps URL
  // Try multiple possible env var names for the Google API key
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Maps API key not configured (set GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY)" },
      { status: 500 }
    );
  }

  const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
  const params_list: string[] = [
    `center=${requestData.latitude},${requestData.longitude}`,
    `zoom=${zoom}`,
    `size=${width}x${height}`,
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

  // Return the data
  return NextResponse.json({
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
}
