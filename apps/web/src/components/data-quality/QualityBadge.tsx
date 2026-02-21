"use client";

/**
 * QualityBadge - Visual indicator for data quality level
 *
 * Shows data quality status with color-coded badge.
 * Maps to database data_quality enum values.
 */

import type { DataQuality } from "@/lib/constants";

interface QualityBadgeProps {
  quality: DataQuality;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

const QUALITY_CONFIG: Record<
  DataQuality,
  { color: string; bg: string; label: string; icon: string }
> = {
  good: {
    color: "#166534",
    bg: "#dcfce7",
    label: "Verified",
    icon: "✓",
  },
  needs_review: {
    color: "#7c2d12",
    bg: "#fee2e2",
    label: "Needs Review",
    icon: "!",
  },
  garbage: {
    color: "#991b1b",
    bg: "#fecaca",
    label: "Invalid",
    icon: "✗",
  },
};

const SIZE_STYLES = {
  sm: { padding: "2px 6px", fontSize: 10, iconSize: 10 },
  md: { padding: "4px 10px", fontSize: 12, iconSize: 12 },
  lg: { padding: "6px 14px", fontSize: 14, iconSize: 14 },
};

export function QualityBadge({
  quality,
  showLabel = true,
  size = "md",
}: QualityBadgeProps) {
  const config = QUALITY_CONFIG[quality];
  const sizeStyle = SIZE_STYLES[size];

  if (!config) {
    return null;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: sizeStyle.padding,
        background: config.bg,
        color: config.color,
        borderRadius: 12,
        fontSize: sizeStyle.fontSize,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      title={`Data quality: ${config.label}`}
    >
      <span style={{ fontSize: sizeStyle.iconSize }}>{config.icon}</span>
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
