import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { requireValidUUID, parsePagination, withErrorHandling, ApiError } from "@/lib/api-validation";
import type { EquipmentKitRow } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/kits
 * List kits (active by default, or all)
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);
  const showAll = searchParams.get("all") === "true";

  const whereClause = showAll ? "" : "WHERE k.returned_at IS NULL";

  const kits = await queryRows<EquipmentKitRow>(
    `SELECT
       k.kit_id,
       k.person_id,
       p.display_name AS person_name,
       k.request_id,
       k.place_id,
       pl.formatted_address AS place_address,
       k.checked_out_at::text,
       k.returned_at::text,
       k.notes,
       (SELECT COUNT(*)::int FROM ops.equipment WHERE current_kit_id = k.kit_id) AS item_count,
       (SELECT jsonb_agg(jsonb_build_object(
           'equipment_id', e.equipment_id,
           'barcode', e.barcode,
           'display_name', COALESCE(e.equipment_name, e.barcode, e.equipment_type),
           'type_display_name', et.display_name
       ))
       FROM ops.equipment e
       LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
       WHERE e.current_kit_id = k.kit_id) AS items
     FROM ops.equipment_kits k
     LEFT JOIN sot.people p ON p.person_id = k.person_id
     LEFT JOIN sot.places pl ON pl.place_id = k.place_id
     ${whereClause}
     ORDER BY k.checked_out_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const countResult = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM ops.equipment_kits k ${whereClause}`
  );

  return apiSuccess(
    { kits },
    { total: countResult?.total || 0, limit, offset, hasMore: kits.length === limit }
  );
});

/**
 * POST /api/equipment/kits
 * Create a kit and check out multiple items together
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const { person_id, equipment_ids, request_id, place_id, due_date, notes } = body;

  if (!person_id) throw new ApiError("person_id is required", 400);
  if (!equipment_ids || !Array.isArray(equipment_ids) || equipment_ids.length === 0) {
    throw new ApiError("equipment_ids array is required (at least 1 item)", 400);
  }

  requireValidUUID(person_id, "person");
  if (request_id) requireValidUUID(request_id, "request");
  if (place_id) requireValidUUID(place_id, "place");

  // Verify all items exist and are available
  for (const eqId of equipment_ids) {
    requireValidUUID(eqId, "equipment");
    const eq = await queryOne<{ custody_status: string }>(
      `SELECT custody_status FROM ops.equipment WHERE equipment_id = $1`,
      [eqId]
    );
    if (!eq) throw new ApiError(`Equipment ${eqId} not found`, 404);
    if (eq.custody_status !== "available") {
      throw new ApiError(`Equipment ${eqId} is not available (status: ${eq.custody_status})`, 400);
    }
  }

  // Create kit
  const kit = await queryOne<{ kit_id: string }>(
    `INSERT INTO ops.equipment_kits (person_id, request_id, place_id, notes, checked_out_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING kit_id`,
    [person_id, request_id || null, place_id || null, notes || null]
  );

  if (!kit) throw new ApiError("Failed to create kit", 500);

  // Check out each item with kit reference (triggers handle equipment state)
  for (const eqId of equipment_ids) {
    await queryOne(
      `INSERT INTO ops.equipment_events (
         equipment_id, event_type, custodian_person_id,
         place_id, request_id, kit_id,
         due_date, notes, source_system
       ) VALUES ($1, 'check_out', $2, $3, $4, $5, $6, $7, 'atlas_ui')`,
      [eqId, person_id, place_id || null, request_id || null, kit.kit_id, due_date || null, notes || null]
    );
  }

  return apiSuccess({ kit_id: kit.kit_id, item_count: equipment_ids.length });
});
