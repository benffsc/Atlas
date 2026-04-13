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
import { useAppConfig } from "@/hooks/useAppConfig";

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

  // Year tick marks — sparse
  const span = max - min;
  const tickInterval = span > 30 ? 10 : span > 15 ? 5 : span > 8 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = min; y <= max; y++) {
    if (y === min || y === max || y % tickInterval === 0) ticks.push(y);
  }

  return (
    <div style={{ padding: "0.25rem 0", userSelect: "none" }}>
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        style={{ position: "relative", height: 18, cursor: "pointer" }}
      >
        {/* Track background */}
        <div style={{
          position: "absolute", top: 7, left: 0, right: 0, height: 4,
          borderRadius: 2, background: "var(--card-border, #e5e7eb)",
        }} />
        {/* Active range */}
        <div style={{
          position: "absolute", top: 7,
          left: `${leftPct}%`, width: `${rightPct - leftPct}%`,
          height: 4, borderRadius: 2,
          background: "var(--primary, #2563eb)", opacity: 0.5,
        }} />
        {/* Thumbs */}
        {(["start", "end"] as const).map((which) => (
          <div
            key={which}
            onMouseDown={handleMouseDown(which)}
            style={{
              position: "absolute", top: 3,
              left: `${which === "start" ? leftPct : rightPct}%`,
              transform: "translateX(-50%)",
              width: 12, height: 12, borderRadius: "50%",
              background: "#fff",
              border: "2px solid var(--primary, #2563eb)",
              cursor: "grab", zIndex: 2,
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }}
          />
        ))}
      </div>
      {/* Tick labels */}
      <div style={{ position: "relative", height: 14 }}>
        {ticks.map((year) => (
          <span
            key={year}
            style={{
              position: "absolute",
              left: `${yearToPercent(year)}%`,
              transform: "translateX(-50%)",
              fontSize: "0.6rem",
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
  const { value: kittensMultiplier } = useAppConfig<number>("impact.kittens_prevented_per_altered_cat");
  const { value: shelterCostPerKitten } = useAppConfig<number>("impact.shelter_cost_per_kitten_usd");

  useEffect(() => {
    let cancelled = false;
    fetchApi<YearlyData>("/api/dashboard/impact/yearly")
      .then((result) => {
        if (cancelled) return;
        if (result && Array.isArray(result.years)) {
          setData(result);
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
    return () => { cancelled = true; };
  }, []);

  const handleRangeChange = useCallback((start: number, end: number) => {
    setYearRange([start, end]);
  }, []);

  if (error || !data || !yearRange) return null;

  const allYears = data.years;
  const minYear = Math.min(...allYears.map((y) => y.year));
  const maxYear = Math.max(...allYears.map((y) => y.year));
  const currentYear = new Date().getFullYear();

  const filtered = allYears.filter((y) => y.year >= yearRange[0] && y.year <= yearRange[1]);
  if (filtered.length === 0) return null;

  // Exclude the current partial year from the max calculation so it
  // doesn't compress the scale, but still show it as a dashed projection
  const completedYears = filtered.filter((y) => y.year < currentYear);
  const partialYear = filtered.find((y) => y.year === currentYear);

  const displayYears = completedYears.length > 0 ? completedYears : filtered;
  const rawMax = Math.max(...displayYears.map((y) => y.donor_facing_count));
  if (rawMax === 0) return null;

  const maxCount = niceMax(rawMax);
  const rangeTotal = filtered.reduce((sum, y) => sum + y.donor_facing_count, 0);

  // Chart geometry — taller for readability
  const chartW = 700;
  const chartH = 220;
  const padL = 48;
  const padR = 16;
  const padT = 8;
  const padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  // Map data to SVG coordinates
  const points = filtered.map((row, i) => ({
    x: padL + (filtered.length === 1 ? plotW / 2 : (i / (filtered.length - 1)) * plotW),
    y: padT + plotH - (Math.min(row.donor_facing_count, maxCount) / maxCount) * plotH,
    row,
    isPartial: row.year === currentYear,
  }));

  // Split into completed line and partial (dashed) segment
  const completedPts = points.filter((p) => !p.isPartial);
  const lastCompleted = completedPts[completedPts.length - 1];
  const partialPt = points.find((p) => p.isPartial);

  // Main line path (completed years only)
  const mainLine = completedPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  // Filled area (completed years only)
  const areaPath = completedPts.length > 1
    ? `${mainLine} L${lastCompleted.x},${padT + plotH} L${completedPts[0].x},${padT + plotH} Z`
    : "";

  // Dashed line from last completed to partial year
  const dashedLine = lastCompleted && partialPt
    ? `M${lastCompleted.x},${lastCompleted.y} L${partialPt.x},${partialPt.y}`
    : "";

  // Y-axis ticks
  const yTicks = [0, 0.5, 1].map((pct) => ({
    y: padT + plotH - pct * plotH,
    label: Math.round(maxCount * pct).toLocaleString(),
  }));

  // X-axis labels (sparse)
  const labelInterval = filtered.length > 20 ? 5 : filtered.length > 12 ? 3 : filtered.length > 8 ? 2 : 1;

  const hovered = hoveredIdx !== null ? points[hoveredIdx] : null;

  const activePreset = PRESETS.find((p) => {
    const [ps, pe] = p.getRange(minYear, maxYear);
    return yearRange[0] === ps && yearRange[1] === pe;
  });

  const rangeLabel = yearRange[0] === yearRange[1]
    ? String(yearRange[0])
    : `${yearRange[0]}–${yearRange[1]}`;

  // Computed impact stats for selected range
  const kMult = kittensMultiplier ?? 10;
  const sMult = shelterCostPerKitten ?? 200;
  const kittensPrevented = rangeTotal * kMult;
  const shelterCostAvoided = kittensPrevented * sMult;

  function fmtBig(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
    return n.toLocaleString();
  }
  function fmtCurrency(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
    return `$${n.toLocaleString()}`;
  }

  return (
    <section className="impact-chart-card" aria-label="Year-over-year alterations">
      {/* Header with impact stats */}
      <div className="impact-chart-header">
        <div>
          <h3 className="impact-chart-title">Our impact ({rangeLabel})</h3>
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

      {/* Impact stats strip — reacts to slider */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "1rem",
        padding: "0.5rem 0 0.75rem",
        borderBottom: "1px solid var(--card-border, #e5e7eb)",
        marginBottom: "0.5rem",
      }}>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {fmtBig(rangeTotal)}
          </div>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
            cats altered
          </div>
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--primary, #2563eb)" }}>
            ~{fmtBig(kittensPrevented)}
          </div>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
            kittens prevented
          </div>
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {fmtCurrency(shelterCostAvoided)}
          </div>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
            shelter costs avoided
          </div>
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
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padL} y1={tick.y} x2={chartW - padR} y2={tick.y}
                stroke="var(--card-border, #e5e7eb)"
                strokeWidth={0.5}
                strokeDasharray={i === 0 ? "none" : "4 3"}
              />
              <text
                x={padL - 8} y={tick.y + 3}
                textAnchor="end" fontSize="10"
                fill="var(--text-muted, #9ca3af)" fontFamily="inherit"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Filled area under completed line */}
          {areaPath && (
            <path d={areaPath} fill="url(#areaGrad)" />
          )}

          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Main line (completed years) */}
          {mainLine && (
            <path
              d={mainLine} fill="none"
              stroke="#2563eb" strokeWidth={2.5}
              strokeLinejoin="round" strokeLinecap="round"
            />
          )}

          {/* Dashed line to current partial year */}
          {dashedLine && (
            <path
              d={dashedLine} fill="none"
              stroke="#2563eb" strokeWidth={2}
              strokeDasharray="6 4" opacity={0.5}
            />
          )}

          {/* Hover target areas — invisible wide columns for easier hovering */}
          {points.map((p, i) => {
            const colW = plotW / Math.max(filtered.length - 1, 1);
            return (
              <rect
                key={`ht-${p.row.year}`}
                x={p.x - colW / 2} y={padT}
                width={colW} height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: "crosshair" }}
              />
            );
          })}

          {/* Hovered dot only */}
          {hovered && (
            <>
              <line
                x1={hovered.x} y1={padT}
                x2={hovered.x} y2={padT + plotH}
                stroke="#2563eb" strokeWidth={0.5} opacity={0.3}
              />
              <circle
                cx={hovered.x} cy={hovered.y} r={5}
                fill="#2563eb" stroke="#fff" strokeWidth={2}
              />
            </>
          )}

          {/* Partial year indicator dot */}
          {partialPt && hoveredIdx !== points.indexOf(partialPt) && (
            <circle
              cx={partialPt.x} cy={partialPt.y} r={3}
              fill="none" stroke="#2563eb" strokeWidth={1.5}
              strokeDasharray="2 2" opacity={0.5}
            />
          )}

          {/* X-axis labels */}
          {points.map((p, i) => {
            if (i % labelInterval !== 0 && i !== points.length - 1) return null;
            return (
              <text
                key={`xl-${p.row.year}`}
                x={p.x} y={chartH - 6}
                textAnchor="middle" fontSize="10"
                fill="var(--text-muted, #9ca3af)" fontFamily="inherit"
              >
                {p.row.year}
              </text>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hovered && (
          <div
            className="impact-chart-tooltip"
            style={{
              position: "absolute",
              left: `${(hovered.x / chartW) * 100}%`,
              top: `${(hovered.y / chartH) * 100}%`,
              transform: "translate(-50%, -120%)",
              pointerEvents: "none",
            }}
          >
            <strong>
              {hovered.row.year}
              {hovered.isPartial && " (year to date)"}
            </strong>
            <div>{hovered.row.donor_facing_count.toLocaleString()} cats</div>
          </div>
        )}
      </div>
    </section>
  );
}
