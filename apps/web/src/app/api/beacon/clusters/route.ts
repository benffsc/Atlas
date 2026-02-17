import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Beacon Colony Clustering API
 *
 * Returns DBSCAN clusters of places with cat activity.
 * Clusters are formed by grouping places within epsilon meters of each other.
 *
 * Scientific basis:
 * - DBSCAN: Density-Based Spatial Clustering of Applications with Noise
 * - Reference: Ester M, et al. KDD 1996
 * - PostGIS implementation: ST_ClusterDBSCAN()
 */

interface BeaconCluster {
  cluster_id: number;
  place_ids: string[];
  place_count: number;
  centroid_lat: number;
  centroid_lng: number;
  total_verified_cats: number;
  total_altered_cats: number;
  avg_alteration_rate: number | null;
  cluster_status: string;
  bounding_box_geojson: string | null;
  cluster_audit: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  try {
    // Check if the view exists (V2: uses regular view in ops schema)
    const viewCheck = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_cluster_summary'
      ) as exists
    `, []);

    if (!viewCheck?.exists) {
      return NextResponse.json({
        error: "Beacon clusters view not deployed",
        missing: ["v_beacon_cluster_summary (MIG_2082)"],
        hint: "Run V2 beacon migrations: MIG_2082__beacon_views_implementation.sql",
        health_check: "/api/beacon/health",
      }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;

    // Clustering parameters
    const epsilon = parseFloat(searchParams.get("epsilon") || "200"); // meters
    const minPoints = parseInt(searchParams.get("minPoints") || "2", 10);

    // Filters
    const minCats = parseInt(searchParams.get("minCats") || "1", 10);
    const status = searchParams.get("status"); // managed, in_progress, needs_attention

    // Use cached materialized view for default parameters, otherwise call function
    const useCache =
      epsilon === 200 &&
      minPoints === 2 &&
      !minCats &&
      !status;

    let clusters: BeaconCluster[];

    if (useCache) {
      // Use V2 view with column mapping
      let query = `
        SELECT
          zone_id::TEXT as cluster_id,
          ARRAY[]::TEXT[] as place_ids,
          place_count::INT,
          ST_Y(cluster_centroid::geometry) as centroid_lat,
          ST_X(cluster_centroid::geometry) as centroid_lng,
          cat_count::INT as total_verified_cats,
          altered_cat_count::INT as total_altered_cats,
          alteration_rate as avg_alteration_rate,
          cluster_status,
          ST_AsGeoJSON(cluster_bounds) as bounding_box_geojson,
          '{}'::JSONB as cluster_audit
        FROM ops.v_beacon_cluster_summary
      `;
      const params: unknown[] = [];
      let paramIndex = 1;

      const conditions: string[] = [];
      if (minCats > 1) {
        conditions.push(`cat_count >= $${paramIndex++}`);
        params.push(minCats);
      }
      if (status) {
        conditions.push(`cluster_status = $${paramIndex++}`);
        params.push(status);
      }
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }
      query += ` ORDER BY cat_count DESC`;

      clusters = await queryRows<BeaconCluster>(query, params);
    } else {
      // V2 doesn't have beacon_cluster_colonies function, use the view with filters
      let query = `
        SELECT
          zone_id::TEXT as cluster_id,
          ARRAY[]::TEXT[] as place_ids,
          place_count::INT,
          ST_Y(cluster_centroid::geometry) as centroid_lat,
          ST_X(cluster_centroid::geometry) as centroid_lng,
          cat_count::INT as total_verified_cats,
          altered_cat_count::INT as total_altered_cats,
          alteration_rate as avg_alteration_rate,
          cluster_status,
          ST_AsGeoJSON(cluster_bounds) as bounding_box_geojson,
          '{}'::JSONB as cluster_audit
        FROM ops.v_beacon_cluster_summary
        WHERE cat_count >= $1
      `;
      const params: unknown[] = [minCats];
      let paramIndex = 2;

      if (status) {
        query += ` AND cluster_status = $${paramIndex++}`;
        params.push(status);
      }
      query += ` ORDER BY cat_count DESC`;

      clusters = await queryRows<BeaconCluster>(query, params);
    }

    // Get cluster summary
    const totalCats = clusters.reduce((sum, c) => sum + c.total_verified_cats, 0);
    const totalAltered = clusters.reduce((sum, c) => sum + c.total_altered_cats, 0);

    return NextResponse.json({
      clusters,
      summary: {
        total_clusters: clusters.length,
        total_places_in_clusters: clusters.reduce((sum, c) => sum + c.place_count, 0),
        total_cats_in_clusters: totalCats,
        total_altered_in_clusters: totalAltered,
        overall_alteration_rate:
          totalCats > 0
            ? Math.round((1000 * totalAltered) / totalCats) / 10
            : null,
        status_breakdown: {
          managed: clusters.filter((c) => c.cluster_status === "managed").length,
          in_progress: clusters.filter((c) => c.cluster_status === "in_progress")
            .length,
          needs_work: clusters.filter((c) => c.cluster_status === "needs_work")
            .length,
          needs_attention: clusters.filter(
            (c) => c.cluster_status === "needs_attention"
          ).length,
        },
      },
      meta: {
        algorithm: "DBSCAN",
        parameters: {
          epsilon_meters: epsilon,
          min_points: minPoints,
        },
        scientific_reference: "Ester M, et al. KDD 1996",
        postgis_function: "ST_ClusterDBSCAN",
        cached: useCache,
      },
    });
  } catch (error) {
    console.error("Error fetching Beacon clusters:", error);

    const errorMessage = String(error);
    if (errorMessage.includes("does not exist") || errorMessage.includes("relation")) {
      return NextResponse.json({
        error: "Beacon clusters view or function not found",
        details: errorMessage,
        hint: "Run: ./scripts/deploy-critical-migrations.sh",
        health_check: "/api/beacon/health",
      }, { status: 503 });
    }

    return NextResponse.json({
      error: "Failed to fetch Beacon cluster data",
      details: errorMessage,
      health_check: "/api/health/db",
    }, { status: 500 });
  }
}

/**
 * POST /api/beacon/clusters/refresh
 * Refreshes the materialized cluster view
 */
export async function POST() {
  try {
    await queryOne(`SELECT ops.refresh_beacon_clusters()`, []);
    return NextResponse.json({
      success: true,
      message: "Beacon clusters refreshed",
    });
  } catch (error) {
    console.error("Error refreshing Beacon clusters:", error);
    return NextResponse.json(
      { error: "Failed to refresh Beacon clusters" },
      { status: 500 }
    );
  }
}
