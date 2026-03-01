"use client";

import { useState, useEffect } from "react";

interface MonthlyComparison {
  month: number;
  month_name: string;
  current_year: {
    year: number;
    appointments: number;
    alterations: number;
    requests: number;
  };
  previous_year: {
    year: number;
    appointments: number;
    alterations: number;
    requests: number;
  };
  change_pct: {
    appointments: number | null;
    alterations: number | null;
    requests: number | null;
  };
}

interface YoYSummary {
  ytd_alterations_current: number;
  ytd_alterations_previous: number;
  ytd_appointments_current: number;
  ytd_appointments_previous: number;
  ytd_change_pct: number | null;
  appointments_change_pct: number | null;
  trend: "up" | "down" | "stable";
  current_year: number;
  previous_year: number;
  months_with_data: number;
}

interface YoYResponse {
  comparison: MonthlyComparison[];
  summary: YoYSummary;
  highlights: {
    best_month: { month: number; month_name: string; change_pct: number } | null;
    worst_month: { month: number; month_name: string; change_pct: number } | null;
    consistent_growth: number;
    consistent_decline: number;
  };
}

type MetricType = "alterations" | "appointments" | "requests";

export function YoYComparisonChart() {
  const [data, setData] = useState<YoYResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricType>("alterations");
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch("/api/beacon/yoy-comparison");
        if (!response.ok) {
          throw new Error("Failed to load YoY data");
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading data");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div
        style={{
          padding: "2rem",
          background: "var(--section-bg)",
          borderRadius: "12px",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Loading comparison data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "2rem",
          background: "var(--danger-bg)",
          borderRadius: "12px",
          border: "1px solid var(--danger-border)",
        }}
      >
        <div style={{ color: "var(--danger-text)", fontSize: "0.9rem" }}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { comparison, summary, highlights } = data;

  // Get max value for scaling the chart
  const maxValue = Math.max(
    ...comparison.map((c) =>
      Math.max(c.current_year[metric], c.previous_year[metric])
    )
  );

  const getBarHeight = (value: number) => {
    return maxValue > 0 ? (value / maxValue) * 100 : 0;
  };

  const trendColors = {
    up: { bg: "var(--success-bg)", text: "var(--success-text)", icon: "↑" },
    down: { bg: "var(--danger-bg)", text: "var(--danger-text)", icon: "↓" },
    stable: { bg: "var(--section-bg)", text: "var(--text-secondary)", icon: "→" },
  };

  const trendStyle = trendColors[summary.trend];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
        }}
      >
        <div
          style={{
            padding: "1rem",
            background: trendStyle.bg,
            borderRadius: "8px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
            YTD Alterations Change
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: trendStyle.text }}>
              {summary.ytd_change_pct !== null ? `${summary.ytd_change_pct >= 0 ? "+" : ""}${summary.ytd_change_pct}%` : "N/A"}
            </span>
            <span style={{ fontSize: "1.25rem", color: trendStyle.text }}>{trendStyle.icon}</span>
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            {summary.ytd_alterations_current.toLocaleString()} vs {summary.ytd_alterations_previous.toLocaleString()} last year
          </div>
        </div>

        <div
          style={{
            padding: "1rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
            {summary.current_year} Alterations (YTD)
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--primary)" }}>
            {summary.ytd_alterations_current.toLocaleString()}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            {summary.ytd_appointments_current.toLocaleString()} total appointments
          </div>
        </div>

        <div
          style={{
            padding: "1rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
            {summary.previous_year} Alterations (YTD)
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-secondary)" }}>
            {summary.ytd_alterations_previous.toLocaleString()}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            {summary.ytd_appointments_previous.toLocaleString()} total appointments
          </div>
        </div>
      </div>

      {/* Metric Selector */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {(["alterations", "appointments", "requests"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            style={{
              padding: "0.5rem 1rem",
              border: metric === m ? "2px solid var(--primary)" : "1px solid var(--border)",
              borderRadius: "6px",
              background: metric === m ? "var(--primary)" : "transparent",
              color: metric === m ? "#fff" : "var(--foreground)",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: metric === m ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div
        style={{
          padding: "1rem",
          background: "var(--section-bg)",
          borderRadius: "12px",
          border: "1px solid var(--border)",
        }}
      >
        {/* Y-axis labels */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div
            style={{
              width: "40px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              fontSize: "0.65rem",
              color: "var(--text-secondary)",
              textAlign: "right",
              paddingRight: "0.25rem",
              height: "160px",
            }}
          >
            <span>{maxValue}</span>
            <span>{Math.round(maxValue / 2)}</span>
            <span>0</span>
          </div>

          {/* Chart bars */}
          <div
            style={{
              flex: 1,
              display: "flex",
              gap: "2px",
              alignItems: "flex-end",
              height: "160px",
              borderBottom: "1px solid var(--border)",
              borderLeft: "1px solid var(--border)",
            }}
          >
            {comparison.map((month) => {
              const currentValue = month.current_year[metric];
              const prevValue = month.previous_year[metric];
              const isHovered = hoveredMonth === month.month;

              return (
                <div
                  key={month.month}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "2px",
                    position: "relative",
                    cursor: "pointer",
                  }}
                  onMouseEnter={() => setHoveredMonth(month.month)}
                  onMouseLeave={() => setHoveredMonth(null)}
                >
                  {/* Previous year bar */}
                  <div
                    style={{
                      flex: 1,
                      height: `${getBarHeight(prevValue)}%`,
                      minHeight: prevValue > 0 ? "4px" : 0,
                      background: "var(--text-secondary)",
                      opacity: isHovered ? 1 : 0.5,
                      borderRadius: "2px 2px 0 0",
                      transition: "opacity 0.15s, height 0.3s",
                    }}
                  />
                  {/* Current year bar */}
                  <div
                    style={{
                      flex: 1,
                      height: `${getBarHeight(currentValue)}%`,
                      minHeight: currentValue > 0 ? "4px" : 0,
                      background: "var(--primary)",
                      opacity: isHovered ? 1 : 0.8,
                      borderRadius: "2px 2px 0 0",
                      transition: "opacity 0.15s, height 0.3s",
                    }}
                  />

                  {/* Tooltip */}
                  {isHovered && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "100%",
                        left: "50%",
                        transform: "translateX(-50%)",
                        marginBottom: "8px",
                        padding: "0.5rem 0.75rem",
                        background: "var(--foreground)",
                        color: "var(--background)",
                        borderRadius: "6px",
                        fontSize: "0.75rem",
                        whiteSpace: "nowrap",
                        zIndex: 10,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{month.month_name}</div>
                      <div style={{ display: "flex", gap: "1rem" }}>
                        <span>
                          {summary.current_year}: <strong>{currentValue}</strong>
                        </span>
                        <span style={{ opacity: 0.7 }}>
                          {summary.previous_year}: {prevValue}
                        </span>
                      </div>
                      {month.change_pct[metric] !== null && (
                        <div
                          style={{
                            marginTop: "0.25rem",
                            color:
                              month.change_pct[metric]! > 0
                                ? "#4ade80"
                                : month.change_pct[metric]! < 0
                                  ? "#f87171"
                                  : "inherit",
                          }}
                        >
                          {month.change_pct[metric]! >= 0 ? "+" : ""}
                          {month.change_pct[metric]}% YoY
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* X-axis labels */}
        <div
          style={{
            display: "flex",
            marginLeft: "40px",
            marginTop: "0.5rem",
          }}
        >
          {comparison.map((month) => (
            <div
              key={month.month}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: "0.65rem",
                color: "var(--text-secondary)",
              }}
            >
              {month.month_name}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1.5rem",
            marginTop: "1rem",
            fontSize: "0.75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: "12px",
                height: "12px",
                background: "var(--primary)",
                borderRadius: "2px",
              }}
            />
            <span>{summary.current_year}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: "12px",
                height: "12px",
                background: "var(--text-secondary)",
                borderRadius: "2px",
              }}
            />
            <span>{summary.previous_year}</span>
          </div>
        </div>
      </div>

      {/* Highlights */}
      {(highlights.best_month || highlights.worst_month) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1rem",
          }}
        >
          {highlights.best_month && highlights.best_month.change_pct > 0 && (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "var(--success-bg)",
                border: "1px solid var(--success-border)",
                borderRadius: "8px",
              }}
            >
              <div style={{ fontSize: "0.7rem", color: "var(--success-text)", marginBottom: "0.25rem" }}>
                Best Month
              </div>
              <div style={{ fontWeight: 600, color: "var(--foreground)" }}>
                {highlights.best_month.month_name}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--success-text)" }}>
                +{highlights.best_month.change_pct}% vs last year
              </div>
            </div>
          )}
          {highlights.worst_month && highlights.worst_month.change_pct < 0 && (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "var(--danger-bg)",
                border: "1px solid var(--danger-border)",
                borderRadius: "8px",
              }}
            >
              <div style={{ fontSize: "0.7rem", color: "var(--danger-text)", marginBottom: "0.25rem" }}>
                Needs Attention
              </div>
              <div style={{ fontWeight: 600, color: "var(--foreground)" }}>
                {highlights.worst_month.month_name}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--danger-text)" }}>
                {highlights.worst_month.change_pct}% vs last year
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
