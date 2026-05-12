"use client";

/**
 * ProjectionAreaChart — SVG area chart showing baseline vs target scenario.
 *
 * Displays two overlapping area fills:
 *   - Muted: baseline (current rate)
 *   - Primary: target rate (user-selected)
 *   - Shaded delta between them
 *
 * Custom SVG — no external chart library.
 */

interface Point {
  year: number;
  baseline: number;
  target: number;
}

interface Props {
  data: Point[];
  width?: number;
  height?: number;
  label?: string;
}

function formatValue(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

export function ProjectionAreaChart({ data, width = 560, height = 200, label = "Unaltered cats" }: Props) {
  if (data.length < 2) return null;

  const padL = 48;
  const padR = 16;
  const padT = 20;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxVal = Math.max(...data.map(d => Math.max(d.baseline, d.target)), 1);
  const minYear = data[0].year;
  const maxYear = data[data.length - 1].year;
  const yearSpan = maxYear - minYear || 1;

  const toX = (year: number) => padL + ((year - minYear) / yearSpan) * plotW;
  const toY = (val: number) => padT + plotH - (val / maxVal) * plotH;

  const baselinePts = data.map(d => `${toX(d.year)},${toY(d.baseline)}`);
  const targetPts = data.map(d => `${toX(d.year)},${toY(d.target)}`);

  const baselineLine = baselinePts.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");
  const targetLine = targetPts.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");

  // Delta fill: target line forward, baseline line backward
  const deltaPath = [
    ...targetPts.map((p, i) => `${i === 0 ? "M" : "L"}${p}`),
    ...baselinePts.slice().reverse().map((p, i) => `${i === 0 ? "L" : "L"}${p}`),
    "Z",
  ].join(" ");

  // Y-axis ticks
  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxVal / tickCount) * i));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="projDeltaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary, #2563eb)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--primary, #2563eb)" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map((val, i) => {
        const y = toY(val);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={width - padR} y2={y}
              stroke="var(--card-border, #e5e7eb)" strokeWidth={0.5} opacity={0.4} />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10"
              fill="var(--text-muted)" fontFamily="inherit">
              {formatValue(val)}
            </text>
          </g>
        );
      })}

      {/* Delta fill */}
      <path d={deltaPath} fill="url(#projDeltaGrad)" />

      {/* Baseline line (muted) */}
      <path d={baselineLine} fill="none" stroke="var(--text-muted, #9ca3af)"
        strokeWidth={2} strokeDasharray="4 3" opacity={0.6} />

      {/* Target line (primary) */}
      <path d={targetLine} fill="none" stroke="var(--primary, #2563eb)"
        strokeWidth={2.5} strokeLinejoin="round" />

      {/* X-axis labels */}
      {data.filter((_, i) => i % Math.max(Math.floor(data.length / 5), 1) === 0 || i === data.length - 1).map(d => (
        <text key={d.year} x={toX(d.year)} y={height - 6} textAnchor="middle" fontSize="10"
          fill="var(--text-muted)" fontFamily="inherit">
          {d.year}
        </text>
      ))}

      {/* Legend */}
      <line x1={padL + 10} y1={8} x2={padL + 30} y2={8}
        stroke="var(--text-muted)" strokeWidth={2} strokeDasharray="4 3" opacity={0.6} />
      <text x={padL + 34} y={12} fontSize="9" fill="var(--text-muted)" fontFamily="inherit">Current rate</text>

      <line x1={padL + 120} y1={8} x2={padL + 140} y2={8}
        stroke="var(--primary)" strokeWidth={2.5} />
      <text x={padL + 144} y={12} fontSize="9" fill="var(--primary)" fontFamily="inherit">Target rate</text>
    </svg>
  );
}
