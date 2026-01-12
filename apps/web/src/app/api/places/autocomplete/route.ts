import { NextRequest, NextResponse } from "next/server";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Bias results to Sonoma County area
const LOCATION_BIAS = {
  lat: 38.5,
  lng: -122.8,
  radius: 50000, // 50km
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const input = searchParams.get("input");

  if (!input) {
    return NextResponse.json(
      { error: "Input required" },
      { status: 400 }
    );
  }

  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Google Places API key not configured" },
      { status: 500 }
    );
  }

  try {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    );
    url.searchParams.set("input", input);
    url.searchParams.set("key", GOOGLE_API_KEY);
    url.searchParams.set("types", "address");
    url.searchParams.set(
      "location",
      `${LOCATION_BIAS.lat},${LOCATION_BIAS.lng}`
    );
    url.searchParams.set("radius", String(LOCATION_BIAS.radius));
    url.searchParams.set("components", "country:us");

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Google Places error:", data.status, data.error_message);
      return NextResponse.json(
        { error: "Places API error", predictions: [] },
        { status: 500 }
      );
    }

    return NextResponse.json({
      predictions: data.predictions || [],
    });
  } catch (error) {
    console.error("Autocomplete error:", error);
    return NextResponse.json(
      { error: "Failed to fetch predictions" },
      { status: 500 }
    );
  }
}
