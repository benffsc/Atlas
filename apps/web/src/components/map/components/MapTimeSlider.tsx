"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

/**
 * MapTimeSlider — scrubbable month-by-month timeline.
 *
 * Drives the map's `dateTo` ("as of") filter — server filters data where
 * `last_alteration_at <= dateTo`, so scrubbing rolls the map back in time.
 * Play button animates forward; quick-range chips jump to common points.
 *
 * Works on /map and /beacon/map. Tracked under FFS-1174.
 */

interface MapTimeSliderProps {
  /** Current "as of" date as ISO (YYYY-MM-DD). null = today. */
  value: string | null;
  /** Called with new ISO date when slider moves. null clears back to today. */
  onChange: (isoDate: string | null) => void;
  /** Earliest selectable date (inclusive). Defaults to 3 years before today. */
  minDate?: string;
}

const QUICK_RANGES = [
  { label: "All", monthsBack: null as number | null },
  { label: "1y", monthsBack: 12 },
  { label: "6m", monthsBack: 6 },
  { label: "3m", monthsBack: 3 },
  { label: "1m", monthsBack: 1 },
];

/** Format YYYY-MM-DD from a Date object */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse ISO YYYY-MM-DD to Date (local noon to avoid TZ edge cases) */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function MapTimeSlider({ value, onChange, minDate }: MapTimeSliderProps) {
  // Anchor dates — "today" for the upper bound, minDate for the lower bound
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);
  const min = useMemo(() => {
    if (minDate) return fromIso(minDate);
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - 3);
    d.setDate(1);
    return d;
  }, [today, minDate]);

  const totalMonths = useMemo(() => monthsBetween(min, today), [min, today]);

  // Current slider position in "months since min"
  const currentMonthIndex = useMemo(() => {
    if (!value) return totalMonths; // null = today
    try {
      const d = fromIso(value);
      return Math.max(0, Math.min(totalMonths, monthsBetween(min, d)));
    } catch {
      return totalMonths;
    }
  }, [value, min, totalMonths]);

  const currentDate = useMemo(() => addMonths(min, currentMonthIndex), [min, currentMonthIndex]);
  const isAtLatest = currentMonthIndex === totalMonths;

  // Play state
  const [playing, setPlaying] = useState(false);
  const playTimerRef = useRef<number | null>(null);

  const stopPlaying = useCallback(() => {
    setPlaying(false);
    if (playTimerRef.current !== null) {
      window.clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    playTimerRef.current = window.setInterval(() => {
      // advance one month per tick
      const next = Math.min(totalMonths, (currentMonthIndex ?? 0) + 1);
      if (next >= totalMonths) {
        onChange(null);
        stopPlaying();
      } else {
        onChange(toIso(addMonths(min, next)));
      }
    }, 700);
    return () => {
      if (playTimerRef.current !== null) {
        window.clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [playing, currentMonthIndex, totalMonths, min, onChange, stopPlaying]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      stopPlaying();
      const idx = Number(e.target.value);
      if (idx >= totalMonths) {
        onChange(null);
      } else {
        onChange(toIso(addMonths(min, idx)));
      }
    },
    [stopPlaying, totalMonths, min, onChange]
  );

  const handleQuickRange = useCallback(
    (monthsBack: number | null) => {
      stopPlaying();
      if (monthsBack === null) {
        onChange(null);
        return;
      }
      const target = addMonths(today, -monthsBack);
      onChange(toIso(target));
    },
    [stopPlaying, today, onChange]
  );

  const handlePlayToggle = useCallback(() => {
    if (playing) {
      stopPlaying();
      return;
    }
    // If starting from "today", reset to beginning first
    if (isAtLatest) {
      onChange(toIso(min));
    }
    setPlaying(true);
  }, [playing, stopPlaying, isAtLatest, min, onChange]);

  return (
    <div
      role="group"
      aria-label="Map time slider"
      style={{
        position: "absolute",
        bottom: 64,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: MAP_Z_INDEX.controls - 1,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: "var(--background, #fff)",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: 10,
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        fontSize: 12,
        maxWidth: "min(720px, calc(100vw - 24px))",
        width: "calc(100vw - 24px)",
        boxSizing: "border-box",
      }}
    >
      {/* Play / Pause */}
      <button
        onClick={handlePlayToggle}
        title={playing ? "Pause" : isAtLatest ? "Play from start" : "Play forward"}
        aria-label={playing ? "Pause timeline" : "Play timeline forward"}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "none",
          background: "var(--primary, #3b82f6)",
          color: "white",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        )}
      </button>

      {/* Slider + label */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--foreground-muted, #6b7280)", lineHeight: 1 }}>
          <span>{formatMonthLabel(min)}</span>
          <strong style={{ color: "var(--foreground, #111)", fontSize: 11 }}>
            {isAtLatest ? "Today" : `As of ${formatMonthLabel(currentDate)}`}
          </strong>
          <span>Today</span>
        </div>
        <input
          type="range"
          min={0}
          max={totalMonths}
          value={currentMonthIndex}
          onChange={handleSliderChange}
          aria-label="Scrub map date"
          style={{
            width: "100%",
            accentColor: "var(--primary, #3b82f6)",
            cursor: "pointer",
          }}
        />
      </div>

      {/* Quick ranges */}
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        {QUICK_RANGES.map(({ label, monthsBack }) => {
          const isSelected =
            monthsBack === null
              ? isAtLatest
              : value === toIso(addMonths(today, -monthsBack));
          return (
            <button
              key={label}
              onClick={() => handleQuickRange(monthsBack)}
              style={{
                padding: "4px 8px",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: isSelected ? 600 : 400,
                background: isSelected ? "var(--primary, #3b82f6)" : "transparent",
                color: isSelected ? "white" : "var(--foreground-muted, #6b7280)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
