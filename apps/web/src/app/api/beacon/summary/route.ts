import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Beacon Dashboard Summary API
 *
 * Returns high-level KPIs for the Beacon dashboard.
 * Combines v_beacon_summary with v_beacon_cluster_summary.
 *
 * Scientific basis:
 * - TNR effectiveness threshold: 71-94% (Levy et al. JAVMA 2005)
 * - Lower-bound calculation for defensible impact claims
 */

interface BeaconDashboardSummary {
  // Overall metrics
  total_cats: number;
  total_places: number;
  places_with_cats: number;

  // Alteration metrics
  total_verified_cats: number;
  total_altered_cats: number;
  overall_alteration_rate: number | null;

  // Colony status breakdown
  colonies_managed: number;
  colonies_in_progress: number;
  colonies_needs_work: number;
  colonies_needs_attention: number;
  colonies_no_data: number;

  // Cluster metrics
  total_clusters: number;
  places_in_clusters: number;
  isolated_places: number;
  clusters_managed: number;
  clusters_in_progress: number;
  clusters_needs_work: number;
  clusters_needs_attention: number;

  // Work remaining
  estimated_cats_to_alter: number | null;

  // Timestamps
  calculated_at: string;
}

export async function GET() {
  try {
    // Check if required views exist before querying
    const viewCheck = await queryOne<{ summary_exists: boolean; clusters_exists: boolean }>(`
      SELECT
        EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_beacon_summary') as summary_exists,
        EXISTS(SELECT 1 FROM pg_matviews WHERE schemaname = 'trapper' AND matviewname = 'mv_beacon_clusters') as clusters_exists
    `, []);

    if (!viewCheck?.summary_exists || !viewCheck?.clusters_exists) {
      const missing = [];
      if (!viewCheck?.summary_exists) missing.push("v_beacon_summary (MIG_340)");
      if (!viewCheck?.clusters_exists) missing.push("mv_beacon_clusters (MIG_341)");

      return NextResponse.json({
        error: "Beacon views not deployed",
        missing,
        hint: "Run: ./scripts/deploy-critical-migrations.sh",
        migrations_needed: [
          "MIG_340__beacon_calculation_views.sql",
          "MIG_341__beacon_clustering.sql",
        ],
        health_check: "/api/beacon/health",
      }, { status: 503 });
    }

    // Fetch summary data from views
    const [placeSummary, clusterSummary, workRemaining] = await Promise.all([
      // Place-level summary
      queryOne<{
        total_cats: number;
        total_places: number;
        places_with_cats: number;
        total_verified_cats: number;
        total_altered_cats: number;
        overall_alteration_rate: number;
        colonies_managed: number;
        colonies_in_progress: number;
        colonies_needs_work: number;
        colonies_needs_attention: number;
        colonies_no_data: number;
      }>(`SELECT * FROM ops.v_beacon_summary`, []),

      // Cluster-level summary
      queryOne<{
        total_clusters: number;
        places_in_clusters: number;
        isolated_places: number;
        cats_in_clusters: number;
        altered_in_clusters: number;
        clusters_managed: number;
        clusters_in_progress: number;
        clusters_needs_work: number;
        clusters_needs_attention: number;
        avg_places_per_cluster: number;
        avg_cats_per_cluster: number;
        overall_cluster_alteration_rate: number;
      }>(`SELECT * FROM ops.v_beacon_cluster_summary`, []),

      // Work remaining estimate
      queryOne<{ estimated_to_alter: number }>(`
        SELECT COALESCE(SUM(
          GREATEST(0, estimated_total - verified_altered_count)
        ), 0)::INT as estimated_to_alter
        FROM ops.v_beacon_place_metrics
        WHERE estimated_total > verified_altered_count
      `, []),
    ]);

    const summary: BeaconDashboardSummary = {
      // Overall metrics
      total_cats: placeSummary?.total_cats || 0,
      total_places: placeSummary?.total_places || 0,
      places_with_cats: placeSummary?.places_with_cats || 0,

      // Alteration metrics
      total_verified_cats: placeSummary?.total_verified_cats || 0,
      total_altered_cats: placeSummary?.total_altered_cats || 0,
      overall_alteration_rate: placeSummary?.overall_alteration_rate || null,

      // Colony status breakdown
      colonies_managed: placeSummary?.colonies_managed || 0,
      colonies_in_progress: placeSummary?.colonies_in_progress || 0,
      colonies_needs_work: placeSummary?.colonies_needs_work || 0,
      colonies_needs_attention: placeSummary?.colonies_needs_attention || 0,
      colonies_no_data: placeSummary?.colonies_no_data || 0,

      // Cluster metrics
      total_clusters: clusterSummary?.total_clusters || 0,
      places_in_clusters: clusterSummary?.places_in_clusters || 0,
      isolated_places: clusterSummary?.isolated_places || 0,
      clusters_managed: clusterSummary?.clusters_managed || 0,
      clusters_in_progress: clusterSummary?.clusters_in_progress || 0,
      clusters_needs_work: clusterSummary?.clusters_needs_work || 0,
      clusters_needs_attention: clusterSummary?.clusters_needs_attention || 0,

      // Work remaining
      estimated_cats_to_alter: workRemaining?.estimated_to_alter || null,

      // Timestamps
      calculated_at: new Date().toISOString(),
    };

    // Calculate derived metrics
    const managedPercentage =
      summary.places_with_cats > 0
        ? Math.round(
            (1000 * summary.colonies_managed) / summary.places_with_cats
          ) / 10
        : 0;

    const clusterManagementRate =
      summary.total_clusters > 0
        ? Math.round(
            (1000 * summary.clusters_managed) / summary.total_clusters
          ) / 10
        : 0;

    // Get top priority clusters (needs attention with most cats)
    const priorityClusters = await queryRows<{
      cluster_id: number;
      place_count: number;
      total_verified_cats: number;
      centroid_lat: number;
      centroid_lng: number;
    }>(`
      SELECT
        cluster_id,
        place_count,
        total_verified_cats,
        centroid_lat,
        centroid_lng
      FROM ops.v_beacon_cluster_summary
      WHERE cluster_status IN ('needs_attention', 'needs_work')
      ORDER BY total_verified_cats DESC
      LIMIT 5
    `, []);

    return NextResponse.json({
      summary,
      insights: {
        managed_percentage: managedPercentage,
        cluster_management_rate: clusterManagementRate,
        priority_clusters: priorityClusters,
        tnr_target_rate: 75, // Scientific target (Levy et al.)
        progress_to_target:
          summary.overall_alteration_rate !== null
            ? Math.round((1000 * summary.overall_alteration_rate) / 75) / 10
            : null,
      },
      meta: {
        calculation_method: "lower_bound_alteration",
        scientific_basis: "Levy et al. JAVMA 2005 - 71-94% threshold",
        clustering_algorithm: "DBSCAN (200m radius, min 2 points)",
        data_sources: [
          "clinic_records (ground truth)",
          "trapper_site_visits",
          "trapping_requests",
          "intake_forms",
        ],
      },
    });
  } catch (error) {
    console.error("Error fetching Beacon summary:", error);

    // Check if it's a "relation does not exist" error
    const errorMessage = String(error);
    if (errorMessage.includes("does not exist") || errorMessage.includes("relation")) {
      return NextResponse.json({
        error: "Beacon database views not found",
        details: errorMessage,
        hint: "Run: ./scripts/deploy-critical-migrations.sh",
        health_check: "/api/beacon/health",
      }, { status: 503 });
    }

    return NextResponse.json({
      error: "Failed to fetch Beacon summary",
      details: errorMessage,
      health_check: "/api/health/db",
    }, { status: 500 });
  }
}
