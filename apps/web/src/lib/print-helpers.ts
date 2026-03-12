/**
 * Shared formatting helpers for print documents.
 */

/** Replace underscores with spaces and title-case each word. Returns "" for null/undefined. */
export function formatPrintValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a date string for print display. Returns "" for null/undefined. */
export function formatPrintDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
