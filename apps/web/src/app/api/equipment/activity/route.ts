import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { parsePagination, withErrorHandling } from "@/lib/api-validation";
import type { EquipmentActivityRow } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/activity
 * Cross-equipment chronological event feed.
 * FFS-1055
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams, { defaultLimit: 50 });

  // Time range filter
  const since = searchParams.get("since");
  let sinceClause = "";
  const params: unknown[] = [];
  let paramIdx = 1;

  if (since) {
    let sinceDate: string;
    if (since === "today") {
      sinceDate = "CURRENT_DATE";
      sinceClause = ` WHERE ev.created_at::timestamptz >= ${sinceDate}`;
    } else if (since === "week") {
      sinceDate = "CURRENT_DATE - INTERVAL '7 days'";
      sinceClause = ` WHERE ev.created_at::timestamptz >= ${sinceDate}`;
    } else if (since === "month") {
      sinceDate = "CURRENT_DATE - INTERVAL '30 days'";
      sinceClause = ` WHERE ev.created_at::timestamptz >= ${sinceDate}`;
    } else {
      // ISO date string
      params.push(since);
      sinceClause = ` WHERE ev.created_at::timestamptz >= $${paramIdx}`;
      paramIdx++;
    }
  }

  // Additional filters
  const eventType = searchParams.get("event_type");
  const checkoutType = searchParams.get("checkout_type");
  const actorPersonId = searchParams.get("actor_person_id");

  const conditions: string[] = [];
  if (eventType) {
    params.push(eventType);
    conditions.push(`ev.event_type = $${paramIdx++}`);
  }
  if (checkoutType) {
    params.push(checkoutType);
    conditions.push(`ev.checkout_type = $${paramIdx++}`);
  }
  if (actorPersonId) {
    params.push(actorPersonId);
    conditions.push(`ev.actor_person_id = $${paramIdx++}`);
  }

  // Build WHERE clause
  let whereClause = sinceClause;
  if (conditions.length > 0) {
    const connector = whereClause ? " AND " : " WHERE ";
    whereClause += connector + conditions.join(" AND ");
  }

  // Query from the raw tables (same join as the view, but parameterized)
  const events = await queryRows<EquipmentActivityRow>(
    `SELECT
       ev.event_id, ev.equipment_id, ev.event_type,
       ev.actor_person_id, ap.display_name AS actor_name,
       ev.custodian_person_id,
       COALESCE(cp.display_name, ev.custodian_name) AS custodian_name,
       ev.place_id, pl.formatted_address AS place_address,
       ev.request_id, ev.kit_id,
       ev.condition_before, ev.condition_after,
       ev.due_date::text, ev.notes, ev.source_system,
       ev.created_at::text,
       ev.checkout_type, ev.deposit_amount::numeric,
       ev.deposit_returned_at::text, ev.custodian_phone,
       ev.appointment_id,
       ev.checkout_purpose, ev.custodian_name_raw, ev.resolution_status,
       ev.photo_url,
       e.equipment_name AS equipment_name,
       e.barcode AS equipment_barcode,
       COALESCE(et.category, 'unknown') AS equipment_category,
       COALESCE(et.display_name, e.equipment_type) AS equipment_type_name
     FROM ops.equipment_events ev
     JOIN ops.equipment e ON e.equipment_id = ev.equipment_id
     LEFT JOIN ops.equipment_types et ON et.type_key = e.equipment_type_key
     LEFT JOIN sot.people ap ON ap.person_id = ev.actor_person_id
     LEFT JOIN sot.people cp ON cp.person_id = ev.custodian_person_id
     LEFT JOIN sot.places pl ON pl.place_id = ev.place_id
     ${whereClause}
     ORDER BY ev.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  // Count query with same filters
  const countResult = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM ops.equipment_events ev
     JOIN ops.equipment e ON e.equipment_id = ev.equipment_id
     ${whereClause}`,
    params
  );

  return apiSuccess(
    { events },
    { total: countResult?.total || 0, limit, offset, hasMore: events.length === limit }
  );
});
