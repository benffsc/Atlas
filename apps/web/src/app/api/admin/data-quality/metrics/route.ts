import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

/**
 * Data Quality Metrics API
 *
 * GET: Get current metrics from v_data_quality_metrics view (MIG_2515)
 */

interface DataQualityMetrics {
  metric_date: string;

  // Entity counts
  active_cats: number;
  active_people: number;
  active_places: number;

  // Data quality flags
  garbage_cats: number;
  needs_review_cats: number;

  // Duplicate checks
  duplicate_place_groups: number;

  // FK integrity
  fk_to_merged_people: number;
  fk_to_merged_places: number;

  // Linking coverage
  cats_with_sl_id: number;
  cats_with_chq_id: number;
  verified_cat_place_links: number;
  unverified_cat_place_links: number;

  // Verification progress
  verified_person_place: number;
  unverified_person_place: number;

  // Google Maps
  gm_linked: number;
  gm_unlinked: number;

  // Request stats
  requests_new: number;
  requests_working: number;
  requests_paused: number;
  requests_completed: number;

  // Intake stats
  intakes_pending: number;
  intakes_converted: number;
  intakes_declined: number;

  // Skeleton & orphan counts
  skeleton_people: number;
  people_without_identifiers: number;
  appointments_without_place: number;
  orphan_cats: number;
}

export async function GET() {
  try {
    const metrics = await queryOne<DataQualityMetrics>(`
      SELECT * FROM ops.v_data_quality_metrics
    `);

    if (!metrics) {
      return NextResponse.json({
        success: false,
        message: "MIG_2515 not applied yet - metrics view not found",
        metrics: null,
      });
    }

    // Calculate some derived percentages
    const catPlaceCoverage = metrics.active_cats > 0
      ? Math.round(((metrics.active_cats - metrics.orphan_cats) / metrics.active_cats) * 100 * 10) / 10
      : 0;

    const verificationProgress = (metrics.verified_person_place + metrics.unverified_person_place) > 0
      ? Math.round((metrics.verified_person_place / (metrics.verified_person_place + metrics.unverified_person_place)) * 100 * 10) / 10
      : 0;

    const gmLinkingCoverage = (metrics.gm_linked + metrics.gm_unlinked) > 0
      ? Math.round((metrics.gm_linked / (metrics.gm_linked + metrics.gm_unlinked)) * 100 * 10) / 10
      : 0;

    const identifierCoverage = metrics.active_people > 0
      ? Math.round(((metrics.active_people - metrics.people_without_identifiers) / metrics.active_people) * 100 * 10) / 10
      : 0;

    return NextResponse.json({
      success: true,
      metrics,
      derived: {
        cat_place_coverage_pct: catPlaceCoverage,
        verification_progress_pct: verificationProgress,
        gm_linking_coverage_pct: gmLinkingCoverage,
        identifier_coverage_pct: identifierCoverage,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    // If view doesn't exist yet
    if (
      error instanceof Error &&
      error.message.includes("does not exist")
    ) {
      return NextResponse.json({
        success: false,
        message: "MIG_2515 not applied yet - metrics view not found",
        metrics: null,
      });
    }

    console.error("Error fetching data quality metrics:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
