import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface PlaceNeedingClassification {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  current_classification: string | null;
  suggested_classification: string;
  avg_confidence: number;
  request_count: number;
  agreement_count: number;
  most_recent_request_id: string;
  most_recent_at: string;
  signals_sample: Record<string, unknown> | null;
}

interface ClassificationStats {
  pending_places: number;
  pending_requests: number;
  auto_applied_today: number;
  by_classification: Record<string, number>;
}

// GET: Fetch places needing classification review
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filter = searchParams.get("filter") || "all"; // all, high_confidence, low_confidence, conflicting
  const classification = searchParams.get("classification"); // filter by suggested classification
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Get stats
    const statsResult = await queryOne<{
      pending_places: number;
      pending_requests: number;
      auto_applied_today: number;
    }>(`
      SELECT
        (SELECT COUNT(DISTINCT place_id) FROM ops.v_places_needing_classification) AS pending_places,
        (SELECT COUNT(*) FROM ops.requests WHERE classification_disposition = 'pending') AS pending_requests,
        (SELECT COUNT(*) FROM ops.requests
         WHERE classification_disposition = 'accepted'
         AND classification_reviewed_at >= CURRENT_DATE
         AND classification_reviewed_by = 'auto_backfill') AS auto_applied_today
    `);

    // Get classification breakdown
    const breakdownResult = await queryRows<{ classification: string; count: number }>(`
      SELECT suggested_classification AS classification, COUNT(*) AS count
      FROM ops.v_places_needing_classification
      GROUP BY 1
      ORDER BY count DESC
    `);

    const byClassification: Record<string, number> = {};
    for (const row of breakdownResult) {
      byClassification[row.classification] = Number(row.count);
    }

    // Build filter conditions
    let filterCondition = "";
    if (filter === "high_confidence") {
      filterCondition = "AND avg_confidence >= 0.8";
    } else if (filter === "low_confidence") {
      filterCondition = "AND avg_confidence < 0.6";
    } else if (filter === "conflicting") {
      filterCondition = "AND agreement_count < request_count";
    }

    if (classification) {
      filterCondition += ` AND suggested_classification = '${classification}'`;
    }

    // Get places needing review
    const places = await queryRows<PlaceNeedingClassification>(`
      SELECT
        pnc.place_id,
        pnc.formatted_address,
        pnc.display_name,
        pnc.current_classification,
        pnc.suggested_classification,
        pnc.avg_confidence,
        pnc.request_count,
        pnc.agreement_count,
        pnc.most_recent_request_id,
        pnc.most_recent_at,
        -- Get signals from most recent request
        (SELECT r.classification_signals
         FROM ops.requests r
         WHERE r.request_id = pnc.most_recent_request_id) AS signals_sample
      FROM ops.v_places_needing_classification pnc
      WHERE 1=1 ${filterCondition}
      ORDER BY
        pnc.avg_confidence DESC,
        pnc.request_count DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const stats: ClassificationStats = {
      pending_places: Number(statsResult?.pending_places || 0),
      pending_requests: Number(statsResult?.pending_requests || 0),
      auto_applied_today: Number(statsResult?.auto_applied_today || 0),
      by_classification: byClassification,
    };

    return NextResponse.json({
      places,
      stats,
      pagination: {
        limit,
        offset,
        hasMore: places.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching classification review queue:", error);
    return NextResponse.json(
      { error: "Failed to fetch classification review queue" },
      { status: 500 }
    );
  }
}

// POST: Bulk actions on classifications
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, place_ids, classification, reason } = body;

    if (!action || !["accept_all", "apply_classification"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    if (!place_ids || !Array.isArray(place_ids) || place_ids.length === 0) {
      return NextResponse.json(
        { error: "place_ids array required" },
        { status: 400 }
      );
    }

    let updated = 0;

    if (action === "accept_all") {
      // Accept the suggested classification for all selected places
      for (const placeId of place_ids) {
        // Get the most recent pending request for this place
        const request = await queryOne<{ request_id: string }>(`
          SELECT r.request_id
          FROM ops.requests r
          WHERE r.place_id = $1
            AND r.classification_disposition = 'pending'
          ORDER BY r.created_at DESC
          LIMIT 1
        `, [placeId]);

        if (request) {
          await queryOne(
            `SELECT trapper.accept_classification_suggestion($1, $2)`,
            [request.request_id, "admin_bulk"]
          );
          updated++;
        }
      }
    } else if (action === "apply_classification") {
      // Apply a specific classification to all selected places
      if (!classification) {
        return NextResponse.json(
          { error: "classification required for apply_classification action" },
          { status: 400 }
        );
      }

      for (const placeId of place_ids) {
        // Get the most recent pending request for this place
        const request = await queryOne<{ request_id: string }>(`
          SELECT r.request_id
          FROM ops.requests r
          WHERE r.place_id = $1
            AND r.classification_disposition = 'pending'
          ORDER BY r.created_at DESC
          LIMIT 1
        `, [placeId]);

        if (request) {
          await queryOne(
            `SELECT trapper.override_classification_suggestion($1, $2, $3, $4, $5)`,
            [request.request_id, classification, reason || "Bulk admin action", "admin_bulk", null]
          );
          updated++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      updated,
    });
  } catch (error) {
    console.error("Error processing bulk classification action:", error);
    return NextResponse.json(
      { error: "Failed to process bulk action" },
      { status: 500 }
    );
  }
}
