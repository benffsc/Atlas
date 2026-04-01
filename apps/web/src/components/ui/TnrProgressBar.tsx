"use client";

import { COLORS } from "@/lib/design-tokens";

interface TnrProgressBarProps {
  fixed: number;
  estimated: number | null;
  /** Compact mode: 4px height, no label — for card thumbnails */
  compact?: boolean;
}

/**
 * TNR progress bar showing cats fixed vs estimated.
 * Uses design tokens for colors. Supports compact mode for card use.
 */
export function TnrProgressBar({ fixed, estimated, compact = false }: TnrProgressBarProps) {
  if (!estimated || estimated <= 0) return null;
  const pct = Math.min(100, Math.round((fixed / estimated) * 100));
  const color = pct >= 70 ? COLORS.successDark : pct >= 30 ? COLORS.warningDark : COLORS.errorDark;
  const bgColor = pct >= 70 ? COLORS.successLight : pct >= 30 ? COLORS.warningLight : COLORS.errorLight;

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
    <div style={{ marginBottom: "1rem" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${fixed} of ${estimated} cats fixed, ${pct}% complete`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color }}>
          {fixed} / {estimated} cats fixed
        </span>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: "8px", borderRadius: "4px", background: bgColor, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "4px", transition: "width 0.3s ease" }} />
      </div>
    </div>
  );
}
