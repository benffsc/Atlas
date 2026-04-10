"use client";

/**
 * YearlyImpactChart — Year-over-year alteration line chart with range slider.
 *
 * SVG line chart (no external chart library). Shows the growth trend
 * clearly with filled area underneath. Hover tooltips on data points.
 * Dual-thumb range slider lets users select any year window.
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

const STATUS_COLORS: Record<string, string> = {
  aligned: "#2563eb",
  db_under: "#f59e0b",
  db_over: "#ef4444",
  pre_system: "#9ca3af",
};

/** Nice Y-axis ticks: round to nearest 500/1000/5000 */
function niceMax(val: number): number {
  if (val <= 100) return Math.ceil(val / 10) * 10;
  if (val <= 1000) return Math.ceil(val / 100) * 100;
  if (val <= 5000) return Math.ceil(val / 500) * 500;
  return Math.ceil(val / 1000) * 1000;
}

// ── Preset quick-select buttons ─────────────────────────────────────────────

interface Preset {
  label: string;
  getRange: (minYear: number, maxYear: number) => [number, number];
}

const PRESETS: Preset[] = [
  { label: "All time", getRange: (min, max) => [min, max] },
  { label: "Since 2013", getRange: (_, max) => [2013, max] },
  { label: "Last 10 years", getRange: (_, max) => [max - 9, max] },
  { label: "Last 5 years", getRange: (_, max) => [max - 4, max] },
];

// ── Dual-thumb range slider ─────────────────────────────────────────────────

