import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { parsePagination, withErrorHandling } from "@/lib/api-validation";
import { NextRequest } from "next/server";

interface OverdueItem {
  equipment_id: string;
  barcode: string | null;
  display_name: string;
  type_display_name: string | null;
  custodian_name: string | null;
  custodian_person_id: string | null;
  checked_out_at: string;
  due_date: string;
  days_overdue: number;
  place_address: string | null;
  request_id: string | null;
}

/**
 * GET /api/equipment/overdue
 * List equipment items past their due date
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);

  const items = await queryRows<OverdueItem>(
    `SELECT
       e.equipment_id,
       e.barcode,
       COALESCE(e.equipment_name, e.barcode, e.equipment_type) AS display_name,
       et.display_name AS type_display_name,
       p.display_name AS custodian_name,
       ev.custodian_person_id,
       ev.created_at::text AS checked_out_at,
       ev.due_date::text AS due_date,
       (CURRENT_DATE - ev.due_date)::int AS days_overdue,
       pl.formatted_address AS place_address,
       ev.request_id
     FROM ops.equipment_events ev
     JOIN ops.equipment e ON e.equipment_id = ev.equipment_id
     LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
     LEFT JOIN sot.people p ON p.person_id = ev.custodian_person_id
     LEFT JOIN sot.places pl ON pl.place_id = ev.place_id
     WHERE ev.event_type = 'check_out'
       AND ev.due_date < CURRENT_DATE
       AND e.custody_status = 'checked_out'
       AND NOT EXISTS (
         SELECT 1 FROM ops.equipment_events ev2
         WHERE ev2.equipment_id = ev.equipment_id
           AND ev2.event_type = 'check_in'
           AND ev2.created_at > ev.created_at
       )
     ORDER BY ev.due_date ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const countResult = await queryOne<{ total: number }>(
    `SELECT COUNT(DISTINCT ev.equipment_id)::int AS total
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

  return apiSuccess(
    { items },
    { total: countResult?.total || 0, limit, offset, hasMore: items.length === limit }
  );
});
