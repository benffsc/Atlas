import { NextRequest, NextResponse } from "next/server";

const GOOGLE_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

/**
 * GET /api/streetview/embed?lat=38.5&lng=-122.8
 *
 * Redirects to Google Maps Embed API Street View URL.
 * Keeps the API key server-side — the iframe src points here,
 * and the browser follows the 302 to Google.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const heading = searchParams.get("heading") || "0";
  const pitch = searchParams.get("pitch") || "0";
  const fov = searchParams.get("fov") || "90";

  if (!lat || !lng) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 }
    );
  }

  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Google Maps API key not configured" },
      { status: 500 }
    );
  }

  const embedUrl = `https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_API_KEY}&location=${lat},${lng}&heading=${heading}&pitch=${pitch}&fov=${fov}`;

  return NextResponse.redirect(embedUrl);
}
