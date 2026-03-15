import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatPhone,
  isValidPhone,
  extractPhone,
  extractPhones,
  formatDateLocal,
  formatRelativeDate,
  formatRelativeTime,
  truncate,
  formatCurrency,
  formatNumber,
  formatAddress,
  formatPhoneAsYouType,
} from "@/lib/formatters";

// =============================================================================
// formatPhone
// =============================================================================

describe("formatPhone", () => {
  it("formats a 10-digit phone number", () => {
    expect(formatPhone("7075551234")).toBe("(707) 555-1234");
  });

  it("formats an 11-digit phone with country code", () => {
    expect(formatPhone("17075551234")).toBe("(707) 555-1234");
  });

  it("formats a phone with +1 country code", () => {
    expect(formatPhone("+17075551234")).toBe("(707) 555-1234");
  });

  it("strips formatting characters and reformats", () => {
    expect(formatPhone("(707) 555-1234")).toBe("(707) 555-1234");
  });

  it("returns original string for non-standard length", () => {
    expect(formatPhone("555-1234")).toBe("555-1234");
  });

  it("returns empty string for null", () => {
    expect(formatPhone(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatPhone(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatPhone("")).toBe("");
  });

  it("returns original for very short input", () => {
    expect(formatPhone("123")).toBe("123");
  });
});

// =============================================================================
// isValidPhone
// =============================================================================

describe("isValidPhone", () => {
  it("validates a 10-digit phone", () => {
    expect(isValidPhone("7075551234")).toBe(true);
  });

  it("validates an 11-digit phone with leading 1", () => {
    expect(isValidPhone("17075551234")).toBe(true);
  });

  it("validates a phone with formatting characters", () => {
    expect(isValidPhone("(707) 555-1234")).toBe(true);
  });

  it("validates a phone with +1 prefix", () => {
    expect(isValidPhone("+17075551234")).toBe(true);
  });

  it("rejects a 7-digit phone", () => {
    expect(isValidPhone("5551234")).toBe(false);
  });

  it("rejects a 9-digit phone", () => {
    expect(isValidPhone("707555123")).toBe(false);
  });

  it("rejects an 11-digit phone not starting with 1", () => {
    expect(isValidPhone("27075551234")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isValidPhone(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidPhone(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidPhone("")).toBe(false);
  });

  it("returns false for non-numeric input", () => {
    expect(isValidPhone("abcdefghij")).toBe(false);
  });
});

// =============================================================================
// extractPhone
// =============================================================================

describe("extractPhone", () => {
  it("returns 10 digits from a clean phone", () => {
    expect(extractPhone("7075551234")).toBe("7075551234");
  });

  it("strips country code from 11-digit phone", () => {
    expect(extractPhone("17075551234")).toBe("7075551234");
  });

  it("extracts from duplicated phone pattern", () => {
    // "(7073967923) 7073967923" -> digits = 70739679237073967923 -> finds first valid 10 digits
    expect(extractPhone("(7073967923) 7073967923")).toBe("7073967923");
  });

  it("extracts from malformed input with prefix junk", () => {
    // "(95492) 7077122660" -> digits = 954927077122660
    // Regex finds first valid 10-digit match: 9549270771
    expect(extractPhone("(95492) 7077122660")).toBe("9549270771");
  });

  it("returns null when no valid phone found", () => {
    expect(extractPhone("(707) 858817")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractPhone(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractPhone(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractPhone("")).toBeNull();
  });

  it("extracts from formatted phone", () => {
    expect(extractPhone("(707) 555-1234")).toBe("7075551234");
  });

  it("returns 10-digit input as-is even with 0 area code", () => {
    // Exactly 10 digits returns directly without area code validation
    expect(extractPhone("0005551234")).toBe("0005551234");
  });

  it("uses area code validation on regex fallback path", () => {
    // More than 10 non-standard digits - regex requires area code 2-9
    expect(extractPhone("00055512340")).toBeNull();
  });
});

// =============================================================================
// extractPhones
// =============================================================================

describe("extractPhones", () => {
  it("extracts single phone", () => {
    expect(extractPhones("7075551234")).toEqual(["7075551234"]);
  });

  it("extracts from 11-digit with country code", () => {
    expect(extractPhones("17075551234")).toEqual(["7075551234"]);
  });

  it("extracts multiple phones separated by text", () => {
    const result = extractPhones("707 8782184 home 707 7910139");
    expect(result).toEqual(["7078782184", "7077910139"]);
  });

  it("extracts multiple phones separated by 'or'", () => {
    const result = extractPhones("(484)-744-0640 or 707-575-7194");
    expect(result).toEqual(["4847440640", "7075757194"]);
  });

  it("handles repeated phone numbers via 20-digit path", () => {
    // "(7073967923) 7073967923" -> 20 digits -> splits into two identical phones
    // The 20-digit path doesn't deduplicate (dedup only happens in regex path)
    const result = extractPhones("(7073967923) 7073967923");
    expect(result).toEqual(["7073967923", "7073967923"]);
  });

  it("returns empty array for null", () => {
    expect(extractPhones(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(extractPhones(undefined)).toEqual([]);
  });

  it("returns empty array for invalid input", () => {
    expect(extractPhones("invalid")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractPhones("")).toEqual([]);
  });

  it("handles two concatenated 10-digit phones (20 digits)", () => {
    const result = extractPhones("70755512347075559999");
    expect(result).toEqual(["7075551234", "7075559999"]);
  });
});

// =============================================================================
// formatPhoneAsYouType
// =============================================================================

describe("formatPhoneAsYouType", () => {
  it("formats partial area code", () => {
    expect(formatPhoneAsYouType("707")).toBe("(707");
  });

  it("formats area code + partial", () => {
    expect(formatPhoneAsYouType("7075551")).toBe("(707) 555-1");
  });

  it("formats full 10-digit phone", () => {
    expect(formatPhoneAsYouType("7075551234")).toBe("(707) 555-1234");
  });

  it("returns empty for null", () => {
    expect(formatPhoneAsYouType(null)).toBe("");
  });

  it("returns empty for empty string", () => {
    expect(formatPhoneAsYouType("")).toBe("");
  });
});

// =============================================================================
// formatDateLocal
// =============================================================================

describe("formatDateLocal", () => {
  it("formats a date-only string without timezone shift", () => {
    const result = formatDateLocal("2026-01-15");
    // Should contain "Jan" and "15" and "2026" regardless of timezone
    expect(result).toContain("15");
    expect(result).toContain("2026");
  });

  it("formats an ISO datetime string", () => {
    const result = formatDateLocal("2026-01-15T10:30:00Z");
    expect(result).toContain("2026");
  });

  it("returns empty string for null", () => {
    expect(formatDateLocal(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatDateLocal(undefined)).toBe("");
  });

  it("returns empty string for invalid date", () => {
    expect(formatDateLocal("not-a-date")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatDateLocal("")).toBe("");
  });

  it("accepts custom format options", () => {
    const result = formatDateLocal("2026-01-15", { year: "numeric" });
    expect(result).toContain("2026");
  });
});

// =============================================================================
// formatRelativeDate
// =============================================================================

describe("formatRelativeDate", () => {
  let realDateNow: typeof Date.now;

  beforeEach(() => {
    realDateNow = Date.now;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Today' for today's date", () => {
    const now = new Date();
    const todayStr = now.toISOString();
    expect(formatRelativeDate(todayStr)).toBe("Today");
  });

  it("returns 'Yesterday' for yesterday's date", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatRelativeDate(yesterday.toISOString())).toBe("Yesterday");
  });

  it("returns 'X days ago' for recent dates within fallback window", () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    expect(formatRelativeDate(threeDaysAgo.toISOString())).toBe("3 days ago");
  });

  it("falls back to formatted date for older dates", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    const result = formatRelativeDate(oldDate.toISOString());
    // Should not be a relative string, should be a formatted date
    expect(result).not.toContain("days ago");
    expect(result).not.toBe("Today");
    expect(result).not.toBe("Yesterday");
  });

  it("returns empty string for null", () => {
    expect(formatRelativeDate(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatRelativeDate(undefined)).toBe("");
  });

  it("returns empty string for invalid date", () => {
    expect(formatRelativeDate("garbage")).toBe("");
  });

  it("respects custom fallbackDays parameter", () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    // With fallbackDays=3, 5 days ago should fall back to formatted date
    const result = formatRelativeDate(fiveDaysAgo.toISOString(), 3);
    expect(result).not.toContain("days ago");
  });
});

// =============================================================================
// formatRelativeTime
// =============================================================================

describe("formatRelativeTime", () => {
  it("returns 'today' for a very recent date", () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe("today");
  });

  it("returns 'Xd ago' for days", () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    // Set to start of day to avoid boundary issues
    threeDaysAgo.setHours(0, 0, 0, 0);
    const result = formatRelativeTime(threeDaysAgo.toISOString());
    expect(result).toMatch(/\d+d ago/);
  });

  it("returns 'Xw ago' for weeks", () => {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    twoWeeksAgo.setHours(0, 0, 0, 0);
    const result = formatRelativeTime(twoWeeksAgo.toISOString());
    expect(result).toMatch(/\d+w ago/);
  });

  it("returns 'Xmo ago' for months", () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
    threeMonthsAgo.setHours(0, 0, 0, 0);
    const result = formatRelativeTime(threeMonthsAgo.toISOString());
    expect(result).toMatch(/\d+mo ago/);
  });

  it("returns 'Xy ago' for years", () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    expect(formatRelativeTime(twoYearsAgo.toISOString())).toBe("2y ago");
  });

  it("returns 'today' for a future date", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(formatRelativeTime(tomorrow.toISOString())).toBe("today");
  });

  it("returns null for null input", () => {
    expect(formatRelativeTime(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(formatRelativeTime(undefined)).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(formatRelativeTime("not-a-date")).toBeNull();
  });
});

// =============================================================================
// truncate
// =============================================================================

describe("truncate", () => {
  it("returns text unchanged if shorter than maxLength", () => {
    expect(truncate("hello", 50)).toBe("hello");
  });

  it("returns text unchanged if exactly maxLength", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates with ellipsis when text exceeds maxLength", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("uses default maxLength of 50", () => {
    const longText = "a".repeat(60);
    const result = truncate(longText);
    expect(result).toHaveLength(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns empty string for null", () => {
    expect(truncate(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(truncate(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(truncate("")).toBe("");
  });
});

// =============================================================================
// formatCurrency
// =============================================================================

describe("formatCurrency", () => {
  it("formats a whole number", () => {
    expect(formatCurrency(123)).toBe("$123.00");
  });

  it("formats a decimal number", () => {
    expect(formatCurrency(123.45)).toBe("$123.45");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats a large number with commas", () => {
    expect(formatCurrency(1234567.89)).toBe("$1,234,567.89");
  });

  it("formats negative numbers", () => {
    const result = formatCurrency(-50);
    expect(result).toContain("50.00");
  });

  it("returns empty string for null", () => {
    expect(formatCurrency(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatCurrency(undefined)).toBe("");
  });
});

// =============================================================================
// formatNumber
// =============================================================================

describe("formatNumber", () => {
  it("formats with comma separators", () => {
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("formats large numbers", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats small numbers without commas", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("returns empty string for null", () => {
    expect(formatNumber(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatNumber(undefined)).toBe("");
  });
});

// =============================================================================
// formatAddress
// =============================================================================

describe("formatAddress", () => {
  it("returns formatted_address when available", () => {
    expect(
      formatAddress({ formatted_address: "123 Main St, Petaluma, CA 94952" })
    ).toBe("123 Main St, Petaluma, CA 94952");
  });

  it("returns short address (street only) when short option is true", () => {
    expect(
      formatAddress(
        { formatted_address: "123 Main St, Petaluma, CA 94952" },
        { short: true }
      )
    ).toBe("123 Main St");
  });

  it("falls back to place_address", () => {
    expect(
      formatAddress({ place_address: "456 Oak Ave, Santa Rosa, CA 95401" })
    ).toBe("456 Oak Ave, Santa Rosa, CA 95401");
  });

  it("constructs from city, state, postal_code", () => {
    expect(
      formatAddress({ city: "Petaluma", state: "CA", postal_code: "94952" })
    ).toBe("Petaluma, CA 94952");
  });

  it("constructs from street, city, state, postal_code", () => {
    expect(
      formatAddress({
        street: "123 Main St",
        city: "Petaluma",
        state: "CA",
        postal_code: "94952",
      })
    ).toBe("123 Main St, Petaluma, CA 94952");
  });

  it("uses locality fallback for city", () => {
    expect(
      formatAddress({ locality: "Rohnert Park", state: "CA" })
    ).toBe("Rohnert Park, CA");
  });

  it("uses state_province fallback for state", () => {
    expect(
      formatAddress({ city: "Petaluma", state_province: "CA" })
    ).toBe("Petaluma, CA");
  });

  it("returns 'Address not available' for null place", () => {
    expect(formatAddress(null)).toBe("Address not available");
  });

  it("returns 'Address not available' for undefined place", () => {
    expect(formatAddress(undefined)).toBe("Address not available");
  });

  it("returns 'Address not available' for empty place object", () => {
    expect(formatAddress({})).toBe("Address not available");
  });

  it("handles short option with component-based address", () => {
    expect(
      formatAddress(
        { street: "789 Elm Dr", city: "Cotati", state: "CA" },
        { short: true }
      )
    ).toBe("789 Elm Dr");
  });

  it("handles state without zip", () => {
    expect(formatAddress({ city: "Petaluma", state: "CA" })).toBe(
      "Petaluma, CA"
    );
  });

  it("handles zip without state", () => {
    expect(formatAddress({ city: "Petaluma", postal_code: "94952" })).toBe(
      "Petaluma, 94952"
    );
  });

  it("trims whitespace in formatted_address", () => {
    expect(formatAddress({ formatted_address: "  123 Main St  " })).toBe(
      "123 Main St"
    );
  });
});
