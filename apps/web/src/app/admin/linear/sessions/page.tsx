"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { COLORS, SPACING, TYPOGRAPHY, BORDERS } from "@/lib/design-tokens";
import { EmptyState, EmptySearchResults } from "@/components/feedback/EmptyState";

// ============================================================================
// Types
// ============================================================================

interface Session {
  id: string;
  session_id: string;
  linear_issue_id: string | null;
  branch_name: string | null;
  commit_hashes: string[] | null;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  files_changed: string[] | null;
  metadata: object;
  issue_identifier: string | null;
  issue_title: string | null;
  issue_state_name: string | null;
  issue_state_type: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

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

function formatDuration(startStr: string, endStr: string | null): string {
  const start = new Date(startStr);
  const end = endStr ? new Date(endStr) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ============================================================================
// Components
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: COLORS.primaryLight, color: COLORS.primaryDark, label: "Active" },
    completed: { bg: COLORS.successLight, color: COLORS.successDark, label: "Completed" },
    paused: { bg: COLORS.warningLight, color: COLORS.warningDark, label: "Paused" },
    abandoned: { bg: COLORS.gray100, color: COLORS.gray500, label: "Abandoned" },
  };
  const { bg, color, label } = config[status.toLowerCase()] || {
    bg: COLORS.gray100,
    color: COLORS.gray500,
    label: status,
  };

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

function IssueBadge({ identifier, title }: { identifier: string; title: string | null }) {
  return (
    <Link
      href={`/admin/linear/issues`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: SPACING.xs,
        padding: `${SPACING.xs} ${SPACING.sm}`,
        background: COLORS.primaryLight,
        color: COLORS.primaryDark,
        borderRadius: BORDERS.radius.md,
        fontSize: TYPOGRAPHY.size.xs,
        fontWeight: TYPOGRAPHY.weight.semibold,
        textDecoration: "none",
      }}
    >
      {identifier}
    </Link>
  );
}

