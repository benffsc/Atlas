"use client";

/**
 * YearlyImpactChart — Year-over-year alteration line chart.
 *
 * SVG line chart (no external chart library). Shows the growth trend
 * clearly with filled area underneath. Hover tooltips on data points.
 *
 * Data source: /api/dashboard/impact/yearly
 * Epic: FFS-1193 (Beacon Polish)
 */

import { useEffect, useState, useCallback, useRef } from "react";
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
  aligned: "#2563eb",
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

/** Nice Y-axis ticks: round to nearest 500/1000/5000 */
function niceMax(val: number): number {
  if (val <= 100) return Math.ceil(val / 10) * 10;
  if (val <= 1000) return Math.ceil(val / 100) * 100;
  if (val <= 5000) return Math.ceil(val / 500) * 500;
  return Math.ceil(val / 1000) * 1000;
}

export function YearlyImpactChart() {
  const [data, setData] = useState<YearlyData | null>(null);
  const [error, setError] = useState(false);
  const [range, setRange] = useState<RangePreset>("since_2013");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  const rawMax = Math.max(...filtered.map((y) => y.donor_facing_count));
  if (rawMax === 0) return null;

  const maxCount = niceMax(rawMax);
  const rangeTotal = filtered.reduce((sum, y) => sum + y.donor_facing_count, 0);

  // Chart geometry
  const chartW = 700;
  const chartH = 160;
  const padL = 50; // y-axis labels
  const padR = 16;
  const padT = 12;
  const padB = 24; // x-axis labels
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  // Map data to SVG coordinates
  const points = filtered.map((row, i) => ({
    x: padL + (filtered.length === 1 ? plotW / 2 : (i / (filtered.length - 1)) * plotW),
    y: padT + plotH - (row.donor_facing_count / maxCount) * plotH,
    row,
  }));

  // Line path
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  // Filled area path
  const areaPath = `${linePath} L${points[points.length - 1].x},${padT + plotH} L${points[0].x},${padT + plotH} Z`;

  // Y-axis grid lines (0, 25%, 50%, 75%, 100%)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    y: padT + plotH - pct * plotH,
    label: Math.round(maxCount * pct).toLocaleString(),
  }));

  // X-axis labels (sparse)
  const labelInterval = filtered.length > 20 ? 5 : filtered.length > 12 ? 3 : filtered.length > 8 ? 2 : 1;

  const hovered = hoveredIdx !== null ? points[hoveredIdx] : null;

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

      {/* SVG Line Chart */}
      <div className="impact-chart-area" style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${chartW} ${chartH}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padL}
                y1={tick.y}
                x2={chartW - padR}
                y2={tick.y}
                stroke="var(--card-border, #e5e7eb)"
                strokeWidth={i === 0 ? 1 : 0.5}
                strokeDasharray={i === 0 ? "none" : "4 3"}
              />
              <text
                x={padL - 6}
                y={tick.y + 3.5}
                textAnchor="end"
                fontSize="9"
                fill="var(--text-muted, #9ca3af)"
                fontFamily="inherit"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Filled area */}
          <path
            d={areaPath}
            fill="url(#areaGradient)"
          />

          {/* Gradient definition */}
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Data point dots — colored by alignment status */}
          {points.map((p, i) => (
            <circle
              key={p.row.year}
              cx={p.x}
              cy={p.y}
              r={hoveredIdx === i ? 5 : 3}
              fill={STATUS_COLORS[p.row.alignment_status] || STATUS_COLORS.aligned}
              stroke="#fff"
              strokeWidth={1.5}
              style={{ cursor: "pointer", transition: "r 100ms ease" }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}

          {/* X-axis labels */}
          {points.map((p, i) => {
            if (i % labelInterval !== 0 && i !== points.length - 1) return null;
            return (
              <text
                key={`xl-${p.row.year}`}
                x={p.x}
                y={chartH - 4}
                textAnchor="middle"
                fontSize="9"
                fill="var(--text-muted, #9ca3af)"
                fontFamily="inherit"
              >
                {filtered.length > 12 ? `'${String(p.row.year).slice(-2)}` : p.row.year}
              </text>
            );
          })}

          {/* Hover crosshair line */}
          {hovered && (
            <line
              x1={hovered.x}
              y1={padT}
              x2={hovered.x}
              y2={padT + plotH}
              stroke="var(--text-muted, #9ca3af)"
              strokeWidth={0.5}
              strokeDasharray="3 3"
            />
          )}
        </svg>

        {/* Tooltip (HTML overlay for better styling) */}
        {hovered && (
          <div
            className="impact-chart-tooltip"
            style={{
              position: "absolute",
              left: `${(hovered.x / chartW) * 100}%`,
              top: `${(hovered.y / chartH) * 100}%`,
              transform: "translate(-50%, -110%)",
              pointerEvents: "none",
            }}
          >
            <strong>{hovered.row.year}</strong>
            <div>{hovered.row.donor_facing_count.toLocaleString()} cats</div>
            {hovered.row.alignment_status !== "pre_system" && (
              <div className="impact-chart-tooltip-detail">
                Ref: {hovered.row.reference_count.toLocaleString()} · DB: {hovered.row.db_count.toLocaleString()}
              </div>
            )}
            {hovered.row.alignment_status === "db_over" && (
              <div className="impact-chart-tooltip-warn">DB exceeds reference</div>
            )}
          </div>
        )}
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
