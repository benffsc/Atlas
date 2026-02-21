"use client";

import { useState } from "react";

/**
 * AtlasCatIdBadge - Displays the Atlas Cat ID for verified clinic cats
 *
 * Format: MMDDYYYY##-[****]
 *   - MMDDYYYY = clinic date
 *   - ## = clinic day number (01-99)
 *   - **** = last 4 of microchip OR hash for unchipped
 *
 * Part of the Atlas Cat ID System (MIG_976).
 */

interface AtlasCatIdBadgeProps {
  atlasCatId: string;
  /** Whether the suffix is from microchip (true) or hash (false) */
  isChipped?: boolean;
  /** "sm" = compact, "md" = default, "lg" = prominent */
  size?: "sm" | "md" | "lg";
  /** Show formatted display (MM/DD/YYYY #XX [XXXX]) vs raw ID */
  formatted?: boolean;
  /** Allow click to copy */
  copyable?: boolean;
}

// Parse atlas_cat_id: MMDDYYYY##-XXXX
function parseAtlasCatId(id: string): {
  month: string;
  day: string;
  year: string;
  number: string;
  suffix: string;
} | null {
  const match = id.match(/^(\d{2})(\d{2})(\d{4})(\d{2})-([A-Z0-9]{4})$/);
  if (!match) return null;

  return {
    month: match[1],
    day: match[2],
    year: match[3],
    number: match[4],
    suffix: match[5],
  };
}

const BADGE_STYLES = {
  chipped: {
    bg: "#dbeafe",
    color: "#1e40af",
    suffixBg: "#3b82f6",
    suffixColor: "#fff",
  },
  unchipped: {
    bg: "#fef3c7",
    color: "#92400e",
    suffixBg: "#f59e0b",
    suffixColor: "#fff",
  },
} as const;

export function AtlasCatIdBadge({
  atlasCatId,
  isChipped = true,
  size = "md",
  formatted = true,
  copyable = true,
}: AtlasCatIdBadgeProps) {
  const [copied, setCopied] = useState(false);

  const parsed = parseAtlasCatId(atlasCatId);
  const style = isChipped ? BADGE_STYLES.chipped : BADGE_STYLES.unchipped;

  const sizeStyles = {
    sm: { fontSize: "0.6rem", padding: "1px 5px", gap: "3px" },
    md: { fontSize: "0.7rem", padding: "2px 8px", gap: "4px" },
    lg: { fontSize: "0.85rem", padding: "4px 12px", gap: "6px" },
  };

  const handleCopy = async () => {
    if (!copyable) return;
    try {
      await navigator.clipboard.writeText(atlasCatId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failed, ignore
    }
  };

  // If we can't parse the ID, show raw
  if (!parsed) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: sizeStyles[size].padding,
          background: style.bg,
          color: style.color,
          borderRadius: "4px",
          fontSize: sizeStyles[size].fontSize,
          fontWeight: 500,
          fontFamily: "monospace",
          cursor: copyable ? "pointer" : "default",
        }}
        onClick={handleCopy}
        title={copyable ? "Click to copy" : atlasCatId}
      >
        {atlasCatId}
      </span>
    );
  }

  // Formatted display: MM/DD/YYYY #XX [XXXX]
  const formattedDisplay = formatted
    ? `${parsed.month}/${parsed.day}/${parsed.year} #${parsed.number}`
    : atlasCatId.slice(0, -5); // Without suffix

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizeStyles[size].gap,
        padding: sizeStyles[size].padding,
        background: style.bg,
        color: style.color,
        borderRadius: "6px",
        fontSize: sizeStyles[size].fontSize,
        fontWeight: 500,
        cursor: copyable ? "pointer" : "default",
        transition: "opacity 0.2s",
      }}
      onClick={handleCopy}
      title={
        copied
          ? "Copied!"
          : copyable
          ? `Atlas Cat ID: ${atlasCatId} (click to copy)`
          : `Atlas Cat ID: ${atlasCatId}`
      }
    >
      {/* Date and number portion */}
      <span style={{ fontFamily: "system-ui" }}>{formattedDisplay}</span>

      {/* Suffix chip */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: size === "lg" ? "2px 6px" : "1px 4px",
          background: style.suffixBg,
          color: style.suffixColor,
          borderRadius: "3px",
          fontFamily: "monospace",
          fontSize: size === "sm" ? "0.55rem" : size === "lg" ? "0.75rem" : "0.65rem",
          fontWeight: 600,
          letterSpacing: "0.5px",
        }}
      >
        {parsed.suffix}
      </span>

      {/* Copied indicator */}
      {copied && (
        <span
          style={{
            fontSize: "0.65rem",
            color: "#10b981",
            marginLeft: "2px",
          }}
        >
          ✓
        </span>
      )}
    </span>
  );
}

/**
 * Compact version for tables and lists
 */
export function AtlasCatIdCompact({
  atlasCatId,
  isChipped = true,
}: {
  atlasCatId: string;
  isChipped?: boolean;
}) {
  return (
    <AtlasCatIdBadge
      atlasCatId={atlasCatId}
      isChipped={isChipped}
      size="sm"
      formatted={false}
    />
  );
}

/**
 * Just the suffix portion (for when date is already shown)
 */
export function AtlasCatIdSuffix({
  suffix,
  isChipped = true,
  size = "sm",
}: {
  suffix: string;
  isChipped?: boolean;
  size?: "sm" | "md";
}) {
  const style = isChipped ? BADGE_STYLES.chipped : BADGE_STYLES.unchipped;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: size === "sm" ? "1px 4px" : "2px 6px",
        background: style.suffixBg,
        color: style.suffixColor,
        borderRadius: "3px",
        fontFamily: "monospace",
        fontSize: size === "sm" ? "0.6rem" : "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.5px",
      }}
      title={isChipped ? "Last 4 of microchip" : "Hash (no microchip)"}
    >
      {suffix}
    </span>
  );
}

/**
 * Placeholder for cats without atlas_cat_id
 */
export function NoAtlasCatId({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: size === "sm" ? "1px 5px" : "2px 8px",
        background: "#f3f4f6",
        color: "#9ca3af",
        borderRadius: "4px",
        fontSize: size === "sm" ? "0.6rem" : "0.7rem",
        fontWeight: 500,
        fontStyle: "italic",
      }}
      title="No Atlas Cat ID (not verified at clinic)"
    >
      No Atlas ID
    </span>
  );
}
