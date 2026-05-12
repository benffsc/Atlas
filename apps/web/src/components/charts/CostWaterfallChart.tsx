"use client";

/**
 * CostWaterfallChart — Horizontal waterfall showing cost breakdown by category.
 *
 * Custom SVG (no external chart library). Shows:
 *   shelter → animal_control → property → disease → placement → indirect → total
 *
 * Supports confidence tier toggle (conservative/moderate/high).
 * Used in ImpactMethodologyDrawer and /beacon/impact page.
 */

import type { CostBreakdown } from "@/app/api/dashboard/impact/route";

interface Props {
  costs: CostBreakdown;
  width?: number;
  height?: number;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

const CATEGORIES: Array<{ key: keyof Omit<CostBreakdown, "total">; label: string; color: string }> = [
  { key: "shelter", label: "Shelter intake", color: "var(--primary, #2563eb)" },
  { key: "animal_control", label: "Animal control", color: "var(--warning-bg, #f59e0b)" },
  { key: "property_damage", label: "Property damage", color: "var(--danger-bg, #ef4444)" },
  { key: "disease", label: "Disease costs", color: "var(--info-bg, #06b6d4)" },
  { key: "placement", label: "Kitten placement", color: "var(--healthy-text, #22c55e)" },
  { key: "indirect", label: "Indirect costs", color: "var(--text-secondary, #6b7280)" },
];

export function CostWaterfallChart({ costs, width = 500, height: propHeight }: Props) {
  const barH = 28;
  const gap = 6;
  const totalBarH = 32;
  const labelW = 120;
  const valueW = 70;
  const padR = 10;
  const barAreaW = width - labelW - valueW - padR;
  const numBars = CATEGORIES.length + 1; // +1 for total
  const height = propHeight ?? (numBars * (barH + gap) + gap + totalBarH);

  const maxVal = costs.total || 1;

  let runningTotal = 0;
  const bars = CATEGORIES.map((cat) => {
    const val = costs[cat.key] ?? 0;
    const startX = labelW + (runningTotal / maxVal) * barAreaW;
    const barW = Math.max((val / maxVal) * barAreaW, 1);
    runningTotal += val;
    return { ...cat, val, startX, barW };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      {bars.map((bar, i) => {
        const y = gap + i * (barH + gap);
        return (
          <g key={bar.key}>
            {/* Label */}
            <text
              x={labelW - 8}
              y={y + barH / 2 + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-secondary, #6b7280)"
              fontFamily="inherit"
            >
              {bar.label}
            </text>
            {/* Bar */}
            <rect
              x={bar.startX}
              y={y}
              width={bar.barW}
              height={barH}
              rx={3}
              fill={bar.color}
              opacity={0.8}
            />
            {/* Connector line to next bar */}
            {i < bars.length - 1 && (
              <line
                x1={bar.startX + bar.barW}
                y1={y + barH}
                x2={bar.startX + bar.barW}
                y2={y + barH + gap}
                stroke="var(--card-border, #e5e7eb)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
            {/* Value */}
            <text
              x={bar.startX + bar.barW + 6}
              y={y + barH / 2 + 4}
              fontSize="11"
              fontWeight="600"
              fill="var(--foreground)"
              fontFamily="inherit"
            >
              {formatCurrency(bar.val)}
            </text>
          </g>
        );
      })}

      {/* Total bar */}
      {(() => {
        const totalY = gap + CATEGORIES.length * (barH + gap) + 4;
        const totalW = barAreaW;
        return (
          <g>
            {/* Separator line */}
            <line
              x1={labelW}
              y1={totalY - 4}
              x2={labelW + totalW + valueW}
              y2={totalY - 4}
              stroke="var(--card-border, #e5e7eb)"
              strokeWidth={1}
            />
            <text
              x={labelW - 8}
              y={totalY + totalBarH / 2 + 4}
              textAnchor="end"
              fontSize="12"
              fontWeight="700"
              fill="var(--foreground)"
              fontFamily="inherit"
            >
              Total
            </text>
            <rect
              x={labelW}
              y={totalY}
              width={totalW}
              height={totalBarH}
              rx={4}
              fill="var(--primary, #2563eb)"
              opacity={0.15}
            />
            <rect
              x={labelW}
              y={totalY}
              width={totalW}
              height={totalBarH}
              rx={4}
              fill="none"
              stroke="var(--primary, #2563eb)"
              strokeWidth={1.5}
              opacity={0.6}
            />
            <text
              x={labelW + totalW + 6}
              y={totalY + totalBarH / 2 + 5}
              fontSize="13"
              fontWeight="700"
              fill="var(--primary, #2563eb)"
              fontFamily="inherit"
            >
              {formatCurrency(costs.total)}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
