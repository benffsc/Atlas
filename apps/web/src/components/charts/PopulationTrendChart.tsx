"use client";

import { useState, useEffect } from "react";

interface TrendData {
  year: string;
  cats_caught: number;
  cats_altered: number;
  colony_estimate: number | null;
}

interface PopulationTrendChartProps {
  placeId: string;
}

export function PopulationTrendChart({ placeId }: PopulationTrendChartProps) {
  const [data, setData] = useState<TrendData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch alteration history for yearly data
        const historyRes = await fetch(`/api/places/${placeId}/alteration-history`);
        if (historyRes.ok) {
          const history = await historyRes.json();
          if (history.yearly_breakdown) {
            type YearlyBreakdown = Record<string, { caught: number; altered: number }>;
            const breakdown = history.yearly_breakdown as YearlyBreakdown;
            const yearlyData = Object.entries(breakdown)
              .map(([year, data]) => ({
                year,
                cats_caught: data.caught,
                cats_altered: data.altered,
                colony_estimate: null as number | null,
              }))
              .sort((a, b) => parseInt(a.year) - parseInt(b.year));

            // Only show last 5 years
            setData(yearlyData.slice(-5));
          }
        }
      } catch (err) {
        console.error("Failed to load trend data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [placeId]);

  if (loading) {
    return <div className="text-muted text-sm">Loading trend...</div>;
  }

  if (data.length < 2) {
    return null; // Not enough data to show a trend
  }

  // Calculate max for scaling
  const maxValue = Math.max(...data.map((d) => Math.max(d.cats_caught, d.cats_altered)));
  if (maxValue === 0) return null;

  const barHeight = 80;
  const barWidth = 100 / data.length;

  // Calculate trend direction
  const firstYear = data[0];
  const lastYear = data[data.length - 1];
  const alteredTrend = lastYear.cats_altered - firstYear.cats_altered;
  const trendLabel =
    alteredTrend > 0
      ? `+${alteredTrend} altered`
      : alteredTrend < 0
      ? `${alteredTrend} altered`
      : "Stable";
  const trendColor = alteredTrend >= 0 ? "#198754" : "#dc3545";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>TNR Activity Trend</h4>
        <span style={{ fontSize: "0.75rem", color: trendColor, fontWeight: 500 }}>
          {trendLabel} over {data.length} years
        </span>
      </div>

      {/* Simple bar chart */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          height: `${barHeight}px`,
          gap: "4px",
          padding: "0.5rem 0",
          borderBottom: "1px solid var(--card-border)",
        }}
      >
        {data.map((d) => {
          const caughtHeight = (d.cats_caught / maxValue) * barHeight;
          const alteredHeight = (d.cats_altered / maxValue) * barHeight;

          return (
            <div
              key={d.year}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
              }}
            >
              {/* Caught bar (background) */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: `${caughtHeight}px`,
                  minHeight: d.cats_caught > 0 ? "4px" : 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: "10%",
                    right: "10%",
                    height: `${caughtHeight}px`,
                    background: "#e9ecef",
                    borderRadius: "2px 2px 0 0",
                  }}
                />
                {/* Altered bar (overlay) */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: "10%",
                    right: "10%",
                    height: `${alteredHeight}px`,
                    background: "#198754",
                    borderRadius: "2px 2px 0 0",
                  }}
                  title={`${d.year}: ${d.cats_altered} altered / ${d.cats_caught} caught`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Year labels */}
      <div style={{ display: "flex", gap: "4px" }}>
        {data.map((d) => (
          <div
            key={d.year}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: "0.65rem",
              color: "var(--text-muted)",
              paddingTop: "4px",
            }}
          >
            {d.year.slice(-2)}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.7rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "10px", height: "10px", background: "#e9ecef", borderRadius: "2px" }} />
          Caught
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "10px", height: "10px", background: "#198754", borderRadius: "2px" }} />
          Altered
        </span>
      </div>
    </div>
  );
}
