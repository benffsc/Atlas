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
    // Check if required views exist before querying (V2 views are in ops schema)
    const viewCheck = await queryOne<{ summary_exists: boolean; cluster_summary_exists: boolean }>(`
      SELECT
        EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_summary') as summary_exists,
        EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_cluster_summary') as cluster_summary_exists
    `, []);

    if (!viewCheck?.summary_exists || !viewCheck?.cluster_summary_exists) {
      const missing = [];
      if (!viewCheck?.summary_exists) missing.push("v_beacon_summary (MIG_2082)");
      if (!viewCheck?.cluster_summary_exists) missing.push("v_beacon_cluster_summary (MIG_2082)");

      return NextResponse.json({
        error: "Beacon views not deployed",
        missing,
        hint: "Run V2 beacon migrations: MIG_2082__beacon_views_implementation.sql",
        migrations_needed: [
          "MIG_2082__beacon_views_implementation.sql",
        ],
        health_check: "/api/beacon/health",
      }, { status: 503 });
    }

    // Fetch summary data from V2 views (column names differ from V1)
    const [placeSummary, clusterSummary, workRemaining] = await Promise.all([
      // Place-level summary - V2 column mapping
      queryOne<{
        total_cats: number;
        total_places: number;
        cats_with_places: number;
        altered_cats: number;
        alteration_rate_pct: number;
        total_zones: number;
        active_zones: number;
        estimated_colonies: number;
        estimated_unfixed_cats: number;
        high_priority_zones: number;
      }>(`SELECT
        total_cats,
        total_places,
        cats_with_places,
        altered_cats,
        alteration_rate_pct,
        total_zones,
        active_zones,
        estimated_colonies,
        estimated_unfixed_cats,
        high_priority_zones
      FROM ops.v_beacon_summary`, []),

      // Cluster-level summary - V2 uses zones instead of clusters
      queryOne<{
        total_zones: number;
        places_in_zones: number;
        cats_in_zones: number;
        altered_in_zones: number;
        zones_managed: number;
        zones_in_progress: number;
        zones_needs_work: number;
        zones_needs_attention: number;
      }>(`SELECT
        COUNT(*)::INT as total_zones,
        COALESCE(SUM(place_count), 0)::INT as places_in_zones,
        COALESCE(SUM(cat_count), 0)::INT as cats_in_zones,
        COALESCE(SUM(altered_cat_count), 0)::INT as altered_in_zones,
        COUNT(*) FILTER (WHERE cluster_status = 'managed')::INT as zones_managed,
        COUNT(*) FILTER (WHERE cluster_status = 'in_progress')::INT as zones_in_progress,
        COUNT(*) FILTER (WHERE cluster_status = 'needs_work')::INT as zones_needs_work,
        COUNT(*) FILTER (WHERE cluster_status = 'needs_attention')::INT as zones_needs_attention
      FROM ops.v_beacon_cluster_summary`, []),

      // Work remaining estimate
      queryOne<{ estimated_to_alter: number }>(`
        SELECT COALESCE(estimated_unfixed_cats, 0)::INT as estimated_to_alter
        FROM ops.v_beacon_summary
      `, []),
    ]);

    const summary: BeaconDashboardSummary = {
      // Overall metrics (V2 column mapping)
      total_cats: placeSummary?.total_cats || 0,
      total_places: placeSummary?.total_places || 0,
      places_with_cats: placeSummary?.cats_with_places || 0,

      // Alteration metrics (V2: uses altered_cats and alteration_rate_pct)
      total_verified_cats: placeSummary?.total_cats || 0, // V2: total_cats is verified
      total_altered_cats: placeSummary?.altered_cats || 0,
      overall_alteration_rate: placeSummary?.alteration_rate_pct || null,

      // Colony status breakdown (V2: uses zones terminology)
      colonies_managed: clusterSummary?.zones_managed || 0,
      colonies_in_progress: clusterSummary?.zones_in_progress || 0,
      colonies_needs_work: clusterSummary?.zones_needs_work || 0,
      colonies_needs_attention: clusterSummary?.zones_needs_attention || 0,
      colonies_no_data: (placeSummary?.total_zones || 0) - (clusterSummary?.total_zones || 0),

      // Cluster metrics (V2: uses zones)
      total_clusters: clusterSummary?.total_zones || 0,
      places_in_clusters: clusterSummary?.places_in_zones || 0,
      isolated_places: (placeSummary?.total_places || 0) - (clusterSummary?.places_in_zones || 0),
      clusters_managed: clusterSummary?.zones_managed || 0,
      clusters_in_progress: clusterSummary?.zones_in_progress || 0,
      clusters_needs_work: clusterSummary?.zones_needs_work || 0,
      clusters_needs_attention: clusterSummary?.zones_needs_attention || 0,

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

    // Get top priority zones (needs attention with most cats) - V2 uses zones
    const priorityClusters = await queryRows<{
      zone_id: string;
      cluster_name: string;
      place_count: number;
      cat_count: number;
      alteration_rate: number;
    }>(`
      SELECT
        zone_id,
        cluster_name,
        place_count::INT,
        cat_count::INT,
        alteration_rate
      FROM ops.v_beacon_cluster_summary
      WHERE cluster_status IN ('needs_attention', 'needs_work')
      ORDER BY cat_count DESC
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
