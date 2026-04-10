"use client";

/**
 * YearlyImpactChart — Year-over-year alteration bar chart.
 *
 * Pure CSS flexbox bars (no external chart library). Follows the same
 * pattern as PopulationTrendChart: inline styles with CSS variables,
 * hover tooltips, proportional bar heights.
 *
 * Data source: /api/dashboard/impact/yearly
 * Epic: FFS-1193 (Beacon Polish)
 */

import { useEffect, useState, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";

interface YearlyRow {
  year: number;
  reference_count: number;
  db_count: number;
  donor_facing_count: number;
  alignment_status: string;
}

interface YearlyData {
  years: YearlyRow[];
  totals: { reference: number; db: number; donor_facing: number };
  start_year: number;
  end_year: number;
}

type RangePreset = "all" | "since_2013" | "last_10" | "last_5";

const RANGE_LABELS: Record<RangePreset, string> = {
  all: "All time",
  since_2013: "Since 2013",
  last_10: "Last 10 years",
  last_5: "Last 5 years",
};

const STATUS_COLORS: Record<string, string> = {
  aligned: "var(--primary, #2563eb)",
  db_under: "#f59e0b",
  db_over: "#ef4444",
  pre_system: "#9ca3af",
};

function filterByRange(years: YearlyRow[], preset: RangePreset): YearlyRow[] {
  const currentYear = new Date().getFullYear();
  switch (preset) {
    case "since_2013":
      return years.filter((y) => y.year >= 2013);
    case "last_10":
      return years.filter((y) => y.year >= currentYear - 9);
    case "last_5":
      return years.filter((y) => y.year >= currentYear - 4);
    default:
      return years;
  }
}

export function YearlyImpactChart() {
  const [data, setData] = useState<YearlyData | null>(null);
  const [error, setError] = useState(false);
  const [range, setRange] = useState<RangePreset>("since_2013");
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApi<YearlyData>("/api/dashboard/impact/yearly")
      .then((result) => {
        if (cancelled) return;
        if (result && Array.isArray(result.years)) {
          setData(result);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRangeChange = useCallback((preset: RangePreset) => {
    setRange(preset);
  }, []);

  if (error || !data) return null;

  const filtered = filterByRange(data.years, range);
  if (filtered.length === 0) return null;

  const maxCount = Math.max(...filtered.map((y) => y.donor_facing_count));
  if (maxCount === 0) return null;

  const barHeight = 140;
  const rangeTotal = filtered.reduce((sum, y) => sum + y.donor_facing_count, 0);

  // Sparse x-axis labels: show every Nth year depending on count
  const labelInterval = filtered.length > 20 ? 5 : filtered.length > 12 ? 3 : filtered.length > 8 ? 2 : 1;

  return (
    <section className="impact-chart-card" aria-label="Year-over-year alterations">
      {/* Header */}
      <div className="impact-chart-header">
        <div>
          <h3 className="impact-chart-title">Alterations by year</h3>
          <span className="impact-chart-subtitle">
            {rangeTotal.toLocaleString()} cats altered
            {range !== "all" && ` (${RANGE_LABELS[range].toLowerCase()})`}
          </span>
        </div>
        {/* Range pills */}
        <div className="impact-chart-pills">
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={`impact-chart-pill${range === preset ? " impact-chart-pill-active" : ""}`}
              onClick={() => handleRangeChange(preset)}
            >
              {RANGE_LABELS[preset]}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="impact-chart-area">
        {/* Y-axis reference lines */}
        <div className="impact-chart-grid" aria-hidden="true">
          <div className="impact-chart-gridline" style={{ bottom: "100%" }}>
            <span className="impact-chart-gridlabel">{maxCount.toLocaleString()}</span>
          </div>
          <div className="impact-chart-gridline" style={{ bottom: "50%" }}>
            <span className="impact-chart-gridlabel">{Math.round(maxCount / 2).toLocaleString()}</span>
          </div>
          <div className="impact-chart-gridline" style={{ bottom: "0%" }}>
            <span className="impact-chart-gridlabel">0</span>
          </div>
        </div>

        {/* Bars */}
        <div
          className="impact-chart-bars"
          style={{ height: `${barHeight}px` }}
        >
          {filtered.map((year, idx) => {
            const pct = (year.donor_facing_count / maxCount) * 100;
            const color = STATUS_COLORS[year.alignment_status] || STATUS_COLORS.aligned;
            const isHovered = hoveredYear === year.year;

            return (
              <div
                key={year.year}
                className="impact-chart-bar-col"
                onMouseEnter={() => setHoveredYear(year.year)}
                onMouseLeave={() => setHoveredYear(null)}
              >
                {/* Tooltip */}
                {isHovered && (
                  <div className="impact-chart-tooltip">
                    <strong>{year.year}</strong>
                    <div>{year.donor_facing_count.toLocaleString()} cats</div>
                    {year.alignment_status !== "pre_system" && (
                      <div className="impact-chart-tooltip-detail">
                        Ref: {year.reference_count.toLocaleString()} · DB: {year.db_count.toLocaleString()}
                      </div>
                    )}
                    {year.alignment_status === "db_over" && (
                      <div className="impact-chart-tooltip-warn">DB exceeds reference</div>
                    )}
                  </div>
                )}
                {/* Bar */}
                <div
                  className="impact-chart-bar"
                  style={{
                    height: `${pct}%`,
                    background: color,
                    opacity: isHovered ? 1 : 0.85,
                  }}
                  title={`${year.year}: ${year.donor_facing_count.toLocaleString()} cats altered`}
                />
                {/* X-axis label */}
                {(idx % labelInterval === 0 || idx === filtered.length - 1) && (
                  <span className="impact-chart-year-label">
                    {filtered.length > 12 ? `'${String(year.year).slice(-2)}` : year.year}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="impact-chart-legend">
        <span className="impact-chart-legend-item">
          <span className="impact-chart-legend-swatch" style={{ background: STATUS_COLORS.aligned }} />
          Aligned
        </span>
        <span className="impact-chart-legend-item">
          <span className="impact-chart-legend-swatch" style={{ background: STATUS_COLORS.db_under }} />
          DB under reference
        </span>
        <span className="impact-chart-legend-item">
          <span className="impact-chart-legend-swatch" style={{ background: STATUS_COLORS.db_over }} />
          DB over reference
        </span>
        <span className="impact-chart-legend-item">
          <span className="impact-chart-legend-swatch" style={{ background: STATUS_COLORS.pre_system }} />
          Pre-system
        </span>
      </div>
    </section>
  );
}
