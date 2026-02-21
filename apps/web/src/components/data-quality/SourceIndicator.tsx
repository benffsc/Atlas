"use client";

/**
 * SourceIndicator - Shows data source system origin
 *
 * Visual indicator for where data originated.
 * Maps to database source_system values.
 */

import type { SourceSystem } from "@/lib/constants";

interface SourceIndicatorProps {
  source: SourceSystem;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

const SOURCE_CONFIG: Record<
  SourceSystem,
  { color: string; bg: string; label: string; abbrev: string }
> = {
  clinichq: {
    color: "#1d4ed8",
    bg: "#dbeafe",
    label: "ClinicHQ",
    abbrev: "CHQ",
  },
  shelterluv: {
    color: "#7c3aed",
    bg: "#ede9fe",
    label: "ShelterLuv",
    abbrev: "SL",
  },
  airtable: {
    color: "#0891b2",
    bg: "#cffafe",
    label: "Airtable",
    abbrev: "AT",
  },
  volunteerhub: {
    color: "#059669",
    bg: "#d1fae5",
    label: "VolunteerHub",
    abbrev: "VH",
  },
  web_intake: {
    color: "#d97706",
    bg: "#fef3c7",
    label: "Web Intake",
    abbrev: "WI",
  },
  petlink: {
    color: "#be185d",
    bg: "#fce7f3",
    label: "PetLink",
    abbrev: "PL",
  },
  google_maps: {
    color: "#dc2626",
    bg: "#fee2e2",
    label: "Google Maps",
    abbrev: "GM",
  },
  atlas_ui: {
    color: "#4f46e5",
    bg: "#e0e7ff",
    label: "Atlas UI",
    abbrev: "UI",
  },
};

const SIZE_STYLES = {
  sm: { padding: "2px 6px", fontSize: 10 },
  md: { padding: "3px 8px", fontSize: 11 },
  lg: { padding: "4px 12px", fontSize: 13 },
};

export function SourceIndicator({
  source,
  showLabel = false,
  size = "sm",
}: SourceIndicatorProps) {
  const config = SOURCE_CONFIG[source];
  const sizeStyle = SIZE_STYLES[size];

  if (!config) {
    return (
      <span
        style={{
          display: "inline-flex",
          padding: sizeStyle.padding,
          background: "#f3f4f6",
          color: "#6b7280",
          borderRadius: 4,
          fontSize: sizeStyle.fontSize,
          fontWeight: 500,
        }}
      >
        {source}
      </span>
    );
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
        borderRadius: 4,
        fontSize: sizeStyle.fontSize,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      title={config.label}
    >
      {showLabel ? config.label : config.abbrev}
    </span>
  );
}
