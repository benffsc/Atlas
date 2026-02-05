/**
 * Centralized date and value formatting utilities
 *
 * Use these functions consistently across all UI pages and components
 * to avoid timezone issues and ensure uniform formatting.
 */

/**
 * Format a date string as a local date, avoiding timezone shift issues.
 *
 * This handles the common problem where "2026-01-15" parsed as `new Date()`
 * gets interpreted as UTC midnight, which can display as "Jan 14" in
 * certain timezones.
 *
 * @param dateStr - ISO date string (e.g., "2026-01-15" or "2026-01-15T10:30:00Z")
 * @param options - Intl.DateTimeFormat options (default: month, day, year)
 * @returns Formatted date string or empty string if invalid
 *
 * @example
 * formatDateLocal("2026-01-15") // "Jan 15, 2026"
 * formatDateLocal("2026-01-15T10:30:00Z") // "Jan 15, 2026" (local time)
 * formatDateLocal(null) // ""
 */
export function formatDateLocal(
  dateStr: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
): string {
  if (!dateStr) return "";

  // Check if it's a date-only string (YYYY-MM-DD)
  const dateOnlyMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    // Create date in local timezone to avoid UTC shift
    const localDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return localDate.toLocaleDateString(undefined, options);
  }

  // For full ISO timestamps, parse normally
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";

  return date.toLocaleDateString(undefined, options);
}

/**
 * Format a datetime string including time component.
 *
 * @param dateStr - ISO datetime string (e.g., "2026-01-15T10:30:00Z")
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted datetime string or empty string if invalid
 *
 * @example
 * formatDateTime("2026-01-15T10:30:00Z") // "Jan 15, 2026, 10:30 AM"
 */
export function formatDateTime(
  dateStr: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }
): string {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, options);
}

/**
 * Format a date as a relative time (e.g., "Today", "Yesterday", "3 days ago").
 *
 * Falls back to standard date format for older dates.
 *
 * @param dateStr - ISO date or datetime string
 * @param fallbackDays - Number of days before falling back to standard format (default: 7)
 * @returns Relative time string or formatted date
 *
 * @example
 * formatRelativeDate("2026-01-16T10:00:00Z") // "Today" (if today is Jan 16)
 * formatRelativeDate("2026-01-15T10:00:00Z") // "Yesterday"
 * formatRelativeDate("2026-01-10T10:00:00Z") // "6 days ago"
 * formatRelativeDate("2026-01-01T10:00:00Z") // "Jan 1, 2026"
 */
export function formatRelativeDate(
  dateStr: string | null | undefined,
  fallbackDays: number = 7
): string {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - targetDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 0 && diffDays <= fallbackDays) return `${diffDays} days ago`;

  // Fall back to standard date format
  return formatDateLocal(dateStr);
}

/**
 * Check if a phone number is valid (10 digits, or 11 starting with 1).
 *
 * @param phone - Raw phone string
 * @returns true if valid US phone number, false otherwise
 *
 * @example
 * isValidPhone("7075551234") // true
 * isValidPhone("+17075551234") // true
 * isValidPhone("555-1234") // false (only 7 digits)
 * isValidPhone("(7073967923) 7073967923") // false (malformed)
 */
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;

  // Extract digits only
  const digits = phone.replace(/\D/g, "");

  // Valid: exactly 10 digits, or 11 starting with 1
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

/**
 * Extract a valid phone number from potentially malformed input.
 * Tries to find a 10-digit sequence that looks like a phone number.
 *
 * @param phone - Raw phone string (possibly malformed)
 * @returns Extracted 10-digit phone or null if extraction fails
 *
 * @example
 * extractPhone("(7073967923) 7073967923") // "7073967923"
 * extractPhone("(95492) 7077122660") // "7077122660"
 * extractPhone("(707) 858817") // null (only 9 digits)
 */
export function extractPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");

  // If already valid, return the 10 digits
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);

  // Try to find a 10-digit sequence that starts with a valid area code (2-9)
  // This handles cases like "(7073967923) 7073967923" -> find the repeated 10 digits
  const tenDigitMatch = digits.match(/([2-9]\d{9})/);
  if (tenDigitMatch) return tenDigitMatch[1];

  return null;
}

/**
 * Format a phone number for display.
 *
 * @param phone - Raw phone string
 * @returns Formatted phone number (e.g., "(707) 555-1234")
 *
 * @example
 * formatPhone("7075551234") // "(707) 555-1234"
 * formatPhone("+17075551234") // "(707) 555-1234"
 * formatPhone("555-1234") // "555-1234" (unchanged if not 10 digits)
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";

  // Extract digits only
  const digits = phone.replace(/\D/g, "");

  // Handle 10-digit US numbers
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // Handle 11-digit US numbers with country code
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  // Return original if not a standard format
  return phone;
}

/**
 * Truncate text with ellipsis if longer than maxLength.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated text with "..." or original if shorter
 */
export function truncate(
  text: string | null | undefined,
  maxLength: number = 50
): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Format a number as currency (USD).
 *
 * @param amount - Numeric amount
 * @returns Formatted currency string (e.g., "$123.45")
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Format a number with commas for thousands.
 *
 * @param num - Number to format
 * @returns Formatted number string (e.g., "1,234")
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "";
  return new Intl.NumberFormat("en-US").format(num);
}
