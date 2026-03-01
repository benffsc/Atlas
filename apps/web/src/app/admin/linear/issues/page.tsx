"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { COLORS, SPACING, TYPOGRAPHY, BORDERS } from "@/lib/design-tokens";
import { EmptyState, EmptySearchResults } from "@/components/feedback";

// ============================================================================
// Types
// ============================================================================

interface LinearIssue {
  id: string;
  linear_id: string;
  identifier: string;
  title: string;
  description: string | null;
  state_name: string | null;
  state_type: string | null;
  priority: number | null;
  priority_label: string | null;
  project_name: string | null;
  cycle_name: string | null;
  assignee_name: string | null;
  labels: { id: string; name: string; color: string }[];
  estimate: number | null;
  due_date: string | null;
  url: string | null;
  atlas_request_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface FilterOption {
  id: string;
  name: string;
}

// ============================================================================
// Helper Components
// ============================================================================

function PriorityBadge({ priority, label }: { priority: number | null; label: string | null }) {
  if (!priority || priority === 0) return null;

  const colors: Record<number, { bg: string; color: string }> = {
    1: { bg: COLORS.errorLight, color: COLORS.errorDark }, // Urgent
    2: { bg: COLORS.warningLight, color: COLORS.warningDark }, // High
    3: { bg: COLORS.primaryLight, color: COLORS.primaryDark }, // Normal
    4: { bg: COLORS.gray100, color: COLORS.gray600 }, // Low
  };

  const style = colors[priority] || colors[4];

  return (
    <span
      style={{
        padding: `${SPACING.xs} ${SPACING.sm}`,
        borderRadius: BORDERS.radius.md,
        fontSize: TYPOGRAPHY.size.xs,
        fontWeight: TYPOGRAPHY.weight.medium,
        background: style.bg,
        color: style.color,
      }}
    >
      {label || `P${priority}`}
    </span>
  );
}

function StateBadge({ stateType, stateName }: { stateType: string | null; stateName: string | null }) {
  const config: Record<string, { bg: string; color: string }> = {
    backlog: { bg: COLORS.gray100, color: COLORS.gray600 },
    unstarted: { bg: COLORS.warningLight, color: COLORS.warningDark },
    started: { bg: COLORS.primaryLight, color: COLORS.primaryDark },
    completed: { bg: COLORS.successLight, color: COLORS.successDark },
    canceled: { bg: COLORS.errorLight, color: COLORS.errorDark },
  };

  const style = config[stateType || ""] || config.backlog;

  return (
    <span
      style={{
        padding: `${SPACING.xs} ${SPACING.sm}`,
        borderRadius: BORDERS.radius.md,
        fontSize: TYPOGRAPHY.size.xs,
        fontWeight: TYPOGRAPHY.weight.medium,
        background: style.bg,
        color: style.color,
      }}
    >
      {stateName || stateType || "Unknown"}
    </span>
  );
}

function LabelTag({ name, color }: { name: string; color: string }) {
  return (
    <span
      style={{
        padding: `2px ${SPACING.xs}`,
        borderRadius: BORDERS.radius.sm,
        fontSize: TYPOGRAPHY.size["2xs"],
        fontWeight: TYPOGRAPHY.weight.medium,
        background: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      {name}
    </span>
  );
}

function AtlasLinkBadge({ requestId }: { requestId: string | null }) {
  if (!requestId) return null;

  return (
    <Link
      href={`/requests/${requestId}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: SPACING.xs,
        padding: `${SPACING.xs} ${SPACING.sm}`,
        borderRadius: BORDERS.radius.md,
        fontSize: TYPOGRAPHY.size.xs,
        fontWeight: TYPOGRAPHY.weight.medium,
        background: "#dbeafe",
        color: "#1d4ed8",
        textDecoration: "none",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      Atlas
    </Link>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function LinearIssuesPage() {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  // Filters
  const [search, setSearch] = useState("");
  const [stateType, setStateType] = useState<string>("");
  const [linked, setLinked] = useState<string>("");

  // Pagination
  const [page, setPage] = useState(1);
  const limit = 25;

  const fetchIssues = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", limit.toString());
      params.set("offset", ((page - 1) * limit).toString());
      if (search) params.set("q", search);
      if (stateType) params.set("state_type", stateType);
      if (linked) params.set("linked", linked);

      const res = await fetch(`/api/admin/linear/issues?${params}`);
      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error?.message || "Failed to fetch issues");
      }

      setIssues(result.data.issues);
      setTotal(result.data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, [page, stateType, linked]);

  useEffect(() => {
    // Debounce search
    const timeout = setTimeout(() => {
      setPage(1);
      fetchIssues();
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.lg }}>
        <div>
          <h1 style={{ margin: 0, marginBottom: SPACING.xs }}>Linear Issues</h1>
          <p style={{ margin: 0, color: COLORS.textSecondary, fontSize: TYPOGRAPHY.size.sm }}>
            {total} issues total
          </p>
        </div>
        <div style={{ display: "flex", gap: SPACING.sm }}>
          <Link href="/admin/linear" className="btn btn-secondary">
            Dashboard
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: SPACING.md,
          marginBottom: SPACING.lg,
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="Search issues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: `${SPACING.sm} ${SPACING.md}`,
            border: `1px solid ${COLORS.border}`,
            borderRadius: BORDERS.radius.md,
            fontSize: TYPOGRAPHY.size.sm,
            flex: "1 1 200px",
            minWidth: "200px",
          }}
        />

        <select
          value={stateType}
          onChange={(e) => {
            setStateType(e.target.value);
            setPage(1);
          }}
          style={{
            padding: `${SPACING.sm} ${SPACING.md}`,
            border: `1px solid ${COLORS.border}`,
            borderRadius: BORDERS.radius.md,
            fontSize: TYPOGRAPHY.size.sm,
            background: COLORS.bgPrimary,
          }}
        >
          <option value="">All States</option>
          <option value="started">In Progress</option>
          <option value="unstarted">To Do</option>
          <option value="backlog">Backlog</option>
          <option value="completed">Completed</option>
          <option value="canceled">Canceled</option>
        </select>

        <select
          value={linked}
          onChange={(e) => {
            setLinked(e.target.value);
            setPage(1);
          }}
          style={{
            padding: `${SPACING.sm} ${SPACING.md}`,
            border: `1px solid ${COLORS.border}`,
            borderRadius: BORDERS.radius.md,
            fontSize: TYPOGRAPHY.size.sm,
            background: COLORS.bgPrimary,
          }}
        >
          <option value="">All Issues</option>
          <option value="true">Linked to Atlas</option>
          <option value="false">Not Linked</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: SPACING.lg,
            background: COLORS.errorLight,
            border: `1px solid ${COLORS.error}`,
            borderRadius: BORDERS.radius.lg,
            marginBottom: SPACING.lg,
          }}
        >
          <strong>Error:</strong> {error}
          <button onClick={fetchIssues} style={{ marginLeft: SPACING.md }} className="btn btn-sm">
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: SPACING["2xl"], color: COLORS.textSecondary }}>
          Loading issues...
        </div>
      )}

      {/* Empty State */}
      {!loading && issues.length === 0 && (
        search ? (
          <EmptySearchResults query={search} onClear={() => setSearch("")} />
        ) : (
          <EmptyState
            title="No issues found"
            description="There are no Linear issues matching your filters"
          />
        )
      )}

      {/* Issues Table */}
      {!loading && issues.length > 0 && (
        <div
          style={{
            background: COLORS.bgPrimary,
            borderRadius: BORDERS.radius.lg,
            border: `1px solid ${COLORS.border}`,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: COLORS.bgSecondary }}>
                <th
                  style={{
                    padding: SPACING.md,
                    textAlign: "left",
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: TYPOGRAPHY.size.xs,
                    fontWeight: TYPOGRAPHY.weight.semibold,
                    color: COLORS.textSecondary,
                  }}
                >
                  Issue
                </th>
                <th
                  style={{
                    padding: SPACING.md,
                    textAlign: "left",
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: TYPOGRAPHY.size.xs,
                    fontWeight: TYPOGRAPHY.weight.semibold,
                    color: COLORS.textSecondary,
                    width: "120px",
                  }}
                >
                  State
                </th>
                <th
                  style={{
                    padding: SPACING.md,
                    textAlign: "left",
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: TYPOGRAPHY.size.xs,
                    fontWeight: TYPOGRAPHY.weight.semibold,
                    color: COLORS.textSecondary,
                    width: "100px",
                  }}
                >
                  Priority
                </th>
                <th
                  style={{
                    padding: SPACING.md,
                    textAlign: "left",
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: TYPOGRAPHY.size.xs,
                    fontWeight: TYPOGRAPHY.weight.semibold,
                    color: COLORS.textSecondary,
                    width: "120px",
                  }}
                >
                  Assignee
                </th>
                <th
                  style={{
                    padding: SPACING.md,
                    textAlign: "center",
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: TYPOGRAPHY.size.xs,
                    fontWeight: TYPOGRAPHY.weight.semibold,
                    color: COLORS.textSecondary,
                    width: "80px",
                  }}
                >
                  Atlas
                </th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr
                  key={issue.id}
                  style={{
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.bgSecondary)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onClick={() => issue.url && window.open(issue.url, "_blank")}
                >
                  <td style={{ padding: SPACING.md, borderBottom: `1px solid ${COLORS.border}` }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: SPACING.xs }}>
                      <div style={{ display: "flex", alignItems: "center", gap: SPACING.sm }}>
                        <span
                          style={{
                            fontSize: TYPOGRAPHY.size.xs,
                            fontWeight: TYPOGRAPHY.weight.semibold,
                            color: COLORS.primary,
                          }}
                        >
                          {issue.identifier}
                        </span>
                        <span style={{ fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium }}>
                          {issue.title}
                        </span>
                      </div>
                      {issue.labels && issue.labels.length > 0 && (
                        <div style={{ display: "flex", gap: SPACING.xs, flexWrap: "wrap" }}>
                          {issue.labels.slice(0, 3).map((label) => (
                            <LabelTag key={label.id} name={label.name} color={label.color} />
                          ))}
                          {issue.labels.length > 3 && (
                            <span style={{ fontSize: TYPOGRAPHY.size["2xs"], color: COLORS.textMuted }}>
                              +{issue.labels.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                      {(issue.project_name || issue.cycle_name) && (
                        <div style={{ fontSize: TYPOGRAPHY.size["2xs"], color: COLORS.textMuted }}>
                          {[issue.project_name, issue.cycle_name].filter(Boolean).join(" / ")}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: SPACING.md, borderBottom: `1px solid ${COLORS.border}` }}>
                    <StateBadge stateType={issue.state_type} stateName={issue.state_name} />
                  </td>
                  <td style={{ padding: SPACING.md, borderBottom: `1px solid ${COLORS.border}` }}>
                    <PriorityBadge priority={issue.priority} label={issue.priority_label} />
                  </td>
                  <td style={{ padding: SPACING.md, borderBottom: `1px solid ${COLORS.border}` }}>
                    <span style={{ fontSize: TYPOGRAPHY.size.sm, color: issue.assignee_name ? COLORS.textPrimary : COLORS.textMuted }}>
                      {issue.assignee_name || "Unassigned"}
                    </span>
                  </td>
                  <td style={{ padding: SPACING.md, borderBottom: `1px solid ${COLORS.border}`, textAlign: "center" }}>
                    <AtlasLinkBadge requestId={issue.atlas_request_id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: SPACING.md,
            marginTop: SPACING.lg,
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: `${SPACING.sm} ${SPACING.md}`,
              border: `1px solid ${COLORS.border}`,
              borderRadius: BORDERS.radius.md,
              background: page === 1 ? COLORS.gray100 : COLORS.bgPrimary,
              color: page === 1 ? COLORS.textMuted : COLORS.textPrimary,
              cursor: page === 1 ? "not-allowed" : "pointer",
            }}
          >
            Previous
          </button>
          <span style={{ fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSecondary }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: `${SPACING.sm} ${SPACING.md}`,
              border: `1px solid ${COLORS.border}`,
              borderRadius: BORDERS.radius.md,
              background: page === totalPages ? COLORS.gray100 : COLORS.bgPrimary,
              color: page === totalPages ? COLORS.textMuted : COLORS.textPrimary,
              cursor: page === totalPages ? "not-allowed" : "pointer",
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
