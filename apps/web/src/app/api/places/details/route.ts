import { NextRequest } from "next/server";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const placeId = searchParams.get("place_id");

  if (!placeId) {
    return apiBadRequest("place_id required");
  }

  if (!GOOGLE_API_KEY) {
    return apiServerError("Google Places API key not configured");
  }

  try {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/details/json"
    );
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("key", GOOGLE_API_KEY);
    url.searchParams.set(
      "fields",
      "place_id,name,formatted_address,geometry,address_components"
    );

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== "OK") {
      console.error("Google Places error:", data.status, data.error_message);
      return apiServerError("Places API error");
    }

    return apiSuccess({ place: data.result });
  } catch (error) {
    console.error("Place details error:", error);
    return apiServerError("Failed to fetch place details");
  }
}
