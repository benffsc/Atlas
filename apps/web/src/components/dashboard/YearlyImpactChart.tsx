"use client";

/**
 * YearlyImpactChart — Year-over-year alteration area chart.
 *
 * SVG area chart (no external chart library). Shows the growth trend
 * with filled gradient area underneath. Hover tooltips on data points.
 * Preset buttons for time range selection.
 *
 * Fixes (FFS-1415):
 * - Removed range slider (FFS-1417) — preset buttons only
 * - Projection uses annualized pace instead of raw partial count (FFS-1416)
 * - Stat labels above numbers, charity:water pattern (FFS-1418)
 * - Y-axis: more ticks, solid gridlines, round numbers (FFS-1419)
 * - Stronger gradient fill (FFS-1420)
 *
 * Data source: /api/dashboard/impact/yearly
 * Epic: FFS-1415 (Dashboard Impact Chart Redesign)
 */

import { useEffect, useState, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { useAppConfig } from "@/hooks/useAppConfig";
import { ImpactMethodologyDrawer, type ImpactMetric } from "./ImpactMethodologyDrawer";
import type { ImpactMethodology } from "@/app/api/dashboard/impact/route";

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

/** Generate nice round Y-axis tick values */
function niceYTicks(maxVal: number): number[] {
  if (maxVal <= 0) return [0];
  // Pick a nice step size
  const rough = maxVal / 4;
  let step: number;
  if (rough <= 50) step = Math.ceil(rough / 10) * 10;
  else if (rough <= 250) step = Math.ceil(rough / 50) * 50;
  else if (rough <= 1000) step = Math.ceil(rough / 250) * 250;
  else step = Math.ceil(rough / 500) * 500;

  const ticks: number[] = [0];
  let v = step;
  while (v <= maxVal * 1.05) {
    ticks.push(v);
    v += step;
  }
  return ticks;
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

// ── Main chart component ────────────────────────────────────────────────────

export function YearlyImpactChart() {
  const [data, setData] = useState<YearlyData | null>(null);
  const [error, setError] = useState(false);
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [methodology, setMethodology] = useState<ImpactMethodology | null>(null);
  const [methodologyStartYear, setMethodologyStartYear] = useState(2013);
  const [auditMetric, setAuditMetric] = useState<ImpactMetric | null>(null);
  const { value: kittensMultiplier } = useAppConfig<number>("impact.kittens_prevented_per_altered_cat");
  const { value: shelterCostPerKitten } = useAppConfig<number>("impact.shelter_cost_per_kitten_usd");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchApi<YearlyData>("/api/dashboard/impact/yearly").catch(() => null),
      fetchApi<{ methodology: ImpactMethodology; start_year: number }>("/api/dashboard/impact").catch(() => null),
    ]).then(([yearlyResult, impactResult]) => {
      if (cancelled) return;
      if (yearlyResult && Array.isArray(yearlyResult.years)) {
        setData(yearlyResult);
        const minY = Math.min(...yearlyResult.years.map((y) => y.year));
        const maxY = Math.max(...yearlyResult.years.map((y) => y.year));
        setYearRange([Math.max(2013, minY), maxY]);
      } else {
        setError(true);
      }
      if (impactResult && "methodology" in impactResult) {
        setMethodology(impactResult.methodology);
        setMethodologyStartYear(impactResult.start_year ?? 1990);
      }
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
  const currentMonth = new Date().getMonth() + 1; // 1-12

  const filtered = allYears.filter((y) => y.year >= yearRange[0] && y.year <= yearRange[1]);
  if (filtered.length === 0) return null;

  // Separate completed years from current partial year
  const completedYears = filtered.filter((y) => y.year < currentYear);
  const partialYear = filtered.find((y) => y.year === currentYear);

  // Annualize partial year: project full-year pace instead of showing raw dip
  const projectedCount = partialYear && currentMonth > 0
    ? Math.round((partialYear.donor_facing_count / currentMonth) * 12)
    : null;

  const displayYears = completedYears.length > 0 ? completedYears : filtered;
  const rawMax = Math.max(
    ...displayYears.map((y) => y.donor_facing_count),
    projectedCount ?? 0,
  );
  if (rawMax === 0) return null;

  // Y-axis ticks — nice round numbers, 4-5 ticks
  const yTicks = niceYTicks(rawMax);
  const maxCount = yTicks[yTicks.length - 1];

  const rangeTotal = filtered.reduce((sum, y) => sum + y.donor_facing_count, 0);

  // Chart geometry
  const chartW = 700;
  const chartH = 240;
  const padL = 52;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  // Map data to SVG coordinates (completed years only for main line)
  const completedPts = completedYears.map((row, i) => ({
    x: padL + (completedYears.length === 1 ? plotW / 2 : (i / Math.max(completedYears.length + (partialYear ? 1 : 0) - 1, 1)) * plotW),
    y: padT + plotH - (Math.min(row.donor_facing_count, maxCount) / maxCount) * plotH,
    row,
  }));

  // Projected point for current year (annualized)
  const projectedPt = partialYear && projectedCount !== null ? {
    x: padL + plotW, // rightmost position
    y: padT + plotH - (Math.min(projectedCount, maxCount) / maxCount) * plotH,
    row: { ...partialYear, donor_facing_count: projectedCount },
    actualCount: partialYear.donor_facing_count,
  } : null;

  // All points for hover targets
  const allPoints = [
    ...completedPts.map(p => ({ ...p, isPartial: false, actualCount: p.row.donor_facing_count })),
    ...(projectedPt ? [{ ...projectedPt, isPartial: true }] : []),
  ];

  const lastCompleted = completedPts[completedPts.length - 1];

  // Main line path (completed years)
  const mainLine = completedPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  // Filled area (completed years)
  const areaPath = completedPts.length > 1
    ? `${mainLine} L${lastCompleted.x},${padT + plotH} L${completedPts[0].x},${padT + plotH} Z`
    : "";

  // Dashed + faded projection line from last completed to projected point
  const dashedLine = lastCompleted && projectedPt
    ? `M${lastCompleted.x},${lastCompleted.y} L${projectedPt.x},${projectedPt.y}`
    : "";

  // X-axis labels (sparse)
  const labelInterval = allPoints.length > 20 ? 5 : allPoints.length > 12 ? 3 : allPoints.length > 8 ? 2 : 1;

  const hovered = hoveredIdx !== null ? allPoints[hoveredIdx] : null;

  const activePreset = PRESETS.find((p) => {
    const [ps, pe] = p.getRange(minYear, maxYear);
    return yearRange[0] === ps && yearRange[1] === pe;
  });

  const rangeLabel = yearRange[0] === yearRange[1]
    ? String(yearRange[0])
    : `${yearRange[0]}\u2013${yearRange[1]}`;

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
      {/* Header with preset buttons */}
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

      {/* Impact stats strip — label ABOVE number (charity:water pattern) */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "1rem",
        padding: "0.75rem 0",
        borderBottom: "1px solid var(--card-border, #e5e7eb)",
        marginBottom: "0.75rem",
      }}>
        {([
          { metric: "cats_altered" as ImpactMetric, value: fmtBig(rangeTotal), label: "Cats Altered", color: "var(--foreground)" },
          { metric: "kittens_prevented" as ImpactMetric, value: `~${fmtBig(kittensPrevented)}`, label: "Kittens Prevented", color: "var(--primary, #2563eb)" },
          { metric: "shelter_cost_avoided" as ImpactMetric, value: fmtCurrency(shelterCostAvoided), label: "Shelter Costs Avoided", color: "var(--foreground)" },
        ]).map((stat) => (
          <button
            key={stat.metric}
            type="button"
            onClick={() => methodology && setAuditMetric(stat.metric)}
            disabled={!methodology}
            style={{
              background: "none", border: "none", padding: 0,
              cursor: methodology ? "pointer" : "default",
              textAlign: "left",
            }}
            title={methodology ? "Click to see the math" : undefined}
          >
            <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "0.2rem" }}>
              {stat.label}
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: stat.color, lineHeight: 1.1 }}>
              {stat.value}
            </div>
            {methodology && (
              <div style={{ fontSize: "0.7rem", color: "var(--primary)", marginTop: "0.25rem" }}>
                See the math &rarr;
              </div>
            )}
          </button>
        ))}
      </div>

      {/* SVG Area Chart */}
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="impactAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary, #2563eb)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--primary, #2563eb)" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Grid lines — solid, light */}
          {yTicks.map((val, i) => {
            const y = padT + plotH - (val / maxCount) * plotH;
            return (
              <g key={i}>
                <line
                  x1={padL} y1={y} x2={chartW - padR} y2={y}
                  stroke="var(--card-border, #e5e7eb)"
                  strokeWidth={i === 0 ? 1 : 0.5}
                  opacity={i === 0 ? 0.6 : 0.35}
                />
                <text
                  x={padL - 8} y={y + 4}
                  textAnchor="end" fontSize="11"
                  fill="var(--text-muted, #9ca3af)" fontFamily="inherit"
                >
                  {val.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* Filled area under completed line */}
          {areaPath && (
            <path d={areaPath} fill="url(#impactAreaGrad)" />
          )}

          {/* Main line (completed years) */}
          {mainLine && (
            <path
              d={mainLine} fill="none"
              stroke="var(--primary, #2563eb)" strokeWidth={2.5}
              strokeLinejoin="round" strokeLinecap="round"
            />
          )}

          {/* Dashed + faded projection line to annualized pace */}
          {dashedLine && (
            <path
              d={dashedLine} fill="none"
              stroke="var(--primary, #2563eb)" strokeWidth={2}
              strokeDasharray="6 4" opacity={0.4}
            />
          )}

          {/* Hover target areas */}
          {allPoints.map((p, i) => {
            const colW = plotW / Math.max(allPoints.length - 1, 1);
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

          {/* Hovered dot + vertical line */}
          {hovered && (
            <>
              <line
                x1={hovered.x} y1={padT}
                x2={hovered.x} y2={padT + plotH}
                stroke="var(--primary, #2563eb)" strokeWidth={0.5} opacity={0.3}
              />
              <circle
                cx={hovered.x} cy={hovered.y} r={5}
                fill="var(--primary, #2563eb)" stroke="#fff" strokeWidth={2}
              />
            </>
          )}

          {/* Projected year indicator dot (when not hovered) */}
          {projectedPt && hoveredIdx !== allPoints.length - 1 && (
            <circle
              cx={projectedPt.x} cy={projectedPt.y} r={4}
              fill="none" stroke="var(--primary, #2563eb)" strokeWidth={1.5}
              opacity={0.5}
            />
          )}

          {/* "On track" annotation at projected point */}
          {projectedPt && !hovered && (
            <text
              x={projectedPt.x} y={projectedPt.y - 12}
              textAnchor="end" fontSize="10"
              fill="var(--primary, #2563eb)" fontFamily="inherit"
              opacity={0.7}
            >
              On track for ~{projectedPt.row.donor_facing_count.toLocaleString()}
            </text>
          )}

          {/* X-axis labels */}
          {allPoints.map((p, i) => {
            if (i % labelInterval !== 0 && i !== allPoints.length - 1) return null;
            return (
              <text
                key={`xl-${p.row.year}`}
                x={p.x} y={chartH - 6}
                textAnchor="middle" fontSize="11"
                fill={p.isPartial ? "var(--primary, #2563eb)" : "var(--text-muted, #9ca3af)"}
                fontFamily="inherit"
                fontWeight={p.isPartial ? 600 : 400}
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
              {hovered.isPartial && ` (projected)`}
            </strong>
            <div>
              {hovered.isPartial
                ? `${hovered.actualCount.toLocaleString()} so far → ~${hovered.row.donor_facing_count.toLocaleString()} pace`
                : `${hovered.row.donor_facing_count.toLocaleString()} cats`
              }
            </div>
          </div>
        )}
      </div>

      {/* Methodology audit drawer */}
      <ImpactMethodologyDrawer
        isOpen={auditMetric !== null}
        onClose={() => setAuditMetric(null)}
        metric={auditMetric}
        methodology={methodology}
        startYear={methodologyStartYear}
        computedAt={new Date().toISOString()}
      />
    </section>
  );
}
