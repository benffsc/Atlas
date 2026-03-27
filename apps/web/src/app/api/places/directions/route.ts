import { NextRequest } from "next/server";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const origin = searchParams.get("origin");
    const destination = searchParams.get("destination");

    if (!origin) {
      return apiBadRequest("origin parameter is required (lat,lng)");
    }
    if (!destination) {
      return apiBadRequest("destination parameter is required (lat,lng)");
    }

    if (!process.env.GOOGLE_PLACES_API_KEY) {
      return apiServerError("Google Places API key not configured");
    }

    // Optional waypoints (comma-separated "lat,lng" pairs) and optimization
    const waypoints = searchParams.get("waypoints");
    const optimize = searchParams.get("optimize") === "true";

    const params = new URLSearchParams({
      origin,
      destination,
      key: process.env.GOOGLE_PLACES_API_KEY!,
    });

    if (waypoints) {
      const waypointList = waypoints.split("|").map(w => w.trim()).filter(Boolean);
      if (waypointList.length > 23) {
        return apiBadRequest("Maximum 23 waypoints allowed");
      }
      const prefix = optimize ? "optimize:true|" : "";
      params.set("waypoints", prefix + waypointList.join("|"));
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params}`
    );

    const data = await response.json();

    if (data.status !== "OK") {
      console.error("Google Directions API error:", data.status, data.error_message);
      return apiServerError(`Google API error: ${data.status}`);
    }

    const route = data.routes[0];
    if (!route) {
      return apiServerError("No route found");
    }

    // Compute totals across all legs
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    const legs = route.legs.map((leg: { distance: { value: number; text: string }; duration: { value: number; text: string }; start_address: string; end_address: string }) => {
      totalDistanceMeters += leg.distance.value;
      totalDurationSeconds += leg.duration.value;
      return {
        distance_meters: leg.distance.value,
        distance_text: leg.distance.text,
        duration_seconds: leg.duration.value,
        duration_text: leg.duration.text,
        start_address: leg.start_address,
        end_address: leg.end_address,
      };
    });

    return apiSuccess({
      distance_meters: totalDistanceMeters,
      distance_text: totalDistanceMeters < 1000
        ? `${totalDistanceMeters} m`
        : `${(totalDistanceMeters / 1609.344).toFixed(1)} mi`,
      duration_seconds: totalDurationSeconds,
      duration_text: totalDurationSeconds < 3600
        ? `${Math.round(totalDurationSeconds / 60)} mins`
        : `${Math.floor(totalDurationSeconds / 3600)} hr ${Math.round((totalDurationSeconds % 3600) / 60)} mins`,
      overview_polyline: route.overview_polyline.points,
      legs,
      waypoint_order: route.waypoint_order || null,
    });
  } catch (error) {
    console.error("Directions error:", error);
    return apiServerError("Failed to fetch directions");
  }
}
