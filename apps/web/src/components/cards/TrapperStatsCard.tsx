"use client";

import { useState, useEffect } from "react";
import { fetchApi, ApiError } from "@/lib/api-client";
import { TrapperBadge } from "@/components/badges";

interface TrapperStats {
  person_id: string;
  display_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_site_visits: number;
  assessment_visits: number;
  first_visit_success_rate_pct: number | null;
  cats_from_visits: number;
  cats_from_assignments: number;
  cats_altered_from_assignments: number;
  manual_catches: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  spayed_count: number;
  neutered_count: number;
  total_altered: number;
  felv_tested_count: number;
  felv_positive_count: number;
  felv_positive_rate_pct: number | null;
  first_clinic_date: string | null;
  last_clinic_date: string | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

interface TrapperStatsCardProps {
  personId: string;
  compact?: boolean;
}

function StatBox({
  label,
  value,
  sublabel,
  color,
  onClick,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "center",
        padding: "0.75rem",
        background: "#f8f9fa",
        borderRadius: "8px",
        cursor: onClick ? "pointer" : "default",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.background = "#e9ecef";
      }}
      onMouseLeave={(e) => {
        if (onClick) e.currentTarget.style.background = "#f8f9fa";
      }}
    >
      <div
        style={{ fontSize: "1.5rem", fontWeight: "bold", color: color || "inherit" }}
      >
        {value}
      </div>
      <div style={{ fontSize: "0.7rem", color: "#666" }}>{label}</div>
      {sublabel && (
        <div style={{ fontSize: "0.65rem", color: "#999", marginTop: "0.125rem" }}>
          {sublabel}
        </div>
      )}
      {onClick && (
        <div style={{ fontSize: "0.6rem", color: "#0d6efd", marginTop: "0.25rem" }}>
          Click for details
        </div>
      )}
    </div>
  );
}

