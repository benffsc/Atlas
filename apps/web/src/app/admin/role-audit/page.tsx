"use client";

import { useState, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RoleAuditSummary {
  stale_roles: number;
  missing_volunteer: number;
  source_conflicts: number;
  unmatched_fosters: number;
}

interface StaleRole {
  role_id: string;
  person_id: string;
  display_name: string;
  role: string;
  trapper_type: string | null;
  days_since_departure: number | null;
  groups_left: string[];
}

interface MissingVolunteer {
  person_id: string;
  display_name: string;
  roles_without_volunteer: string[];
  role_sources: string[];
  has_vh_record: boolean;
}

interface SourceConflict {
  person_id: string;
  display_name: string;
  role: string;
  atlas_status: string;
  source_status: string;
}

interface UnmatchedFoster {
  id: string;
  hold_for_name: string;
  foster_email: string | null;
  cat_name: string | null;
  match_attempt: string;
  created_at: string;
}

interface RecentReconciliation {
  person_id: string;
  display_name: string;
  role: string;
  previous_status: string;
  new_status: string;
  reason: string;
  created_at: string;
}

interface RoleAuditResponse {
  summary: RoleAuditSummary;
  stale_roles: StaleRole[];
  missing_volunteer: MissingVolunteer[];
  source_conflicts: SourceConflict[];
  unmatched_fosters: UnmatchedFoster[];
  recent_reconciliations: RecentReconciliation[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: "stale_roles", label: "Stale Roles" },
  { key: "missing_volunteer", label: "Missing Volunteer" },
  { key: "source_conflicts", label: "Source Conflicts" },
  { key: "unmatched_fosters", label: "Unmatched Fosters" },
  { key: "recent_activity", label: "Recent Activity" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const ROLE_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  staff: { bg: "#eef2ff", text: "#4338ca" },
  trapper: { bg: "#ecfdf5", text: "#065f46" },
  foster: { bg: "#fdf2f8", text: "#9d174d" },
  caretaker: { bg: "#ecfeff", text: "#0e7490" },
  volunteer: { bg: "#f5f3ff", text: "#6d28d9" },
};

/* ------------------------------------------------------------------ */
/*  Helper components                                                  */
/* ------------------------------------------------------------------ */

function RoleBadge({ role }: { role: string }) {
  const colors = ROLE_BADGE_COLORS[role] || { bg: "var(--card-border)", text: "var(--foreground)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: "4px",
        fontSize: "0.75rem",
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
      }}
    >
      {role}
    </span>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function PersonLink({ personId, name }: { personId: string; name: string }) {
  return (
    <a
      href={`/people/${personId}`}
      style={{ color: "var(--accent, #0d6efd)", textDecoration: "none", fontWeight: 500 }}
    >
      {name}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function RoleAuditPage() {
  const [data, setData] = useState<RoleAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("stale_roles");
  const [deactivating, setDeactivating] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/role-audit");
      if (!res.ok) throw new Error("Failed to fetch role audit data");
      const result: RoleAuditResponse = await res.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDeactivate = async (personId: string, role: string) => {
    setDeactivating(`${personId}-${role}`);
    try {
      const res = await fetch(`/api/people/${personId}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          action: "deactivate",
          notes: "Deactivated via role audit dashboard",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to deactivate role");
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deactivation failed");
    } finally {
      setDeactivating(null);
    }
  };

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div>
        <h1>Role Audit</h1>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (error && !data) {
    return (
      <div>
        <h1>Role Audit</h1>
        <div
          className="card"
          style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444" }}
        >
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary } = data;

  /* ---- Determine indicator color per metric ---- */
  const indicatorColor = (key: keyof RoleAuditSummary, value: number): string => {
    if (value === 0) return "#10b981"; // green
    if (key === "unmatched_fosters") return "#3b82f6"; // blue / info
    if (key === "missing_volunteer") return "#ef4444"; // red / danger
    return "#f59e0b"; // amber / warning
  };

  const summaryCards: { key: keyof RoleAuditSummary; label: string }[] = [
    { key: "stale_roles", label: "Stale Roles" },
    { key: "missing_volunteer", label: "Missing Volunteer" },
    { key: "source_conflicts", label: "Source Conflicts" },
    { key: "unmatched_fosters", label: "Unmatched Fosters" },
  ];

  return (
    <div>
      {/* ---- Header ---- */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Role Audit</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Monitor and resolve role integrity issues
        </p>
      </div>

      {/* ---- Dismissible error banner ---- */}
      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#fef2f2",
            border: "1px solid #ef4444",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
              color: "#dc2626",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ---- Summary stat cards ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        {summaryCards.map(({ key, label }) => {
          const value = summary[key];
          const color = indicatorColor(key, value);
          return (
            <div
              key={key}
              className="card"
              style={{
                padding: "1rem",
                borderLeft: `4px solid ${color}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <StatusDot color={color} />
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{label}</span>
              </div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1 }}>
                {value}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- Tab bar ---- */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
          paddingBottom: "0.5rem",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px 6px 0 0",
              border: "none",
              background: activeTab === tab.key ? "var(--accent, #0d6efd)" : "transparent",
              color: activeTab === tab.key ? "#fff" : "var(--foreground)",
              cursor: "pointer",
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: "0.875rem",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---- Tab content ---- */}
      {activeTab === "stale_roles" && (
        <StaleRolesTab
          rows={data.stale_roles}
          deactivating={deactivating}
          onDeactivate={handleDeactivate}
        />
      )}
      {activeTab === "missing_volunteer" && (
        <MissingVolunteerTab rows={data.missing_volunteer} />
      )}
      {activeTab === "source_conflicts" && (
        <SourceConflictsTab rows={data.source_conflicts} />
      )}
      {activeTab === "unmatched_fosters" && (
        <UnmatchedFostersTab rows={data.unmatched_fosters} />
      )}
      {activeTab === "recent_activity" && (
        <RecentActivityTab rows={data.recent_reconciliations} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared table wrapper                                               */
/* ------------------------------------------------------------------ */

function TableWrapper({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  if (empty) {
    return (
      <div
        className="card"
        style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}
      >
        No records found
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.875rem",
        }}
      >
        {children}
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 1rem",
  borderBottom: "2px solid var(--card-border, #e5e7eb)",
  color: "var(--muted)",
  fontWeight: 600,
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  borderBottom: "1px solid var(--card-border, #e5e7eb)",
  verticalAlign: "middle",
};

/* ------------------------------------------------------------------ */
/*  Tab: Stale Roles                                                   */
/* ------------------------------------------------------------------ */

function StaleRolesTab({
  rows,
  deactivating,
  onDeactivate,
}: {
  rows: StaleRole[];
  deactivating: string | null;
  onDeactivate: (personId: string, role: string) => void;
}) {
  return (
    <TableWrapper empty={rows.length === 0}>
      <thead>
        <tr>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>Role</th>
          <th style={thStyle}>Type</th>
          <th style={thStyle}>Days Since Departure</th>
          <th style={thStyle}>Groups Left</th>
          <th style={thStyle} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.role_id}>
            <td style={tdStyle}>
              <PersonLink personId={row.person_id} name={row.display_name} />
            </td>
            <td style={tdStyle}>
              <RoleBadge role={row.role} />
            </td>
            <td style={tdStyle}>{row.trapper_type || "--"}</td>
            <td style={tdStyle}>
              {row.days_since_departure != null ? row.days_since_departure : "--"}
            </td>
            <td style={tdStyle}>
              {row.groups_left.length > 0 ? (
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                  {row.groups_left.map((g) => (
                    <span
                      key={g}
                      style={{
                        padding: "0.1rem 0.4rem",
                        borderRadius: "4px",
                        background: "var(--card-border, #e5e7eb)",
                        fontSize: "0.75rem",
                      }}
                    >
                      {g}
                    </span>
                  ))}
                </div>
              ) : (
                "--"
              )}
            </td>
            <td style={{ ...tdStyle, textAlign: "right" }}>
              <button
                onClick={() => onDeactivate(row.person_id, row.role)}
                disabled={deactivating === `${row.person_id}-${row.role}`}
                style={{
                  padding: "0.35rem 0.75rem",
                  borderRadius: "4px",
                  border: "none",
                  background: "#fef2f2",
                  color: "#dc2626",
                  cursor: deactivating === `${row.person_id}-${row.role}` ? "not-allowed" : "pointer",
                  fontWeight: 500,
                  fontSize: "0.8rem",
                  opacity: deactivating === `${row.person_id}-${row.role}` ? 0.6 : 1,
                }}
              >
                {deactivating === `${row.person_id}-${row.role}` ? "Deactivating..." : "Deactivate"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrapper>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Missing Volunteer                                             */
/* ------------------------------------------------------------------ */

function MissingVolunteerTab({ rows }: { rows: MissingVolunteer[] }) {
  return (
    <TableWrapper empty={rows.length === 0}>
      <thead>
        <tr>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>Roles</th>
          <th style={thStyle}>Sources</th>
          <th style={thStyle}>VH Record</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.person_id}>
            <td style={tdStyle}>
              <PersonLink personId={row.person_id} name={row.display_name} />
            </td>
            <td style={tdStyle}>
              <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                {row.roles_without_volunteer.map((r) => (
                  <RoleBadge key={r} role={r} />
                ))}
              </div>
            </td>
            <td style={tdStyle}>
              <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                {row.role_sources.map((s) => (
                  <span
                    key={s}
                    style={{
                      padding: "0.1rem 0.4rem",
                      borderRadius: "4px",
                      background: "var(--card-border, #e5e7eb)",
                      fontSize: "0.75rem",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </td>
            <td style={tdStyle}>
              <span
                style={{
                  display: "inline-block",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  background: row.has_vh_record ? "#ecfdf5" : "#fef2f2",
                  color: row.has_vh_record ? "#065f46" : "#dc2626",
                }}
              >
                {row.has_vh_record ? "Yes" : "No"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrapper>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Source Conflicts                                               */
/* ------------------------------------------------------------------ */

function SourceConflictsTab({ rows }: { rows: SourceConflict[] }) {
  return (
    <TableWrapper empty={rows.length === 0}>
      <thead>
        <tr>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>Role</th>
          <th style={thStyle}>Atlas Status</th>
          <th style={thStyle}>Source Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.person_id}-${row.role}-${i}`}>
            <td style={tdStyle}>
              <PersonLink personId={row.person_id} name={row.display_name} />
            </td>
            <td style={tdStyle}>
              <RoleBadge role={row.role} />
            </td>
            <td style={tdStyle}>
              <span
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  background: "#fef3c7",
                  color: "#92400e",
                }}
              >
                {row.atlas_status}
              </span>
            </td>
            <td style={tdStyle}>
              <span
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  background: "#fef3c7",
                  color: "#92400e",
                }}
              >
                {row.source_status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrapper>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Unmatched Fosters                                             */
/* ------------------------------------------------------------------ */

function UnmatchedFostersTab({ rows }: { rows: UnmatchedFoster[] }) {
  return (
    <TableWrapper empty={rows.length === 0}>
      <thead>
        <tr>
          <th style={thStyle}>Hold For Name</th>
          <th style={thStyle}>Foster Email</th>
          <th style={thStyle}>Cat Name</th>
          <th style={thStyle}>Match Attempt</th>
          <th style={thStyle}>Created</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td style={tdStyle}>
              <span style={{ fontWeight: 500 }}>{row.hold_for_name}</span>
            </td>
            <td style={tdStyle}>
              {row.foster_email || (
                <span style={{ color: "var(--muted)" }}>--</span>
              )}
            </td>
            <td style={tdStyle}>
              {row.cat_name || (
                <span style={{ color: "var(--muted)" }}>--</span>
              )}
            </td>
            <td style={tdStyle}>
              <span
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                }}
              >
                {row.match_attempt}
              </span>
            </td>
            <td style={tdStyle}>
              {new Date(row.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrapper>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Recent Activity                                               */
/* ------------------------------------------------------------------ */

function RecentActivityTab({ rows }: { rows: RecentReconciliation[] }) {
  return (
    <TableWrapper empty={rows.length === 0}>
      <thead>
        <tr>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>Role</th>
          <th style={thStyle}>Previous</th>
          <th style={thStyle}>New</th>
          <th style={thStyle}>Reason</th>
          <th style={thStyle}>Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.person_id}-${row.role}-${i}`}>
            <td style={tdStyle}>
              <PersonLink personId={row.person_id} name={row.display_name} />
            </td>
            <td style={tdStyle}>
              <RoleBadge role={row.role} />
            </td>
            <td style={tdStyle}>
              <span
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  background: "#fef2f2",
                  color: "#dc2626",
                }}
              >
                {row.previous_status}
              </span>
            </td>
            <td style={tdStyle}>
              <span
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  background: "#ecfdf5",
                  color: "#065f46",
                }}
              >
                {row.new_status}
              </span>
            </td>
            <td style={tdStyle}>
              <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                {row.reason}
              </span>
            </td>
            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
              {new Date(row.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrapper>
  );
}
