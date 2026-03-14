import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { logFieldEdit } from "@/lib/audit";

/** PATCH /api/people/[id]/contracts/[contractId] — Update contract status */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contractId: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id, contractId } = await params;
    requireValidUUID(id, "person");
    requireValidUUID(contractId, "contract");

    const body = await request.json();
    const { status, reason } = body as { status: string; reason?: string };

    const validStatuses = ["active", "expired", "terminated"];
    if (!status || !validStatuses.includes(status)) {
      return apiError(`status must be one of: ${validStatuses.join(", ")}`, 400);
    }

    // Get current contract
    const current = await queryOne<{ contract_id: string; status: string; person_id: string }>(
      `SELECT contract_id, status, person_id::text
       FROM ops.trapper_contracts
       WHERE contract_id = $1 AND person_id = $2`,
      [contractId, id]
    );

    if (!current) return apiNotFound("Contract", contractId);

    // Update contract status
    await queryOne(
      `UPDATE ops.trapper_contracts
       SET status = $1,
           contract_notes = CASE
             WHEN $3::text IS NOT NULL THEN COALESCE(contract_notes || E'\n', '') || $3
             ELSE contract_notes
           END,
           updated_at = NOW()
       WHERE contract_id = $2`,
      [status, contractId, reason || null]
    );

    // If terminating/expiring, check if person still has any active contracts
    if (status === "terminated" || status === "expired") {
      const activeCount = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count
         FROM ops.trapper_contracts
         WHERE person_id = $1 AND status = 'active' AND contract_id != $2`,
        [id, contractId]
      );

      // If no remaining active contracts, update trapper_profiles
      if (activeCount && activeCount.count === 0) {
        await queryOne(
          `UPDATE sot.trapper_profiles
           SET has_signed_contract = FALSE, updated_at = NOW()
           WHERE person_id = $1`,
          [id]
        );
      }
    }

    // Audit log
    await logFieldEdit("person", id, "contract_status", current.status, status, {
      editedBy: session.staff_id || "web_user",
      editSource: "web_ui",
      reason: reason || `Contract ${status}`,
    });

    return apiSuccess({ action: "updated", status });
  } catch (error) {
    console.error("[API] Error updating contract:", error);
    return apiServerError("Failed to update contract");
  }
}
