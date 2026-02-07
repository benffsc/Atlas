"use client";

export interface StatItem {
  label: string;
  count: number;
  color?: string;
  href?: string;
  subLabel?: string;
}

export interface ReviewStatsBarProps {
  stats: StatItem[];
  showTotal?: boolean;
}

export function ReviewStatsBar({ stats, showTotal = false }: ReviewStatsBarProps) {
  const total = stats.reduce((sum, s) => sum + s.count, 0);

  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        marginBottom: "1.5rem",
        flexWrap: "wrap",
      }}
    >
      {showTotal && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "var(--bg-muted, #f8f9fa)",
            borderRadius: "8px",
            textAlign: "center",
            minWidth: "80px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{total}</div>
          <div className="text-muted text-sm">Total</div>
        </div>
      )}
      {stats.map((stat, i) => {
        const content = (
          <div
            key={i}
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-muted, #f8f9fa)",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "80px",
              borderLeft: stat.color ? `3px solid ${stat.color}` : undefined,
              cursor: stat.href ? "pointer" : undefined,
              transition: "transform 0.1s ease",
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{stat.count}</div>
            <div className="text-muted text-sm">{stat.label}</div>
            {stat.subLabel && (
              <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                {stat.subLabel}
              </div>
            )}
          </div>
        );

        if (stat.href) {
          return (
            <a
              key={i}
              href={stat.href}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              {content}
            </a>
          );
        }
        return content;
      })}
    </div>
  );
}

export default ReviewStatsBar;