function StatsBreakdownModal({
  stats,
  onClose,
}: {
  stats: TrapperStats;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--background, #fff)",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "550px",
          width: "90%",
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem", fontWeight: 600 }}>
          Stats Breakdown for {stats.display_name}
        </h3>

        {/* Cats Caught Section */}
        <div
          style={{
            background: "#f8f9fa",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 600, color: "#198754" }}>
            Total Cats Caught: {stats.total_cats_caught}
          </h4>
          <div style={{ fontSize: "0.875rem", lineHeight: 1.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span>From Request Assignments:</span>
              <strong>{stats.cats_from_assignments}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span>Direct Clinic Bookings:</span>
              <strong>{stats.total_clinic_cats}</strong>
            </div>
            {stats.cats_from_visits > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span>From Site Visits:</span>
                <strong>{stats.cats_from_visits}</strong>
              </div>
            )}
            {stats.manual_catches > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Manual Catches:</span>
                <strong>+{stats.manual_catches}</strong>
              </div>
            )}
          </div>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "#666", fontStyle: "italic" }}>
            Total Caught = max(assignments, direct, visits) + manual catches.
            The largest source is used to avoid double-counting.
          </p>
        </div>

        {/* Alterations Section */}
        <div
          style={{
            background: "#f8f9fa",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 600, color: "#0d6efd" }}>
            Total Alterations: {stats.total_altered}
          </h4>
          <div style={{ fontSize: "0.875rem", lineHeight: 1.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span>From Request Assignments:</span>
              <strong>{stats.cats_altered_from_assignments || 0}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span>Direct Clinic Bookings:</span>
              <strong>{stats.spayed_count + stats.neutered_count}</strong>
            </div>
            <div style={{ borderTop: "1px solid #dee2e6", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Spayed:</span>
                <strong>{stats.spayed_count}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Neutered:</span>
                <strong>{stats.neutered_count}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Important Notes */}
        <div
          style={{
            background: "#fff3cd",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
            border: "1px solid #ffc107",
          }}
        >
          <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600, color: "#856404" }}>
            Understanding the Numbers
          </h4>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem", color: "#856404", lineHeight: 1.5 }}>
            <li>
              <strong>Total Caught</strong> may include the same cat multiple times (e.g., initial trapping + wellness visits).
            </li>
            <li>
              <strong>Request Assignments</strong> counts cats at locations of assigned requests - these are cats attributed to the trapper&apos;s work.
            </li>
            <li>
              <strong>Direct Bookings</strong> are appointments where the trapper personally booked (matched by email/phone).
            </li>
            <li>
              The gap between Caught and Altered may include wellness visits, already-altered cats, or pending appointments.
            </li>
          </ul>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1.25rem",
              background: "var(--primary, #0d6efd)",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function TrapperStatsCard({ personId, compact = false }: TrapperStatsCardProps) {
  const [stats, setStats] = useState<TrapperStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      try {
        const data = await fetchApi<TrapperStats>(`/api/people/${personId}/trapper-stats`);
        setStats(data);
      } catch (err) {
        if (err instanceof ApiError && err.code === 404) {
          // Not a trapper
          setStats(null);
        } else {
          setError(err instanceof Error ? err.message : "Error loading stats");
        }
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [personId]);

  if (loading) {
    return (
      <div style={{ padding: "1rem", color: "#666" }}>
        Loading trapper statistics...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "1rem",
          background: "#fff3cd",
          borderRadius: "6px",
          color: "#856404",
        }}
      >
        Unable to load trapper statistics
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  // Compact version for person detail page
  if (compact) {
    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <TrapperBadge trapperType={stats.trapper_type} />
          <a
            href={`/trappers/${personId}`}
            style={{ fontSize: "0.875rem", color: "#0d6efd" }}
          >
            View full trapper profile
          </a>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))",
            gap: "0.75rem",
          }}
        >
          <StatBox
            label="Total Caught"
            value={stats.total_cats_caught}
            sublabel="via request assignments"
            color="#198754"
            onClick={() => setShowBreakdown(true)}
          />
          <StatBox
            label="Direct Bookings"
            value={stats.total_clinic_cats}
            sublabel="self-booked appts"
            onClick={() => setShowBreakdown(true)}
          />
          <StatBox
            label="Assignments"
            value={stats.active_assignments + stats.completed_assignments}
            sublabel={`${stats.active_assignments} active`}
          />
          {stats.felv_tested_count > 0 && (
            <StatBox
              label="FeLV Rate"
              value={
                stats.felv_positive_rate_pct !== null
                  ? `${stats.felv_positive_rate_pct}%`
                  : "—"
              }
              sublabel={`${stats.felv_positive_count}/${stats.felv_tested_count}`}
              color={
                stats.felv_positive_rate_pct !== null &&
                stats.felv_positive_rate_pct > 5
                  ? "#dc3545"
                  : undefined
              }
            />
          )}
        </div>

        {/* Breakdown Modal for compact view */}
        {showBreakdown && (
          <StatsBreakdownModal stats={stats} onClose={() => setShowBreakdown(false)} />
        )}
      </div>
    );
  }

  // Full version for trapper detail page
  return (
    <div>
      {/* Header Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <StatBox
          label="Total Caught"
          value={stats.total_cats_caught}
          sublabel="via request assignments"
          color="#198754"
          onClick={() => setShowBreakdown(true)}
        />
        <StatBox
          label="Direct Bookings"
          value={stats.total_clinic_cats}
          sublabel="self-booked appointments"
          onClick={() => setShowBreakdown(true)}
        />
        <StatBox
          label="Clinic Days"
          value={stats.unique_clinic_days}
        />
        <StatBox
          label="Avg Cats/Day"
          value={stats.avg_cats_per_day}
        />
      </div>

      {/* Assignments Row */}
      <div
        style={{
          display: "flex",
          gap: "2rem",
          marginBottom: "1.5rem",
          fontSize: "0.875rem",
        }}
      >
        <div>
          <strong>Active Assignments:</strong> {stats.active_assignments}
        </div>
        <div>
          <strong>Completed:</strong> {stats.completed_assignments}
        </div>
        <div>
          <strong>Site Visits:</strong> {stats.total_site_visits}
        </div>
      </div>

      {/* FeLV Section */}
      {stats.felv_tested_count > 0 && (
        <div
          style={{
            padding: "1rem",
            background: "#f8f9fa",
            borderRadius: "8px",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            FeLV Encounter Rate
          </div>
          <div style={{ display: "flex", gap: "2rem", fontSize: "0.875rem" }}>
            <div>
              <span
                style={{
                  fontSize: "1.25rem",
                  fontWeight: "bold",
                  color:
                    stats.felv_positive_rate_pct !== null &&
                    stats.felv_positive_rate_pct > 5
                      ? "#dc3545"
                      : "#198754",
                }}
              >
                {stats.felv_positive_rate_pct !== null
                  ? `${stats.felv_positive_rate_pct}%`
                  : "—"}
              </span>
              <span style={{ color: "#666", marginLeft: "0.5rem" }}>
                positive
              </span>
            </div>
            <div style={{ color: "#666" }}>
              {stats.felv_positive_count} positive / {stats.felv_tested_count}{" "}
              tested
            </div>
          </div>
        </div>
      )}

      {/* First Visit Success */}
      {stats.assessment_visits > 0 && (
        <div
          style={{
            padding: "1rem",
            background: "#f8f9fa",
            borderRadius: "8px",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            First Visit Success Rate
          </div>
          <div style={{ display: "flex", gap: "2rem", fontSize: "0.875rem" }}>
            <div>
              <span
                style={{
                  fontSize: "1.25rem",
                  fontWeight: "bold",
                  color:
                    stats.first_visit_success_rate_pct !== null &&
                    stats.first_visit_success_rate_pct >= 50
                      ? "#198754"
                      : stats.first_visit_success_rate_pct !== null &&
                        stats.first_visit_success_rate_pct >= 25
                      ? "#fd7e14"
                      : "#dc3545",
                }}
              >
                {stats.first_visit_success_rate_pct !== null
                  ? `${stats.first_visit_success_rate_pct}%`
                  : "—"}
              </span>
              <span style={{ color: "#666", marginLeft: "0.5rem" }}>
                of assessments yielded catches
              </span>
            </div>
            <div style={{ color: "#666" }}>
              {stats.assessment_visits} assessment visits
            </div>
          </div>
        </div>
      )}

      {/* Alteration Breakdown */}
      <div
        style={{
          marginBottom: "1.5rem",
          cursor: "pointer",
          padding: "0.75rem",
          borderRadius: "8px",
          transition: "background 0.15s",
        }}
        onClick={() => setShowBreakdown(true)}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8f9fa")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          Alterations
          <span style={{ fontSize: "0.7rem", color: "#0d6efd" }}>Click for details</span>
        </div>
        <div style={{ display: "flex", gap: "2rem", fontSize: "0.875rem" }}>
          <div>
            <strong>Spayed:</strong> {stats.spayed_count}
          </div>
          <div>
            <strong>Neutered:</strong> {stats.neutered_count}
          </div>
          <div>
            <strong>Total:</strong> {stats.total_altered}
          </div>
        </div>
      </div>

      {/* Activity Period */}
      {stats.first_activity_date && (
        <div style={{ fontSize: "0.8rem", color: "#666" }}>
          Activity period:{" "}
          {new Date(stats.first_activity_date).toLocaleDateString()} to{" "}
          {stats.last_activity_date
            ? new Date(stats.last_activity_date).toLocaleDateString()
            : "present"}
        </div>
      )}

      {/* Breakdown Modal */}
      {showBreakdown && (
        <StatsBreakdownModal stats={stats} onClose={() => setShowBreakdown(false)} />
      )}
    </div>
  );
}
