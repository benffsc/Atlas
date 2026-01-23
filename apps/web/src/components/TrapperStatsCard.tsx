"use client";

import { useState, useEffect } from "react";
import { TrapperBadge } from "./TrapperBadge";

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
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "0.75rem",
        background: "#f8f9fa",
        borderRadius: "8px",
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
    </div>
  );
}

export function TrapperStatsCard({ personId, compact = false }: TrapperStatsCardProps) {
  const [stats, setStats] = useState<TrapperStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch(`/api/people/${personId}/trapper-stats`);
        if (response.status === 404) {
          // Not a trapper
          setStats(null);
          return;
        }
        if (!response.ok) {
          throw new Error("Failed to load trapper stats");
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading stats");
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
          />
          <StatBox
            label="Direct Bookings"
            value={stats.total_clinic_cats}
            sublabel="self-booked appts"
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
        />
        <StatBox
          label="Direct Bookings"
          value={stats.total_clinic_cats}
          sublabel="self-booked appointments"
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
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
          Alterations
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
    </div>
  );
}
