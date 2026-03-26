import { queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/scan?barcode=192
 * Barcode lookup — returns item + status + available actions
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const barcode = searchParams.get("barcode")?.trim();

  if (!barcode) {
    throw new ApiError("barcode query parameter is required", 400);
  }

  // Try exact barcode match first
  let equipment = await queryOne<VEquipmentInventoryRow>(
    `SELECT * FROM ops.v_equipment_inventory WHERE barcode = $1`,
    [barcode]
  );

  // Fallback: try matching with common prefix patterns
  if (!equipment) {
    equipment = await queryOne<VEquipmentInventoryRow>(
      `SELECT * FROM ops.v_equipment_inventory
       WHERE barcode ILIKE $1 OR barcode ILIKE $2
       LIMIT 1`,
      [barcode, `%${barcode}`]
    );
  }

  // Fallback: try matching equipment_name
  if (!equipment) {
    equipment = await queryOne<VEquipmentInventoryRow>(
      `SELECT * FROM ops.v_equipment_inventory
       WHERE display_name ILIKE $1
       LIMIT 1`,
      [`%${barcode}%`]
    );
  }

  if (!equipment) {
    return apiNotFound("equipment with barcode", barcode);
  }

  // Compute available actions based on current state
  const actions: string[] = [];
  switch (equipment.custody_status) {
    case "available":
      actions.push("check_out");
      actions.push("condition_change");
      actions.push("maintenance_start");
      actions.push("reported_missing");
      actions.push("retired");
      break;
    case "checked_out":
      actions.push("check_in");
      actions.push("transfer");
      actions.push("condition_change");
      actions.push("reported_missing");
      break;
    case "maintenance":
      actions.push("maintenance_end");
      actions.push("condition_change");
      break;
    case "missing":
      actions.push("found");
      actions.push("retired");
      break;
    default:
      actions.push("note");
  }

  return apiSuccess({ ...equipment, available_actions: actions });
});
