import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/tippy-signals
 * Unified view of all Tippy signals (feedback, corrections, gaps, drafts)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const signalType = searchParams.get("type") || "all";
    const status = searchParams.get("status") || "needs_attention";
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Map "needs_attention" to the statuses that need action
    const needsAttentionStatuses = ["pending", "proposed", "unresolved"];

    const signals = await queryRows(
      `
      SELECT
        signal_type,
        signal_id,
        created_at,
        status,
        detail_type,
        summary,
        entity_type,
        entity_id,
        reported_by,
        staff_id,
        confidence,
        is_silent,
        -- Entity name lookup
        CASE
          WHEN entity_type = 'place' THEN (SELECT label FROM sot.places WHERE place_id = entity_id)
          WHEN entity_type = 'cat' THEN (SELECT display_name FROM sot.cats WHERE cat_id = entity_id)
          WHEN entity_type = 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = entity_id)
          WHEN entity_type = 'request' THEN (SELECT short_address FROM ops.requests WHERE request_id = entity_id)
          ELSE NULL
        END as entity_name
      FROM ops.v_tippy_all_signals
      WHERE ($1 = 'all' OR signal_type = $1)
        AND (
          $2 = 'all'
          OR ($2 = 'needs_attention' AND status = ANY($5::text[]))
          OR ($2 != 'all' AND $2 != 'needs_attention' AND status = $2)
        )
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
      `,
      [signalType, status, limit, offset, needsAttentionStatuses]
    );

    // Get summary counts
    const summary = await queryRows(
      `SELECT signal_type, total, needs_attention, last_7_days, latest
       FROM ops.v_tippy_signal_summary
       ORDER BY needs_attention DESC`
    );

    // Total needs attention across all types
    const totalNeedsAttention = summary.reduce(
      (sum: number, row: Record<string, unknown>) => sum + (Number(row.needs_attention) || 0),
      0
    );

    return NextResponse.json({
      signals,
      summary,
      total_needs_attention: totalNeedsAttention,
    });
  } catch (error) {
    console.error("Error fetching Tippy signals:", error);
    return NextResponse.json(
      { error: "Failed to fetch signals" },
      { status: 500 }
    );
  }
}
