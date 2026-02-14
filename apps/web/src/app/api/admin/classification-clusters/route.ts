import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface ClusterPlace {
  place_id: string;
  address: string;
  classification: string;
  colony_id: string | null;
}

interface Cluster {
  cluster_id: string;
  cluster_name: string | null;
  place_count: number;
  unique_classifications: string[];
  dominant_classification: string;
  consistency_score: number;
  recommended_action: string;
  recommended_classification: string | null;
  status: string;
  created_at: string;
  places: ClusterPlace[];
  suggestion_distribution: Record<string, number>;
}

// GET: Fetch clusters for review
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    const clusters = await queryRows<Cluster>(
      `SELECT
        cc.cluster_id,
        cc.cluster_name,
        cc.place_count,
        cc.unique_classifications,
        cc.dominant_classification,
        cc.consistency_score,
        cc.recommended_action,
        cc.recommended_classification,
        cc.status,
        cc.created_at,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'place_id', p.place_id,
            'address', p.formatted_address,
            'classification', COALESCE(p.colony_classification::TEXT, 'unknown'),
            'colony_id', p.colony_id
          ))
          FROM sot.places p
          WHERE p.place_id = ANY(cc.place_ids)
        ) AS places,
        (
          SELECT COALESCE(jsonb_object_agg(
            COALESCE(r.suggested_classification::TEXT, 'none'),
            cnt
          ), '{}'::jsonb)
          FROM (
            SELECT suggested_classification, COUNT(*) as cnt
            FROM ops.requests r
            WHERE r.place_id = ANY(cc.place_ids)
              AND r.suggested_classification IS NOT NULL
            GROUP BY suggested_classification
          ) r
        ) AS suggestion_distribution
      FROM ops.v_beacon_cluster_summary cc
      WHERE cc.status = $1
      ORDER BY cc.consistency_score ASC, cc.place_count DESC
      LIMIT $2`,
      [status, limit]
    );

    // Get summary stats
    const stats = await queryOne<{
      total_pending: number;
      total_reviewed: number;
      total_merged: number;
      avg_consistency: number;
    }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS total_pending,
        COUNT(*) FILTER (WHERE status = 'reviewed') AS total_reviewed,
        COUNT(*) FILTER (WHERE status = 'merged') AS total_merged,
        ROUND(AVG(consistency_score)::numeric, 2) AS avg_consistency
      FROM ops.v_beacon_cluster_summary`
    );

    return NextResponse.json({
      clusters,
      stats,
    });
  } catch (error) {
    console.error("Error fetching clusters:", error);
    return NextResponse.json(
      { error: "Failed to fetch clusters" },
      { status: 500 }
    );
  }
}

// POST: Take action on a cluster
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cluster_id, action, classification, colony_id, notes, reviewed_by } = body;

    if (!cluster_id || !action) {
      return NextResponse.json(
        { error: "cluster_id and action are required" },
        { status: 400 }
      );
    }

    let result;

    switch (action) {
      case "reconcile":
        if (!classification) {
          return NextResponse.json(
            { error: "classification is required for reconcile action" },
            { status: 400 }
          );
        }
        result = await queryOne(
          `SELECT trapper.reconcile_cluster_classification($1, $2, $3) AS success`,
          [cluster_id, classification, reviewed_by || "staff"]
        );
        break;

      case "merge":
        if (!colony_id) {
          return NextResponse.json(
            { error: "colony_id is required for merge action" },
            { status: 400 }
          );
        }
        result = await queryOne(
          `SELECT sot.merge_cluster_to_colony($1, $2, $3) AS success`,
          [cluster_id, colony_id, reviewed_by || "staff"]
        );
        break;

      case "dismiss":
        result = await queryOne(
          `SELECT trapper.dismiss_cluster($1, $2, $3) AS success`,
          [cluster_id, reviewed_by || "staff", notes]
        );
        break;

      case "create_colony_and_merge":
        // Create a new colony and merge the cluster into it
        const clusterData = await queryOne<{ place_ids: string[]; dominant_classification: string }>(
          `SELECT place_ids, dominant_classification FROM ops.v_beacon_cluster_summary WHERE cluster_id = $1`,
          [cluster_id]
        );

        if (!clusterData) {
          return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
        }

        // Get center and first address for naming
        const centerData = await queryOne<{ center_lat: number; center_lng: number; first_address: string }>(
          `SELECT
            AVG(ST_Y(location::geometry)) AS center_lat,
            AVG(ST_X(location::geometry)) AS center_lng,
            (SELECT formatted_address FROM sot.places WHERE place_id = $2 LIMIT 1) AS first_address
          FROM sot.places
          WHERE place_id = ANY($1)`,
          [clusterData.place_ids, clusterData.place_ids[0]]
        );

        // Create colony
        const colonyName = body.colony_name || `Colony at ${centerData?.first_address?.split(",")[0] || "Unknown"}`;
        const newColony = await queryOne<{ colony_id: string }>(
          `INSERT INTO sot.colonies (
            colony_name, center_lat, center_lng, status, created_by
          ) VALUES ($1, $2, $3, 'active', $4)
          RETURNING colony_id`,
          [colonyName, centerData?.center_lat, centerData?.center_lng, reviewed_by || "staff"]
        );

        // Merge cluster to new colony
        result = await queryOne(
          `SELECT sot.merge_cluster_to_colony($1, $2, $3) AS success`,
          [cluster_id, newColony?.colony_id, reviewed_by || "staff"]
        );

        return NextResponse.json({
          success: true,
          action: "create_colony_and_merge",
          colony_id: newColony?.colony_id,
          colony_name: colonyName,
        });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: result?.success ?? true,
      action,
    });
  } catch (error) {
    console.error("Error processing cluster action:", error);
    return NextResponse.json(
      { error: "Failed to process cluster action" },
      { status: 500 }
    );
  }
}
