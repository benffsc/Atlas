"use client";

import { MAP_Z_INDEX } from "@/lib/design-tokens";

interface DateRangeFilterProps {
  fromDate: string | null;
  toDate: string | null;
  onDateRangeChange: (from: string | null, to: string | null) => void;
  /** When true, renders inline (no absolute positioning). Used when embedded in sidebar. */
  inline?: boolean;
}

const PRESETS = [
  { label: "30d", from: 30 },
  { label: "90d", from: 90 },
  { label: "1y", from: 365 },
  { label: "All", from: null },
] as const;

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export function DateRangeFilter({ fromDate, toDate, onDateRangeChange, inline = false }: DateRangeFilterProps) {
  const isActive = fromDate !== null || toDate !== null;

  return (
    <div
      style={{
        ...(inline ? {} : {
          position: "absolute" as const,
          top: 60,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: MAP_Z_INDEX.controls - 1,
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }),
        display: "flex",
        alignItems: inline ? "flex-start" : "center",
        flexWrap: inline ? "wrap" : "nowrap",
        gap: 6,
        background: inline ? "transparent" : "var(--background)",
        borderRadius: 8,
        padding: inline ? 0 : "4px 8px",
        fontSize: "0.8rem",
      }}
    >
      {/* Presets */}
      {PRESETS.map(({ label, from: days }) => {
        const presetFrom = days !== null ? daysAgo(days) : null;
        const isSelected = days === null
          ? !isActive
          : fromDate === presetFrom && toDate === null;

        return (
          <button
            key={label}
            onClick={() => onDateRangeChange(presetFrom, null)}
            style={{
              padding: "3px 8px",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: isSelected ? 600 : 400,
              background: isSelected ? "var(--primary, #3b82f6)" : "transparent",
              color: isSelected ? "white" : "#6b7280",
            }}
          >
            {label}
          </button>
        );
      })}

      <span style={{ color: "#d1d5db", margin: "0 2px" }}>|</span>

      {/* Custom dates */}
      <input
        type="date"
        value={fromDate || ""}
        onChange={(e) => onDateRangeChange(e.target.value || null, toDate)}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "2px 4px",
          fontSize: "0.75rem",
          width: 120,
        }}
      />
      <span style={{ color: "#9ca3af" }}>to</span>
      <input
        type="date"
        value={toDate || ""}
        onChange={(e) => onDateRangeChange(fromDate, e.target.value || null)}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "2px 4px",
          fontSize: "0.75rem",
          width: 120,
        }}
      />

      {/* Clear button when active */}
      {isActive && (
        <button
          onClick={() => onDateRangeChange(null, null)}
          title="Clear date filter"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#ef4444",
            fontSize: "0.85rem",
            padding: "2px 4px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
