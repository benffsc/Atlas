import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling } from "@/lib/api-validation";

/**
 * GET /api/equipment/stats
 * Dashboard statistics for equipment inventory
 */
export const GET = withErrorHandling(async () => {
  const stats = await queryOne<{
    total: number;
    available: number;
    checked_out: number;
    in_maintenance: number;
    missing: number;
    needs_repair: number;
  }>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE custody_status = 'available')::int AS available,
       COUNT(*) FILTER (WHERE custody_status = 'checked_out')::int AS checked_out,
       COUNT(*) FILTER (WHERE custody_status = 'maintenance')::int AS in_maintenance,
       COUNT(*) FILTER (WHERE custody_status = 'missing')::int AS missing,
       COUNT(*) FILTER (WHERE functional_status = 'needs_repair')::int AS needs_repair
     FROM ops.equipment
     WHERE retired_at IS NULL`
  );

  // Overdue: checked out items past their due date
  const overdueResult = await queryOne<{ overdue: number }>(
    `SELECT COUNT(DISTINCT ev.equipment_id)::int AS overdue
     FROM ops.equipment_events ev
     JOIN ops.equipment e ON e.equipment_id = ev.equipment_id
     WHERE ev.event_type = 'check_out'
       AND ev.due_date < CURRENT_DATE
       AND e.custody_status = 'checked_out'
       AND NOT EXISTS (
         SELECT 1 FROM ops.equipment_events ev2
         WHERE ev2.equipment_id = ev.equipment_id
           AND ev2.event_type = 'check_in'
           AND ev2.created_at > ev.created_at
       )`
  );

  const byCategory = await queryRows<{ category: string; count: number }>(
    `SELECT
       COALESCE(et.category, 'unknown') AS category,
       COUNT(*)::int AS count
     FROM ops.equipment e
     LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
     WHERE e.retired_at IS NULL
     GROUP BY et.category
     ORDER BY count DESC`
  );

  const byType = await queryRows<{ type_key: string; display_name: string; count: number }>(
    `SELECT
       COALESCE(e.equipment_type_key, 'unknown') AS type_key,
       COALESCE(et.display_name, e.equipment_type) AS display_name,
       COUNT(*)::int AS count
     FROM ops.equipment e
     LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
     WHERE e.retired_at IS NULL
     GROUP BY e.equipment_type_key, et.display_name, e.equipment_type
     ORDER BY count DESC`
  );

  const byItemType = await queryRows<{ item_type: string; count: number }>(
    `SELECT
       COALESCE(item_type, 'Unknown') AS item_type,
       COUNT(*)::int AS count
     FROM ops.equipment
     WHERE retired_at IS NULL AND item_type IS NOT NULL
     GROUP BY item_type
     ORDER BY count DESC`
  );

  // Next available 4-digit barcode suggestion
  const nextBarcodeResult = await queryOne<{ next_barcode: string }>(
    `SELECT LPAD((COALESCE(MAX(barcode::int), 0) + 1)::text, 4, '0') AS next_barcode
     FROM ops.equipment
     WHERE barcode ~ '^\\d{1,4}$'`
  );

  return apiSuccess({
    total: stats?.total || 0,
    available: stats?.available || 0,
    checked_out: stats?.checked_out || 0,
    in_maintenance: stats?.in_maintenance || 0,
    missing: stats?.missing || 0,
    overdue: overdueResult?.overdue || 0,
    needs_repair: stats?.needs_repair || 0,
    by_category: byCategory,
    by_type: byType,
    by_item_type: byItemType,
    next_barcode: nextBarcodeResult?.next_barcode || "0001",
  });
});
