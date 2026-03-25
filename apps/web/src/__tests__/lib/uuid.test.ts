import { describe, it, expect } from "vitest";
import {
  isValidUUID,
  isValidUUIDLoose,
  generateUUID,
  abbreviateUUID,
  uuidEquals,
  parseUUID,
  parseUUIDs,
  assertUUID,
  formatUUID,
  isEntityId,
  getEntityId,
  isNilUUID,
  NIL_UUID,
} from "@/lib/uuid";

// =============================================================================
// isValidUUID (strict v4)
// =============================================================================

describe("isValidUUID", () => {
  it("accepts a valid v4 UUID", () => {
    expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("accepts uppercase UUID", () => {
    expect(isValidUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidUUID("")).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidUUID(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidUUID(undefined)).toBe(false);
  });

  it("rejects random string", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
  });

  it("rejects UUID with invalid version (0)", () => {
    expect(isValidUUID("550e8400-e29b-01d4-a716-446655440000")).toBe(false);
  });

  it("rejects UUID with invalid variant bits", () => {
    expect(isValidUUID("550e8400-e29b-41d4-0716-446655440000")).toBe(false);
  });

  it("rejects truncated UUID", () => {
    expect(isValidUUID("550e8400-e29b-41d4")).toBe(false);
  });

  it("accepts v1 UUID", () => {
    expect(isValidUUID("550e8400-e29b-11d4-a716-446655440000")).toBe(true);
  });
});

// =============================================================================
// isValidUUIDLoose
// =============================================================================

describe("isValidUUIDLoose", () => {
  it("accepts nil UUID (all zeros)", () => {
    expect(isValidUUIDLoose("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("accepts UUID with version 0 (rejected by strict)", () => {
    expect(isValidUUIDLoose("550e8400-e29b-01d4-a716-446655440000")).toBe(true);
  });

  it("accepts standard v4 UUID", () => {
    expect(isValidUUIDLoose("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidUUIDLoose(null)).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidUUIDLoose("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")).toBe(false);
  });
});

// =============================================================================
// generateUUID
// =============================================================================

describe("generateUUID", () => {
  it("returns a valid UUID format", () => {
    const uuid = generateUUID();
    expect(isValidUUIDLoose(uuid)).toBe(true);
  });

  it("returns different UUIDs on successive calls", () => {
    const a = generateUUID();
    const b = generateUUID();
    expect(a).not.toBe(b);
  });

  it("returns correct length (36 chars with hyphens)", () => {
    expect(generateUUID()).toHaveLength(36);
  });
});

// =============================================================================
// abbreviateUUID
// =============================================================================

describe("abbreviateUUID", () => {
  it("returns first 8 characters", () => {
    expect(abbreviateUUID("550e8400-e29b-41d4-a716-446655440000")).toBe("550e8400");
  });

  it("returns null for invalid UUID", () => {
    expect(abbreviateUUID("not-a-uuid")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(abbreviateUUID(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(abbreviateUUID(undefined)).toBeNull();
  });
});

// =============================================================================
// uuidEquals
// =============================================================================

describe("uuidEquals", () => {
  it("returns true for identical UUIDs", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(uuidEquals(uuid, uuid)).toBe(true);
  });

  it("returns true for case-different UUIDs", () => {
    expect(
      uuidEquals(
        "550e8400-e29b-41d4-a716-446655440000",
        "550E8400-E29B-41D4-A716-446655440000"
      )
    ).toBe(true);
  });

  it("returns false for different UUIDs", () => {
    expect(
      uuidEquals(
        "550e8400-e29b-41d4-a716-446655440000",
        "660e8400-e29b-41d4-a716-446655440000"
      )
    ).toBe(false);
  });

  it("returns false when first is null", () => {
    expect(uuidEquals(null, "550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("returns false when second is null", () => {
    expect(uuidEquals("550e8400-e29b-41d4-a716-446655440000", null)).toBe(false);
  });

  it("returns false when both are null", () => {
    expect(uuidEquals(null, null)).toBe(false);
  });
});

// =============================================================================
// parseUUID
// =============================================================================

describe("parseUUID", () => {
  it("returns valid UUID unchanged", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseUUID(uuid)).toBe(uuid);
  });

  it("trims whitespace", () => {
    expect(parseUUID("  550e8400-e29b-41d4-a716-446655440000  ")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
  });

  it("returns null for invalid string", () => {
    expect(parseUUID("not-a-uuid")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseUUID(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseUUID(undefined)).toBeNull();
  });
});

// =============================================================================
// parseUUIDs
// =============================================================================

describe("parseUUIDs", () => {
  it("filters out invalid entries", () => {
    const result = parseUUIDs([
      "550e8400-e29b-41d4-a716-446655440000",
      "invalid",
      "660e8400-e29b-41d4-a716-446655440001",
      null,
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns empty array for all invalid", () => {
    expect(parseUUIDs(["bad", null, undefined])).toEqual([]);
  });
});

// =============================================================================
// assertUUID
// =============================================================================

describe("assertUUID", () => {
  it("does not throw for valid UUID", () => {
    expect(() => assertUUID("550e8400-e29b-41d4-a716-446655440000")).not.toThrow();
  });

  it("throws for invalid UUID", () => {
    expect(() => assertUUID("bad")).toThrow("Invalid ID");
  });

  it("includes custom field name in error", () => {
    expect(() => assertUUID("bad", "person_id")).toThrow("person_id");
  });

  it("throws for null", () => {
    expect(() => assertUUID(null)).toThrow();
  });
});

// =============================================================================
// formatUUID
// =============================================================================

describe("formatUUID", () => {
  it("lowercases a valid UUID", () => {
    expect(formatUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
  });

  it("returns null for invalid", () => {
    expect(formatUUID("bad")).toBeNull();
  });
});

// =============================================================================
// isEntityId
// =============================================================================

describe("isEntityId", () => {
  it("returns true for valid UUID string", () => {
    expect(isEntityId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("returns false for number", () => {
    expect(isEntityId(42)).toBe(false);
  });

  it("returns false for invalid string", () => {
    expect(isEntityId("bad")).toBe(false);
  });
});

// =============================================================================
// getEntityId
// =============================================================================

describe("getEntityId", () => {
  it("extracts valid UUID from params", () => {
    expect(
      getEntityId({ id: "550e8400-e29b-41d4-a716-446655440000" }, "id")
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null for missing key", () => {
    expect(getEntityId({}, "id")).toBeNull();
  });

  it("returns null for invalid UUID param", () => {
    expect(getEntityId({ id: "bad" }, "id")).toBeNull();
  });

  it("handles array param (takes first)", () => {
    expect(
      getEntityId({ id: ["550e8400-e29b-41d4-a716-446655440000", "other"] }, "id")
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

// =============================================================================
// isNilUUID / NIL_UUID
// =============================================================================

describe("isNilUUID", () => {
  it("returns true for nil UUID", () => {
    expect(isNilUUID(NIL_UUID)).toBe(true);
  });

  it("returns false for regular UUID", () => {
    expect(isNilUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNilUUID(null)).toBe(false);
  });
});
