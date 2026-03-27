import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiBadRequest, apiNotFound, apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * GET /api/places/[id]/context
 *
 * Returns comprehensive context for a place including:
 *
 * OPERATIONAL LAYER (current state for staff workflows):
 * - Active requests at this address
 * - Recent clinic activity (cats, appointments)
 * - Google Maps historical notes (within 200m)
 * - Nearby active requests (within 200m)
 *
 * ECOLOGICAL LAYER (historical context for analysis):
 * - Historical conditions (hoarding, disease outbreak, etc.)
 * - Colony timeline (population estimates over time)
 * - Dispersal patterns (source-sink relationships)
 * - Zone demographics (socioeconomic data)
 *
 * Summary flags for quick UI rendering.
 *
 * This endpoint powers the AI Data Guardian's contextual awareness system.
 * It surfaces relevant information to staff during intake and request handling.
 *
 * Note: This is READ-ONLY. It provides awareness, not modification suggestions.
 * Each address remains its own distinct place.
 */

interface PlaceContext {
  place_id: string;
  address: string;
  service_zone: string | null;
  location: { lat: number; lng: number };

  // OPERATIONAL LAYER
  active_requests: Array<{
    request_id: string;
    summary: string;
    status: string;
    estimated_cat_count: number;
    created_at: string;
    assigned_trapper: string | null;
  }>;
  clinic_activity: {
    total_cats_6mo: number;
    total_appointments_6mo: number;
    last_visit_date: string | null;
    recent_cats: Array<{
      cat_id: string;
      name: string;
      altered_status: string;
      last_appointment: string;
    }>;
  };
  google_context: Array<{
    entry_id: number;
    name: string;
    notes: string;
    ai_summary: string | null;
    ai_meaning: string | null;
    classification: Record<string, unknown> | null;
    cat_count: number | null;
    distance_m: number;
  }>;
  nearby_requests: Array<{
    request_id: string;
    summary: string;
    status: string;
    cat_count: number;
    address: string;
    distance_m: number;
  }>;

  // ECOLOGICAL LAYER
  condition_history: Array<{
    condition_id: string;
    condition_type: string;
    display_label: string;
    severity: string;
    valid_from: string;
    valid_to: string | null;
    is_ongoing: boolean;
    peak_cat_count: number | null;
    ecological_impact: string | null;
    description: string | null;
    source_type: string;
  }>;
  colony_timeline: Array<{
    estimated_total: number;
    estimated_altered: number;
    alteration_rate: number;
    colony_status: string;
    valid_from: string;
    valid_to: string | null;
    is_current: boolean;
    confidence: number;
    source_type: string;
  }>;
  dispersal_patterns: {
    as_source: Array<{
      sink_place_id: string;
      sink_address: string;
      relationship_type: string;
      evidence_strength: string;
      estimated_cats_transferred: number | null;
    }>;
    as_sink: Array<{
      source_place_id: string;
      source_address: string;
      relationship_type: string;
      evidence_strength: string;
      estimated_cats_transferred: number | null;
    }>;
  };
  zone_demographics: {
    zone_name: string;
    median_household_income: number | null;
    pct_below_poverty: number | null;
    pct_renter_occupied: number | null;
    pct_mobile_homes: number | null;
    pet_ownership_index: number | null;
    tnr_priority_score: number | null;
  } | null;

  // SUMMARY FLAGS
  context_flags: {
    // Operational
    has_active_request: boolean;
    has_recent_clinic: boolean;
    has_google_history: boolean;
    has_nearby_activity: boolean;
    // Ecological
    has_condition_history: boolean;
    has_ongoing_condition: boolean;
    has_disease_history: boolean;
    was_significant_source: boolean;
  };
  generated_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Place ID is required");
  }

  try {
    requireValidUUID(id, "place");
    // Use the database function for comprehensive context
    const result = await queryOne<{ context: PlaceContext }>(
      `SELECT sot.get_place_context($1) as context`,
      [id]
    );

    if (!result || !result.context) {
      return apiNotFound("Place", id);
    }

    // Check if the function returned an error (cast to handle error case)
    const context = result.context as PlaceContext & { error?: string };
    if (context.error) {
      return apiNotFound("Place", id);
    }

    return apiSuccess(context);
  } catch (error) {
    console.error("Error fetching place context:", error);
    return apiServerError("Failed to fetch place context");
  }
}

/**
 * POST /api/places/[id]/context
 *
 * Alternative lookup by address string.
 * Body: { address: string }
 *
 * Finds matching place and returns its context.
 * Useful for intake form address matching.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { address } = body;

    if (!address) {
      return apiBadRequest("Address is required");
    }

    // Use the address lookup function
    const result = await queryOne<{ context: PlaceContext }>(
      `SELECT sot.get_place_context_by_address($1) as context`,
      [address]
    );

    if (!result || !result.context) {
      return apiSuccess({
        address,
        error: "No matching place found",
        context_flags: {
          has_active_request: false,
          has_recent_clinic: false,
          has_google_history: false,
          has_nearby_activity: false,
        },
      });
    }

    return apiSuccess(result.context);
  } catch (error) {
    console.error("Error fetching place context by address:", error);
    return apiServerError("Failed to fetch place context");
  }
}
