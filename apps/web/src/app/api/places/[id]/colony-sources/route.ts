import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/places/[id]/colony-sources
 *
 * Returns detailed breakdown of colony estimate sources for a place.
 * Shows WHERE estimates come from, confidence factors, and data quality.
 */

interface SourceBreakdown {
  estimate_id: string;
  source_type: string;
  source_label: string;
  total_cats: number;
  base_confidence: number;
  recency_factor: number;
  firsthand_boost: number;
  final_confidence: number;
  weighted_contribution: number; // % of total weight
  observation_date: string | null;
  reported_at: string;
  days_ago: number;
  is_firsthand: boolean;
  reporter_name: string | null;
  notes: string | null;
}

interface ColonySummary {
  final_estimate: number;
  final_confidence: number;
  is_multi_source_confirmed: boolean;
  estimate_count: number;
  primary_source: string | null;
  primary_source_label: string | null;
  has_clinic_verification: boolean;
  verified_cat_count: number;
  verified_altered_count: number;
}

interface DataQuality {
  needs_more_observations: boolean;
  most_recent_days_ago: number | null;
  has_recent_data: boolean; // < 90 days
  source_diversity: number; // Unique source types
  recommendation: string;
  quality_level: "high" | "medium" | "low";
}

const SOURCE_LABELS: Record<string, string> = {
  verified_cats: "Verified Cats in Database",
  post_clinic_survey: "Project 75 Survey",
  trapper_site_visit: "Trapper Assessment",
  manual_observation: "Staff Observation",
  trapping_request: "Trapping Request",
  intake_form: "Web Intake Form",
  appointment_request: "Appointment Request",
  ai_parsed: "AI Parsed",
  legacy_mymaps: "Google Maps (Legacy)",
  field_observation: "Field Observation",
};

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
    // Get all colony estimates with calculated confidence factors
    const sourcesSql = `
      WITH scored_estimates AS (
        SELECT
          e.estimate_id,
          e.total_cats,
          e.source_type,
          e.observation_date,
          e.reported_at,
          e.is_firsthand,
          e.notes,
          p.display_name AS reporter_name,
          -- Base confidence from source type
          COALESCE(sc.base_confidence, 0.50) AS base_confidence,
          -- Days since observation
          EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at))::INTEGER AS days_ago,
          -- Recency decay factor
          CASE
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 30
              THEN 1.0
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 90
              THEN 0.90
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 180
              THEN 0.75
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 365
              THEN 0.50
            ELSE 0.25
          END AS recency_factor,
          -- Firsthand boost
          CASE WHEN e.is_firsthand THEN COALESCE(sc.is_firsthand_boost, 0.05) ELSE 0 END AS firsthand_boost
        FROM trapper.place_colony_estimates e
        LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
        LEFT JOIN trapper.sot_people p ON p.person_id = e.reported_by_person_id
        WHERE e.place_id = $1
          AND e.total_cats IS NOT NULL
      ),
      with_final AS (
        SELECT
          *,
          LEAST(1.0, (base_confidence * recency_factor) + firsthand_boost) AS final_confidence
        FROM scored_estimates
      ),
      with_weights AS (
        SELECT
          *,
          -- Calculate weighted contribution as percentage of total
          CASE
            WHEN SUM(final_confidence) OVER () > 0
            THEN ROUND((final_confidence / SUM(final_confidence) OVER ()) * 100, 1)
            ELSE 0
          END AS weighted_contribution
        FROM with_final
      )
      SELECT
        estimate_id::TEXT,
        total_cats,
        source_type,
        observation_date::TEXT,
        reported_at::TEXT,
        is_firsthand,
        notes,
        reporter_name,
        ROUND(base_confidence::NUMERIC, 2) AS base_confidence,
        ROUND(recency_factor::NUMERIC, 2) AS recency_factor,
        ROUND(firsthand_boost::NUMERIC, 2) AS firsthand_boost,
        ROUND(final_confidence::NUMERIC, 2) AS final_confidence,
        weighted_contribution,
        days_ago
      FROM with_weights
      ORDER BY final_confidence DESC, observation_date DESC NULLS LAST
    `;

    const sources = await queryRows<{
      estimate_id: string;
      total_cats: number;
      source_type: string;
      observation_date: string | null;
      reported_at: string;
      is_firsthand: boolean;
      notes: string | null;
      reporter_name: string | null;
      base_confidence: number;
      recency_factor: number;
      firsthand_boost: number;
      final_confidence: number;
      weighted_contribution: number;
      days_ago: number;
    }>(sourcesSql, [id]);

    // Get summary from the colony status view
    const summarySql = `
      SELECT
        colony_size_estimate,
        final_confidence,
        is_multi_source_confirmed,
        estimate_count,
        primary_source,
        verified_cat_count,
        verified_altered_count
      FROM trapper.v_place_colony_status
      WHERE place_id = $1
    `;

    const summaryRow = await queryOne<{
      colony_size_estimate: number;
      final_confidence: number | null;
      is_multi_source_confirmed: boolean;
      estimate_count: number;
      primary_source: string | null;
      verified_cat_count: number;
      verified_altered_count: number;
    }>(summarySql, [id]);

    // Check for clinic verification (post_clinic_survey or verified_cats)
    const hasClinicVerification = sources.some(
      (s) => s.source_type === "post_clinic_survey" || s.source_type === "verified_cats"
    );

    // Build source breakdown with labels
    const formattedSources: SourceBreakdown[] = sources.map((s) => ({
      estimate_id: s.estimate_id,
      source_type: s.source_type,
      source_label: SOURCE_LABELS[s.source_type] || s.source_type,
      total_cats: s.total_cats,
      base_confidence: s.base_confidence,
      recency_factor: s.recency_factor,
      firsthand_boost: s.firsthand_boost,
      final_confidence: s.final_confidence,
      weighted_contribution: s.weighted_contribution,
      observation_date: s.observation_date,
      reported_at: s.reported_at,
      days_ago: s.days_ago,
      is_firsthand: s.is_firsthand,
      reporter_name: s.reporter_name,
      notes: s.notes,
    }));

    // Build summary
    const summary: ColonySummary = {
      final_estimate: summaryRow?.colony_size_estimate || 0,
      final_confidence: summaryRow?.final_confidence || 0,
      is_multi_source_confirmed: summaryRow?.is_multi_source_confirmed || false,
      estimate_count: summaryRow?.estimate_count || 0,
      primary_source: summaryRow?.primary_source || null,
      primary_source_label: summaryRow?.primary_source
        ? SOURCE_LABELS[summaryRow.primary_source] || summaryRow.primary_source
        : null,
      has_clinic_verification: hasClinicVerification,
      verified_cat_count: summaryRow?.verified_cat_count || 0,
      verified_altered_count: summaryRow?.verified_altered_count || 0,
    };

    // Build data quality assessment
    // Filter out NaN/null/undefined days_ago values to prevent Math.min returning NaN
    const validDaysAgo = sources
      .map((s) => s.days_ago)
      .filter((d): d is number => Number.isFinite(d));
    const mostRecentDaysAgo = validDaysAgo.length > 0
      ? Math.min(...validDaysAgo)
      : null;

    const hasRecentData = mostRecentDaysAgo !== null && mostRecentDaysAgo <= 90;
    const uniqueSourceTypes = new Set(sources.map((s) => s.source_type)).size;
    const needsMoreObservations = sources.length < 3;

    let recommendation: string;
    let qualityLevel: "high" | "medium" | "low";

    if (sources.length === 0) {
      recommendation = "No colony estimates on file. Add an observation to start tracking.";
      qualityLevel = "low";
    } else if (summary.is_multi_source_confirmed && hasRecentData && hasClinicVerification) {
      recommendation = "Colony estimate is highly reliable (multi-source confirmed with recent clinic data).";
      qualityLevel = "high";
    } else if (summary.is_multi_source_confirmed && hasRecentData) {
      recommendation = "Colony estimate is reliable (confirmed by multiple recent sources).";
      qualityLevel = "high";
    } else if (hasRecentData && sources.length >= 2) {
      recommendation = "Colony estimate is moderately reliable. Additional observations would improve confidence.";
      qualityLevel = "medium";
    } else if (!hasRecentData && sources.length > 0) {
      recommendation = `Data is ${mostRecentDaysAgo} days old. A recent observation would improve accuracy.`;
      qualityLevel = "low";
    } else {
      recommendation = `Only ${sources.length} observation${sources.length === 1 ? "" : "s"} on file. Add ${3 - sources.length} more for reliable estimates.`;
      qualityLevel = needsMoreObservations ? "low" : "medium";
    }

    const dataQuality: DataQuality = {
      needs_more_observations: needsMoreObservations,
      most_recent_days_ago: mostRecentDaysAgo,
      has_recent_data: hasRecentData,
      source_diversity: uniqueSourceTypes,
      recommendation,
      quality_level: qualityLevel,
    };

    return NextResponse.json({
      place_id: id,
      summary,
      sources: formattedSources,
      data_quality: dataQuality,
    });
  } catch (error) {
    console.error("Error fetching colony sources:", error);
    return NextResponse.json(
      { error: "Failed to fetch colony sources" },
      { status: 500 }
    );
  }
}
