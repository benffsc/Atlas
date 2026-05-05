"use client";

import { useState } from "react";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

interface DateRangeFilterProps {
  fromDate: string | null;
  toDate: string | null;
  onDateRangeChange: (from: string | null, to: string | null) => void;
}

type PresetConfig = { label: string; getFrom: () => string | null };

function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function startOfWeek(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return toIsoDate(d);
}

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return toIsoDate(d);
}

function startOfQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) * 3;
  d.setMonth(q, 1);
  return toIsoDate(d);
}

function startOfYear(): string {
  const d = new Date();
  d.setMonth(0, 1);
  return toIsoDate(d);
}

const PRESETS: PresetConfig[] = [
  { label: "Today", getFrom: () => toIsoDate(new Date()) },
  { label: "This Week", getFrom: startOfWeek },
  { label: "This Month", getFrom: startOfMonth },
  { label: "This Quarter", getFrom: startOfQuarter },
  { label: "This Year", getFrom: startOfYear },
  { label: "All", getFrom: () => null },
];

/** Format an ISO date for display: "Jan 5, 2026" */
function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Derive a human label for the active filter */
function getActiveLabel(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  // Check if it matches a preset
  for (const preset of PRESETS) {
    const presetFrom = preset.getFrom();
    if (presetFrom !== null && from === presetFrom && !to) return preset.label;
  }
  // Custom range
  if (from && to) return `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
  if (from) return `Since ${formatDisplayDate(from)}`;
  if (to) return `Until ${formatDisplayDate(to)}`;
  return null;
}

export function DateRangeFilter({ fromDate, toDate, onDateRangeChange }: DateRangeFilterProps) {
  const isActive = fromDate !== null || toDate !== null;
  const [showCustom, setShowCustom] = useState(false);
  const activeLabel = getActiveLabel(fromDate, toDate);

  return (
    <div
      role="group"
      aria-label="Date range filter"
      style={{
        position: "absolute",
        bottom: 40,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: MAP_Z_INDEX.controls - 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      {/* Custom date picker row — shown on demand */}
      {showCustom && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--background, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 10,
            padding: "6px 12px",
            boxShadow: "var(--shadow-md, 0 2px 8px rgba(0,0,0,0.12))",
          }}
        >
          <input
            type="date"
            value={fromDate || ""}
            onChange={(e) => onDateRangeChange(e.target.value || null, toDate)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: "0.8rem",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          />
          <span style={{ color: "var(--foreground-muted, #9ca3af)", fontSize: "0.8rem" }}>to</span>
          <input
            type="date"
            value={toDate || ""}
            onChange={(e) => onDateRangeChange(fromDate, e.target.value || null)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: "0.8rem",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          />
          <button
            onClick={() => setShowCustom(false)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--foreground-muted, #6b7280)",
              fontSize: "1rem",
              padding: "2px 4px",
              lineHeight: 1,
            }}
            title="Close date picker"
          >
            ×
          </button>
        </div>
      )}

      {/* Main bar: presets + custom toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          background: "var(--background, #fff)",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: 10,
          padding: "4px 6px",
          boxShadow: "var(--shadow-md, 0 2px 8px rgba(0,0,0,0.12))",
        }}
      >
        {/* Calendar icon / custom date toggle */}
        <button
          onClick={() => setShowCustom(!showCustom)}
          title="Custom date range"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            background: showCustom ? "var(--primary, #3b82f6)" : "transparent",
            color: showCustom ? "white" : "var(--foreground-muted, #6b7280)",
            flexShrink: 0,
            fontSize: "0.8rem",
            fontWeight: showCustom ? 600 : 400,
            whiteSpace: "nowrap",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Custom
        </button>

        <div style={{ width: 1, height: 20, background: "var(--border, #e5e7eb)", margin: "0 2px", flexShrink: 0 }} />

        {/* Preset buttons */}
        {PRESETS.map(({ label, getFrom }) => {
          const presetFrom = getFrom();
          const isSelected = presetFrom === null
            ? !isActive
            : fromDate === presetFrom && toDate === null;

          return (
            <button
              key={label}
              onClick={() => {
                onDateRangeChange(presetFrom, null);
                setShowCustom(false);
              }}
              style={{
                padding: "5px 10px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: isSelected ? 600 : 400,
                background: isSelected ? "var(--primary, #3b82f6)" : "transparent",
                color: isSelected ? "white" : "var(--foreground-muted, #6b7280)",
                whiteSpace: "nowrap",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}

        {/* Active custom range indicator + clear */}
        {isActive && activeLabel && !PRESETS.some(p => p.getFrom() !== null && fromDate === p.getFrom() && !toDate) && (
          <>
            <div style={{ width: 1, height: 20, background: "var(--border, #e5e7eb)", margin: "0 2px", flexShrink: 0 }} />
            <span style={{ fontSize: "0.75rem", color: "var(--foreground, #111)", fontWeight: 500, whiteSpace: "nowrap", padding: "0 4px" }}>
              {activeLabel}
            </span>
          </>
        )}

        {/* Clear */}
        {isActive && (
          <button
            onClick={() => {
              onDateRangeChange(null, null);
              setShowCustom(false);
            }}
            title="Clear date filter"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: "transparent",
              color: "#ef4444",
              fontSize: "0.9rem",
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