function YearRangeSlider({
  min,
  max,
  startYear,
  endYear,
  onChange,
}: {
  min: number;
  max: number;
  startYear: number;
  endYear: number;
  onChange: (start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const yearToPercent = (year: number) => ((year - min) / (max - min)) * 100;
  const percentToYear = (pct: number) => Math.round(min + (pct / 100) * (max - min));

  const getYearFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const track = trackRef.current;
      if (!track) return min;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      return percentToYear(pct);
    },
    [min, max] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleMouseDown = useCallback(
    (thumb: "start" | "end") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = thumb;

      const handleMove = (ev: MouseEvent) => {
        const year = getYearFromEvent(ev);
        if (dragging.current === "start") {
          onChange(Math.min(year, endYear), endYear);
        } else {
          onChange(startYear, Math.max(year, startYear));
        }
      };

      const handleUp = () => {
        dragging.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [getYearFromEvent, onChange, startYear, endYear]
  );

  // Click on track to move nearest thumb
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      const year = getYearFromEvent(e);
      const distToStart = Math.abs(year - startYear);
      const distToEnd = Math.abs(year - endYear);
      if (distToStart <= distToEnd) {
        onChange(Math.min(year, endYear), endYear);
      } else {
        onChange(startYear, Math.max(year, startYear));
      }
    },
    [getYearFromEvent, onChange, startYear, endYear]
  );

  const leftPct = yearToPercent(startYear);
  const rightPct = yearToPercent(endYear);

  // Year tick marks
  const span = max - min;
  const tickInterval = span > 30 ? 10 : span > 15 ? 5 : span > 8 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = min; y <= max; y++) {
    if (y === min || y === max || y % tickInterval === 0) ticks.push(y);
  }

  return (
    <div style={{ padding: "0.5rem 0 0.25rem", userSelect: "none" }}>
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        style={{
          position: "relative",
          height: 20,
          cursor: "pointer",
        }}
      >
        {/* Track background */}
        <div style={{
          position: "absolute",
          top: 8,
          left: 0,
          right: 0,
          height: 4,
          borderRadius: 2,
          background: "var(--card-border, #e5e7eb)",
        }} />

        {/* Active range highlight */}
        <div style={{
          position: "absolute",
          top: 8,
          left: `${leftPct}%`,
          width: `${rightPct - leftPct}%`,
          height: 4,
          borderRadius: 2,
          background: "var(--primary, #2563eb)",
          opacity: 0.6,
        }} />

        {/* Start thumb */}
        <div
          onMouseDown={handleMouseDown("start")}
          style={{
            position: "absolute",
            top: 4,
            left: `${leftPct}%`,
            transform: "translateX(-50%)",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            border: "2px solid var(--primary, #2563eb)",
            cursor: "grab",
            zIndex: 2,
            boxShadow: "var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.1))",
          }}
          title={String(startYear)}
        />

        {/* End thumb */}
        <div
          onMouseDown={handleMouseDown("end")}
          style={{
            position: "absolute",
            top: 4,
            left: `${rightPct}%`,
            transform: "translateX(-50%)",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            border: "2px solid var(--primary, #2563eb)",
            cursor: "grab",
            zIndex: 2,
            boxShadow: "var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.1))",
          }}
          title={String(endYear)}
        />
      </div>

      {/* Year tick labels */}
      <div style={{ position: "relative", height: 16, marginTop: 2 }}>
        {ticks.map((year) => (
          <span
            key={year}
            style={{
              position: "absolute",
              left: `${yearToPercent(year)}%`,
              transform: "translateX(-50%)",
              fontSize: "0.65rem",
              color: year >= startYear && year <= endYear
                ? "var(--text-secondary, #6b7280)"
                : "var(--text-muted, #d1d5db)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {year}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main chart component ────────────────────────────────────────────────────

export function YearlyImpactChart() {
  const [data, setData] = useState<YearlyData | null>(null);
  const [error, setError] = useState(false);
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApi<YearlyData>("/api/dashboard/impact/yearly")
      .then((result) => {
        if (cancelled) return;
        if (result && Array.isArray(result.years)) {
          setData(result);
          // Default: since 2013
          const minY = Math.min(...result.years.map((y) => y.year));
          const maxY = Math.max(...result.years.map((y) => y.year));
          setYearRange([Math.max(2013, minY), maxY]);
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

  const handleRangeChange = useCallback((start: number, end: number) => {
    setYearRange([start, end]);
  }, []);

  if (error || !data) return null;
  if (!yearRange) return null;

  const allYears = data.years;
  const minYear = Math.min(...allYears.map((y) => y.year));
  const maxYear = Math.max(...allYears.map((y) => y.year));

  const filtered = allYears.filter((y) => y.year >= yearRange[0] && y.year <= yearRange[1]);
  if (filtered.length === 0) return null;

  const rawMax = Math.max(...filtered.map((y) => y.donor_facing_count));
  if (rawMax === 0) return null;

  const maxCount = niceMax(rawMax);
  const rangeTotal = filtered.reduce((sum, y) => sum + y.donor_facing_count, 0);

  // Chart geometry
  const chartW = 700;
  const chartH = 160;
  const padL = 50;
  const padR = 16;
  const padT = 12;
  const padB = 24;
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

  // Check if current range matches a preset
  const activePreset = PRESETS.find((p) => {
    const [ps, pe] = p.getRange(minYear, maxYear);
    return yearRange[0] === ps && yearRange[1] === pe;
  });

  const rangeLabel = yearRange[0] === yearRange[1]
    ? String(yearRange[0])
    : `${yearRange[0]}–${yearRange[1]}`;

  return (
    <section className="impact-chart-card" aria-label="Year-over-year alterations">
      {/* Header */}
      <div className="impact-chart-header">
        <div>
          <h3 className="impact-chart-title">Alterations by year</h3>
          <span className="impact-chart-subtitle">
            {rangeTotal.toLocaleString()} cats altered
            {` (${rangeLabel})`}
          </span>
        </div>
        <div className="impact-chart-pills">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`impact-chart-pill${activePreset === preset ? " impact-chart-pill-active" : ""}`}
              onClick={() => {
                const [s, e] = preset.getRange(minYear, maxYear);
                handleRangeChange(Math.max(s, minYear), Math.min(e, maxYear));
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Range slider */}
      <YearRangeSlider
        min={minYear}
        max={maxYear}
        startYear={yearRange[0]}
        endYear={yearRange[1]}
        onChange={handleRangeChange}
      />

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
