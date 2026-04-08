import { queryRows, queryOne, query } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { parsePagination, withErrorHandling, ApiError } from "@/lib/api-validation";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment
 * List equipment with filters + pagination
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);

  const search = searchParams.get("search")?.trim();
  const category = searchParams.get("category");
  const custodyStatus = searchParams.get("custody_status");
  const conditionStatus = searchParams.get("condition_status");
  const functionalStatus = searchParams.get("functional_status");
  const typeKey = searchParams.get("type_key");

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (search) {
    conditions.push(`(v.barcode ILIKE $${paramIdx} OR v.display_name ILIKE $${paramIdx} OR v.custodian_name ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  if (category) {
    conditions.push(`v.type_category = $${paramIdx}`);
    params.push(category);
    paramIdx++;
  }
  if (custodyStatus) {
    conditions.push(`v.custody_status = $${paramIdx}`);
    params.push(custodyStatus);
    paramIdx++;
  }
  if (conditionStatus) {
    conditions.push(`v.condition_status = $${paramIdx}`);
    params.push(conditionStatus);
    paramIdx++;
  }
  if (functionalStatus) {
    conditions.push(`v.functional_status = $${paramIdx}`);
    params.push(functionalStatus);
    paramIdx++;
  }
  if (typeKey) {
    conditions.push(`v.equipment_type_key = $${paramIdx}`);
    params.push(typeKey);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Sort
  const validSortColumns = ["display_name", "barcode", "custody_status", "condition_status", "type_display_name", "custodian_name", "days_checked_out", "total_checkouts", "created_at", "updated_at"];
  const sortBy = searchParams.get("sort") || "display_name";
  const sortDir = searchParams.get("sortDir") === "desc" ? "DESC" : "ASC";
  const orderColumn = validSortColumns.includes(sortBy) ? sortBy : "display_name";

  const equipment = await queryRows<VEquipmentInventoryRow>(
    `SELECT * FROM ops.v_equipment_inventory v
     ${whereClause}
     ORDER BY ${orderColumn} ${sortDir} NULLS LAST
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, limit, offset]
  );

  const countResult = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM ops.v_equipment_inventory v ${whereClause}`,
    params
  );

  return apiSuccess(
    { equipment },
    { total: countResult?.total || 0, limit, offset, hasMore: equipment.length === limit }
  );
});

/**
 * POST /api/equipment
 * Create new equipment item
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const { barcode, equipment_name, equipment_type_key, serial_number, manufacturer, model, condition_status, notes, item_type, size, functional_status } = body;

  if (!equipment_type_key) {
    throw new ApiError("equipment_type_key is required", 400);
  }

  // Verify type exists
  const typeExists = await queryOne<{ type_key: string }>(
    `SELECT type_key FROM ops.equipment_types WHERE type_key = $1`,
    [equipment_type_key]
  );
  if (!typeExists) {
    throw new ApiError(`Unknown equipment type: ${equipment_type_key}`, 400);
  }

  // Check barcode uniqueness if provided
  if (barcode) {
    const existing = await queryOne<{ equipment_id: string }>(
      `SELECT equipment_id FROM ops.equipment WHERE barcode = $1`,
      [barcode]
    );
    if (existing) {
      throw new ApiError(`Barcode "${barcode}" is already in use`, 409);
    }
  }

  const result = await queryOne<{
    equipment_id: string;
    barcode: string | null;
    equipment_name: string | null;
  }>(
    `INSERT INTO ops.equipment (
       equipment_name, equipment_type, equipment_type_key, barcode,
       serial_number, manufacturer, model,
       custody_status, condition_status, notes,
       item_type, size, functional_status,
       source_system, created_at, updated_at
     ) VALUES (
       $1, (SELECT display_name FROM ops.equipment_types WHERE type_key = $2), $2, $3,
       $4, $5, $6,
       'available', COALESCE($7, 'new'), $8,
       $9, $10, COALESCE($11, 'functional'),
       'atlas_ui', NOW(), NOW()
     ) RETURNING
       equipment_id,
       barcode,
       COALESCE(equipment_name, barcode, equipment_type) AS equipment_name`,
    [equipment_name || null, equipment_type_key, barcode || null, serial_number || null, manufacturer || null, model || null, condition_status, notes || null, item_type || null, size || null, functional_status]
  );

  // Return both the legacy `equipment_id` field AND the kiosk-add-page-expected
  // `{ id, barcode, equipment_name }` shape. Without this dual-shape return,
  // the kiosk add flow's photo upload, success screen, and "Scan This Item"
  // link all break (they read result.id / created.barcode / created.equipment_name).
  // The barcode fallback is empty-string so the success screen renders cleanly
  // even when a user creates an item without scanning a barcode first.
  return apiSuccess({
    equipment_id: result?.equipment_id ?? "",
    id: result?.equipment_id ?? "",
    barcode: result?.barcode ?? "",
    equipment_name: result?.equipment_name ?? "New equipment",
  });
});
