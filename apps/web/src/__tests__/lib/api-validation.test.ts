import { describe, it, expect } from "vitest";
import {
  requireValidUUID,
  parsePagination,
  requireValidEnum,
  requireField,
  requireNonEmptyString,
  ApiError,
} from "@/lib/api-validation";

// =============================================================================
// ApiError
// =============================================================================

describe("ApiError", () => {
  it("has correct name property", () => {
    const err = new ApiError("test", 400);
    expect(err.name).toBe("ApiError");
  });

  it("stores message, status, and details", () => {
    const err = new ApiError("Something went wrong", 422, { field: "name" });
    expect(err.message).toBe("Something went wrong");
    expect(err.status).toBe(422);
    expect(err.details).toEqual({ field: "name" });
  });

  it("is an instance of Error", () => {
    const err = new ApiError("test", 500);
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults details to undefined", () => {
    const err = new ApiError("test", 400);
    expect(err.details).toBeUndefined();
  });
});

// =============================================================================
// requireValidUUID
// =============================================================================

describe("requireValidUUID", () => {
  it("accepts a valid v4 UUID", () => {
    expect(() =>
      requireValidUUID("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "cat")
    ).not.toThrow();
  });

  it("accepts a valid v1 UUID", () => {
    expect(() =>
      requireValidUUID("550e8400-e29b-11d4-a716-446655440000", "person")
    ).not.toThrow();
  });

  it("accepts uppercase UUIDs", () => {
    expect(() =>
      requireValidUUID("A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D", "cat")
    ).not.toThrow();
  });

  it("throws ApiError for null", () => {
    expect(() => requireValidUUID(null, "cat")).toThrow(ApiError);
    try {
      requireValidUUID(null, "cat");
    } catch (e) {
      expect((e as ApiError).status).toBe(400);
      expect((e as ApiError).message).toContain("cat ID is required");
    }
  });

  it("throws ApiError for undefined", () => {
    expect(() => requireValidUUID(undefined, "place")).toThrow(ApiError);
  });

  it("throws ApiError for empty string", () => {
    expect(() => requireValidUUID("", "request")).toThrow(ApiError);
  });

  it("throws ApiError for random string", () => {
    expect(() => requireValidUUID("not-a-uuid", "cat")).toThrow(ApiError);
    try {
      requireValidUUID("not-a-uuid", "cat");
    } catch (e) {
      expect((e as ApiError).status).toBe(400);
      expect((e as ApiError).message).toContain("Invalid cat ID format");
    }
  });

  it("throws for UUID with invalid version digit", () => {
    // Version 0 is not valid (must be 1-5)
    expect(() =>
      requireValidUUID("a1b2c3d4-e5f6-0a7b-8c9d-0e1f2a3b4c5d", "cat")
    ).toThrow(ApiError);
  });

  it("throws for UUID with invalid variant bits", () => {
    // The 17th hex digit (after 3rd dash) must be 8, 9, a, or b
    expect(() =>
      requireValidUUID("a1b2c3d4-e5f6-4a7b-0c9d-0e1f2a3b4c5d", "cat")
    ).toThrow(ApiError);
  });

  it("throws for truncated UUID", () => {
    expect(() =>
      requireValidUUID("a1b2c3d4-e5f6-4a7b-8c9d", "cat")
    ).toThrow(ApiError);
  });

  it("includes entity type in error message", () => {
    try {
      requireValidUUID("bad", "person");
    } catch (e) {
      expect((e as ApiError).message).toContain("person");
    }
  });
});

// =============================================================================
// parsePagination
// =============================================================================

describe("parsePagination", () => {
  function makeParams(params: Record<string, string>): URLSearchParams {
    return new URLSearchParams(params);
  }

  it("returns defaults when no params provided", () => {
    const result = parsePagination(new URLSearchParams());
    expect(result).toEqual({ limit: 50, offset: 0 });
  });

  it("parses valid limit and offset", () => {
    const result = parsePagination(makeParams({ limit: "25", offset: "10" }));
    expect(result).toEqual({ limit: 25, offset: 10 });
  });

  it("caps limit at maxLimit (default 100)", () => {
    const result = parsePagination(makeParams({ limit: "500" }));
    expect(result.limit).toBe(100);
  });

  it("uses custom maxLimit", () => {
    const result = parsePagination(makeParams({ limit: "250" }), {
      maxLimit: 200,
    });
    expect(result.limit).toBe(200);
  });

  it("uses custom defaultLimit", () => {
    const result = parsePagination(new URLSearchParams(), {
      defaultLimit: 20,
    });
    expect(result.limit).toBe(20);
  });

  it("rejects negative limit and uses default", () => {
    const result = parsePagination(makeParams({ limit: "-5" }));
    expect(result.limit).toBe(50);
  });

  it("rejects zero limit and uses default", () => {
    const result = parsePagination(makeParams({ limit: "0" }));
    expect(result.limit).toBe(50);
  });

  it("rejects NaN limit and uses default", () => {
    const result = parsePagination(makeParams({ limit: "abc" }));
    expect(result.limit).toBe(50);
  });

  it("rejects negative offset and uses 0", () => {
    const result = parsePagination(makeParams({ offset: "-10" }));
    expect(result.offset).toBe(0);
  });

  it("rejects NaN offset and uses 0", () => {
    const result = parsePagination(makeParams({ offset: "xyz" }));
    expect(result.offset).toBe(0);
  });

  it("allows offset of 0", () => {
    const result = parsePagination(makeParams({ offset: "0" }));
    expect(result.offset).toBe(0);
  });

  it("allows limit of 1", () => {
    const result = parsePagination(makeParams({ limit: "1" }));
    expect(result.limit).toBe(1);
  });
});

// =============================================================================
// requireValidEnum
// =============================================================================

describe("requireValidEnum", () => {
  const validValues = ["new", "working", "paused", "completed"] as const;

  it("returns the value when valid", () => {
    expect(requireValidEnum("new", validValues, "status")).toBe("new");
  });

  it("returns null for null input", () => {
    expect(requireValidEnum(null, validValues, "status")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(requireValidEnum(undefined, validValues, "status")).toBeNull();
  });

  it("throws ApiError for invalid value", () => {
    expect(() =>
      requireValidEnum("invalid", validValues, "status")
    ).toThrow(ApiError);
  });

  it("error message includes field name", () => {
    try {
      requireValidEnum("bad", validValues, "status");
    } catch (e) {
      expect((e as ApiError).message).toContain("status");
    }
  });

  it("error message lists valid values", () => {
    try {
      requireValidEnum("bad", validValues, "status");
    } catch (e) {
      expect((e as ApiError).message).toContain("new");
      expect((e as ApiError).message).toContain("completed");
    }
  });

  it("error has 400 status", () => {
    try {
      requireValidEnum("bad", validValues, "status");
    } catch (e) {
      expect((e as ApiError).status).toBe(400);
    }
  });

  it("is case-sensitive", () => {
    expect(() =>
      requireValidEnum("NEW", validValues, "status")
    ).toThrow(ApiError);
  });
});

// =============================================================================
// requireField
// =============================================================================

describe("requireField", () => {
  it("does not throw for truthy values", () => {
    expect(() => requireField("hello", "name")).not.toThrow();
    expect(() => requireField(42, "count")).not.toThrow();
    expect(() => requireField(false, "flag")).not.toThrow();
    expect(() => requireField(0, "count")).not.toThrow();
  });

  it("throws ApiError for null", () => {
    expect(() => requireField(null, "email")).toThrow(ApiError);
  });

  it("throws ApiError for undefined", () => {
    expect(() => requireField(undefined, "phone")).toThrow(ApiError);
  });

  it("includes field name in error message", () => {
    try {
      requireField(null, "email");
    } catch (e) {
      expect((e as ApiError).message).toContain("email");
      expect((e as ApiError).message).toContain("required");
    }
  });

  it("error has 400 status", () => {
    try {
      requireField(null, "name");
    } catch (e) {
      expect((e as ApiError).status).toBe(400);
    }
  });
});

// =============================================================================
// requireNonEmptyString
// =============================================================================

describe("requireNonEmptyString", () => {
  it("returns trimmed string for valid input", () => {
    expect(requireNonEmptyString("  hello  ", "name")).toBe("hello");
  });

  it("returns non-trimmed string as-is when already clean", () => {
    expect(requireNonEmptyString("hello", "name")).toBe("hello");
  });

  it("throws ApiError for null", () => {
    expect(() => requireNonEmptyString(null, "name")).toThrow(ApiError);
  });

  it("throws ApiError for undefined", () => {
    expect(() => requireNonEmptyString(undefined, "name")).toThrow(ApiError);
  });

  it("throws ApiError for empty string", () => {
    expect(() => requireNonEmptyString("", "name")).toThrow(ApiError);
  });

  it("throws ApiError for whitespace-only string", () => {
    expect(() => requireNonEmptyString("   ", "name")).toThrow(ApiError);
  });

  it("error message includes field name", () => {
    try {
      requireNonEmptyString("", "first_name");
    } catch (e) {
      expect((e as ApiError).message).toContain("first_name");
    }
  });

  it("error has 400 status", () => {
    try {
      requireNonEmptyString("", "name");
    } catch (e) {
      expect((e as ApiError).status).toBe(400);
    }
  });
});
