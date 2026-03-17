"use client";

/**
 * PersonStatusBadges — inline badges for person-level status signals.
 *
 * Shows: trapper tier, DNC flag, organization type, high cat count.
 * Used on people list, PersonDetailDrawer, and EntityPreviewContent.
 *
 * @see FFS-434
 */

export interface PersonStatusBadgesProps {
  /** Person's primary role (from person_roles) */
  primaryRole?: string | null;
  /** Trapper type if role is trapper */
  trapperType?: string | null;
  /** Do not contact flag */
  doNotContact?: boolean;
  /** Account/entity type (organization, rescue, etc.) */
  entityType?: string | null;
  /** Number of cats linked */
  catCount?: number;
  /** Badge size */
  size?: "sm" | "md";
}

const TRAPPER_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  ffsc_staff:          { label: "FFSC Staff",     bg: "#dcfce7", color: "#166534" },
  ffsc_volunteer:      { label: "FFSC Trapper",   bg: "#dcfce7", color: "#166534" },
  community_trapper:   { label: "Community",      bg: "#dbeafe", color: "#1d4ed8" },
  rescue_operator:     { label: "Rescue",         bg: "#f3e8ff", color: "#7c3aed" },
  colony_caretaker:    { label: "Caretaker",      bg: "#fef3c7", color: "#92400e" },
};

const ROLE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  staff:     { label: "Staff",     bg: "#dbeafe", color: "#1d4ed8" },
  volunteer: { label: "Volunteer", bg: "#dcfce7", color: "#166534" },
  foster:    { label: "Foster",    bg: "#fef3c7", color: "#92400e" },
};

const ORG_TYPES: Record<string, { label: string; bg: string; color: string }> = {
  organization: { label: "Org",     bg: "#f3e8ff", color: "#7c3aed" },
  clinic:       { label: "Clinic",  bg: "#fee2e2", color: "#dc2626" },
  rescue:       { label: "Rescue",  bg: "#f3e8ff", color: "#7c3aed" },
  household:    { label: "Household", bg: "#e0e7ff", color: "#4338ca" },
};

export function PersonStatusBadges({
  primaryRole,
  trapperType,
  doNotContact,
  entityType,
  catCount,
  size = "sm",
}: PersonStatusBadgesProps) {
  const badges: Array<{ key: string; label: string; bg: string; color: string }> = [];

  // DNC — always shown first (highest urgency)
  if (doNotContact) {
    badges.push({ key: "dnc", label: "DNC", bg: "#fee2e2", color: "#dc2626" });
  }

  // Trapper badge (takes priority over generic role badge)
  if (primaryRole === "trapper" && trapperType) {
    const config = TRAPPER_CONFIG[trapperType];
    if (config) {
      badges.push({ key: `trapper-${trapperType}`, ...config });
    }
  } else if (primaryRole && primaryRole !== "trapper") {
    const config = ROLE_CONFIG[primaryRole];
    if (config) {
      badges.push({ key: `role-${primaryRole}`, ...config });
    }
  }

  // Organization/entity type (only if not already covered by role)
  if (entityType && entityType !== "individual" && entityType !== "person") {
    const config = ORG_TYPES[entityType];
    if (config) {
      badges.push({ key: `entity-${entityType}`, ...config });
    }
  }

  // High cat count
  if (catCount != null && catCount > 10) {
    badges.push({ key: "cats", label: `${catCount} cats`, bg: "#f3f4f6", color: "var(--text-secondary)" });
  }

  if (badges.length === 0) return null;

  const fontSize = size === "sm" ? "0.65rem" : "0.7rem";
  const padding = size === "sm" ? "0.1rem 0.4rem" : "0.15rem 0.5rem";

  return (
    <span style={{ display: "inline-flex", gap: "0.25rem", flexWrap: "wrap", alignItems: "center" }}>
      {badges.map((b) => (
        <span
          key={b.key}
          className="badge"
          style={{
            background: b.bg,
            color: b.color,
            fontSize,
            padding,
            fontWeight: 600,
          }}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}
