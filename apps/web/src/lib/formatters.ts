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
 * Extract ALL valid phone numbers from a string that may contain multiple.
 * Useful for fields like "707 8782184 home 707 7910139" or "(484)-744-0640 or 707-575-7194".
 *
 * @param phone - Raw phone string (possibly containing multiple numbers)
 * @returns Array of extracted 10-digit phones (may be empty)
 *
 * @example
 * extractPhones("707 8782184 home 707 7910139") // ["7078782184", "7077910139"]
 * extractPhones("(484)-744-0640 or 707-575-7194") // ["4847440640", "7075757194"]
 * extractPhones("7075551234") // ["7075551234"]
 * extractPhones("invalid") // []
 */
export function extractPhones(phone: string | null | undefined): string[] {
  if (!phone) return [];

  const digits = phone.replace(/\D/g, "");

  // If exactly 10 digits, return as single phone
  if (digits.length === 10) return [digits];

  // If 11 digits starting with 1, strip country code
  if (digits.length === 11 && digits.startsWith("1")) return [digits.slice(1)];

  // If exactly 20 digits, likely two 10-digit phones concatenated
  if (digits.length === 20) {
    const phone1 = digits.slice(0, 10);
    const phone2 = digits.slice(10);
    // Validate both start with valid area code (2-9)
    if (/^[2-9]/.test(phone1) && /^[2-9]/.test(phone2)) {
      return [phone1, phone2];
    }
  }

  // Try to find all 10-digit sequences with valid area codes
  const matches = digits.match(/[2-9]\d{9}/g);
  if (matches && matches.length > 0) {
    // Deduplicate (in case of repeated numbers like "(7073967923) 7073967923")
    return [...new Set(matches)];
  }

  return [];
}

/**
 * Auto-format phone number as user types (for input fields).
 * Formats progressively: 7 → 70 → 707 → (707) → (707) 5 → (707) 55 → (707) 555 → (707) 555-1 → etc.
 *
 * @param phone - Raw phone input (may be partial)
 * @returns Progressively formatted phone string
 *
 * @example
 * formatPhoneAsYouType("707") // "(707) "
 * formatPhoneAsYouType("7075551") // "(707) 555-1"
 * formatPhoneAsYouType("7075551234") // "(707) 555-1234"
 */
export function formatPhoneAsYouType(phone: string | null | undefined): string {
  if (!phone) return "";

  // Extract digits only
  const digits = phone.replace(/\D/g, "");

  // Strip leading 1 if present (country code)
  const normalized = digits.startsWith("1") && digits.length > 10 ? digits.slice(1) : digits;

  // Build formatted string progressively
  if (normalized.length === 0) return "";
  if (normalized.length <= 3) return `(${normalized}`;
  if (normalized.length <= 6) return `(${normalized.slice(0, 3)}) ${normalized.slice(3)}`;
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6, 10)}`;
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

/**
 * Format an address for display, preferring Google's formatted_address.
 *
 * This provides consistent address formatting across the app:
 * - Priority 1: Use `formatted_address` from Google Geocoding (canonical format)
 * - Priority 2: Construct from components (city, state, zip)
 *
 * @param place - Object with address fields
 * @param options - Formatting options
 *   - short: If true, returns only the street portion for compact displays
 * @returns Formatted address string
 *
 * @example
 * formatAddress({ formatted_address: "123 Main St, Petaluma, CA 94952" })
 * // "123 Main St, Petaluma, CA 94952"
 *
 * formatAddress({ formatted_address: "123 Main St, Petaluma, CA 94952" }, { short: true })
 * // "123 Main St"
 *
 * formatAddress({ place_address: "123 Main St, Petaluma, CA 94952" })
 * // "123 Main St, Petaluma, CA 94952"
 *
 * formatAddress({ city: "Petaluma", state: "CA", postal_code: "94952" })
 * // "Petaluma, CA 94952"
 */
/**
 * Format a date as compact relative time for search results and activity signals.
 *
 * @param dateStr - ISO date or datetime string
 * @returns Compact relative string like "2d ago", "3mo ago", "1y ago", or null if invalid
 *
 * @example
 * formatRelativeTime("2026-03-06") // "2d ago"
 * formatRelativeTime("2025-12-08") // "3mo ago"
 * formatRelativeTime("2025-03-08") // "1y ago"
 * formatRelativeTime(null) // null
 */
export function formatRelativeTime(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "today";
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return "today";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Get activity recency color for status dots in search results.
 *
 * @param dateStr - ISO date or datetime string
 * @returns CSS color string or null if no date
 *
 * Green: within 6 months (recent activity)
 * Amber: 6-18 months (stale)
 * Gray: older than 18 months
 */
export function getActivityColor(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
  if (diffMonths <= 6) return "var(--success-text)";
  if (diffMonths <= 18) return "var(--warning-text)";
  return "var(--muted)";
}

export function formatAddress(
  place: {
    formatted_address?: string | null;
    place_address?: string | null;
    street?: string | null;
    city?: string | null;
    locality?: string | null;
    state?: string | null;
    state_province?: string | null;
    postal_code?: string | null;
    place_city?: string | null;
    place_postal_code?: string | null;
  } | null | undefined,
  options?: { short?: boolean }
): string {
  if (!place) return "Address not available";

  // Priority 1: Use Google's formatted_address when available
  const formattedAddress = place.formatted_address || place.place_address;
  if (formattedAddress?.trim()) {
    if (options?.short) {
      // Return just the street portion for compact displays
      return formattedAddress.split(",")[0].trim();
    }
    return formattedAddress.trim();
  }

  // Priority 2: Construct from components
  const parts: string[] = [];

  if (place.street?.trim()) {
    parts.push(place.street.trim());
  }

  const city = place.city || place.locality || place.place_city;
  if (city?.trim()) {
    parts.push(city.trim());
  }

  const state = place.state || place.state_province;
  const zip = place.postal_code || place.place_postal_code;

  if (state?.trim() && zip?.trim()) {
    parts.push(`${state.trim()} ${zip.trim()}`);
  } else if (state?.trim()) {
    parts.push(state.trim());
  } else if (zip?.trim()) {
    parts.push(zip.trim());
  }

  if (parts.length === 0) {
    return "Address not available";
  }

  const fullAddress = parts.join(", ");

  if (options?.short && parts.length > 0) {
    return parts[0]; // Return just the first part (usually street)
  }

  return fullAddress;
}
