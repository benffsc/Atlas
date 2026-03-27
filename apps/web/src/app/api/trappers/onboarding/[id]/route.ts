import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

// PATCH - Advance onboarding status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "trapper");
    const body = await request.json();
    const { new_status, notes, advanced_by } = body;

    if (!new_status) {
      return apiBadRequest("new_status is required");
    }

    // Valid statuses
    const validStatuses = [
      "interested",
      "contacted",
      "orientation_scheduled",
      "orientation_complete",
      "training_scheduled",
      "training_complete",
      "contract_sent",
      "contract_signed",
      "approved",
      "declined",
      "withdrawn",
      "on_hold",
    ];

    if (!validStatuses.includes(new_status)) {
      return apiBadRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }

    // Advance using centralized function
    const result = await queryOne<{
      onboarding_id: string;
      previous_status: string;
      new_status: string;
      person_created: boolean;
    }>(`
      SELECT * FROM ops.advance_trapper_onboarding(
        p_person_id := $1::UUID,
        p_new_status := $2,
        p_notes := $3,
        p_advanced_by := $4
      )
    `, [
      id,
      new_status,
      notes || null,
      advanced_by || "web_user",
    ]);

    if (!result) {
      return apiServerError("Failed to advance onboarding");
    }

    return apiSuccess({
      success: true,
      onboarding_id: result.onboarding_id,
      previous_status: result.previous_status,
      new_status: result.new_status,
      person_created: result.person_created,
    });
  } catch (err) {
    console.error("Error advancing onboarding:", err);
    return apiServerError("Failed to advance onboarding status");
  }
}

// GET - Get single onboarding record
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "trapper");
    const candidate = await queryOne(`
      SELECT * FROM ops.v_trapper_onboarding_pipeline
      WHERE person_id = $1
    `, [id]);

    if (!candidate) {
      return apiNotFound("onboarding", id);
    }

    return apiSuccess({ candidate });
  } catch (err) {
    console.error("Error fetching onboarding record:", err);
    return apiServerError("Failed to fetch onboarding record");
  }
}
