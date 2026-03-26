import { queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling } from "@/lib/api-validation";
import type { EquipmentTypeRow } from "@/lib/types/view-contracts";

/**
 * GET /api/equipment/types
 * Equipment types for dropdowns and filters
 */
export const GET = withErrorHandling(async () => {
  const types = await queryRows<EquipmentTypeRow>(
    `SELECT
       et.type_key,
       et.display_name,
       et.category,
       et.manufacturer,
       et.is_active,
       et.sort_order,
       COALESCE(cnt.item_count, 0)::int AS item_count
     FROM ops.equipment_types et
     LEFT JOIN (
       SELECT equipment_type_key, COUNT(*)::int AS item_count
       FROM ops.equipment
       WHERE retired_at IS NULL
       GROUP BY equipment_type_key
     ) cnt ON cnt.equipment_type_key = et.type_key
     WHERE et.is_active = TRUE
     ORDER BY et.sort_order, et.display_name`
  );

  return apiSuccess({ types });
});
