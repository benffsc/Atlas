import Link from "next/link";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accentColor?: string;
  valueColor?: string;
  href?: string;
}

/**
 * Compact stat display card with optional accent border, colored value, and link wrapper.
 *
 * @example
 * ```tsx
 * <StatCard label="Total" value={42} />
 * <StatCard label="Errors" value={3} valueColor="#dc2626" />
 * <StatCard label="Pending" value={12} subtitle="Need review" accentColor="#f59e0b" href="/reviews" />
 * ```
 */
export function StatCard({ label, value, subtitle, accentColor, valueColor, href }: StatCardProps) {
  const formattedValue = typeof value === "number" ? value.toLocaleString() : value;

  const content = (
    <div
      className="card-elevated"
      style={{
        padding: "1rem",
        background: "var(--surface-raised, var(--card-bg))",
        border: "1px solid var(--card-border)",
        borderRadius: "8px",
        borderLeft: accentColor ? `4px solid ${accentColor}` : undefined,
        cursor: href ? "pointer" : undefined,
      }}
    >
      <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>{label}</div>
      <div className="text-data" style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1, color: valueColor || "var(--foreground)" }}>
        {formattedValue}
      </div>
      {subtitle && (
        <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.25rem" }}>{subtitle}</div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {content}
      </Link>
    );
  }

  return content;
}

export default StatCard;
