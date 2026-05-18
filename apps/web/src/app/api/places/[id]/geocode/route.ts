import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiNotFound } from "@/lib/api-response";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

/**
 * POST /api/places/[id]/geocode
 * Geocodes a single place by its formatted_address, writes coordinates to DB.
 */
export const POST = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: placeId } = await params;
  requireValidUUID(placeId, "place");

  if (!GOOGLE_API_KEY) {
    return apiServerError("Google API key not configured");
  }

  const place = await queryOne<{ formatted_address: string; display_name: string | null }>(
    `SELECT formatted_address, display_name FROM sot.places WHERE place_id = $1`,
    [placeId]
  );

  if (!place || !place.formatted_address) {
    return apiNotFound("Place not found or has no address to geocode");
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", place.formatted_address);
  url.searchParams.set("key", GOOGLE_API_KEY);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== "OK" || !data.results?.length) {
    return apiServerError(`Geocoding failed: ${data.status || "no results"}`);
  }

  const location = data.results[0].geometry.location;
  const lat = location.lat;
  const lng = location.lng;

  await queryOne(
    `UPDATE sot.places
     SET location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
         updated_at = NOW()
     WHERE place_id = $3`,
    [lat, lng, placeId]
  );

  return apiSuccess({ lat, lng, formatted_address: place.formatted_address });
});
