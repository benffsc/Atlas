"use client";

import { COLORS } from "@/lib/design-tokens";

interface TnrProgressBarProps {
  /** Number of cats confirmed altered (from clinic records) */
  fixed: number;
  /** Total cats at the location (colony size). Primary denominator. */
  total: number | null;
  /** Cats still needing TNR (remaining work). Used when total is unknown. */
  remaining: number | null;
  /** Compact mode: 4px height, no label — for card thumbnails */
  compact?: boolean;
}

/**
 * TNR progress bar showing cats fixed vs total colony size.
 *
 * Denominator priority:
 * 1. total (total_cats_reported — colony size)
 * 2. max(remaining, fixed) — fallback when colony size unknown
 *
 * Display: "3 of 4 cats fixed · 1 remaining"
 */
export function TnrProgressBar({ fixed, total, remaining, compact = false }: TnrProgressBarProps) {
  // Compute denominator: prefer total colony size, fall back to best guess
  const denominator = total ?? Math.max(remaining ?? 0, fixed);
  if (denominator <= 0) return null;

  const pct = Math.min(100, Math.round((fixed / denominator) * 100));
  const color = pct >= 70 ? COLORS.successDark : pct >= 30 ? COLORS.warningDark : COLORS.errorDark;
  const bgColor = pct >= 70 ? COLORS.successLight : pct >= 30 ? COLORS.warningLight : COLORS.errorLight;

  // Remaining cats: prefer explicit remaining count, else derive from total - fixed
  const remainingCount = remaining ?? (total != null ? Math.max(0, total - fixed) : null);

  if (compact) {
    return (
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% TNR progress`}
        style={{ height: "4px", borderRadius: "2px", background: bgColor, overflow: "hidden" }}
      >
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "2px", transition: "width 0.3s ease" }} />
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "1rem" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${fixed} of ${denominator} cats fixed, ${pct}% complete`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color }}>
          {fixed} of {denominator} cats fixed{remainingCount != null && remainingCount > 0 ? ` · ${remainingCount} remaining` : ""}
        </span>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: "8px", borderRadius: "4px", background: bgColor, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "4px", transition: "width 0.3s ease" }} />
      </div>
    </div>
  );
}