function SessionCard({ session, expanded, onToggle }: { session: Session; expanded: boolean; onToggle: () => void }) {
  const commitCount = session.commit_hashes?.length || 0;
  const filesCount = session.files_changed?.length || 0;

  return (
    <div
      style={{
        background: COLORS.bgPrimary,
        borderRadius: BORDERS.radius.lg,
        border: `${BORDERS.width.default} solid ${COLORS.border}`,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        onClick={onToggle}
        style={{
          padding: SPACING.lg,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: expanded ? `${BORDERS.width.default} solid ${COLORS.border}` : "none",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: SPACING.sm, marginBottom: SPACING.xs }}>
            <StatusBadge status={session.status} />
            {session.issue_identifier && (
              <IssueBadge identifier={session.issue_identifier} title={session.issue_title} />
            )}
          </div>

          <div style={{ fontWeight: TYPOGRAPHY.weight.semibold, marginBottom: SPACING.xs }}>
            {session.issue_title || session.branch_name || session.session_id}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: SPACING.md, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSecondary }}>
            {session.branch_name && (
              <span style={{ fontFamily: "monospace", fontSize: TYPOGRAPHY.size.xs, background: COLORS.gray100, padding: `2px ${SPACING.xs}`, borderRadius: BORDERS.radius.sm }}>
                {session.branch_name}
              </span>
            )}
            <span>{commitCount} commits</span>
            <span>{filesCount} files</span>
            <span>{formatDuration(session.started_at, session.completed_at)}</span>
          </div>
        </div>

        <div style={{ textAlign: "right", marginLeft: SPACING.lg }}>
          <div style={{ fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSecondary }}>
            {formatRelativeTime(session.started_at)}
          </div>
          {session.pr_url && (
            <a
              href={session.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: SPACING.xs,
                marginTop: SPACING.xs,
                fontSize: TYPOGRAPHY.size.xs,
                color: COLORS.primary,
                textDecoration: "none",
              }}
            >
              PR #{session.pr_number}
            </a>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div style={{ padding: SPACING.lg, background: COLORS.gray50 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.lg }}>
            {/* Left Column */}
            <div>
              <div style={{ marginBottom: SPACING.md }}>
                <div style={{ fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.semibold, color: COLORS.textSecondary, marginBottom: SPACING.xs }}>
                  TIMELINE
                </div>
                <div style={{ fontSize: TYPOGRAPHY.size.sm }}>
                  <div><strong>Started:</strong> {formatDateTime(session.started_at)}</div>
                  <div><strong>Completed:</strong> {formatDateTime(session.completed_at)}</div>
                </div>
              </div>

              {session.summary && (
                <div style={{ marginBottom: SPACING.md }}>
                  <div style={{ fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.semibold, color: COLORS.textSecondary, marginBottom: SPACING.xs }}>
                    SUMMARY
                  </div>
                  <div style={{ fontSize: TYPOGRAPHY.size.sm, whiteSpace: "pre-wrap" }}>
                    {session.summary}
                  </div>
                </div>
              )}

              {session.commit_hashes && session.commit_hashes.length > 0 && (
                <div>
                  <div style={{ fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.semibold, color: COLORS.textSecondary, marginBottom: SPACING.xs }}>
                    COMMITS ({session.commit_hashes.length})
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: SPACING.xs }}>
                    {session.commit_hashes.slice(0, 10).map((hash, i) => (
                      <span
                        key={i}
                        style={{
                          fontFamily: "monospace",
                          fontSize: TYPOGRAPHY.size.xs,
                          background: COLORS.gray200,
                          padding: `2px ${SPACING.xs}`,
                          borderRadius: BORDERS.radius.sm,
                        }}
                      >
                        {hash.substring(0, 7)}
                      </span>
                    ))}
                    {session.commit_hashes.length > 10 && (
                      <span style={{ fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSecondary }}>
                        +{session.commit_hashes.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column */}
            <div>
              {session.files_changed && session.files_changed.length > 0 && (
                <div>
                  <div style={{ fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.semibold, color: COLORS.textSecondary, marginBottom: SPACING.xs }}>
                    FILES CHANGED ({session.files_changed.length})
                  </div>
                  <div
                    style={{
                      maxHeight: "200px",
                      overflowY: "auto",
                      background: COLORS.bgPrimary,
                      borderRadius: BORDERS.radius.md,
                      padding: SPACING.sm,
                      border: `${BORDERS.width.default} solid ${COLORS.border}`,
                    }}
                  >
                    {session.files_changed.map((file, i) => (
                      <div
                        key={i}
                        style={{
                          fontFamily: "monospace",
                          fontSize: TYPOGRAPHY.size.xs,
                          padding: `${SPACING.xs} 0`,
                          borderBottom: i < session.files_changed!.length - 1 ? `1px solid ${COLORS.gray100}` : "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={file}
                      >
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function LinearSessionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", limit.toString());
      params.set("offset", offset.toString());
      if (search) params.set("q", search);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/admin/linear/sessions?${params}`);
      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error?.message || "Failed to fetch sessions");
      }

      setSessions(result.data.sessions);
      setTotal(result.data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, offset]);

  useEffect(() => {
    const timer = setTimeout(fetchSessions, 300);
    return () => clearTimeout(timer);
  }, [fetchSessions]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [search, statusFilter]);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  const hasAppliedFilters = search || statusFilter;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.lg }}>
        <div>
          <h1 style={{ margin: 0 }}>Claude Code Sessions</h1>
          <p style={{ margin: 0, marginTop: SPACING.xs, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSecondary }}>
            Development sessions linked to Linear issues
          </p>
        </div>
        <Link href="/admin/linear" className="btn btn-secondary">
          Back to Dashboard
        </Link>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: SPACING.md,
          marginBottom: SPACING.lg,
          padding: SPACING.md,
          background: COLORS.bgPrimary,
          borderRadius: BORDERS.radius.lg,
          border: `${BORDERS.width.default} solid ${COLORS.border}`,
        }}
      >
        <input
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: `${SPACING.sm} ${SPACING.md}`,
            border: `${BORDERS.width.default} solid ${COLORS.border}`,
            borderRadius: BORDERS.radius.md,
            fontSize: TYPOGRAPHY.size.sm,
          }}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: `${SPACING.sm} ${SPACING.md}`,
            border: `${BORDERS.width.default} solid ${COLORS.border}`,
            borderRadius: BORDERS.radius.md,
            fontSize: TYPOGRAPHY.size.sm,
            minWidth: "150px",
          }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="paused">Paused</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>

      {/* Error State */}
      {error && (
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
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: "center", padding: SPACING.xl, color: COLORS.textSecondary }}>
          Loading sessions...
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && sessions.length === 0 && (
        hasAppliedFilters ? (
          <EmptySearchResults
            query={search || statusFilter}
            onClear={() => {
              setSearch("");
              setStatusFilter("");
            }}
          />
        ) : (
          <EmptyState
            title="No Claude Code sessions"
            description="Development sessions will appear here when Claude Code sessions are linked to Linear issues."
          />
        )
      )}

      {/* Sessions List */}
      {!loading && !error && sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: SPACING.md }}>
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              expanded={expandedId === session.id}
              onToggle={() => setExpandedId(expandedId === session.id ? null : session.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > limit && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: SPACING.lg,
            padding: SPACING.md,
            background: COLORS.bgPrimary,
            borderRadius: BORDERS.radius.lg,
            border: `${BORDERS.width.default} solid ${COLORS.border}`,
          }}
        >
          <span style={{ fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSecondary }}>
            Showing {offset + 1}-{Math.min(offset + limit, total)} of {total} sessions
          </span>

          <div style={{ display: "flex", gap: SPACING.sm }}>
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              style={{
                padding: `${SPACING.sm} ${SPACING.md}`,
                background: offset === 0 ? COLORS.gray100 : COLORS.bgPrimary,
                border: `${BORDERS.width.default} solid ${COLORS.border}`,
                borderRadius: BORDERS.radius.md,
                cursor: offset === 0 ? "not-allowed" : "pointer",
                color: offset === 0 ? COLORS.textMuted : COLORS.textPrimary,
              }}
            >
              Previous
            </button>

            <span
              style={{
                padding: `${SPACING.sm} ${SPACING.md}`,
                fontSize: TYPOGRAPHY.size.sm,
                color: COLORS.textSecondary,
              }}
            >
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              style={{
                padding: `${SPACING.sm} ${SPACING.md}`,
                background: offset + limit >= total ? COLORS.gray100 : COLORS.bgPrimary,
                border: `${BORDERS.width.default} solid ${COLORS.border}`,
                borderRadius: BORDERS.radius.md,
                cursor: offset + limit >= total ? "not-allowed" : "pointer",
                color: offset + limit >= total ? COLORS.textMuted : COLORS.textPrimary,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
