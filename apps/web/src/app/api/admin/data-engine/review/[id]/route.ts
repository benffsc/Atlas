import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest, apiError } from "@/lib/api-response";

/**
 * Data Engine Review Resolution API
 *
 * POST: Resolve a pending identity review
 */

interface ResolveResult {
  success: boolean;
  decision_id: string;
  action: string;
  resolved_by: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "review");
    const body = await request.json();
    const { action, notes } = body;

    if (!action) {
      return apiBadRequest("action is required (merge, keep_separate, add_to_household, reject)");
    }

    const validActions = ["merge", "keep_separate", "add_to_household", "reject"];
    if (!validActions.includes(action)) {
      return apiBadRequest(`Invalid action. Must be one of: ${validActions.join(", ")}`);
    }

    // Call the resolution function
    const result = await queryOne<{ result: ResolveResult }>(`
      SELECT sot.data_engine_resolve_review($1::uuid, $2, $3, $4) as result
    `, [id, action, "api_user", notes || null]);

    if (!result?.result) {
      return apiServerError("Failed to resolve review");
    }

    return apiSuccess(result.result);
  } catch (error) {
    console.error("Error resolving review:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Check for specific error messages
    if (errorMessage.includes("Decision not found")) {
      return apiNotFound("Decision", id);
    }
    if (errorMessage.includes("already resolved")) {
      return apiError("Decision already resolved", 409);
    }

    return apiServerError(errorMessage);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "review");
    const decision = await queryOne<{
      decision_id: string;
      source_system: string;
      incoming_email: string | null;
      incoming_phone: string | null;
      incoming_name: string | null;
      incoming_address: string | null;
      candidates_evaluated: number;
      top_candidate_person_id: string | null;
      top_candidate_name: string | null;
      top_candidate_score: number;
      decision_type: string;
      decision_reason: string | null;
      resulting_person_id: string | null;
      resulting_name: string | null;
      score_breakdown: Record<string, number> | null;
      rules_applied: string[] | null;
      processed_at: string;
      review_status: string;
      reviewed_by: string | null;
      reviewed_at: string | null;
      review_notes: string | null;
      review_action: string | null;
    }>(`
      SELECT
        d.decision_id::text,
        d.source_system,
        d.incoming_email,
        d.incoming_phone,
        d.incoming_name,
        d.incoming_address,
        d.candidates_evaluated,
        d.top_candidate_person_id::text,
        top_p.display_name as top_candidate_name,
        COALESCE(d.top_candidate_score, 0)::numeric as top_candidate_score,
        d.decision_type,
        d.decision_reason,
        d.resulting_person_id::text,
        res_p.display_name as resulting_name,
        d.score_breakdown,
        d.rules_applied,
        d.processed_at::text,
        d.review_status,
        d.reviewed_by,
        d.reviewed_at::text,
        d.review_notes,
        d.review_action
      FROM sot.data_engine_match_decisions d
      LEFT JOIN sot.people top_p ON top_p.person_id = d.top_candidate_person_id
      LEFT JOIN sot.people res_p ON res_p.person_id = d.resulting_person_id
      WHERE d.decision_id = $1::uuid
    `, [id]);

    if (!decision) {
      return apiNotFound("Decision", id);
    }

    return apiSuccess({ decision });
  } catch (error) {
    console.error("Error fetching decision:", error);
    return apiServerError(error instanceof Error ? error.message : "Unknown error");
  }
}
