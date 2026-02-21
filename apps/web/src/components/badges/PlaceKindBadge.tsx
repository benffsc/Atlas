"use client";

export type PlaceKind =
  | "single_family"
  | "apartment_unit"
  | "apartment_building"
  | "mobile_home"
  | "business"
  | "farm"
  | "outdoor_site"
  | "clinic"
  | "shelter"
  | "unknown";

interface PlaceKindConfig {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
}

const PLACE_KIND_CONFIG: Record<PlaceKind, PlaceKindConfig> = {
  single_family: {
    icon: "\u{1F3E1}",
    label: "House",
    color: "#166534",
    bgColor: "#dcfce7",
  },
  apartment_unit: {
    icon: "\u{1F6AA}",
    label: "Unit",
    color: "#1d4ed8",
    bgColor: "#dbeafe",
  },
  apartment_building: {
    icon: "\u{1F3E2}",
    label: "Apartments",
    color: "#4338ca",
    bgColor: "#e0e7ff",
  },
  mobile_home: {
    icon: "\u{1F69A}",
    label: "Mobile",
    color: "#7c3aed",
    bgColor: "#ede9fe",
  },
  business: {
    icon: "\u{1F3EA}",
    label: "Business",
    color: "#b45309",
    bgColor: "#fef3c7",
  },
  farm: {
    icon: "\u{1F33E}",
    label: "Farm",
    color: "#4d7c0f",
    bgColor: "#ecfccb",
  },
  outdoor_site: {
    icon: "\u{1F3DE}",
    label: "Outdoor",
    color: "#0d9488",
    bgColor: "#ccfbf1",
  },
  clinic: {
    icon: "\u{1FA7A}",
    label: "Clinic",
    color: "#dc2626",
    bgColor: "#fee2e2",
  },
  shelter: {
    icon: "\u{1F3E5}",
    label: "Shelter",
    color: "#9333ea",
    bgColor: "#f3e8ff",
  },
  unknown: {
    icon: "\u{2753}",
    label: "Unknown",
    color: "#6b7280",
    bgColor: "#f3f4f6",
  },
};

interface PlaceKindBadgeProps {
  /** Place kind value */
  kind: PlaceKind | string | null | undefined;
  /** Show icon only (compact mode) */
  iconOnly?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional class */
  className?: string;
}

/**
 * Visual indicator for place classification.
 *
 * Shows the type of place (house, apartment, business, outdoor, etc.)
 * based on the place_kind column from MIG_2417.
 *
 * @example
 * ```tsx
 * <PlaceKindBadge kind="single_family" />
 * <PlaceKindBadge kind="outdoor_site" iconOnly />
 * <PlaceKindBadge kind={place.place_kind} size="sm" />
 * ```
 */
export function PlaceKindBadge({
  kind,
  iconOnly = false,
  size = "md",
  className = "",
}: PlaceKindBadgeProps) {
  // Handle null/undefined/unknown kinds
  const normalizedKind = (kind && kind in PLACE_KIND_CONFIG ? kind : "unknown") as PlaceKind;
  const config = PLACE_KIND_CONFIG[normalizedKind];

  const sizeClasses = size === "sm"
    ? "text-xs px-1.5 py-0.5 gap-1"
    : "text-sm px-2 py-1 gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses} ${className}`}
      style={{ backgroundColor: config.bgColor, color: config.color }}
      title={config.label}
    >
      <span role="img" aria-label={config.label}>
        {config.icon}
      </span>
      {!iconOnly && <span>{config.label}</span>}
    </span>
  );
}

/**
 * Get display label for a place kind
 */
export function getPlaceKindLabel(kind: PlaceKind | string | null | undefined): string {
  const normalizedKind = (kind && kind in PLACE_KIND_CONFIG ? kind : "unknown") as PlaceKind;
  return PLACE_KIND_CONFIG[normalizedKind].label;
}

export default PlaceKindBadge;
