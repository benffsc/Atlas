"use client";

import React from "react";

type ShowWhenMode = "always" | "truthy" | "nonzero" | "defined";

interface SmartFieldProps {
  /** Field label displayed to the user */
  label: string;
  /** Value to display - will be evaluated based on showWhen mode */
  value: unknown;
  /**
   * When to show the field:
   * - "always": Always show, even if value is null/undefined/0
   * - "truthy": Show only if value is truthy (not null, undefined, 0, "", false)
   * - "nonzero": Show if truthy OR if value is explicitly 0 (hides null/undefined)
   * - "defined": Show if value is not null/undefined (includes 0, "", false)
   * Default: "truthy"
   */
  showWhen?: ShowWhenMode;
  /** Optional hint text shown below the label */
  hint?: string;
  /** Optional fallback content to show instead of hiding */
  fallback?: React.ReactNode;
  /** Custom formatter for the value */
  formatter?: (value: unknown) => string | React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Legacy request mode - shows fields even when empty for historical context */
  legacyMode?: boolean;
}

// Values that indicate "no data" in legacy Airtable imports
const LEGACY_EMPTY_VALUES = ["Unknown", "N/A", "?", "TBD", "-", "None", "none", "n/a"];

/**
 * SmartField - Intelligent field display with automatic hiding
 *
 * Reduces visual noise by hiding fields that have no meaningful value,
 * while maintaining backwards compatibility with legacy Airtable requests.
 *
 * @example
 * // Hide if value is falsy (default)
 * <SmartField label="Eartips Observed" value={request.eartip_count} />
 *
 * // Always show core fields
 * <SmartField label="Cats Needing TNR" value={request.estimated_cat_count} showWhen="always" />
 *
 * // Show if defined (including 0)
 * <SmartField label="Peak Count" value={request.peak_count} showWhen="defined" />
 *
 * // Legacy mode for Airtable requests
 * <SmartField label="Previous TNR" value={request.previous_tnr} legacyMode={isLegacy} />
 */
export function SmartField({
  label,
  value,
  showWhen = "truthy",
  hint,
  fallback,
  formatter,
  className,
  legacyMode = false,
}: SmartFieldProps) {
  // Determine if we should hide this field
  const shouldHide = (): boolean => {
    // Legacy mode: show fields even if empty (for historical context)
    if (legacyMode) {
      return false;
    }

    // Check for legacy empty values regardless of mode
    if (typeof value === "string" && LEGACY_EMPTY_VALUES.includes(value)) {
      return showWhen !== "always";
    }

    switch (showWhen) {
      case "always":
        return false;

      case "truthy":
        return !value;

      case "nonzero":
        // Show if truthy, or if value is exactly 0 (number)
        return !value && value !== 0;

      case "defined":
        // Show if not null/undefined
        return value === null || value === undefined;

      default:
        return !value;
    }
  };

  if (shouldHide()) {
    return fallback ?? null;
  }

  // Format the display value
  const displayValue = (): React.ReactNode => {
    if (formatter) {
      return formatter(value);
    }

    // Handle boolean values
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      return <span style={{ color: "var(--muted)", fontStyle: "italic" }}>—</span>;
    }

    // Handle legacy empty values
    if (typeof value === "string" && LEGACY_EMPTY_VALUES.includes(value)) {
      return <span style={{ color: "var(--muted)", fontStyle: "italic" }}>—</span>;
    }

    return String(value);
  };

  return (
    <div className={className} style={{ marginBottom: "0.5rem" }}>
      <dt
        style={{
          fontSize: "0.75rem",
          fontWeight: 500,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "0.25rem",
        }}
      >
        {label}
        {hint && (
          <span
            style={{
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: "normal",
              marginLeft: "0.5rem",
              fontSize: "0.7rem",
            }}
          >
            ({hint})
          </span>
        )}
      </dt>
      <dd style={{ margin: 0, fontSize: "0.9rem" }}>{displayValue()}</dd>
    </div>
  );
}

/**
 * YesNoSmartField - Specialized SmartField for boolean values
 *
 * Shows Yes/No with appropriate styling, hides when null/undefined.
 */
export function YesNoSmartField({
  label,
  value,
  showWhen = "defined",
  hint,
  className,
  legacyMode,
}: Omit<SmartFieldProps, "value" | "formatter"> & { value: boolean | null | undefined }) {
  const formatter = (v: unknown): React.ReactNode => {
    if (v === true) {
      return <span style={{ color: "#16a34a", fontWeight: 500 }}>Yes</span>;
    }
    if (v === false) {
      return <span style={{ color: "#dc2626" }}>No</span>;
    }
    return <span style={{ color: "var(--muted)", fontStyle: "italic" }}>—</span>;
  };

  return (
    <SmartField
      label={label}
      value={value}
      showWhen={showWhen}
      hint={hint}
      formatter={formatter}
      className={className}
      legacyMode={legacyMode}
    />
  );
}

/**
 * Helper to check if a request is from a legacy source
 */
export function isLegacySource(sourceSystem: string | null | undefined): boolean {
  if (!sourceSystem) return false;
  return sourceSystem.startsWith("airtable");
}

export default SmartField;
