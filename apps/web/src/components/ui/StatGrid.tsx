import { ReactNode } from "react";

interface StatGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  gap?: string;
  style?: React.CSSProperties;
}

/**
 * Responsive grid wrapper for StatCard components.
 * Uses CSS Grid with auto-fill to adapt to container width.
 *
 * @example
 * ```tsx
 * <StatGrid columns={4}>
 *   <StatCard label="Total Cats" value={1234} />
 *   <StatCard label="Active Requests" value={42} accentColor="#0066cc" />
 *   <StatCard label="Trappers" value={18} />
 *   <StatCard label="This Month" value={56} />
 * </StatGrid>
 * ```
 *
 * @see FFS-619
 */
export function StatGrid({ children, columns = 4, gap = "0.75rem", style }: StatGridProps) {
  const minWidth = columns <= 3 ? "200px" : "160px";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))`,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default StatGrid;
