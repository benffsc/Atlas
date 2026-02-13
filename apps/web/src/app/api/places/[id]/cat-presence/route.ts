import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";

interface CatPresence {
  cat_place_id: string;
  cat_id: string;
  cat_name: string;
  altered_status: string | null;
  relationship_type: string;
  last_observed_at: string | null;
  explicit_status: string;
  effective_status: string;
  inferred_status: string;
  presence_confirmed_at: string | null;
  presence_confirmed_by: string | null;
  departure_reason: string | null;
  reactivation_reason: string | null;
  has_observation: boolean;
  days_since_observed: number | null;
  altered_date: string | null;
  is_altered: boolean;
}

interface ReconciliationSummary {
  total_cats: number;
  current_cats: number;
  uncertain_cats: number;
  departed_cats: number;
  unconfirmed_cats: number;
  needs_reconciliation: boolean;
  authoritative_cat_count: number | null;
  has_count_mismatch: boolean;
}

// GET: Fetch cat presence data for a place
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  if (!placeId) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    // Get cats with presence status
    const cats = await queryRows<CatPresence>(
      `SELECT
        cat_place_id,
        cat_id,
        cat_name,
        altered_status,
        relationship_type,
        last_observed_at::TEXT,
        explicit_status,
        effective_status,
        inferred_status,
        presence_confirmed_at::TEXT,
        presence_confirmed_by,
        departure_reason,
        reactivation_reason,
        has_observation,
        days_since_observed,
        altered_date::TEXT,
        is_altered
      FROM sot.v_cat_place_presence
      WHERE place_id = $1
      ORDER BY
        CASE effective_status
          WHEN 'current' THEN 1
          WHEN 'uncertain' THEN 2
          WHEN 'unknown' THEN 3
          WHEN 'departed' THEN 4
        END,
        last_observed_at DESC NULLS LAST`,
      [placeId]
    );

    // Get place info for summary
    const placeInfo = await queryOne<{
      authoritative_cat_count: number | null;
      colony_classification: string | null;
    }>(
      `SELECT authoritative_cat_count, colony_classification::TEXT
       FROM sot.places
       WHERE place_id = $1`,
      [placeId]
    );

    // Calculate summary
    const summary: ReconciliationSummary = {
      total_cats: cats.length,
      current_cats: cats.filter((c) => c.effective_status === "current").length,
      uncertain_cats: cats.filter((c) => c.effective_status === "uncertain")
        .length,
      departed_cats: cats.filter((c) => c.effective_status === "departed")
        .length,
      unconfirmed_cats: cats.filter(
        (c) => c.explicit_status === "unknown" || !c.explicit_status
      ).length,
      authoritative_cat_count: placeInfo?.authoritative_cat_count ?? null,
      has_count_mismatch:
        placeInfo?.authoritative_cat_count != null &&
        placeInfo.authoritative_cat_count !==
          cats.filter((c) => c.effective_status === "current").length,
      needs_reconciliation: false,
    };

    // Determine if reconciliation is needed
    summary.needs_reconciliation =
      summary.uncertain_cats > 0 ||
      summary.has_count_mismatch ||
      (summary.departed_cats > 0 &&
        cats.some(
          (c) =>
            c.effective_status === "departed" &&
            (c.explicit_status === "unknown" || !c.explicit_status)
        ));

    return NextResponse.json({
      cats,
      summary,
      classification: placeInfo?.colony_classification ?? "unknown",
    });
  } catch (error) {
    console.error("Error fetching cat presence:", error);
    return NextResponse.json(
      { error: "Failed to fetch cat presence data" },
      { status: 500 }
    );
  }
}

// POST: Update presence status for cats
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  if (!placeId) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { updates, confirmed_by = "staff" } = body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: "Updates array is required" },
        { status: 400 }
      );
    }

    const results: { cat_id: string; success: boolean; error?: string }[] = [];

    for (const update of updates) {
      const { cat_id, presence_status, departure_reason } = update;

      if (!cat_id || !presence_status) {
        results.push({
          cat_id: cat_id || "unknown",
          success: false,
          error: "cat_id and presence_status are required",
        });
        continue;
      }

      try {
        const result = await queryOne<{ update_cat_presence: boolean }>(
          `SELECT trapper.update_cat_presence($1, $2, $3, $4, $5) AS update_cat_presence`,
          [cat_id, placeId, presence_status, departure_reason || null, confirmed_by]
        );

        results.push({
          cat_id,
          success: result?.update_cat_presence ?? false,
        });
      } catch (err) {
        results.push({
          cat_id,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const allSucceeded = results.every((r) => r.success);

    return NextResponse.json({
      success: allSucceeded,
      results,
    });
  } catch (error) {
    console.error("Error updating cat presence:", error);
    return NextResponse.json(
      { error: "Failed to update cat presence" },
      { status: 500 }
    );
  }
}

// Bulk action: Mark all old cats as departed
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  if (!placeId) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { action, confirmed_by = "staff" } = body;

    if (action === "mark_old_as_departed") {
      // Mark all cats not seen in 36+ months as departed
      const result = await query(
        `UPDATE sot.cat_place_relationships
         SET
           presence_status = 'departed',
           departure_reason = 'unknown',
           presence_confirmed_at = NOW(),
           presence_confirmed_by = $2
         WHERE place_id = $1
           AND (presence_status = 'unknown' OR presence_status IS NULL)
           AND (last_observed_at IS NULL OR last_observed_at < CURRENT_DATE - INTERVAL '36 months')
         RETURNING cat_id`,
        [placeId, confirmed_by]
      );

      return NextResponse.json({
        success: true,
        action: "mark_old_as_departed",
        updated_count: result.rowCount,
      });
    }

    if (action === "dismiss") {
      // Mark all unconfirmed cats as having been reviewed (no change needed)
      // This just acknowledges that staff looked at them
      return NextResponse.json({
        success: true,
        action: "dismiss",
        message: "Reconciliation dismissed for now",
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
