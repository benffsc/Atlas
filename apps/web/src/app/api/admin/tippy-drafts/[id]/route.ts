import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/tippy-drafts/[id]
 * Get a specific draft request with full context
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await context.params;

    const draft = await queryOne(
      `
      SELECT
        d.draft_id,
        d.created_at,
        d.expires_at,
        d.expires_at < NOW() AS is_expired,
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
        d.conversation_id
      FROM ops.tippy_draft_requests d
      LEFT JOIN sot.places p ON p.place_id = d.place_id
      LEFT JOIN ops.staff s ON s.staff_id = d.created_by_staff_id
      LEFT JOIN ops.staff rb ON rb.staff_id = d.reviewed_by
      WHERE d.draft_id = $1
      `,
      [id]
    );

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    return NextResponse.json({ draft });
  } catch (error) {
    console.error("Get draft error:", error);
    return NextResponse.json(
      { error: "Failed to fetch draft" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/tippy-drafts/[id]
 * Approve or reject a draft request
 * Body: { action: "approve" | "reject", review_notes?: string, overrides?: { address?, cat_count?, priority? } }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { action, review_notes, overrides } = body;

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    if (action === "approve") {
      // Use the approve function which handles window logic
      const result = await queryOne<{ approve_tippy_draft: string }>(
        `SELECT trapper.approve_tippy_draft($1, $2, $3, $4, $5, $6)`,
        [
          id,
          session.staff_id,
          review_notes || null,
          overrides?.address || null,
          overrides?.cat_count || null,
          overrides?.priority || null,
        ]
      );

      if (!result) {
        return NextResponse.json(
          { error: "Failed to approve draft" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Draft approved and request created",
        request_id: result.approve_tippy_draft,
      });
    } else {
      // Reject the draft
      await queryOne(
        `SELECT trapper.reject_tippy_draft($1, $2, $3)`,
        [id, session.staff_id, review_notes || null]
      );

      return NextResponse.json({
        success: true,
        message: "Draft rejected",
      });
    }
  } catch (error) {
    console.error("Draft action error:", error);
    const message = error instanceof Error ? error.message : "Failed to process draft";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
