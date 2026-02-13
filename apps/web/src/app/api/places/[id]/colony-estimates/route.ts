import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface ColonyEstimate {
  estimate_id: string;
  total_cats: number | null;
  adult_count: number | null;
  kitten_count: number | null;
  altered_count: number | null;
  unaltered_count: number | null;
  friendly_count: number | null;
  feral_count: number | null;
  source_type: string;
  observation_date: string | null;
  reported_at: string;
  is_firsthand: boolean;
  source_record_id: string | null;
  reporter_name: string | null;
  reporter_person_id: string | null;
  notes: string | null;
}

interface ColonyStatus {
  colony_size_estimate: number;
  verified_cat_count: number;
  verified_altered_count: number;
  final_confidence: number | null;
  estimate_count: number;
  primary_source: string | null;
  is_multi_source_confirmed: boolean;
  estimated_work_remaining: number;
}

interface EcologyStats {
  a_known: number;
  a_known_current: number;
  a_known_effective: number;
  cats_needing_tnr: number;
  n_recent_max: number;
  p_lower: number | null;
  p_lower_pct: number | null;
  estimation_method: string;
  has_eartip_data: boolean;
  total_eartips_seen: number;
  total_cats_seen: number;
  n_hat_chapman: number | null;
  p_hat_chapman_pct: number | null;
  best_colony_estimate: number | null;
  estimated_work_remaining: number | null;
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
    // Get all colony estimates for this place
    const estimatesSql = `
      SELECT
        e.estimate_id,
        e.total_cats,
        e.adult_count,
        e.kitten_count,
        e.altered_count,
        e.unaltered_count,
        e.friendly_count,
        e.feral_count,
        e.source_type,
        e.observation_date,
        e.reported_at,
        e.is_firsthand,
        e.source_record_id,
        e.notes,
        p.display_name AS reporter_name,
        p.person_id AS reporter_person_id
      FROM sot.place_colony_estimates e
      LEFT JOIN sot.people p ON p.person_id = e.reported_by_person_id
      WHERE e.place_id = $1
      ORDER BY e.observation_date DESC NULLS LAST, e.reported_at DESC
    `;

    const estimates = await queryRows<ColonyEstimate>(estimatesSql, [id]);

    // Get aggregated colony status - wrapped in try/catch for resilience
    let status: ColonyStatus | null = null;
    try {
      const statusSql = `
        SELECT
          colony_size_estimate,
          verified_cat_count,
          verified_altered_count,
          final_confidence,
          estimate_count,
          primary_source,
          is_multi_source_confirmed,
          estimated_work_remaining
        FROM sot.v_place_colony_status
        WHERE place_id = $1
      `;
      status = await queryOne<ColonyStatus>(statusSql, [id]);
    } catch (statusError) {
      console.warn("Could not fetch colony status (view may not exist):", statusError);
      // Continue without colony status
    }

    // Get colony columns from places table directly (synced values)
    // Includes new classification fields from MIG_615
    const placeSql = `
      SELECT
        colony_size_estimate,
        colony_confidence,
        colony_estimate_count,
        colony_updated_at,
        colony_classification::TEXT,
        colony_classification_reason,
        colony_classification_set_by,
        colony_classification_set_at,
        authoritative_cat_count,
        authoritative_count_reason,
        allows_clustering
      FROM sot.places
      WHERE place_id = $1
    `;

    const placeColony = await queryOne<{
      colony_size_estimate: number | null;
      colony_confidence: number | null;
      colony_estimate_count: number | null;
      colony_updated_at: string | null;
      colony_classification: string | null;
      colony_classification_reason: string | null;
      colony_classification_set_by: string | null;
      colony_classification_set_at: string | null;
      authoritative_cat_count: number | null;
      authoritative_count_reason: string | null;
      allows_clustering: boolean | null;
    }>(placeSql, [id]);

    // Get ecology-based statistics - wrapped in try/catch for resilience
    let ecology: EcologyStats | null = null;
    try {
      const ecologySql = `
        SELECT
          COALESCE(a_known, 0) as a_known,
          COALESCE(a_known_current, 0) as a_known_current,
          COALESCE(a_known_effective, 0) as a_known_effective,
          COALESCE(cats_needing_tnr, 0) as cats_needing_tnr,
          COALESCE(n_recent_max, 0) as n_recent_max,
          p_lower,
          p_lower_pct,
          COALESCE(estimation_method, 'no_data') as estimation_method,
          COALESCE(has_eartip_data, false) as has_eartip_data,
          COALESCE(total_eartips_seen, 0) as total_eartips_seen,
          COALESCE(total_cats_seen, 0) as total_cats_seen,
          n_hat_chapman,
          p_hat_chapman_pct,
          best_colony_estimate,
          estimated_work_remaining
        FROM sot.v_place_ecology_stats
        WHERE place_id = $1
      `;
      ecology = await queryOne<EcologyStats>(ecologySql, [id]);
    } catch (ecologyError) {
      console.warn("Could not fetch ecology stats (view may not exist):", ecologyError);
      // Continue without ecology stats
    }

    // Map source types to display labels
    const sourceLabels: Record<string, string> = {
      post_clinic_survey: "Project 75 Survey",
      trapper_site_visit: "Trapper Assessment",
      manual_observation: "Manual Observation",
      trapping_request: "Trapping Request",
      intake_form: "Web Intake Form",
      appointment_request: "Appointment Request",
      verified_cats: "Verified Cats",
      ai_parsed: "AI Parsed",
      legacy_mymaps: "Google Maps (Legacy)",
    };

    // Format estimates with display labels
    const formattedEstimates = estimates.map((e) => ({
      ...e,
      source_label: sourceLabels[e.source_type] || e.source_type,
    }));

    return NextResponse.json({
      place_id: id,
      estimates: formattedEstimates,
      status: status || {
        colony_size_estimate: placeColony?.colony_size_estimate || 0,
        verified_cat_count: 0,
        verified_altered_count: 0,
        final_confidence: placeColony?.colony_confidence || null,
        estimate_count: placeColony?.colony_estimate_count || 0,
        primary_source: null,
        is_multi_source_confirmed: false,
        estimated_work_remaining: 0,
      },
      // Ecology-based metrics (wildlife management best practices)
      ecology: ecology || {
        a_known: 0,
        a_known_current: 0,
        a_known_effective: 0,
        cats_needing_tnr: 0,
        n_recent_max: 0,
        p_lower: null,
        p_lower_pct: null,
        estimation_method: "no_data",
        has_eartip_data: false,
        total_eartips_seen: 0,
        total_cats_seen: 0,
        n_hat_chapman: null,
      },
      // Classification data (MIG_615)
      classification: {
        type: placeColony?.colony_classification || "unknown",
        reason: placeColony?.colony_classification_reason || null,
        set_by: placeColony?.colony_classification_set_by || null,
        set_at: placeColony?.colony_classification_set_at || null,
        authoritative_cat_count: placeColony?.authoritative_cat_count || null,
        authoritative_count_reason: placeColony?.authoritative_count_reason || null,
        allows_clustering: placeColony?.allows_clustering ?? true,
      },
      has_data: estimates.length > 0 || (status && status.colony_size_estimate > 0) || (ecology && ecology.a_known > 0),
    });
  } catch (error) {
    console.error("Error fetching colony estimates:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to fetch colony estimates", details: errorMessage },
      { status: 500 }
    );
  }
}
