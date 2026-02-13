import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

/**
 * Place AI Summary Endpoint
 * =========================
 *
 * Returns a comprehensive summary of a place including:
 * - Location info (address, coordinates)
 * - AI-extracted attributes grouped by confidence
 * - Alerts (disease, safety concerns)
 * - Request history
 * - Colony information
 * - Associated people
 * - Cats linked to place
 * - Google Maps mentions
 * - Data sources
 *
 * Uses the get_place_summary() function from MIG_711.
 */

interface PlaceSummary {
  place_id: string;
  formatted_address: string;
  location: {
    lat: number | null;
    lng: number | null;
    locality: string | null;
    county: string | null;
  };
  attributes: {
    high_confidence: Array<{
      key: string;
      value: unknown;
      confidence: number;
      evidence: string | null;
    }>;
    medium_confidence: Array<{
      key: string;
      value: unknown;
      confidence: number;
      evidence: string | null;
    }>;
    low_confidence: Array<{
      key: string;
      value: unknown;
      confidence: number;
      evidence: string | null;
    }>;
  };
  alerts: Array<{
    type: string;
    message: string;
    confidence: number;
  }>;
  request_history: {
    total_requests: number;
    active_requests: number;
    completed_requests: number;
    recent_requests: Array<{
      request_id: string;
      status: string;
      created_at: string;
    }>;
  };
  colony: {
    estimated_size: number | null;
    confidence: number | null;
    source: string | null;
    last_updated: string | null;
  };
  people: Array<{
    person_id: string;
    display_name: string;
    relationship_type: string;
  }>;
  cats: {
    total_linked: number;
    altered: number;
    unaltered: number;
  };
  contexts: Array<{
    context_type: string;
    started_at: string | null;
  }>;
  google_maps_mentions: number;
  data_sources: string[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    // Call the database function
    const result = await queryOne<{ get_place_summary: PlaceSummary | null }>(
      `SELECT sot.get_place_summary($1) as get_place_summary`,
      [id]
    );

    if (!result?.get_place_summary) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result.get_place_summary);
  } catch (error) {
    console.error("Error fetching place summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch place summary" },
      { status: 500 }
    );
  }
}
