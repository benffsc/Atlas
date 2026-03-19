"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { COLORS, SPACING, TYPOGRAPHY, BORDERS, getStatusColor } from "@/lib/design-tokens";
import { StatCard } from "@/components/ui/StatCard";

// ============================================================================
// Types
// ============================================================================

interface SyncStatus {
  sync_type: string;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  records_synced: number;
  error_message: string | null;
  sync_health: "healthy" | "stale" | "error" | "never";
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

interface LinearDashboardData {
  sync_status: SyncStatus[];
  issue_summary: IssueSummary[];
  current_cycle: CurrentCycle | null;
  team_workload: TeamWorkload[];
  recent_sessions: ClaudeSession[];
  totals: {
    issues: number;
    projects: number;
    cycles: number;
    team_members: number;
    labels: number;
    active_sessions: number;
  };
}

// ============================================================================
// Helper Components
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    healthy: { bg: COLORS.successLight, color: COLORS.successDark, label: "Healthy" },
    stale: { bg: COLORS.warningLight, color: COLORS.warningDark, label: "Stale" },
    error: { bg: COLORS.errorLight, color: COLORS.errorDark, label: "Error" },
    never: { bg: COLORS.gray100, color: COLORS.gray500, label: "Never Synced" },
    active: { bg: COLORS.primaryLight, color: COLORS.primaryDark, label: "Active" },
    completed: { bg: COLORS.successLight, color: COLORS.successDark, label: "Completed" },
    paused: { bg: COLORS.warningLight, color: COLORS.warningDark, label: "Paused" },
    abandoned: { bg: COLORS.gray100, color: COLORS.gray500, label: "Abandoned" },
  };
  const { bg, color, label } = config[status.toLowerCase()] || { bg: COLORS.gray100, color: COLORS.gray500, label: status };

  return (
    <span
      style={{
        padding: `${SPACING.xs} ${SPACING.sm}`,
        borderRadius: BORDERS.radius.full,
        fontSize: TYPOGRAPHY.size.xs,
        fontWeight: TYPOGRAPHY.weight.semibold,
        background: bg,
        color: color,
      }}
    >
      {label}
    </span>
  );
}


