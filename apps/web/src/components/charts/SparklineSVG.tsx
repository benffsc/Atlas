"use client";

/**
 * SparklineSVG — Tiny inline SVG sparkline (~60x20px).
 *
 * Used inside ImpactSummary and other stat cards to show 10-year trend.
 * No external chart library — custom SVG matching codebase pattern.
 */

interface Props {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}

export function SparklineSVG({
  values,
  width = 60,
  height = 20,
  color = "var(--primary, #2563eb)",
  strokeWidth = 1.5,
}: Props) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 2;
  const plotH = height - padY * 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = padY + plotH - ((v - min) / range) * plotH;
    return `${x},${y}`;
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.6}
      />
      {/* End dot */}
      <circle
        cx={parseFloat(points[points.length - 1].split(",")[0])}
        cy={parseFloat(points[points.length - 1].split(",")[1])}
        r={2}
        fill={color}
        opacity={0.8}
      />
    </svg>
  );
}
