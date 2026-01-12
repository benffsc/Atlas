import { NextRequest, NextResponse } from "next/server";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const placeId = searchParams.get("place_id");

  if (!placeId) {
    return NextResponse.json(
      { error: "place_id required" },
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
      return NextResponse.json(
        { error: "Places API error" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      place: data.result,
    });
  } catch (error) {
    console.error("Place details error:", error);
    return NextResponse.json(
      { error: "Failed to fetch place details" },
      { status: 500 }
    );
  }
}
