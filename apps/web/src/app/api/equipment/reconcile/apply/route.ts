import { query } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import { NextRequest } from "next/server";

interface ReconcileAction {
  equipment_id: string;
  action: "check_in" | "mark_missing" | "mark_found" | "skip";
}

/**
 * POST /api/equipment/reconcile/apply
 *
 * Applies reconciliation actions in bulk.
 * Temporarily disables trigger for performance, then creates events
 * and manually updates equipment state.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const actions: ReconcileAction[] = body.actions;

  if (!Array.isArray(actions) || actions.length === 0) {
    throw new ApiError("actions must be a non-empty array", 400);
  }

  const validActions = ["check_in", "mark_missing", "mark_found", "skip"];
  for (const a of actions) {
    if (!a.equipment_id || !validActions.includes(a.action)) {
      throw new ApiError(`Invalid action: ${JSON.stringify(a)}`, 400);
    }
  }

  // Filter out skips
  const toApply = actions.filter((a) => a.action !== "skip");

  if (toApply.length === 0) {
    return apiSuccess({ applied: 0, skipped: actions.length });
  }

  try {
    // Disable trigger for bulk performance
    await query(`ALTER TABLE ops.equipment_events DISABLE TRIGGER trg_equipment_event_sync`);

    let applied = 0;

    for (const action of toApply) {
      const eventType = action.action === "mark_missing" ? "reported_missing"
                      : action.action === "mark_found" ? "found"
                      : "check_in";

      // Create event record
      await query(
        `INSERT INTO ops.equipment_events (equipment_id, event_type, notes, source_system)
         VALUES ($1, $2, $3, 'atlas_ui')`,
        [action.equipment_id, eventType, "Restock reconciliation"]
      );

      // Manually update equipment state (since trigger is disabled)
      switch (action.action) {
        case "check_in":
          await query(
            `UPDATE ops.equipment SET
               custody_status = 'available',
               checkout_type = NULL,
               inferred_due_date = NULL,
               current_custodian_id = NULL,
               current_place_id = NULL,
               current_request_id = NULL,
               current_kit_id = NULL,
               updated_at = NOW()
             WHERE equipment_id = $1`,
            [action.equipment_id]
          );
          break;

        case "mark_missing":
          await query(
            `UPDATE ops.equipment SET
               custody_status = 'missing',
               updated_at = NOW()
             WHERE equipment_id = $1`,
            [action.equipment_id]
          );
          break;

        case "mark_found":
          await query(
            `UPDATE ops.equipment SET
               custody_status = 'available',
               checkout_type = NULL,
               inferred_due_date = NULL,
               current_custodian_id = NULL,
               current_place_id = NULL,
               current_request_id = NULL,
               updated_at = NOW()
             WHERE equipment_id = $1`,
            [action.equipment_id]
          );
          break;
      }

      applied++;
    }

    return apiSuccess({
      applied,
      skipped: actions.length - toApply.length,
    });

  } finally {
    // Re-enable trigger
    await query(`ALTER TABLE ops.equipment_events ENABLE TRIGGER trg_equipment_event_sync`);
  }
});
