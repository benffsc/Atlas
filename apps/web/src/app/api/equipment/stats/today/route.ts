import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling } from "@/lib/api-validation";
import type { KioskDailyStatsRow } from "@/lib/types/view-contracts";

/**
 * GET /api/equipment/stats/today
 * Today's kiosk activity summary for admin dashboard.
 * FFS-1056
 */
export const GET = withErrorHandling(async () => {
  const stats = await queryOne<{
    checkouts_today: number;
    checkins_today: number;
    deposits_today: number;
    last_activity_at: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'check_out')::int AS checkouts_today,
       COUNT(*) FILTER (WHERE event_type = 'check_in')::int AS checkins_today,
       COUNT(*) FILTER (WHERE event_type = 'check_out' AND deposit_amount > 0)::int AS deposits_today,
       MAX(created_at)::text AS last_activity_at
     FROM ops.equipment_events
     WHERE created_at >= CURRENT_DATE`
  );

  // Overdue count (same logic as /api/equipment/stats)
  const overdueResult = await queryOne<{ overdue_count: number }>(
    `SELECT COUNT(DISTINCT ev.equipment_id)::int AS overdue_count
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

  // Active staff today — distinct actor names from today's events
  const staffRows = await queryRows<{ actor_name: string }>(
    `SELECT DISTINCT p.display_name AS actor_name
     FROM ops.equipment_events ev
     JOIN sot.people p ON p.person_id = ev.actor_person_id
     WHERE ev.created_at >= CURRENT_DATE
       AND ev.actor_person_id IS NOT NULL`
  );

  const result: KioskDailyStatsRow = {
    checkouts_today: stats?.checkouts_today || 0,
    checkins_today: stats?.checkins_today || 0,
    deposits_today: stats?.deposits_today || 0,
    overdue_count: overdueResult?.overdue_count || 0,
    last_activity_at: stats?.last_activity_at || null,
    active_staff_today: staffRows.map((r) => r.actor_name),
  };

  return apiSuccess(result);
});
