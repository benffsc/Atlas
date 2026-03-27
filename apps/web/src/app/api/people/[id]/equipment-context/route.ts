import { queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import type { EquipmentContextResponse } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * GET /api/people/[id]/equipment-context
 * Returns context for the equipment checkout flow:
 * - Active requests (person is requester or assigned trapper)
 * - Upcoming appointments (within 14 days)
 * - Trapper service places
 * - Recent checkouts (last 3)
 */
export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "person");

  // Run all 4 queries in parallel
  const [activeRequests, upcomingAppointments, servicePlaces, recentCheckouts] = await Promise.all([
    // 1. Active requests — person is requester or assigned trapper
    queryRows<EquipmentContextResponse["active_requests"][number]>(
      `SELECT
         r.request_id,
         pl.formatted_address AS place_address,
         r.estimated_cat_count,
         r.status
       FROM ops.requests r
       LEFT JOIN sot.places pl ON pl.place_id = r.place_id
       WHERE r.merged_into_request_id IS NULL
         AND r.status NOT IN ('completed', 'cancelled')
         AND (
           r.requester_person_id = $1
           OR r.request_id IN (
             SELECT ra.request_id FROM ops.request_assignments ra
             WHERE ra.person_id = $1 AND ra.unassigned_at IS NULL
           )
         )
       ORDER BY r.created_at DESC
       LIMIT 5`,
      [id]
    ),

    // 2. Upcoming appointments — within 14 days
    queryRows<EquipmentContextResponse["upcoming_appointments"][number]>(
      `SELECT
         a.appointment_id,
         a.appointment_date::text AS appointment_date,
         a.service_name,
         COALESCE(pl.formatted_address, '') AS place_address
       FROM ops.appointments a
       LEFT JOIN sot.places pl ON pl.place_id = a.inferred_place_id
       WHERE a.person_id = $1
         AND a.appointment_date >= CURRENT_DATE
         AND a.appointment_date <= CURRENT_DATE + INTERVAL '14 days'
       ORDER BY a.appointment_date ASC
       LIMIT 3`,
      [id]
    ),

    // 3. Trapper service places
    queryRows<EquipmentContextResponse["service_places"][number]>(
      `SELECT
         tsp.place_id,
         COALESCE(pl.display_name, pl.formatted_address, 'Unknown') AS place_name,
         tsp.service_type
       FROM sot.trapper_service_places tsp
       JOIN sot.places pl ON pl.place_id = tsp.place_id
       WHERE tsp.person_id = $1
       ORDER BY
         CASE tsp.service_type
           WHEN 'primary_territory' THEN 1
           WHEN 'secondary_territory' THEN 2
           ELSE 3
         END
       LIMIT 5`,
      [id]
    ),

    // 4. Recent checkouts — last 3
    queryRows<EquipmentContextResponse["recent_checkouts"][number]>(
      `SELECT
         ev.event_id,
         ev.created_at::text,
         COALESCE(eq.display_name, 'Equipment') AS equipment_name,
         COALESCE(pl.formatted_address, '') AS place_address
       FROM ops.equipment_events ev
       JOIN ops.equipment eq ON eq.equipment_id = ev.equipment_id
       LEFT JOIN sot.places pl ON pl.place_id = ev.place_id
       WHERE ev.custodian_person_id = $1
         AND ev.event_type = 'check_out'
       ORDER BY ev.created_at DESC
       LIMIT 3`,
      [id]
    ),
  ]);

  const response: EquipmentContextResponse = {
    active_requests: activeRequests,
    upcoming_appointments: upcomingAppointments,
    service_places: servicePlaces,
    recent_checkouts: recentCheckouts,
  };

  return apiSuccess(response);
});
