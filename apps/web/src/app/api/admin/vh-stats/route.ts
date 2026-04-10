import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export async function GET() {
  try {
    // Population snapshot (from classification view)
    const population = await queryOne<{
      total_volunteers: number;
      approved_active: number;
      applicants: number;
      lapsed: number;
      active_trappers: number;
      active_fosters: number;
      active_caretakers: number;
      active_staff: number;
      matched_volunteers: number;
      unmatched_volunteers: number;
    }>(`SELECT * FROM source.v_vh_population_snapshot`);

    // Hours by group (top 10 groups with hours)
    const hoursByGroup = await queryRows<{
      group_name: string;
      total_hours: number;
      volunteer_count: number;
    }>(`
      SELECT
        ug.name AS group_name,
        COALESCE(SUM(er.hours), 0)::NUMERIC AS total_hours,
        COUNT(DISTINCT er.volunteerhub_id)::INT AS volunteer_count
      FROM source.volunteerhub_event_registrations er
      JOIN source.volunteerhub_events e ON e.event_uid = er.event_uid
      JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = e.user_group_uid
      WHERE NOT er.is_deleted AND er.hours > 0
      GROUP BY ug.name
      ORDER BY total_hours DESC
      LIMIT 10
    `);

    // Top volunteers by hours (last 90 days)
    const topVolunteers = await queryRows<{
      display_name: string;
      total_hours: number;
      event_count: number;
    }>(`
      SELECT
        vv.display_name,
        COALESCE(SUM(er.hours), 0)::NUMERIC AS total_hours,
        COUNT(DISTINCT er.event_uid)::INT AS event_count
      FROM source.volunteerhub_event_registrations er
      JOIN source.volunteerhub_events e ON e.event_uid = er.event_uid
      JOIN source.volunteerhub_volunteers vv ON vv.volunteerhub_id = er.volunteerhub_id
      WHERE NOT er.is_deleted
        AND er.hours > 0
        AND e.event_date >= NOW() - INTERVAL '90 days'
      GROUP BY vv.display_name
      ORDER BY total_hours DESC
      LIMIT 10
    `);

    // Recent membership changes (last 30 days)
    const recentChanges = await queryOne<{
      joined_last_30d: number;
      left_last_30d: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE joined_at >= NOW() - INTERVAL '30 days')::INT AS joined_last_30d,
        COUNT(*) FILTER (WHERE left_at >= NOW() - INTERVAL '30 days')::INT AS left_last_30d
      FROM source.volunteerhub_group_memberships
    `);

    // Last user sync
    const lastSync = await queryOne<{ last_sync: string | null }>(`
      SELECT MAX(synced_at)::TEXT AS last_sync FROM source.volunteerhub_volunteers
    `);

    // Event sync state
    const eventSync = await queryOne<{
      last_sync_at: string | null;
      records_synced: number;
    }>(`
      SELECT last_sync_at::TEXT, records_synced
      FROM source.volunteerhub_sync_state
      WHERE sync_type = 'events'
    `);

    // Total hours stats
    const hoursTotals = await queryOne<{
      total_hours: number;
      hours_last_90d: number;
      total_events: number;
    }>(`
      SELECT
        COALESCE(SUM(total_hours), 0)::NUMERIC AS total_hours,
        COALESCE(SUM(hours_last_90d), 0)::NUMERIC AS hours_last_90d,
        COALESCE(SUM(event_count), 0)::INT AS total_events
      FROM source.v_vh_volunteer_hours
    `);

    return apiSuccess({
      population: population || {
        total_volunteers: 0,
        approved_active: 0,
        applicants: 0,
        lapsed: 0,
        active_trappers: 0,
        active_fosters: 0,
        active_caretakers: 0,
        active_staff: 0,
        matched_volunteers: 0,
        unmatched_volunteers: 0,
      },
      hours_by_group: hoursByGroup,
      top_volunteers: topVolunteers,
      recent_changes: recentChanges || { joined_last_30d: 0, left_last_30d: 0 },
      hours_totals: hoursTotals || { total_hours: 0, hours_last_90d: 0, total_events: 0 },
      last_sync: lastSync?.last_sync || null,
      event_sync: eventSync || { last_sync_at: null, records_synced: 0 },
      // Legacy compat — old UI reads these top-level fields
      total_volunteers: population?.total_volunteers ?? 0,
      active_volunteers: population?.approved_active ?? 0,
      matched_volunteers: population?.matched_volunteers ?? 0,
      unmatched_volunteers: population?.unmatched_volunteers ?? 0,
      trappers: population?.active_trappers ?? 0,
      fosters: population?.active_fosters ?? 0,
    });
  } catch (error) {
    console.error("[VH-STATS] Error:", error);
    return apiServerError("Failed to fetch VH stats");
  }
}
