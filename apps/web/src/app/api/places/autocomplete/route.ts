import { NextRequest } from "next/server";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";
import { getAutocompleteBias } from "@/lib/geo-config";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const input = searchParams.get("input");

  if (!input) {
    return apiBadRequest("Input required");
  }

  if (!GOOGLE_API_KEY) {
    return apiServerError("Google Places API key not configured");
  }

  try {
    const locationBias = await getAutocompleteBias();

    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    );
    url.searchParams.set("input", input);
    url.searchParams.set("key", GOOGLE_API_KEY);
    url.searchParams.set("types", "address");
    url.searchParams.set(
      "location",
      `${locationBias.lat},${locationBias.lng}`
    );
    url.searchParams.set("radius", String(locationBias.radius));
    url.searchParams.set("components", "country:us");

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Google Places error:", data.status, data.error_message);
      return apiServerError("Places API error");
    }

    return apiSuccess({ predictions: data.predictions || [] });
  } catch (error) {
    console.error("Autocomplete error:", error);
    return apiServerError("Failed to fetch predictions");
  }
}
