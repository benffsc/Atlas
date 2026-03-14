"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";

interface TrendRow {
  month: string;
  month_label: string;
  new_cats_seen: number;
  alterations: number;
  cumulative_cats: number;
  cumulative_altered: number;
  alteration_rate_pct: number | null;
}

interface TrendsResponse {
  place_id: string;
  months_back: number;
  trends: TrendRow[];
  summary: {
    total_new_cats: number;
    total_alterations: number;
    current_cumulative_cats: number;
    current_cumulative_altered: number;
    current_alteration_rate: number | null;
    months_with_activity: number;
  };
}

interface TemporalTrendChartProps {
  placeId: string;
  months?: number;
}

export function TemporalTrendChart({ placeId, months = 24 }: TemporalTrendChartProps) {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchApi<TrendsResponse>(`/api/beacon/trends/${placeId}?months=${months}`)
      .then(setData)
      .catch((err) => {
        console.error("Failed to load temporal trends:", err);
        setError("Unable to load trend data");
      })
      .finally(() => setLoading(false));
  }, [placeId, months]);

  if (loading) {
    return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading monthly trends...</div>;
  }

  if (error || !data) {
    return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>{error || "No trend data available"}</div>;
  }

  const trends = data.trends;
  if (trends.length < 2) {
    return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>Not enough data for trend chart (need at least 2 months)</div>;
  }

  // Filter to months with any activity for display
  const activeMonths = trends.filter(t => t.new_cats_seen > 0 || t.alterations > 0);
  const displayTrends = activeMonths.length >= 2 ? activeMonths : trends.slice(-12);

  const maxValue = Math.max(...displayTrends.map(t => Math.max(t.new_cats_seen, t.alterations)), 1);
  const chartHeight = 120;

  const summary = data.summary;

  return (
    <div>
      {/* Summary row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
        gap: "0.75rem",
        marginBottom: "1rem",
        padding: "0.75rem",
        background: "var(--card-bg, #f9fafb)",
        borderRadius: "6px",
        border: "1px solid var(--card-border, #e5e7eb)",
      }}>
        <MiniStat label="New Cats" value={summary.total_new_cats} />
        <MiniStat label="Alterations" value={summary.total_alterations} />
        <MiniStat
          label="Current Rate"
          value={summary.current_alteration_rate !== null ? `${Math.round(summary.current_alteration_rate)}%` : "N/A"}
          color={
            summary.current_alteration_rate !== null
              ? summary.current_alteration_rate >= 70 ? "#16a34a"
              : summary.current_alteration_rate >= 50 ? "#f59e0b"
              : "#dc2626"
              : undefined
          }
        />
        <MiniStat label="Active Months" value={summary.months_with_activity} />
      </div>

      {/* Bar chart */}
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        height: `${chartHeight}px`,
        gap: "2px",
        padding: "0 0 0.5rem 0",
        borderBottom: "1px solid var(--card-border, #e5e7eb)",
      }}>
        {displayTrends.map((t) => {
          const newH = (t.new_cats_seen / maxValue) * chartHeight;
          const altH = (t.alterations / maxValue) * chartHeight;

          return (
            <div
              key={t.month}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}
              title={`${t.month_label}: ${t.new_cats_seen} new, ${t.alterations} altered`}
            >
              <div style={{ position: "relative", width: "100%", height: `${Math.max(newH, altH)}px` }}>
                {/* New cats bar (background) */}
                <div style={{
                  position: "absolute", bottom: 0, left: "15%", right: "15%",
                  height: `${newH}px`, minHeight: t.new_cats_seen > 0 ? "3px" : 0,
                  background: "#e9ecef", borderRadius: "2px 2px 0 0",
                }} />
                {/* Alterations bar (overlay) */}
                <div style={{
                  position: "absolute", bottom: 0, left: "15%", right: "15%",
                  height: `${altH}px`, minHeight: t.alterations > 0 ? "3px" : 0,
                  background: "#16a34a", borderRadius: "2px 2px 0 0",
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Month labels — show every Nth */}
      <div style={{ display: "flex", gap: "2px" }}>
        {displayTrends.map((t, i) => {
          const showLabel = displayTrends.length <= 12 || i % Math.ceil(displayTrends.length / 12) === 0;
          return (
            <div key={t.month} style={{
              flex: 1, textAlign: "center", fontSize: "0.6rem",
              color: "var(--text-muted)", paddingTop: "3px", minWidth: 0,
              overflow: "hidden", whiteSpace: "nowrap",
            }}>
              {showLabel ? t.month_label.slice(0, 3) : ""}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "10px", height: "10px", background: "#e9ecef", borderRadius: "2px", display: "inline-block" }} />
          New Cats
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "10px", height: "10px", background: "#16a34a", borderRadius: "2px", display: "inline-block" }} />
          Altered
        </span>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 700, color: color || "var(--text)" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}
