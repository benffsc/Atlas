interface KpiCardProps {
  label: string;
  value: number | null;
  previousValue?: number;
  compareLabel?: string;
  href: string;
  accentColor: string;
  invertDelta?: boolean;
}

/**
 * KpiCard — Dashboard metric card with trend indicator.
 *
 * Tier 1 polish (FFS-1194): added trend arrow icons, subtle Beacon gradient
 * background, and hover glow. Existing delta/comparison logic preserved.
 *
 * Pattern references:
 * - Tableau Pulse: metric cards show trend direction + goal/threshold color
 * - Linear: subtle hover elevation, 200ms cubic-bezier transitions
 */
export function KpiCard({ label, value, previousValue, compareLabel, href, accentColor, invertDelta }: KpiCardProps) {
  const delta = value != null && previousValue != null && previousValue > 0
    ? value - previousValue
    : null;

  const deltaPercent = delta != null && previousValue! > 0
    ? Math.round((delta / previousValue!) * 100)
    : null;

  const isPositive = delta != null && delta > 0;
  const isNegative = delta != null && delta < 0;
  const isGood = delta == null || delta === 0
    ? null
    : (invertDelta ? !isPositive : isPositive);

  const deltaColor = isGood === null
    ? "var(--text-muted)"
    : isGood
      ? "#16a34a"
      : "#dc2626";

  const arrow = delta === null || delta === 0
    ? null
    : isPositive
      ? "↑"
      : "↓";

  return (
    <a href={href} className="kpi-card" style={{ borderLeftColor: accentColor }}>
      <div className="kpi-card-inner">
        <span className="kpi-value">
          {value != null ? value : <span className="kpi-skeleton" />}
        </span>
        {delta != null && deltaPercent != null && (
          <span className="kpi-delta" style={{ color: deltaColor }} aria-label={`${isPositive ? "Up" : "Down"} ${Math.abs(deltaPercent)} percent`}>
            {arrow} {Math.abs(deltaPercent)}%
          </span>
        )}
      </div>
      <span className="kpi-label">{label}</span>
      {delta != null && (
        <span className="kpi-compare">
          vs {previousValue} {compareLabel || "last month"}
        </span>
      )}
    </a>
  );
}
