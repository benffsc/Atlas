import { describe, it, expect } from "vitest";
import {
  shouldBePerson,
  classifyOwnerName,
  isPositiveValue,
  isValidMicrochip,
  isFabricatedEmail,
  isValidUUID,
  classifyFfscBooking,
} from "@/lib/guards";

// =============================================================================
// shouldBePerson
// =============================================================================

describe("shouldBePerson", () => {
  it("accepts valid person with name + email", () => {
    const result = shouldBePerson("John", "Smith", "john@example.com", null);
    expect(result.valid).toBe(true);
  });

  it("accepts valid person with name + phone", () => {
    const result = shouldBePerson("Jane", "Doe", null, "7075551234");
    expect(result.valid).toBe(true);
  });

  it("rejects when no email and no phone", () => {
    const result = shouldBePerson("John", "Smith", null, null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("Email or phone required");
    }
  });

  it("rejects blacklisted email", () => {
    const result = shouldBePerson("Office", null, "info@forgottenfelines.com", null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("organization");
    }
  });

  it("rejects organization name", () => {
    const result = shouldBePerson("Sonoma County", "Animal Services", "test@example.com", null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.classification).toBe("organization");
    }
  });

  it("rejects address as name", () => {
    const result = shouldBePerson("123 Main", "Street", "test@example.com", null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.classification).toBe("address");
    }
  });

  it("rejects garbage name", () => {
    const result = shouldBePerson("unknown", null, "test@example.com", null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.classification).toBe("garbage");
    }
  });
});

// =============================================================================
// classifyOwnerName
// =============================================================================

describe("classifyOwnerName", () => {
  it("classifies 'John Smith' as likely_person", () => {
    expect(classifyOwnerName("John Smith")).toBe("likely_person");
  });

  it("classifies 'World Of Carpets' as organization", () => {
    expect(classifyOwnerName("World Of Carpets")).toBe("organization");
  });

  it("classifies 'Silveira Ranch' as site_name", () => {
    expect(classifyOwnerName("Silveira Ranch")).toBe("site_name");
  });

  it("classifies '123 Main St' as address", () => {
    expect(classifyOwnerName("123 Main St")).toBe("address");
  });

  it("classifies empty string as garbage", () => {
    expect(classifyOwnerName("")).toBe("garbage");
  });

  it("classifies 'unknown' as garbage", () => {
    expect(classifyOwnerName("unknown")).toBe("garbage");
  });

  it("classifies 'SCAS' as organization (TNR abbreviation)", () => {
    expect(classifyOwnerName("SCAS")).toBe("organization");
  });

  it("classifies 'Sonoma County Animal Services' as organization", () => {
    expect(classifyOwnerName("Sonoma County Animal Services")).toBe("organization");
  });

  it("classifies common first name alone as likely_person", () => {
    expect(classifyOwnerName("Mary")).toBe("likely_person");
  });

  it("classifies 'The Animal Shelter' as organization", () => {
    expect(classifyOwnerName("The Animal Shelter")).toBe("organization");
  });

  it("classifies 'n/a' as garbage", () => {
    expect(classifyOwnerName("n/a")).toBe("garbage");
  });
});

// =============================================================================
// isPositiveValue
// =============================================================================

describe("isPositiveValue", () => {
  it("returns true for 'Yes'", () => {
    expect(isPositiveValue("Yes")).toBe(true);
  });

  it("returns true for 'true' string", () => {
    expect(isPositiveValue("true")).toBe(true);
  });

  it("returns true for 'Bilateral'", () => {
    expect(isPositiveValue("Bilateral")).toBe(true);
  });

  it("returns true for 'Left'", () => {
    expect(isPositiveValue("Left")).toBe(true);
  });

  it("returns true for boolean true", () => {
    expect(isPositiveValue(true)).toBe(true);
  });

  it("returns false for 'No'", () => {
    expect(isPositiveValue("No")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPositiveValue(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPositiveValue(undefined)).toBe(false);
  });

  it("returns false for boolean false", () => {
    expect(isPositiveValue(false)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isPositiveValue("")).toBe(false);
  });
});

// =============================================================================
// isValidMicrochip
// =============================================================================

describe("isValidMicrochip", () => {
  it("accepts 15-digit microchip", () => {
    expect(isValidMicrochip("985141404123456")).toBe(true);
  });

  it("rejects short strings", () => {
    expect(isValidMicrochip("12345")).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidMicrochip(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidMicrochip(undefined)).toBe(false);
  });

  it("rejects 14-digit string", () => {
    expect(isValidMicrochip("98514140412345")).toBe(false);
  });

  it("rejects 16-digit string", () => {
    expect(isValidMicrochip("9851414041234567")).toBe(false);
  });
});

// =============================================================================
// isFabricatedEmail
// =============================================================================

describe("isFabricatedEmail", () => {
  it("returns false for normal email", () => {
    expect(isFabricatedEmail("john@gmail.com")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isFabricatedEmail(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isFabricatedEmail(undefined)).toBe(false);
  });

  it("detects street suffix domain as fabricated", () => {
    expect(isFabricatedEmail("gordon@lohrmanln.com")).toBe(true);
  });
});

// =============================================================================
// isValidUUID
// =============================================================================

describe("isValidUUID", () => {
  it("accepts valid v4 UUID", () => {
    expect(isValidUUID("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")).toBe(true);
  });

  it("rejects invalid string", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidUUID(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidUUID(undefined)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidUUID("")).toBe(false);
  });
});

// =============================================================================
// classifyFfscBooking
// =============================================================================

describe("classifyFfscBooking", () => {
  it("returns null for a regular person name", () => {
    expect(classifyFfscBooking("John Smith")).toBeNull();
  });

  it("classifies Forgotten Felines Fosters", () => {
    expect(classifyFfscBooking("Forgotten Felines Fosters")).toBe("ffsc_foster");
  });

  it("classifies SCAS as shelter_transfer", () => {
    expect(classifyFfscBooking("SCAS Kitten")).toBe("shelter_transfer");
  });

  it("returns null for null input", () => {
    expect(classifyFfscBooking(null)).toBeNull();
  });
});