function ProgressBar({ progress, label }: { progress: number; label?: string }) {
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: SPACING.xs }}>
        <span style={{ fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSecondary }}>{label || "Progress"}</span>
        <span style={{ fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.semibold }}>{Math.round(progress)}%</span>
      </div>
      <div
        style={{
          width: "100%",
          height: "8px",
          background: COLORS.gray200,
          borderRadius: BORDERS.radius.md,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, progress)}%`,
            height: "100%",
            background: progress >= 100 ? COLORS.success : COLORS.primary,
            borderRadius: BORDERS.radius.md,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// ============================================================================
// Section Components
// ============================================================================

function SyncStatusSection({
  data,
  onSync,
  syncing,
}: {
  data: SyncStatus[];
  onSync: (type?: string) => void;
  syncing: boolean;
}) {
  const typeConfig: Record<string, { label: string; color: string }> = {
    issues: { label: "Issues", color: COLORS.primary },
    projects: { label: "Projects", color: "#8b5cf6" },
    cycles: { label: "Cycles", color: COLORS.warning },
    team_members: { label: "Team", color: COLORS.success },
    labels: { label: "Labels", color: "#ec4899" },
  };

  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Sync Status</h2>
        <button
          onClick={() => onSync()}
          disabled={syncing}
          style={{
            padding: `${SPACING.sm} ${SPACING.lg}`,
            background: syncing ? COLORS.gray400 : COLORS.primary,
            color: COLORS.textInverse,
            border: "none",
            borderRadius: BORDERS.radius.md,
            fontSize: TYPOGRAPHY.size.sm,
            fontWeight: TYPOGRAPHY.weight.medium,
            cursor: syncing ? "not-allowed" : "pointer",
          }}
        >
          {syncing ? "Syncing..." : "Sync All"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
        {data.map((status) => {
          const config = typeConfig[status.sync_type] || { label: status.sync_type, color: "#6b7280" };
          return (
            <div
              key={status.sync_type}
              style={{
                padding: "1rem",
                background: "var(--background)",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                borderTop: `3px solid ${config.color}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <strong style={{ fontSize: "0.9rem" }}>{config.label}</strong>
                <StatusBadge status={status.sync_health} />
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>
                {status.records_synced.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                Last: {formatRelativeTime(status.last_sync_at)}
              </div>
              {status.error_message && (
                <div
                  style={{
                    marginTop: SPACING.sm,
                    fontSize: TYPOGRAPHY.size['2xs'],
                    color: COLORS.error,
                    background: COLORS.errorLight,
                    padding: `${SPACING.xs} ${SPACING.sm}`,
                    borderRadius: BORDERS.radius.md,
                  }}
                >
                  {status.error_message.substring(0, 50)}...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CycleSection({ cycle }: { cycle: CurrentCycle | null }) {
  if (!cycle) {
    return (
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", marginBottom: "1rem" }}>Current Cycle</h2>
        <div
          style={{
            padding: "2rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
            textAlign: "center",
            color: "#6b7280",
          }}
        >
          No active cycle
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem", marginBottom: "1rem" }}>Current Cycle</h2>
      <div
        style={{
          padding: "1.5rem",
          background: "var(--background)",
          borderRadius: "8px",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
              {cycle.name || `Cycle ${cycle.number}`}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
              {cycle.days_remaining > 0 ? `${cycle.days_remaining} days remaining` : "Ending today"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#3b82f6" }}>{cycle.total_issues}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Total Issues</div>
          </div>
        </div>

        <ProgressBar progress={cycle.progress * 100} label="Cycle Progress" />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#10b981" }}>{cycle.completed_issues}</div>
            <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>Completed</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#3b82f6" }}>{cycle.in_progress_issues}</div>
            <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>In Progress</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#6b7280" }}>{cycle.todo_issues}</div>
            <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>To Do</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssueSummarySection({ data }: { data: IssueSummary[] }) {
  const stateConfig: Record<string, { label: string; color: string }> = {
    backlog: { label: "Backlog", color: "#6b7280" },
    unstarted: { label: "To Do", color: "#f59e0b" },
    started: { label: "In Progress", color: "#3b82f6" },
    completed: { label: "Completed", color: "#10b981" },
    canceled: { label: "Canceled", color: "#ef4444" },
  };

  const totalIssues = data.reduce((sum, d) => sum + d.issue_count, 0);
  const totalOverdue = data.reduce((sum, d) => sum + d.overdue, 0);
  const totalLinked = data.reduce((sum, d) => sum + d.linked_to_atlas, 0);

  return (
    <div style={{ marginBottom: "2rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem", marginBottom: "1rem" }}>Issues by State</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        {data.map((summary) => {
          const config = stateConfig[summary.state_type] || { label: summary.state_type, color: "#6b7280" };
          return (
            <div
              key={summary.state_type}
              style={{
                padding: "1rem",
                background: "var(--background)",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                borderLeft: `4px solid ${config.color}`,
              }}
            >
              <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>{config.label}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{summary.issue_count}</div>
              {summary.high_priority > 0 && (
                <div style={{ fontSize: "0.65rem", color: "#dc2626" }}>
                  {summary.high_priority} high priority
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {totalOverdue > 0 && (
          <div
            style={{
              padding: "0.5rem 1rem",
              background: "#fee2e2",
              color: "#dc2626",
              borderRadius: "6px",
              fontSize: "0.8rem",
              fontWeight: 500,
            }}
          >
            {totalOverdue} overdue
          </div>
        )}
        <div
          style={{
            padding: "0.5rem 1rem",
            background: "#dbeafe",
            color: "#1d4ed8",
            borderRadius: "6px",
            fontSize: "0.8rem",
            fontWeight: 500,
          }}
        >
          {totalLinked} linked to Atlas
        </div>
        <div
          style={{
            padding: "0.5rem 1rem",
            background: "var(--bg-secondary)",
            color: "#6b7280",
            borderRadius: "6px",
            fontSize: "0.8rem",
            fontWeight: 500,
          }}
        >
          {totalIssues} total issues
        </div>
      </div>
    </div>
  );
}

function TeamWorkloadSection({ data }: { data: TeamWorkload[] }) {
  if (data.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem", marginBottom: "1rem" }}>Team Workload</h2>
      <div style={{ background: "var(--background)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--section-bg)" }}>
              <th style={{ padding: "0.75rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.75rem" }}>
                Team Member
              </th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.75rem" }}>
                In Progress
              </th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.75rem" }}>
                To Do
              </th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.75rem" }}>
                Overdue
              </th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.75rem" }}>
                Estimate
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((member) => (
              <tr key={member.id}>
                <td style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {member.avatar_url ? (
                      <img
                        src={member.avatar_url}
                        alt=""
                        style={{ width: 24, height: 24, borderRadius: "50%" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: "var(--bg-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          color: "#6b7280",
                        }}
                      >
                        {member.name.charAt(0)}
                      </div>
                    )}
                    <span style={{ fontWeight: 500 }}>{member.display_name || member.name}</span>
                  </div>
                </td>
                <td style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontWeight: member.in_progress > 0 ? 600 : 400, color: member.in_progress > 0 ? "#3b82f6" : "#9ca3af" }}>
                    {member.in_progress}
                  </span>
                </td>
                <td style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)" }}>
                  {member.assigned_todo}
                </td>
                <td style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)" }}>
                  {member.overdue > 0 ? (
                    <span style={{ fontWeight: 600, color: "#dc2626" }}>{member.overdue}</span>
                  ) : (
                    <span style={{ color: "#9ca3af" }}>0</span>
                  )}
                </td>
                <td style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", color: "#6b7280" }}>
                  {member.total_estimate || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClaudeSessionsSection({ data }: { data: ClaudeSession[] }) {
  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Claude Code Sessions</h2>
        <Link
          href="/admin/linear/sessions"
          style={{
            fontSize: "0.85rem",
            color: "#3b82f6",
            textDecoration: "none",
          }}
        >
          View All
        </Link>
      </div>

      {data.length === 0 ? (
        <div
          style={{
            padding: "2rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
            textAlign: "center",
            color: "#6b7280",
          }}
        >
          No Claude Code sessions yet
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {data.slice(0, 5).map((session) => (
            <div
              key={session.id}
              style={{
                padding: "1rem",
                background: "var(--background)",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  {session.issue_identifier && (
                    <span
                      style={{
                        padding: "0.15rem 0.5rem",
                        background: "#dbeafe",
                        color: "#1d4ed8",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      {session.issue_identifier}
                    </span>
                  )}
                  <StatusBadge status={session.status} />
                </div>
                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                  {session.issue_title || session.branch_name || session.session_id}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.25rem" }}>
                  {session.commit_count || 0} commits, {session.files_count || 0} files |{" "}
                  {session.duration_hours.toFixed(1)}h
                </div>
              </div>
              <div style={{ fontSize: "0.7rem", color: "#6b7280", textAlign: "right" }}>
                {formatRelativeTime(session.started_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function LinearDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LinearDashboardData | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/linear/dashboard");
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error?.message || "Failed to fetch dashboard data");
      }
      setData(result.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (type?: string) => {
    setSyncing(true);
    try {
      const url = type ? `/api/cron/linear-sync?type=${type}` : "/api/cron/linear-sync";
      const res = await fetch(url, { method: "POST" });
      const result = await res.json();
      if (result.success) {
        await fetchData();
      } else {
        setError(result.error || result.message || "Sync failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (error) {
    return (
      <div>
        <h1>Linear Dashboard</h1>
        <div
          style={{
            padding: SPACING.lg,
            background: COLORS.errorLight,
            border: `${BORDERS.width.default} solid ${COLORS.error}`,
            borderRadius: BORDERS.radius.lg,
            marginBottom: SPACING.lg,
          }}
        >
          <strong>Error:</strong> {error}
        </div>
        <button onClick={fetchData} className="btn btn-primary">
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1>Linear Dashboard</h1>
        <p className="text-muted">Loading dashboard...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1>Linear Dashboard</h1>
        <p className="text-muted">No data available</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Linear Dashboard</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href="/admin/linear/issues" className="btn btn-secondary">
            All Issues
          </Link>
          <Link href="/admin/linear/sessions" className="btn btn-secondary">
            Sessions
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="Total Issues" value={data.totals.issues} accentColor="#3b82f6" href="/admin/linear/issues" />
        <StatCard label="Projects" value={data.totals.projects} accentColor="#8b5cf6" />
        <StatCard label="Cycles" value={data.totals.cycles} accentColor="#f59e0b" />
        <StatCard label="Team Members" value={data.totals.team_members} accentColor="#10b981" />
        <StatCard label="Labels" value={data.totals.labels} accentColor="#ec4899" />
        <StatCard label="Active Sessions" value={data.totals.active_sessions} accentColor="#6366f1" href="/admin/linear/sessions" />
      </div>

      {/* Sync Status */}
      <SyncStatusSection data={data.sync_status} onSync={handleSync} syncing={syncing} />

      {/* Current Cycle */}
      <CycleSection cycle={data.current_cycle} />

      {/* Issue Summary */}
      <IssueSummarySection data={data.issue_summary} />

      {/* Team Workload */}
      <TeamWorkloadSection data={data.team_workload} />

      {/* Claude Sessions */}
      <ClaudeSessionsSection data={data.recent_sessions} />
    </div>
  );
}
