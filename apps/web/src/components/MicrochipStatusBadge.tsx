"use client";

/**
 * MicrochipStatusBadge - Displays microchip status for cats
 *
 * Used to flag whether a cat has a microchip on file.
 * Part of the Atlas Cat ID System (MIG_976).
 */

interface MicrochipStatusBadgeProps {
  hasChip: boolean;
  chipNumber?: string | null;
  /** "sm" = compact, "md" = default */
  size?: "sm" | "md";
  /** Show the chip number if available */
  showNumber?: boolean;
}

const CHIP_STATUS = {
  chipped: {
    bg: "#dcfce7",
    color: "#166534",
    icon: "✓",
    label: "Chipped",
  },
  unchipped: {
    bg: "#fef3c7",
    color: "#92400e",
    icon: "!",
    label: "No Chip",
  },
  unknown: {
    bg: "#f3f4f6",
    color: "#6b7280",
    icon: "?",
    label: "Unknown",
  },
} as const;

export function MicrochipStatusBadge({
  hasChip,
  chipNumber,
  size = "md",
  showNumber = false,
}: MicrochipStatusBadgeProps) {
  const status = hasChip ? CHIP_STATUS.chipped : CHIP_STATUS.unchipped;

  const sizeStyles = {
    sm: { fontSize: "0.6rem", padding: "1px 5px", gap: "2px" },
    md: { fontSize: "0.7rem", padding: "2px 6px", gap: "3px" },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizeStyles[size].gap,
        padding: sizeStyles[size].padding,
        background: status.bg,
        color: status.color,
        borderRadius: "4px",
        fontSize: sizeStyles[size].fontSize,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      title={
        hasChip && chipNumber
          ? `Microchip: ${chipNumber}`
          : hasChip
          ? "Has microchip on file"
          : "No microchip on file"
      }
    >
      <span style={{ fontWeight: 700 }}>{status.icon}</span>
      <span>{status.label}</span>
      {showNumber && hasChip && chipNumber && (
        <span
          style={{
            opacity: 0.8,
            fontSize: "0.9em",
          }}
        >
          (...{chipNumber.slice(-4)})
        </span>
      )}
    </span>
  );
}

/**
 * Convenience component for unknown chip status
 */
export function UnknownChipBadge({ size = "md" }: { size?: "sm" | "md" }) {
  const status = CHIP_STATUS.unknown;

  const sizeStyles = {
    sm: { fontSize: "0.6rem", padding: "1px 5px", gap: "2px" },
    md: { fontSize: "0.7rem", padding: "2px 6px", gap: "3px" },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizeStyles[size].gap,
        padding: sizeStyles[size].padding,
        background: status.bg,
        color: status.color,
        borderRadius: "4px",
        fontSize: sizeStyles[size].fontSize,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      title="Microchip status unknown"
    >
      <span style={{ fontWeight: 700 }}>{status.icon}</span>
      <span>{status.label}</span>
    </span>
  );
}
