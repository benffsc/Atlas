/**
 * Shared StatusBadge, PriorityBadge, and PriorityDot components.
 * Single source of truth for status/priority colors across the app.
 */

const STATUS_COLORS: Record<string, { bg: string; color: string; softBg: string; softColor: string }> = {
  new:         { bg: "#0d6efd", color: "#fff", softBg: "#dbeafe", softColor: "#1e40af" },
  triaged:     { bg: "#6610f2", color: "#fff", softBg: "#f3e8ff", softColor: "#6b21a8" },
  scheduled:   { bg: "#198754", color: "#fff", softBg: "#dcfce7", softColor: "#166534" },
  in_progress: { bg: "#fd7e14", color: "#000", softBg: "#fef3c7", softColor: "#92400e" },
  complete:    { bg: "#20c997", color: "#000", softBg: "#ccfbf1", softColor: "#115e59" },
  completed:   { bg: "#20c997", color: "#000", softBg: "#ccfbf1", softColor: "#115e59" },
  cancelled:   { bg: "#6c757d", color: "#fff", softBg: "#f3f4f6", softColor: "#4b5563" },
  on_hold:     { bg: "#ffc107", color: "#000", softBg: "#fef9c3", softColor: "#854d0e" },
  redirected:  { bg: "#9ca3af", color: "#fff", softBg: "#f3f4f6", softColor: "#6b7280" },
  handed_off:  { bg: "#0d9488", color: "#fff", softBg: "#ccfbf1", softColor: "#115e59" },
  archived:    { bg: "#adb5bd", color: "#000", softBg: "#f3f4f6", softColor: "#6b7280" },
};

const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  urgent: { bg: "#dc3545", color: "#fff" },
  high:   { bg: "#fd7e14", color: "#000" },
  normal: { bg: "#6c757d", color: "#fff" },
  low:    { bg: "#adb5bd", color: "#000" },
};

const PRIORITY_DOT_COLORS: Record<string, string> = {
  urgent: "#dc2626",
  high:   "#f97316",
  normal: "#6b7280",
  low:    "#9ca3af",
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
    sm: { fontSize: "0.65rem", padding: "1px 6px" },
    md: { fontSize: "0.75rem", padding: "2px 8px" },
    lg: { fontSize: "0.9rem", padding: "0.5rem 1rem" },
  };

  const displayLabel = label || status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <span
      className="badge"
      style={{
        background: isSoft ? s.softBg : s.bg,
        color: isSoft ? s.softColor : s.color,
        borderRadius: isSoft ? "9999px" : undefined,
        fontWeight: 500,
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
        fontSize: size === "sm" ? "0.65rem" : "0.75rem",
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
