import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface RedirectResult {
  original_request_id: string;
  new_request_id: string;
  redirect_status: string;
}

/**
 * POST /api/requests/[id]/redirect
 *
 * Redirects a request when field conditions change.
 * Creates a new request and links them together with non-overlapping
 * attribution windows to prevent double-counting in Beacon stats.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Require authentication
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id: requestId } = await params;
    const body = await request.json();

    const {
      redirect_reason,
      existing_target_request_id,
      new_address,
      new_place_id,
      new_requester_name,
      new_requester_phone,
      new_requester_email,
      summary,
      notes,
      estimated_cat_count,
      // Kitten assessment fields
      has_kittens,
      kitten_count,
      kitten_age_weeks,
      kitten_assessment_status,
      kitten_assessment_outcome,
      kitten_not_needed_reason,
    } = body;

    // Validate required fields
    if (!redirect_reason) {
      return NextResponse.json(
        { error: "Redirect reason is required" },
        { status: 400 }
      );
    }

    // --- Link to existing request path ---
    if (existing_target_request_id) {
      // Verify target request exists and is in a valid state
      const target = await queryOne<{ request_id: string; status: string }>(
        `SELECT request_id, status::TEXT FROM trapper.sot_requests WHERE request_id = $1`,
        [existing_target_request_id]
      );
      if (!target) {
        return NextResponse.json({ error: "Target request not found" }, { status: 404 });
      }
      if (["cancelled", "redirected", "handed_off"].includes(target.status)) {
        return NextResponse.json(
          { error: "Target request is already closed and cannot be linked to" },
          { status: 400 }
        );
      }

      // Close original + link to existing target
      await queryOne(
        `UPDATE trapper.sot_requests SET
          status = 'redirected',
          redirected_to_request_id = $2,
          redirect_reason = $3,
          redirect_at = NOW(),
          resolved_at = NOW(),
          transfer_type = 'redirect',
          resolution_notes = $4
        WHERE request_id = $1
          AND status NOT IN ('redirected', 'handed_off')`,
        [requestId, existing_target_request_id, redirect_reason, `Redirected to existing request ${existing_target_request_id}`]
      );

      // Link target back (only if it doesn't already have a parent)
      await queryOne(
        `UPDATE trapper.sot_requests SET
          redirected_from_request_id = $1
        WHERE request_id = $2
          AND redirected_from_request_id IS NULL`,
        [requestId, existing_target_request_id]
      );

      // Audit log
      await queryOne(
        `INSERT INTO trapper.entity_edits (entity_type, entity_id, edit_type, field_name, new_value, reason, edited_by)
         VALUES ('request', $1, 'field_update', 'status', to_jsonb('redirected'::TEXT), $2, $3)`,
        [requestId, `Redirected to existing request ${existing_target_request_id}: ${redirect_reason}`, `staff:${session.staff_id}`]
      );

      return NextResponse.json({
        success: true,
        original_request_id: requestId,
        new_request_id: existing_target_request_id,
        redirect_url: `/requests/${existing_target_request_id}`,
      });
    }

    // --- Create new request path (existing behavior) ---
    if (!new_address && !new_place_id) {
      return NextResponse.json(
        { error: "Either new_address or new_place_id is required" },
        { status: 400 }
      );
    }

    // Call the redirect_request function
    const result = await queryOne<RedirectResult>(
      `SELECT * FROM trapper.redirect_request(
        p_original_request_id := $1,
        p_redirect_reason := $2,
        p_new_address := $3,
        p_new_place_id := $4,
        p_new_requester_name := $5,
        p_new_requester_phone := $6,
        p_new_requester_email := $7,
        p_summary := $8,
        p_notes := $9,
        p_estimated_cat_count := $10,
        p_created_by := $11,
        p_has_kittens := $12,
        p_kitten_count := $13,
        p_kitten_age_weeks := $14,
        p_kitten_assessment_status := $15,
        p_kitten_assessment_outcome := $16,
        p_kitten_not_needed_reason := $17
      )`,
      [
        requestId,
        redirect_reason,
        new_address || null,
        new_place_id || null,
        new_requester_name || null,
        new_requester_phone || null,
        new_requester_email || null,
        summary || null,
        notes || null,
        estimated_cat_count || null,
        `staff:${session.staff_id}`,
        has_kittens || false,
        kitten_count || null,
        kitten_age_weeks || null,
        kitten_assessment_status || null,
        kitten_assessment_outcome || null,
        kitten_not_needed_reason || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to redirect request" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      original_request_id: result.original_request_id,
      new_request_id: result.new_request_id,
      redirect_url: `/requests/${result.new_request_id}`,
    });
  } catch (error) {
    console.error("Redirect request error:", error);

    // Handle specific error messages from the function
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }
      if (error.message.includes("already been redirected")) {
        return NextResponse.json(
          { error: "This request has already been redirected" },
          { status: 400 }
        );
      }
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { error: `Failed to redirect request: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to redirect request" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/requests/[id]/redirect
 *
 * Get redirect information for a request (if any)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: requestId } = await params;

    const result = await queryOne<{
      request_id: string;
      status: string;
      redirected_to_request_id: string | null;
      redirected_from_request_id: string | null;
      redirect_reason: string | null;
      redirect_at: string | null;
      to_request_summary: string | null;
      from_request_summary: string | null;
    }>(
      `SELECT
        r.request_id,
        r.status::TEXT,
        r.redirected_to_request_id,
        r.redirected_from_request_id,
        r.redirect_reason,
        r.redirect_at,
        to_req.summary AS to_request_summary,
        from_req.summary AS from_request_summary
      FROM trapper.sot_requests r
      LEFT JOIN trapper.sot_requests to_req ON to_req.request_id = r.redirected_to_request_id
      LEFT JOIN trapper.sot_requests from_req ON from_req.request_id = r.redirected_from_request_id
      WHERE r.request_id = $1`,
      [requestId]
    );

    if (!result) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    return NextResponse.json({
      request_id: result.request_id,
      status: result.status,
      redirect_info: {
        redirected_to: result.redirected_to_request_id
          ? {
              request_id: result.redirected_to_request_id,
              summary: result.to_request_summary,
            }
          : null,
        redirected_from: result.redirected_from_request_id
          ? {
              request_id: result.redirected_from_request_id,
              summary: result.from_request_summary,
            }
          : null,
        redirect_reason: result.redirect_reason,
        redirect_at: result.redirect_at,
      },
    });
  } catch (error) {
    console.error("Get redirect info error:", error);
    return NextResponse.json(
      { error: "Failed to get redirect info" },
      { status: 500 }
    );
  }
}
