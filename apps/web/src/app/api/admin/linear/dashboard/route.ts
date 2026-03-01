import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Linear Dashboard API
 *
 * Returns aggregated data for the Linear admin dashboard.
 */

interface SyncStatus {
  sync_type: string;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  records_synced: number;
  error_message: string | null;
  sync_health: string;
}

interface IssueSummary {
  state_type: string;
  issue_count: number;
  high_priority: number;
  linked_to_atlas: number;
  overdue: number;
}

interface CurrentCycle {
  id: string;
  linear_id: string;
  name: string | null;
  number: number;
  starts_at: string;
  ends_at: string;
  progress: number;
  total_issues: number;
  completed_issues: number;
  in_progress_issues: number;
  todo_issues: number;
  days_remaining: number;
}

interface TeamWorkload {
  id: string;
  linear_id: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
  in_progress: number;
  assigned_todo: number;
  overdue: number;
  total_estimate: number | null;
}

interface ClaudeSession {
  id: string;
  session_id: string;
  branch_name: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  issue_identifier: string | null;
  issue_title: string | null;
  issue_state: string | null;
  commit_count: number | null;
  files_count: number | null;
  duration_hours: number;
}

interface Totals {
  issues: number;
  projects: number;
  cycles: number;
  team_members: number;
  labels: number;
  active_sessions: number;
}

export async function GET() {
  try {
    // Fetch all data in parallel
    const [
      syncStatus,
      issueSummary,
      currentCycle,
      teamWorkload,
      recentSessions,
      totals,
    ] = await Promise.all([
      // Sync status from view
      queryRows<SyncStatus>(
        `SELECT sync_type, last_sync_at, last_sync_cursor, records_synced, error_message, sync_health
         FROM ops.v_linear_sync_status
         ORDER BY sync_type`
      ).catch(() => []),

      // Issue summary from view
      queryRows<IssueSummary>(
        `SELECT state_type, issue_count::int, high_priority::int, linked_to_atlas::int, overdue::int
         FROM ops.v_linear_issue_summary`
      ).catch(() => []),

      // Current cycle from view
      queryOne<CurrentCycle>(
        `SELECT id::text, linear_id, name, number, starts_at, ends_at, progress::float,
                total_issues::int, completed_issues::int, in_progress_issues::int,
                todo_issues::int, days_remaining
         FROM ops.v_linear_current_cycle
         LIMIT 1`
      ).catch(() => null),

      // Team workload from view
      queryRows<TeamWorkload>(
        `SELECT id::text, linear_id, name, display_name, avatar_url,
                in_progress::int, assigned_todo::int, overdue::int, total_estimate::int
         FROM ops.v_linear_team_workload
         WHERE in_progress > 0 OR assigned_todo > 0
         ORDER BY in_progress DESC, assigned_todo DESC
         LIMIT 10`
      ).catch(() => []),

      // Recent Claude sessions from view
      queryRows<ClaudeSession>(
        `SELECT id::text, session_id, branch_name, status, started_at, completed_at,
                issue_identifier, issue_title, issue_state,
                commit_count::int, files_count::int, duration_hours::float
         FROM ops.v_linear_claude_activity
         ORDER BY started_at DESC
         LIMIT 10`
      ).catch(() => []),

      // Totals
      Promise.all([
        queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM ops.linear_issues").then(r => r?.count || 0).catch(() => 0),
        queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM ops.linear_projects").then(r => r?.count || 0).catch(() => 0),
        queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM ops.linear_cycles").then(r => r?.count || 0).catch(() => 0),
        queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM ops.linear_team_members WHERE is_active = TRUE").then(r => r?.count || 0).catch(() => 0),
        queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM ops.linear_labels").then(r => r?.count || 0).catch(() => 0),
        queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM ops.linear_claude_sessions WHERE status = 'active'").then(r => r?.count || 0).catch(() => 0),
      ]).then(([issues, projects, cycles, team_members, labels, active_sessions]) => ({
        issues,
        projects,
        cycles,
        team_members,
        labels,
        active_sessions,
      })),
    ]);

    return apiSuccess({
      sync_status: syncStatus,
      issue_summary: issueSummary,
      current_cycle: currentCycle,
      team_workload: teamWorkload,
      recent_sessions: recentSessions,
      totals,
    });
  } catch (error) {
    console.error("Linear dashboard error:", error);
    return apiServerError(
      error instanceof Error ? error.message : "Failed to fetch dashboard data"
    );
  }
}
