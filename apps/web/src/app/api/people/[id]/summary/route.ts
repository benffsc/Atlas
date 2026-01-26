import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

/**
 * Person AI Summary Endpoint
 * ==========================
 *
 * Returns a comprehensive summary of a person including:
 * - Contact info (verified from person_identifiers)
 * - Roles (from person_roles)
 * - AI-extracted attributes grouped by confidence
 * - Alerts (safety concerns)
 * - Request history
 * - Clinic history
 * - Google Maps mentions
 * - Data sources
 *
 * Uses the get_person_summary() function from MIG_711.
 */

interface PersonSummary {
  person_id: string;
  display_name: string;
  contact: {
    emails: string[];
    phones: string[];
    primary_address: string | null;
  };
  roles: Array<{
    role_type: string;
    status: string;
    started_at: string | null;
  }>;
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
    as_requester: number;
    as_trapper: number;
    recent_requests: Array<{
      request_id: string;
      status: string;
      created_at: string;
    }>;
  };
  clinic_history: {
    total_appointments: number;
    cats_processed: number;
  };
  places: Array<{
    place_id: string;
    formatted_address: string;
    relationship_type: string;
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
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    // Call the database function
    const result = await queryOne<{ get_person_summary: PersonSummary | null }>(
      `SELECT trapper.get_person_summary($1) as get_person_summary`,
      [id]
    );

    if (!result?.get_person_summary) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result.get_person_summary);
  } catch (error) {
    console.error("Error fetching person summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch person summary" },
      { status: 500 }
    );
  }
}
