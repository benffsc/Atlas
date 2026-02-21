"use client";

export type PropertyType =
  | "private_home"
  | "apartment_complex"
  | "mobile_home_park"
  | "business"
  | "farm_ranch"
  | "public_park"
  | "industrial"
  | "other";

interface PropertyTypeConfig {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
}

const PROPERTY_CONFIG: Record<PropertyType, PropertyTypeConfig> = {
  private_home: {
    icon: "\u{1F3E0}",
    label: "Residence",
    color: "#166534",
    bgColor: "#dcfce7",
  },
  apartment_complex: {
    icon: "\u{1F3E2}",
    label: "Apartment",
    color: "#1d4ed8",
    bgColor: "#dbeafe",
  },
  mobile_home_park: {
    icon: "\u{1F3D8}",
    label: "Mobile Home",
    color: "#7c3aed",
    bgColor: "#ede9fe",
  },
  business: {
    icon: "\u{1F3EA}",
    label: "Business",
    color: "#b45309",
    bgColor: "#fef3c7",
  },
  farm_ranch: {
    icon: "\u{1F33E}",
    label: "Farm/Ranch",
    color: "#4d7c0f",
    bgColor: "#ecfccb",
  },
  public_park: {
    icon: "\u{1F333}",
    label: "Public",
    color: "#0891b2",
    bgColor: "#cffafe",
  },
  industrial: {
    icon: "\u{1F3ED}",
    label: "Industrial",
    color: "#475569",
    bgColor: "#f1f5f9",
  },
  other: {
    icon: "\u{1F4CD}",
    label: "Other",
    color: "#6b7280",
    bgColor: "#f3f4f6",
  },
};

interface PropertyTypeBadgeProps {
  /** Property type value */
  type: PropertyType | string | null | undefined;
  /** Show icon only (compact mode) */
  iconOnly?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional class */
  className?: string;
}

/**
 * Visual indicator for residence/business/farm distinction.
 *
 * Used to show property type on request and place pages.
 *
 * @example
 * ```tsx
 * <PropertyTypeBadge type="private_home" />
 * <PropertyTypeBadge type="business" iconOnly />
 * <PropertyTypeBadge type={request.property_type} size="sm" />
 * ```
 */
export function PropertyTypeBadge({
  type,
  iconOnly = false,
  size = "md",
  className = "",
}: PropertyTypeBadgeProps) {
  // Handle null/undefined/unknown types
  const normalizedType = (type && type in PROPERTY_CONFIG ? type : "other") as PropertyType;
  const config = PROPERTY_CONFIG[normalizedType];

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
 * Get display label for a property type
 */
export function getPropertyTypeLabel(type: PropertyType | string | null | undefined): string {
  const normalizedType = (type && type in PROPERTY_CONFIG ? type : "other") as PropertyType;
  return PROPERTY_CONFIG[normalizedType].label;
}

export default PropertyTypeBadge;
