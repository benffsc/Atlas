import { NextRequest } from "next/server";
import { apiSuccess, apiError, apiBadRequest } from "@/lib/api-response";
import { queryRows } from "@/lib/db";

/**
 * POST /api/places/optimize-route
 *
 * Accepts an array of place IDs, fetches their coordinates, and returns
 * an optimized visiting order using nearest-neighbor TSP heuristic.
 * No external API calls — uses Haversine distance for ordering.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { place_ids } = body;

    if (!Array.isArray(place_ids) || place_ids.length < 2) {
      return apiBadRequest("At least 2 place IDs required");
    }

    if (place_ids.length > 50) {
      return apiBadRequest("Maximum 50 places for route optimization");
    }

    // Fetch coordinates for all places
    const places = await queryRows<PlaceCoord>(
      `SELECT place_id, formatted_address, lat, lng
       FROM sot.v_place_list
       WHERE place_id = ANY($1) AND lat IS NOT NULL AND lng IS NOT NULL`,
      [place_ids]
    );

    if (places.length < 2) {
      return apiBadRequest("Not enough places with valid coordinates");
    }

    // Nearest-neighbor TSP
    const ordered = nearestNeighborTSP(places);

    // Calculate leg distances and total
    let totalDistance = 0;
    const legs: Array<{
      from_place_id: string;
      to_place_id: string;
      distance_km: number;
    }> = [];

    for (let i = 0; i < ordered.length - 1; i++) {
      const dist = haversine(
        ordered[i].lat, ordered[i].lng,
        ordered[i + 1].lat, ordered[i + 1].lng,
      );
      totalDistance += dist;
      legs.push({
        from_place_id: ordered[i].place_id,
        to_place_id: ordered[i + 1].place_id,
        distance_km: Math.round(dist * 100) / 100,
      });
    }

    return apiSuccess({
      ordered_places: ordered.map((p, i) => ({
        order: i + 1,
        place_id: p.place_id,
        address: p.formatted_address,
        lat: p.lat,
        lng: p.lng,
      })),
      legs,
      total_distance_km: Math.round(totalDistance * 100) / 100,
      total_distance_mi: Math.round(totalDistance * 0.621371 * 100) / 100,
      google_maps_url: buildGoogleMapsUrl(ordered),
    });
  } catch (err) {
    console.error("[optimize-route] Error:", err);
    return apiError("Route optimization failed", 500);
  }
}

// ── Haversine distance (km) ──────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// ── Nearest-neighbor TSP ─────────────────────────────────────────────────

interface PlaceCoord {
  place_id: string;
  formatted_address: string;
  lat: number;
  lng: number;
}

function nearestNeighborTSP(places: PlaceCoord[]): PlaceCoord[] {
  const remaining = [...places];
  const result: PlaceCoord[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const current = result[result.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversine(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    result.push(remaining.splice(nearestIdx, 1)[0]);
  }

  return result;
}

// ── Google Maps directions URL ───────────────────────────────────────────

function buildGoogleMapsUrl(places: PlaceCoord[]): string {
  if (places.length === 0) return "";
  const origin = `${places[0].lat},${places[0].lng}`;
  const destination = `${places[places.length - 1].lat},${places[places.length - 1].lng}`;
  const waypoints = places.slice(1, -1).map(p => `${p.lat},${p.lng}`).join("|");
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}
