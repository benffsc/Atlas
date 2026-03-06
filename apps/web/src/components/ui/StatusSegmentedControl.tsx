"use client";

import { REQUEST_STATUS_COLORS } from "@/lib/design-tokens";

interface StatusSegmentedControlProps {
  counts: Record<string, number>;
  activeStatus: string; // "" = all
  onStatusChange: (status: string) => void;
  size?: "sm" | "md";
}

const SEGMENTS = [
  { key: "", label: "All" },
  { key: "new", label: "New" },
  { key: "working", label: "Working" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" },
] as const;

/**
 * Full-width segmented control for status filtering with live count badges.
 * Active segment gets its status color; inactive segments are neutral outlines.
 */
export function StatusSegmentedControl({
  counts,
  activeStatus,
  onStatusChange,
  size = "md",
}: StatusSegmentedControlProps) {
  const padding = size === "sm" ? "0.35rem 0.5rem" : "0.5rem 0.75rem";
  const fontSize = size === "sm" ? "0.8rem" : "0.875rem";
  const badgeFontSize = size === "sm" ? "0.7rem" : "0.75rem";

  const totalCount = Object.values(counts).reduce((sum, n) => sum + (n || 0), 0);

  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        width: "100%",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: "8px",
        overflow: "hidden",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {SEGMENTS.map((seg, i) => {
        const isActive = activeStatus === seg.key;
        const statusColors =
          seg.key && seg.key in REQUEST_STATUS_COLORS
            ? REQUEST_STATUS_COLORS[seg.key as keyof typeof REQUEST_STATUS_COLORS]
            : null;

        const count = seg.key === "" ? totalCount : counts[seg.key] ?? 0;

        const activeBg = statusColors?.bg || "var(--foreground)";
        const activeText = statusColors?.text || "var(--background)";
        const activeBorder = statusColors?.border || "var(--foreground)";

        return (
          <button
            key={seg.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onStatusChange(seg.key)}
            style={{
              flex: 1,
              padding,
              fontSize,
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              borderRight: i < SEGMENTS.length - 1 ? "1px solid var(--border, #e5e7eb)" : "none",
              background: isActive ? activeBg : "transparent",
              color: isActive ? activeText : "var(--text-secondary, #6b7280)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
              whiteSpace: "nowrap",
              transition: "background 0.15s, color 0.15s",
              boxShadow: isActive ? `inset 0 -2px 0 ${activeBorder}` : "none",
              minWidth: 0,
            }}
          >
            {seg.label}
            {count > 0 && (
              <span
                style={{
                  background: isActive ? activeText : "#d1d5db",
                  color: isActive ? activeBg : "#4b5563",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "999px",
                  fontSize: badgeFontSize,
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default StatusSegmentedControl;
