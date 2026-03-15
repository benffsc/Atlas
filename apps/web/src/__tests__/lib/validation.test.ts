import { describe, it, expect } from "vitest";
import {
  isValidUUID,
  validatePagination,
  validatePersonName,
} from "@/lib/validation";

// =============================================================================
// isValidUUID
// =============================================================================

describe("isValidUUID", () => {
  it("returns true for valid v4 UUID", () => {
    expect(isValidUUID("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")).toBe(true);
  });

  it("returns true for valid v1 UUID", () => {
    expect(isValidUUID("550e8400-e29b-11d4-a716-446655440000")).toBe(true);
  });

  it("returns true for uppercase UUID", () => {
    expect(isValidUUID("A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidUUID("")).toBe(false);
  });

  it("returns false for random string", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
  });

  it("returns false for UUID with version 0", () => {
    expect(isValidUUID("a1b2c3d4-e5f6-0a7b-8c9d-0e1f2a3b4c5d")).toBe(false);
  });

  it("returns false for UUID with version 6+", () => {
    expect(isValidUUID("a1b2c3d4-e5f6-6a7b-8c9d-0e1f2a3b4c5d")).toBe(false);
  });

  it("returns false for UUID with invalid variant", () => {
    // Variant must be 8, 9, a, or b in position 19
    expect(isValidUUID("a1b2c3d4-e5f6-4a7b-0c9d-0e1f2a3b4c5d")).toBe(false);
  });

  it("returns false for truncated UUID", () => {
    expect(isValidUUID("a1b2c3d4-e5f6-4a7b")).toBe(false);
  });

  it("returns false for UUID with extra characters", () => {
    expect(isValidUUID("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d-extra")).toBe(false);
  });

  it("returns false for UUID without dashes", () => {
    expect(isValidUUID("a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d")).toBe(false);
  });
});

// =============================================================================
// validatePagination
// =============================================================================

describe("validatePagination", () => {
  it("returns defaults when both are null", () => {
    const result = validatePagination(null, null);
    expect(result).toEqual({ limit: 50, offset: 0 });
  });

  it("parses valid limit and offset strings", () => {
    const result = validatePagination("25", "10");
    expect(result).toEqual({ limit: 25, offset: 10 });
  });

  it("caps limit at maxLimit", () => {
    const result = validatePagination("500", "0");
    expect(result.limit).toBe(100);
  });

  it("uses custom maxLimit", () => {
    const result = validatePagination("500", "0", 200);
    expect(result.limit).toBe(200);
  });

  it("uses custom defaultLimit", () => {
    const result = validatePagination(null, null, 100, 20);
    expect(result.limit).toBe(20);
  });

  it("clamps negative limit to 1", () => {
    const result = validatePagination("-5", "0");
    expect(result.limit).toBeGreaterThanOrEqual(1);
  });

  it("clamps negative offset to 0", () => {
    const result = validatePagination("50", "-10");
    expect(result.offset).toBe(0);
  });

  it("handles NaN limit by using default", () => {
    const result = validatePagination("abc", "0");
    expect(result.limit).toBe(50);
  });

  it("handles NaN offset by using 0", () => {
    const result = validatePagination("50", "xyz");
    expect(result.offset).toBe(0);
  });

  it("handles zero limit (clamped to 1)", () => {
    const result = validatePagination("0", "0");
    expect(result.limit).toBeGreaterThanOrEqual(1);
  });

  it("allows limit of 1", () => {
    const result = validatePagination("1", "0");
    expect(result.limit).toBe(1);
  });

  it("allows large offset", () => {
    const result = validatePagination("50", "10000");
    expect(result.offset).toBe(10000);
  });
});

// =============================================================================
// validatePersonName
// =============================================================================

describe("validatePersonName", () => {
  // --- Valid names ---
  it("accepts a normal name", () => {
    const result = validatePersonName("Jane Doe");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts a short 2-character name", () => {
    const result = validatePersonName("Bo");
    expect(result.valid).toBe(true);
  });

  it("accepts a name with accents", () => {
    const result = validatePersonName("Jose Garcia");
    expect(result.valid).toBe(true);
  });

  // --- Garbage patterns ---
  it("rejects 'unknown'", () => {
    const result = validatePersonName("unknown");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects 'Unknown' (case-insensitive)", () => {
    const result = validatePersonName("Unknown");
    expect(result.valid).toBe(false);
  });

  it("rejects 'n/a'", () => {
    const result = validatePersonName("n/a");
    expect(result.valid).toBe(false);
  });

  it("rejects 'na'", () => {
    const result = validatePersonName("na");
    expect(result.valid).toBe(false);
  });

  it("rejects 'none'", () => {
    const result = validatePersonName("none");
    expect(result.valid).toBe(false);
  });

  it("rejects 'test'", () => {
    const result = validatePersonName("test");
    expect(result.valid).toBe(false);
  });

  it("rejects 'asdf'", () => {
    const result = validatePersonName("asdf");
    expect(result.valid).toBe(false);
  });

  it("rejects all-number strings", () => {
    const result = validatePersonName("12345");
    expect(result.valid).toBe(false);
  });

  it("rejects repeated character strings", () => {
    const result = validatePersonName("aaa");
    expect(result.valid).toBe(false);
  });

  it("rejects 'xxx'", () => {
    const result = validatePersonName("xxx");
    expect(result.valid).toBe(false);
  });

  it("rejects 'zzz'", () => {
    const result = validatePersonName("zzz");
    expect(result.valid).toBe(false);
  });

  it("rejects 'null'", () => {
    const result = validatePersonName("null");
    expect(result.valid).toBe(false);
  });

  it("rejects 'undefined'", () => {
    const result = validatePersonName("undefined");
    expect(result.valid).toBe(false);
  });

  it("rejects 'delete'", () => {
    const result = validatePersonName("delete");
    expect(result.valid).toBe(false);
  });

  it("rejects 'remove'", () => {
    const result = validatePersonName("remove");
    expect(result.valid).toBe(false);
  });

  // --- Edge cases ---
  it("rejects empty string", () => {
    const result = validatePersonName("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("rejects whitespace-only string", () => {
    const result = validatePersonName("   ");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("rejects single character", () => {
    const result = validatePersonName("A");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("at least 2");
  });

  // --- ALL CAPS warning ---
  it("warns on ALL CAPS name but allows it", () => {
    const result = validatePersonName("JANE DOE");
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("ALL CAPS");
  });

  it("does not warn for 2-letter ALL CAPS (too short to judge)", () => {
    const result = validatePersonName("JD");
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("does not warn for mixed case", () => {
    const result = validatePersonName("Jane Doe");
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("trims whitespace before validation", () => {
    const result = validatePersonName("  Jane Doe  ");
    expect(result.valid).toBe(true);
  });

  it("includes the invalid name in the error message", () => {
    const result = validatePersonName("test");
    expect(result.error).toContain("test");
  });
});
