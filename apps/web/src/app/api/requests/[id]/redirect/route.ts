import { NextRequest } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError, requireValidUUID } from "@/lib/api-validation";

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
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const session = await getSession(request);
  if (!session) {
    throw new ApiError("Authentication required", 401);
  }

  const { id: requestId } = await params;
  requireValidUUID(requestId, "request");
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
    has_kittens,
    kitten_count,
    kitten_age_weeks,
    kitten_assessment_status,
    kitten_assessment_outcome,
    kitten_not_needed_reason,
  } = body;

  if (!redirect_reason) {
    throw new ApiError("Redirect reason is required", 400);
  }

  // --- Link to existing request path ---
  if (existing_target_request_id) {
    await withTransaction(async (tx) => {
      const target = await tx.queryOne<{ request_id: string; status: string }>(
        `SELECT request_id, status::TEXT FROM ops.requests WHERE request_id = $1`,
        [existing_target_request_id]
      );
      if (!target) {
        throw new ApiError(`Request with ID ${existing_target_request_id} not found`, 404);
      }
      if (["cancelled", "redirected", "handed_off"].includes(target.status)) {
        throw new ApiError("Target request is already closed and cannot be linked to", 400);
      }

      // Close original + link to existing target
      await tx.query(
        `UPDATE ops.requests SET
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

      // Link target back
      await tx.query(
        `UPDATE ops.requests SET
          redirected_from_request_id = $1
        WHERE request_id = $2
          AND redirected_from_request_id IS NULL`,
        [requestId, existing_target_request_id]
      );

      // Audit log
      await tx.query(
        `INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, field_name, new_value, reason, edited_by)
         VALUES ('request', $1, 'field_update', 'status', to_jsonb('redirected'::TEXT), $2, $3)`,
        [requestId, `Redirected to existing request ${existing_target_request_id}: ${redirect_reason}`, `staff:${session.staff_id}`]
      );
    });

    return apiSuccess({
      original_request_id: requestId,
      new_request_id: existing_target_request_id,
      redirect_url: `/requests/${existing_target_request_id}`,
    });
  }

  // --- Create new request path ---
  if (!new_address && !new_place_id) {
    throw new ApiError("Either new_address or new_place_id is required", 400);
  }

  const result = await queryOne<RedirectResult>(
    `SELECT * FROM ops.redirect_request(
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
      estimated_cat_count ?? null,
      `staff:${session.staff_id}`,
      has_kittens ?? false,
      kitten_count ?? null,
      kitten_age_weeks ?? null,
      kitten_assessment_status || null,
      kitten_assessment_outcome || null,
      kitten_not_needed_reason || null,
    ]
  );

  if (!result) {
    throw new ApiError("Failed to redirect request", 500);
  }

  return apiSuccess({
    original_request_id: result.original_request_id,
    new_request_id: result.new_request_id,
    redirect_url: `/requests/${result.new_request_id}`,
  });
});

/**
 * GET /api/requests/[id]/redirect
 *
 * Get redirect information for a request (if any)
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: requestId } = await params;
  requireValidUUID(requestId, "request");

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
    FROM ops.requests r
    LEFT JOIN ops.requests to_req ON to_req.request_id = r.redirected_to_request_id
    LEFT JOIN ops.requests from_req ON from_req.request_id = r.redirected_from_request_id
    WHERE r.request_id = $1`,
    [requestId]
  );

  if (!result) {
    throw new ApiError(`Request with ID ${requestId} not found`, 404);
  }

  return apiSuccess({
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
});
