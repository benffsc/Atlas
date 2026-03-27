import { NextRequest } from "next/server";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";
import { getAutocompleteBias, type AutocompleteBias } from "@/lib/geo-config";

let cachedBias: AutocompleteBias | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getBias(): Promise<AutocompleteBias> {
  const now = Date.now();
  if (cachedBias && now - cacheTimestamp < CACHE_TTL) {
    return cachedBias;
  }
  cachedBias = await getAutocompleteBias();
  cacheTimestamp = now;
  return cachedBias;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("query");
    const location = searchParams.get("location");
    const radius = searchParams.get("radius");

    if (!query) {
      return apiBadRequest("query parameter is required");
    }

    if (!process.env.GOOGLE_PLACES_API_KEY) {
      return apiServerError("Google Places API key not configured");
    }

    const bias = await getBias();

    const params = new URLSearchParams({
      query,
      key: process.env.GOOGLE_PLACES_API_KEY!,
      location: location || `${bias.lat},${bias.lng}`,
      radius: radius || String(bias.radius),
    });

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`
    );

    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Google Text Search API error:", data.status, data.error_message);
      return apiServerError(`Google API error: ${data.status}`);
    }

    return apiSuccess({
      results: (data.results || []).slice(0, 5).map((r: any) => ({
        place_id: r.place_id,
        name: r.name,
        formatted_address: r.formatted_address,
        geometry: r.geometry,
        types: r.types,
      })),
    });
  } catch (error) {
    console.error("Text search error:", error);
    return apiServerError("Failed to perform text search");
  }
}
