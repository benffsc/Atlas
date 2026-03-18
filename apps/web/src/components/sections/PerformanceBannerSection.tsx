"use client";

import type { SectionProps } from "@/lib/person-roles/types";

/**
 * Performance summary banner for trapper detail pages.
 * Shows key metrics in a colored grid: total caught, active assignments,
 * clinic days, tenure, cats/month, days since last activity.
 */
export function PerformanceBannerSection({ data }: SectionProps) {
  const stats = data.trapperStats;
  if (!stats) return null;

  const tenure = stats.first_activity_date
    ? Math.floor((Date.now() - new Date(stats.first_activity_date).getTime()) / 86400000)
    : 0;
  const tenureLabel = tenure > 365
    ? `${Math.floor(tenure / 365)}y ${Math.floor((tenure % 365) / 30)}mo`
    : tenure > 30
    ? `${Math.floor(tenure / 30)} months`
    : `${tenure} days`;
  const daysSinceLast = stats.last_activity_date
    ? Math.floor((Date.now() - new Date(stats.last_activity_date).getTime()) / 86400000)
    : null;
  const isDormant = daysSinceLast !== null && daysSinceLast > 90;
  const catsPerMonth = tenure > 30 && stats.total_cats_caught > 0
    ? (stats.total_cats_caught / (tenure / 30)).toFixed(1)
    : null;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
      gap: "0.75rem",
      padding: "1rem",
      background: isDormant ? "#fffbeb" : "var(--success-bg)",
      borderRadius: "10px",
      border: `1px solid ${isDormant ? "#fde68a" : "var(--success-border)"}`,
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#166534" }}>
          {stats.total_cats_caught}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Total Caught</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
          {stats.active_assignments}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Active Assignments</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
          {stats.unique_clinic_days}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Clinic Days</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
          {tenureLabel}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Tenure</div>
      </div>
      {catsPerMonth && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0d6efd" }}>
            {catsPerMonth}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Cats/Month</div>
        </div>
      )}
      <div style={{ textAlign: "center" }}>
        <div style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          color: isDormant ? "#b45309" : daysSinceLast !== null && daysSinceLast < 30 ? "#166534" : "var(--muted)",
        }}>
          {daysSinceLast !== null ? (
            daysSinceLast === 0 ? "Today" : `${daysSinceLast}d`
          ) : "—"}
        </div>
        <div style={{ fontSize: "0.7rem", color: isDormant ? "#b45309" : "var(--muted)" }}>
          {isDormant ? "Dormant" : "Since Last Activity"}
        </div>
      </div>
    </div>
  );
}
