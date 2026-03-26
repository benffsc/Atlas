import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/kits/[id]
 * Kit detail with items
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "kit");

  const kit = await queryOne<{
    kit_id: string;
    person_id: string | null;
    person_name: string | null;
    request_id: string | null;
    place_id: string | null;
    place_address: string | null;
    checked_out_at: string;
    returned_at: string | null;
    notes: string | null;
  }>(
    `SELECT
       k.kit_id, k.person_id, p.display_name AS person_name,
       k.request_id, k.place_id, pl.formatted_address AS place_address,
       k.checked_out_at::text, k.returned_at::text, k.notes
     FROM ops.equipment_kits k
     LEFT JOIN sot.people p ON p.person_id = k.person_id
     LEFT JOIN sot.places pl ON pl.place_id = k.place_id
     WHERE k.kit_id = $1`,
    [id]
  );

  if (!kit) return apiNotFound("kit", id);

  const items = await queryRows<{
    equipment_id: string;
    barcode: string | null;
    display_name: string;
    type_display_name: string | null;
    custody_status: string;
    condition_status: string;
  }>(
    `SELECT
       e.equipment_id, e.barcode,
       COALESCE(e.equipment_name, e.barcode, e.equipment_type) AS display_name,
       et.display_name AS type_display_name,
       e.custody_status, e.condition_status
     FROM ops.equipment e
     LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
     WHERE e.current_kit_id = $1`,
    [id]
  );

  return apiSuccess({ ...kit, items, item_count: items.length });
});

/**
 * PATCH /api/equipment/kits/[id]
 * Return a kit (checks in all items)
 */
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "kit");

  const body = await request.json();
  const { action, condition_after, notes } = body;

  if (action !== "return") {
    throw new ApiError("Only 'return' action is supported", 400);
  }

  const kit = await queryOne<{ kit_id: string; returned_at: string | null }>(
    `SELECT kit_id, returned_at::text FROM ops.equipment_kits WHERE kit_id = $1`,
    [id]
  );

  if (!kit) return apiNotFound("kit", id);
  if (kit.returned_at) throw new ApiError("Kit is already returned", 400);

  // Find all items in this kit
  const kitItems = await queryRows<{ equipment_id: string; condition_status: string }>(
    `SELECT equipment_id, condition_status FROM ops.equipment WHERE current_kit_id = $1`,
    [id]
  );

  // Check in each item (triggers handle equipment state)
  for (const item of kitItems) {
    await queryOne(
      `INSERT INTO ops.equipment_events (
         equipment_id, event_type, kit_id,
         condition_before, condition_after,
         notes, source_system
       ) VALUES ($1, 'check_in', $2, $3, $4, $5, 'atlas_ui')`,
      [item.equipment_id, id, item.condition_status, condition_after || null, notes || null]
    );
  }

  // Mark kit returned
  await queryOne(
    `UPDATE ops.equipment_kits SET returned_at = NOW() WHERE kit_id = $1`,
    [id]
  );

  return apiSuccess({ kit_id: id, items_returned: kitItems.length });
});
