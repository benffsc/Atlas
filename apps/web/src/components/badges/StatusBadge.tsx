/**
 * Shared StatusBadge, PriorityBadge, and PriorityDot components.
 * Single source of truth for status/priority colors across the app.
 *
 * Status System (MIG_2530):
 * - Primary: new, working, paused, completed
 * - Special: redirected, handed_off
 * - Legacy (mapped): triaged→new, scheduled→working, in_progress→working, on_hold→paused
 */

import { COLORS, TYPOGRAPHY, BORDERS, SPACING } from "@/lib/design-tokens";

const STATUS_COLORS: Record<string, { bg: string; color: string; softBg: string; softColor: string }> = {
  // PRIMARY STATUSES (new simplified system)
  new:         { bg: COLORS.primary, color: COLORS.white, softBg: COLORS.primaryLight, softColor: COLORS.primaryDark },  // Blue
  working:     { bg: COLORS.warning, color: COLORS.black, softBg: COLORS.warningLight, softColor: COLORS.warningDark },  // Amber
  paused:      { bg: "#ec4899", color: COLORS.white, softBg: "#fce7f3", softColor: "#9d174d" },  // Pink
  completed:   { bg: COLORS.success, color: COLORS.white, softBg: COLORS.successLight, softColor: COLORS.successDark },  // Emerald

  // SPECIAL STATUSES
  redirected:  { bg: COLORS.gray400, color: COLORS.white, softBg: COLORS.gray100, softColor: COLORS.gray500 },  // Gray
  handed_off:  { bg: "#0d9488", color: COLORS.white, softBg: "#ccfbf1", softColor: "#115e59" },  // Teal

  // LEGACY STATUSES (for backward compatibility - display as primary equivalent)
  triaged:     { bg: COLORS.primary, color: COLORS.white, softBg: COLORS.primaryLight, softColor: COLORS.primaryDark },  // → new
  scheduled:   { bg: COLORS.warning, color: COLORS.black, softBg: COLORS.warningLight, softColor: COLORS.warningDark },  // → working
  in_progress: { bg: COLORS.warning, color: COLORS.black, softBg: COLORS.warningLight, softColor: COLORS.warningDark },  // → working
  on_hold:     { bg: "#ec4899", color: COLORS.white, softBg: "#fce7f3", softColor: "#9d174d" },  // → paused
  cancelled:   { bg: COLORS.gray500, color: COLORS.white, softBg: COLORS.gray100, softColor: COLORS.gray600 },  // → completed (gray)
  complete:    { bg: COLORS.success, color: COLORS.white, softBg: COLORS.successLight, softColor: COLORS.successDark },  // → completed
  partial:     { bg: COLORS.gray500, color: COLORS.white, softBg: COLORS.gray100, softColor: COLORS.gray600 },  // → completed (gray)
  archived:    { bg: COLORS.gray300, color: COLORS.black, softBg: COLORS.gray100, softColor: COLORS.gray500 },
};

/**
 * Maps legacy status values to their display labels.
 * Legacy statuses show their new equivalent name.
 */
const STATUS_LABELS: Record<string, string> = {
  // Primary statuses
  new: "New",
  working: "Working",
  paused: "Paused",
  completed: "Completed",
  // Special statuses
  redirected: "Redirected",
  handed_off: "Handed Off",
  // Legacy → display as new equivalent
  triaged: "New",
  scheduled: "Working",
  in_progress: "Working",
  on_hold: "Paused",
  cancelled: "Completed",
  partial: "Completed",
  complete: "Completed",
};

const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  urgent: { bg: COLORS.error, color: COLORS.white },
  high:   { bg: "#fd7e14", color: COLORS.black },
  normal: { bg: COLORS.gray500, color: COLORS.white },
  low:    { bg: COLORS.gray300, color: COLORS.black },
};

const PRIORITY_DOT_COLORS: Record<string, string> = {
  urgent: COLORS.error,
  high:   "#f97316",
  normal: COLORS.gray500,
  low:    COLORS.gray400,
};

interface StatusBadgeProps {
  status: string;
  /** "solid" = bold background (default), "soft" = light tinted background */
  variant?: "solid" | "soft";
  /** "sm" = compact, "md" = default, "lg" = prominent (request detail header) */
  size?: "sm" | "md" | "lg";
  /** Custom label override (otherwise auto-generated from status) */
  label?: string;
}

export function StatusBadge({ status, variant = "solid", size = "md", label }: StatusBadgeProps) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.cancelled;
  const isSoft = variant === "soft";

  const sizeStyles = {
    sm: { fontSize: TYPOGRAPHY.size["2xs"], padding: `1px ${SPACING.sm}` },
    md: { fontSize: TYPOGRAPHY.size.xs, padding: `2px ${SPACING.sm}` },
    lg: { fontSize: TYPOGRAPHY.size.sm, padding: `${SPACING.sm} ${SPACING.lg}` },
  };

  const displayLabel = label || STATUS_LABELS[status] || status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <span
      className="badge"
      style={{
        background: isSoft ? s.softBg : s.bg,
        color: isSoft ? s.softColor : s.color,
        borderRadius: isSoft ? BORDERS.radius.full : undefined,
        fontWeight: TYPOGRAPHY.weight.medium,
        textTransform: "capitalize",
        whiteSpace: "nowrap",
        ...sizeStyles[size],
      }}
    >
      {displayLabel}
    </span>
  );
}

interface PriorityBadgeProps {
  priority: string;
  size?: "sm" | "md";
}

export function PriorityBadge({ priority, size = "md" }: PriorityBadgeProps) {
  const s = PRIORITY_COLORS[priority] || PRIORITY_COLORS.normal;

  return (
    <span
      className="badge"
      style={{
        background: s.bg,
        color: s.color,
        fontSize: size === "sm" ? TYPOGRAPHY.size["2xs"] : TYPOGRAPHY.size.xs,
        textTransform: "capitalize",
      }}
    >
      {priority}
    </span>
  );
}

interface PriorityDotProps {
  priority: string;
}

export function PriorityDot({ priority }: PriorityDotProps) {
  const color = PRIORITY_DOT_COLORS[priority] || PRIORITY_DOT_COLORS.normal;

  return (
    <span
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: color,
        display: "inline-block",
      }}
      title={priority}
    />
  );
}
