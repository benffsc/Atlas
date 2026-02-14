import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/tippy-drafts
 * List Tippy draft requests for coordinator review
 */
export async function GET(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Get drafts using the review queue view for pending, or direct query for others
    const drafts = await queryRows(
      `
      SELECT
        d.draft_id,
        d.created_at,
        d.expires_at,
        d.expires_at < NOW() AS is_expired,
        EXTRACT(EPOCH FROM (d.expires_at - NOW())) / 3600 AS hours_until_expiry,
        d.raw_address,
        d.requester_name,
        d.requester_phone,
        d.requester_email,
        d.estimated_cat_count,
        d.summary,
        d.notes,
        d.has_kittens,
        d.priority,
        d.tippy_reasoning,
        d.place_id,
        p.display_name AS place_name,
        p.formatted_address AS place_address,
        d.place_context,
        d.status,
        d.reviewed_by,
        rb.display_name AS reviewed_by_name,
        d.reviewed_at,
        d.review_notes,
        d.promoted_request_id,
        d.created_by_staff_id,
        s.display_name AS created_by_name,
        d.conversation_id,
        -- Existing place stats (if place exists)
        (SELECT COUNT(*) FROM ops.requests r
         WHERE r.place_id = d.place_id
         AND r.status NOT IN ('cancelled', 'redirected')) AS existing_request_count,
        (SELECT COUNT(*) FROM ops.requests r
         WHERE r.place_id = d.place_id
         AND r.status NOT IN ('completed', 'cancelled', 'redirected', 'partial')) AS active_request_count
      FROM ops.tippy_draft_requests d
      LEFT JOIN sot.places p ON p.place_id = d.place_id
      LEFT JOIN ops.staff s ON s.staff_id = d.created_by_staff_id
      LEFT JOIN ops.staff rb ON rb.staff_id = d.reviewed_by
      WHERE ($1 = 'all' OR d.status = $1)
      ORDER BY
        CASE WHEN d.priority = 'urgent' THEN 0 ELSE 1 END,
        d.expires_at ASC
      LIMIT $2 OFFSET $3
      `,
      [status, limit, offset]
    );

    // Get stats
    const stats = await queryOne(
      `SELECT * FROM ops.v_tippy_draft_stats`
    );

    return NextResponse.json({
      drafts,
      stats,
      pagination: {
        limit,
        offset,
        hasMore: drafts.length === limit,
      },
    });
  } catch (error) {
    console.error("Admin tippy drafts list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch drafts" },
      { status: 500 }
    );
  }
}
