import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import type { VEquipmentInventoryRow, EquipmentEventRow } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/[id]
 * Equipment detail with recent events
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "equipment");

  const equipment = await queryOne<VEquipmentInventoryRow>(
    `SELECT * FROM ops.v_equipment_inventory WHERE equipment_id = $1`,
    [id]
  );

  if (!equipment) {
    // Check if it exists but is retired
    const retired = await queryOne<{ equipment_id: string; retired_at: string }>(
      `SELECT equipment_id, retired_at::text FROM ops.equipment WHERE equipment_id = $1`,
      [id]
    );
    if (retired) {
      return apiNotFound("equipment (retired)", id);
    }
    return apiNotFound("equipment", id);
  }

  // Recent events (last 10)
  const recentEvents = await queryRows<EquipmentEventRow>(
    `SELECT
       ev.event_id, ev.equipment_id, ev.event_type,
       ev.actor_person_id, ap.display_name AS actor_name,
       ev.custodian_person_id, cp.display_name AS custodian_name,
       ev.place_id, pl.formatted_address AS place_address,
       ev.request_id, ev.kit_id,
       ev.condition_before, ev.condition_after,
       ev.due_date::text, ev.notes, ev.source_system,
       ev.created_at::text
     FROM ops.equipment_events ev
     LEFT JOIN sot.people ap ON ap.person_id = ev.actor_person_id
     LEFT JOIN sot.people cp ON cp.person_id = ev.custodian_person_id
     LEFT JOIN sot.places pl ON pl.place_id = ev.place_id
     WHERE ev.equipment_id = $1
     ORDER BY ev.created_at DESC
     LIMIT 10`,
    [id]
  );

  return apiSuccess({ ...equipment, recent_events: recentEvents });
});

/**
 * PATCH /api/equipment/[id]
 * Update equipment metadata
 */
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "equipment");

  const body = await request.json();
  const allowedFields = ["equipment_name", "barcode", "equipment_type_key", "serial_number", "manufacturer", "model", "condition_status", "notes", "item_type", "size", "functional_status", "current_holder_name", "expected_return_date", "photo_url", "barcode_image_url"];

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${paramIdx}`);
      values.push(body[field]);
      paramIdx++;
    }
  }

  if (updates.length === 0) {
    throw new ApiError("No valid fields to update", 400);
  }

  // Check barcode uniqueness if changing
  if (body.barcode !== undefined) {
    const existing = await queryOne<{ equipment_id: string }>(
      `SELECT equipment_id FROM ops.equipment WHERE barcode = $1 AND equipment_id != $2`,
      [body.barcode, id]
    );
    if (existing) {
      throw new ApiError(`Barcode "${body.barcode}" is already in use`, 409);
    }
  }

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const result = await queryOne<{ equipment_id: string }>(
    `UPDATE ops.equipment SET ${updates.join(", ")} WHERE equipment_id = $${paramIdx} RETURNING equipment_id`,
    values
  );

  if (!result) {
    return apiNotFound("equipment", id);
  }

  return apiSuccess({ equipment_id: result.equipment_id });
});
