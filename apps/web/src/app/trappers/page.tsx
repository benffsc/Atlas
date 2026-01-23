"use client";

import { useState, useEffect, useCallback } from "react";

interface Trapper {
  person_id: string;
  display_name: string;
  trapper_type: string;
  role_status: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  felv_positive_rate_pct: number | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

interface AggregateStats {
  total_active_trappers: number;
  ffsc_trappers: number;
  community_trappers: number;
  inactive_trappers: number;
  all_clinic_cats: number;
  all_clinic_days: number;
  avg_cats_per_day_all: number;
  felv_positive_rate_pct_all: number | null;
  all_site_visits: number;
  first_visit_success_rate_pct_all: number | null;
  all_cats_caught: number;
}

interface TrappersResponse {
  trappers: Trapper[];
  aggregates: AggregateStats;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "1rem",
        background: "#f8f9fa",
        borderRadius: "8px",
      }}
    >
      <div style={{ fontSize: "1.75rem", fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#666" }}>{label}</div>
      {sublabel && (
        <div style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.25rem" }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

export default function TrappersPage() {
  const [data, setData] = useState<TrappersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("total_cats_caught");
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchTrappers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    params.set("sort", sortBy);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/trappers?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch trappers");
      }
      const result: TrappersResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, sortBy, page]);

  useEffect(() => {
    fetchTrappers();
  }, [fetchTrappers]);

  const updateTrapper = async (personId: string, action: "status" | "type", value: string) => {
    setUpdating(personId);
    try {
      const response = await fetch("/api/trappers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId, action, value }),
      });
      if (response.ok) {
        fetchTrappers();
      } else {
        const err = await response.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error("Update error:", err);
    } finally {
      setUpdating(null);
    }
  };

  const agg = data?.aggregates;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Trappers</h1>

      {/* Aggregate Stats */}
      {agg && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          <StatCard
            label="Active Trappers"
            value={agg.total_active_trappers}
            sublabel={`${agg.ffsc_trappers} FFSC, ${agg.community_trappers} Community`}
          />
          <StatCard
            label="Total Cats Caught"
            value={agg.all_cats_caught}
            sublabel="via request assignments"
          />
          <StatCard
            label="Direct Bookings"
            value={agg.all_clinic_cats}
            sublabel="self-booked appointments"
          />
          <StatCard label="Clinic Days" value={agg.all_clinic_days} />
          <StatCard
            label="Avg Cats/Day"
            value={agg.avg_cats_per_day_all || "—"}
          />
          <StatCard
            label="FeLV Rate"
            value={
              agg.felv_positive_rate_pct_all !== null
                ? `${agg.felv_positive_rate_pct_all}%`
                : "—"
            }
          />
        </div>
      )}

      {/* Explanation */}
      <div
        style={{
          padding: "0.75rem 1rem",
          background: "#e7f3ff",
          borderRadius: "6px",
          marginBottom: "1rem",
          fontSize: "0.85rem",
          color: "#0c5460",
        }}
      >
        <strong>Understanding the metrics:</strong>{" "}
        <span style={{ color: "#17a2b8" }}>Total Caught</span> = cats attributed via request assignments (the primary metric).{" "}
        <span style={{ color: "#6c757d" }}>Direct Bookings</span> = appointments booked directly under the trapper&apos;s email (often lower since homeowners book their own appointments).
      </div>

      {/* Filters */}
      <div className="filters" style={{ marginBottom: "1.5rem" }}>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All Trappers</option>
          <option value="ffsc">FFSC Trappers</option>
          <option value="community">Community Trappers</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value);
            setPage(0);
          }}
        >
          <option value="total_cats_caught">Sort by Total Caught</option>
          <option value="total_clinic_cats">Sort by Direct Bookings</option>
          <option value="active_assignments">Sort by Active Assignments</option>
          <option value="completed_assignments">Sort by Completed</option>
          <option value="avg_cats_per_day">Sort by Avg Cats/Day</option>
          <option value="display_name">Sort by Name</option>
          <option value="last_activity_date">Sort by Last Activity</option>
        </select>
      </div>

      {loading && <div className="loading">Loading trappers...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          {data.trappers.length === 0 ? (
            <div className="empty">No trappers found.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>
                    <span title="Cats attributed via request assignments - the primary performance metric">
                      Total Caught
                    </span>
                  </th>
                  <th style={{ textAlign: "right" }}>
                    <span title="Appointments booked directly under trapper's email">
                      Direct
                    </span>
                  </th>
                  <th style={{ textAlign: "right" }}>Clinic Days</th>
                  <th style={{ textAlign: "right" }}>Cats/Day</th>
                  <th style={{ textAlign: "right" }}>Active</th>
                  <th style={{ textAlign: "right" }}>Completed</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.trappers.map((trapper) => {
                  const isInactive = trapper.role_status !== "active";
                  const rowStyle = isInactive
                    ? { opacity: 0.6, background: "#f9fafb" }
                    : {};

                  return (
                    <tr key={trapper.person_id} style={rowStyle}>
                      <td>
                        <a
                          href={`/trappers/${trapper.person_id}`}
                          style={{
                            fontWeight: 500,
                            color: isInactive ? "#9ca3af" : "var(--foreground)",
                            textDecoration: "none",
                          }}
                        >
                          {trapper.display_name}
                        </a>
                      </td>
                      <td>
                        <select
                          value={trapper.trapper_type}
                          onChange={(e) =>
                            updateTrapper(trapper.person_id, "type", e.target.value)
                          }
                          disabled={updating === trapper.person_id}
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.4rem",
                            borderRadius: "4px",
                            border: "1px solid #ddd",
                            background: isInactive ? "#e5e7eb" : "#fff",
                          }}
                        >
                          <option value="coordinator">Coordinator</option>
                          <option value="head_trapper">Head Trapper</option>
                          <option value="ffsc_trapper">FFSC Trapper</option>
                          <option value="community_trapper">Community</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={trapper.role_status}
                          onChange={(e) =>
                            updateTrapper(trapper.person_id, "status", e.target.value)
                          }
                          disabled={updating === trapper.person_id}
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.4rem",
                            borderRadius: "4px",
                            border: "1px solid #ddd",
                            background: isInactive ? "#fef3c7" : "#d1fae5",
                            color: isInactive ? "#92400e" : "#065f46",
                          }}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="suspended">Suspended</option>
                          <option value="revoked">Revoked</option>
                        </select>
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontWeight: 600,
                          color:
                            trapper.total_cats_caught > 0
                              ? "#198754"
                              : "#999",
                        }}
                      >
                        {trapper.total_cats_caught}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: "#6c757d",
                          fontSize: "0.9em",
                        }}
                        title="Appointments booked directly under their email"
                      >
                        {trapper.total_clinic_cats}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {trapper.unique_clinic_days}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {trapper.avg_cats_per_day}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            trapper.active_assignments > 0
                              ? "#fd7e14"
                              : "#999",
                        }}
                      >
                        {trapper.active_assignments}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {trapper.completed_assignments}
                      </td>
                      <td style={{ color: "#666", fontSize: "0.875rem" }}>
                        {trapper.last_activity_date
                          ? new Date(trapper.last_activity_date).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1rem",
              marginTop: "1.5rem",
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </button>
            <span style={{ display: "flex", alignItems: "center", color: "#666" }}>
              Page {page + 1}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.pagination.hasMore}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
