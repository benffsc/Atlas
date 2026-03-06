interface KpiCardProps {
  label: string;
  value: number | null;
  previousValue?: number;
  compareLabel?: string;
  href: string;
  accentColor: string;
  invertDelta?: boolean;
}

export function KpiCard({ label, value, previousValue, compareLabel, href, accentColor, invertDelta }: KpiCardProps) {
  const delta = value != null && previousValue != null && previousValue > 0
    ? value - previousValue
    : null;

  const deltaPercent = delta != null && previousValue! > 0
    ? Math.round((delta / previousValue!) * 100)
    : null;

  const isPositive = delta != null && delta > 0;
  const isNegative = delta != null && delta < 0;
  const deltaColor = delta === null || delta === 0
    ? "var(--text-muted)"
    : (invertDelta ? !isPositive : isPositive)
      ? "#16a34a"
      : "#dc2626";

  return (
    <a href={href} className="kpi-card" style={{ borderLeftColor: accentColor }}>
      <div className="kpi-card-inner">
        <span className="kpi-value">
          {value != null ? value : <span className="kpi-skeleton" />}
        </span>
        {delta != null && (
          <span className="kpi-delta" style={{ color: deltaColor }}>
            {isPositive ? "+" : ""}{deltaPercent}%
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
