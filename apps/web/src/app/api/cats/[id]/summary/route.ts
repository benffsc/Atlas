import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

/**
 * Cat AI Summary Endpoint
 * =======================
 *
 * Returns a comprehensive summary of a cat including:
 * - Basic info (name, breed, sex, colors)
 * - Microchip identifiers
 * - Alteration status
 * - AI-extracted attributes grouped by confidence
 * - Alerts (health issues)
 * - Clinic history
 * - Place history
 * - People relationships
 * - Data sources
 *
 * Uses the get_cat_summary() function from MIG_711.
 */

interface CatSummary {
  cat_id: string;
  name: string | null;
  identifiers: {
    microchips: string[];
    clinic_ids: string[];
  };
  physical: {
    sex: string | null;
    breed: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    estimated_age: string | null;
  };
  status: {
    is_altered: boolean;
    is_deceased: boolean;
    is_eartipped: boolean;
    altered_date: string | null;
    deceased_date: string | null;
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
  clinic_history: {
    total_appointments: number;
    recent_appointments: Array<{
      appointment_id: string;
      appointment_date: string;
      appointment_type: string;
    }>;
  };
  places: Array<{
    place_id: string;
    formatted_address: string;
    relationship_type: string;
  }>;
  people: Array<{
    person_id: string;
    display_name: string;
    relationship_type: string;
  }>;
  data_sources: string[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    // Call the database function
    const result = await queryOne<{ get_cat_summary: CatSummary | null }>(
      `SELECT trapper.get_cat_summary($1) as get_cat_summary`,
      [id]
    );

    if (!result?.get_cat_summary) {
      return NextResponse.json(
        { error: "Cat not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result.get_cat_summary);
  } catch (error) {
    console.error("Error fetching cat summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch cat summary" },
      { status: 500 }
    );
  }
}
