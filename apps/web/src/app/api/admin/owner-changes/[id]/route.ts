// API route for handling owner change actions
// POST /api/admin/owner-changes/[id]

import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

interface ActionRequest {
  action: "transfer" | "merge" | "keep_both" | "reject";
  reason?: string;
}

interface ActionResult {
  success: boolean;
  action: string;
  relationships_deleted?: number;
  relationships_created?: number;
  cats_transferred?: number;
  person_updated?: string;
  notes?: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params;

  if (!reviewId) {
    return apiBadRequest("Review ID is required");
  }

  try {
    const body: ActionRequest = await request.json();

    if (!body.action || !["transfer", "merge", "keep_both", "reject"].includes(body.action)) {
      return apiBadRequest("Invalid action. Must be: transfer, merge, keep_both, or reject");
    }

    // Call the SQL function we created in MIG_2504
    const result = await queryOne<{ apply_owner_change: ActionResult }>(
      `SELECT ops.apply_owner_change($1, $2, $3, NULL) as apply_owner_change`,
      [reviewId, body.action, body.reason || null]
    );

    if (!result) {
      return apiServerError("Failed to apply owner change");
    }

    const actionResult = result.apply_owner_change;

    if (!actionResult.success) {
      return apiBadRequest(actionResult.error || "Action failed");
    }

    return apiSuccess({
      message: `Owner change ${body.action} successful`,
      result: actionResult,
    });
  } catch (error) {
    console.error("Error applying owner change:", error);
    return apiServerError(error instanceof Error ? error.message : "Unknown error");
  }
}
