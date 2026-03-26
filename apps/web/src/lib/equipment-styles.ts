/**
 * Equipment Status Style Maps
 *
 * Centralized CSS-variable-based style maps for equipment UI.
 * Replaces all hardcoded hex color maps across equipment files (FFS-748).
 *
 * Uses CSS variables from globals.css:
 *   --success-*, --warning-*, --danger-*, --info-*, --muted, --border
 */

export interface StatusStyle {
  bg: string;
  border: string;
  text: string;
}

// =============================================================================
// CUSTODY STATUS (available, checked_out, in_field, maintenance, missing, retired)
// =============================================================================

export const CUSTODY_STATUS_STYLES: Record<string, StatusStyle> = {
  available:   { bg: "var(--success-bg)",  border: "var(--success-border)", text: "var(--success-text)" },
  checked_out: { bg: "var(--warning-bg)",  border: "var(--warning-border)", text: "var(--warning-text)" },
  in_field:    { bg: "var(--caution-bg)",  border: "var(--caution-border)", text: "var(--caution-text)" },
  maintenance: { bg: "var(--info-bg)",     border: "var(--info-border)",    text: "var(--info-text)" },
  missing:     { bg: "var(--danger-bg)",   border: "var(--danger-border)",  text: "var(--danger-text)" },
  retired:     { bg: "var(--muted-bg, #f3f4f6)", border: "var(--border)", text: "var(--muted)" },
};

// =============================================================================
// CONDITION STATUS (new, good, fair, poor, damaged, decommissioned)
// =============================================================================

export const CONDITION_STATUS_STYLES: Record<string, StatusStyle> = {
  new:              { bg: "var(--info-bg)",      border: "var(--info-border)",      text: "var(--info-text)" },
  good:             { bg: "var(--success-bg)",   border: "var(--success-border)",   text: "var(--success-text)" },
  fair:             { bg: "var(--warning-bg)",   border: "var(--warning-border)",   text: "var(--warning-text)" },
  poor:             { bg: "var(--danger-bg)",    border: "var(--danger-border)",    text: "var(--danger-text)" },
  damaged:          { bg: "var(--critical-bg)",  border: "var(--critical-border)",  text: "var(--critical-text)" },
  decommissioned:   { bg: "var(--muted-bg, #f3f4f6)", border: "var(--border)", text: "var(--muted)" },
};

// =============================================================================
// EVENT TYPE (check_out, check_in, transfer, etc.)
// =============================================================================

export const EVENT_TYPE_STYLES: Record<string, StatusStyle> = {
  check_out:        { bg: "var(--warning-bg)",   border: "var(--warning-border)",   text: "var(--warning-text)" },
  check_in:         { bg: "var(--success-bg)",   border: "var(--success-border)",   text: "var(--success-text)" },
  transfer:         { bg: "var(--info-bg)",      border: "var(--info-border)",      text: "var(--info-text)" },
  reported_missing: { bg: "var(--danger-bg)",    border: "var(--danger-border)",    text: "var(--danger-text)" },
  found:            { bg: "var(--success-bg)",   border: "var(--success-border)",   text: "var(--success-text)" },
  retired:          { bg: "var(--muted-bg, #f3f4f6)", border: "var(--border)", text: "var(--muted)" },
  maintenance_start:{ bg: "var(--info-bg)",      border: "var(--info-border)",      text: "var(--info-text)" },
  maintenance_end:  { bg: "var(--success-bg)",   border: "var(--success-border)",   text: "var(--success-text)" },
  condition_change: { bg: "var(--caution-bg)",   border: "var(--caution-border)",   text: "var(--caution-text)" },
  note:             { bg: "var(--muted-bg, #f3f4f6)", border: "var(--border)", text: "var(--muted)" },
};

// =============================================================================
// FUNCTIONAL STATUS (functional, needs_repair, unknown)
// =============================================================================

export const FUNCTIONAL_STATUS_STYLES: Record<string, StatusStyle> = {
  functional:   { bg: "var(--success-bg)",   border: "var(--success-border)",   text: "var(--success-text)" },
  needs_repair: { bg: "var(--danger-bg)",    border: "var(--danger-border)",    text: "var(--danger-text)" },
  unknown:      { bg: "var(--muted-bg, #f3f4f6)", border: "var(--border)", text: "var(--muted)" },
};

// =============================================================================
// SCAN / RECONCILE RESULT STYLES
// =============================================================================

export const SCAN_RESULT_STYLES: Record<string, StatusStyle> = {
  confirmed:        { bg: "var(--success-bg)",   border: "var(--success-border)",   text: "var(--success-text)" },
  found_here:       { bg: "var(--info-bg)",      border: "var(--info-border)",      text: "var(--info-text)" },
  found:            { bg: "var(--info-bg)",      border: "var(--info-border)",      text: "var(--info-text)" },
  possibly_missing: { bg: "var(--warning-bg)",   border: "var(--warning-border)",   text: "var(--warning-text)" },
  expected_out:     { bg: "var(--muted-bg, #f3f4f6)", border: "var(--border)", text: "var(--muted)" },
  still_missing:    { bg: "var(--danger-bg)",    border: "var(--danger-border)",    text: "var(--danger-text)" },
};

// =============================================================================
// ACTION BUTTON STYLES
// =============================================================================

export const ACTION_BUTTON_STYLES: Record<string, string> = {
  check_out:        "var(--warning-text)",
  check_in:         "var(--success-text)",
  transfer:         "var(--info-text)",
  reported_missing: "var(--danger-text)",
  retired:          "var(--muted)",
};

// =============================================================================
// HELPERS
// =============================================================================

const DEFAULT_STYLE: StatusStyle = {
  bg: "var(--muted-bg, #f3f4f6)",
  border: "var(--border)",
  text: "var(--muted)",
};

export function getCustodyStyle(status: string): StatusStyle {
  return CUSTODY_STATUS_STYLES[status] || DEFAULT_STYLE;
}

export function getConditionStyle(status: string): StatusStyle {
  return CONDITION_STATUS_STYLES[status] || DEFAULT_STYLE;
}

export function getEventStyle(eventType: string): StatusStyle {
  return EVENT_TYPE_STYLES[eventType] || DEFAULT_STYLE;
}

export function getFunctionalStyle(status: string): StatusStyle {
  return FUNCTIONAL_STATUS_STYLES[status] || DEFAULT_STYLE;
}

export function getScanResultStyle(status: string): StatusStyle {
  return SCAN_RESULT_STYLES[status] || DEFAULT_STYLE;
}

export function getActionColor(action: string): string {
  return ACTION_BUTTON_STYLES[action] || "var(--muted)";
}
