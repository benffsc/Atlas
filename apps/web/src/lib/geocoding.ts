/**
 * Google Geocoding API helper (FFS-128)
 *
 * Used for inline geocoding at intake submission and by the geocode cron.
 */

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

export interface GeocodingResult {
  success: true;
  lat: number;
  lng: number;
  formatted_address: string;
}

export interface GeocodingFailure {
  success: false;
  error: string;
}

export type GeocodingResponse = GeocodingResult | GeocodingFailure;

/**
 * Forward geocode an address string to lat/lng coordinates.
 * Returns null if API key is not configured (non-fatal).
 */
export async function geocodeAddress(address: string): Promise<GeocodingResponse | null> {
  if (!GOOGLE_API_KEY) {
    return null; // No API key — skip geocoding silently
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("key", GOOGLE_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
      const { lat, lng } = data.results[0].geometry.location;
      return {
        success: true,
        lat,
        lng,
        formatted_address: data.results[0].formatted_address,
      };
    }

    const error =
      data.status === "ZERO_RESULTS"
        ? "Address not found"
        : data.error_message || data.status || "Unknown error";

    return { success: false, error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Geocoding request failed",
    };
  }
}

/**
 * Build a full address string from components for geocoding.
 */
export function buildAddressString(
  address: string,
  city?: string,
  zip?: string
): string {
  const parts = [address];
  if (city) parts.push(city);
  if (zip) parts.push(zip);
  return parts.join(", ");
}
