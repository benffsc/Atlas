import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";

interface PlaceNeedingReconciliation {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  colony_classification: string | null;
  authoritative_cat_count: number | null;
  total_cats: number;
  current_cats: number;
  uncertain_cats: number;
  likely_departed: number;
  unconfirmed_cats: number;
  altered_cats: number;
  most_recent_observation: string | null;
  has_count_mismatch: boolean;
  has_uncertain_cats: boolean;
  has_likely_departed: boolean;
  reconciliation_priority: number;
}

interface Stats {
  total_places: number;
  with_uncertain: number;
  with_mismatch: number;
  with_departed: number;
  total_unconfirmed_cats: number;
}

// GET: Fetch places needing cat presence reconciliation
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");
  const classification = searchParams.get("classification");
  const hasMismatch = searchParams.get("has_mismatch") === "true";
  const hasUncertain = searchParams.get("has_uncertain") === "true";

  try {
    let whereClause = "1=1";
    const params: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (classification && classification !== "all") {
      whereClause += ` AND colony_classification = $${paramIndex}`;
      params.push(classification);
      paramIndex++;
    }

    if (hasMismatch) {
      whereClause += ` AND has_count_mismatch = TRUE`;
    }

    if (hasUncertain) {
      whereClause += ` AND uncertain_cats > 0`;
    }

    const places = await queryRows<PlaceNeedingReconciliation>(
      `SELECT
        place_id,
        formatted_address,
        display_name,
        colony_classification,
        authoritative_cat_count,
        total_cats,
        current_cats,
        uncertain_cats,
        likely_departed,
        unconfirmed_cats,
        altered_cats,
        most_recent_observation::TEXT,
        has_count_mismatch,
        has_uncertain_cats,
        has_likely_departed,
        reconciliation_priority
      FROM ops.v_places_needing_cat_reconciliation
      WHERE ${whereClause}
      ORDER BY reconciliation_priority DESC, uncertain_cats DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    // Get stats
    const stats = await queryOne<Stats>(
      `SELECT
        COUNT(*) AS total_places,
        COUNT(*) FILTER (WHERE uncertain_cats > 0) AS with_uncertain,
        COUNT(*) FILTER (WHERE has_count_mismatch) AS with_mismatch,
        COUNT(*) FILTER (WHERE likely_departed > 0) AS with_departed,
        SUM(unconfirmed_cats) AS total_unconfirmed_cats
      FROM ops.v_places_needing_cat_reconciliation`
    );

    // Get classification distribution
    const classificationDist = await queryRows<{
      colony_classification: string;
      count: number;
    }>(
      `SELECT
        COALESCE(colony_classification, 'unknown') AS colony_classification,
        COUNT(*) AS count
      FROM ops.v_places_needing_cat_reconciliation
      GROUP BY colony_classification
      ORDER BY count DESC`
    );

    return NextResponse.json({
      places,
      stats: {
        ...stats,
        total_unconfirmed_cats: Number(stats?.total_unconfirmed_cats || 0),
      },
      classification_distribution: classificationDist,
      pagination: {
        limit,
        offset,
        has_more: places.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching places needing reconciliation:", error);
    return NextResponse.json(
      { error: "Failed to fetch places needing reconciliation" },
      { status: 500 }
    );
  }
}

// POST: Bulk action on multiple places
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, place_ids, confirmed_by = "staff" } = body;

    if (!action) {
      return NextResponse.json(
        { error: "action is required" },
        { status: 400 }
      );
    }

    if (action === "mark_all_old_departed") {
      // Mark all cats not seen in 36+ months as departed across specified places
      if (!place_ids || !Array.isArray(place_ids) || place_ids.length === 0) {
        return NextResponse.json(
          { error: "place_ids array is required for this action" },
          { status: 400 }
        );
      }

      const result = await query(
        `UPDATE sot.cat_place_relationships
         SET
           presence_status = 'departed',
           departure_reason = 'unknown',
           presence_confirmed_at = NOW(),
           presence_confirmed_by = $2
         WHERE place_id = ANY($1)
           AND (presence_status = 'unknown' OR presence_status IS NULL)
           AND (last_observed_at IS NULL OR last_observed_at < CURRENT_DATE - INTERVAL '36 months')
         RETURNING cat_id, place_id`,
        [place_ids, confirmed_by]
      );

      return NextResponse.json({
        success: true,
        action: "mark_all_old_departed",
        updated_count: result.rowCount,
        places_affected: place_ids.length,
      });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error performing bulk action:", error);
    return NextResponse.json(
      { error: "Failed to perform bulk action" },
      { status: 500 }
    );
  }
}
