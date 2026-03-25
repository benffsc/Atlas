import { describe, it, expect } from "vitest";
import {
  maskEmail,
  maskPhone,
  maskAddress,
  maskName,
  shouldMaskForRole,
  maskEntityForVolunteer,
} from "@/lib/dataMasking";

// =============================================================================
// maskEmail
// =============================================================================

describe("maskEmail", () => {
  it("masks local part, preserves domain", () => {
    expect(maskEmail("john.smith@example.com")).toBe("j***@example.com");
  });

  it("handles single-char local part", () => {
    expect(maskEmail("j@example.com")).toBe("***@example.com");
  });

  it("returns null for null input", () => {
    expect(maskEmail(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(maskEmail(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(maskEmail("")).toBeNull();
  });

  it("handles email without @ sign", () => {
    expect(maskEmail("notanemail")).toBe("***@***.***");
  });
});

// =============================================================================
// maskPhone
// =============================================================================

describe("maskPhone", () => {
  it("masks 10-digit US phone", () => {
    expect(maskPhone("7075551234")).toBe("707-***-**34");
  });

  it("masks 11-digit US phone (with leading 1)", () => {
    expect(maskPhone("17075551234")).toBe("707-***-**34");
  });

  it("masks formatted phone", () => {
    expect(maskPhone("707-555-1234")).toBe("707-***-**34");
  });

  it("returns null for null", () => {
    expect(maskPhone(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(maskPhone(undefined)).toBeNull();
  });

  it("handles short numbers gracefully", () => {
    expect(maskPhone("12345")).toBe("***-****");
  });

  it("handles other-length numbers (show last 2)", () => {
    expect(maskPhone("123456789012")).toBe("***-***-**12");
  });
});

// =============================================================================
// maskAddress
// =============================================================================

describe("maskAddress", () => {
  it("masks house number, preserves street", () => {
    expect(maskAddress("123 Main St, Santa Rosa, CA 95401")).toBe(
      "*** Main St, Santa Rosa, CA 95401"
    );
  });

  it("masks range-style house number", () => {
    expect(maskAddress("123-125 Oak Ave")).toBe("*** Oak Ave");
  });

  it("returns null for null", () => {
    expect(maskAddress(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(maskAddress(undefined)).toBeNull();
  });

  it("handles address without leading number", () => {
    expect(maskAddress("Main Street")).toBe("Main Street");
  });
});

// =============================================================================
// maskName
// =============================================================================

describe("maskName", () => {
  it("masks first and last name to initials", () => {
    expect(maskName("John Smith")).toBe("J. S.");
  });

  it("handles single name", () => {
    expect(maskName("John")).toBe("J.");
  });

  it("handles three-part name", () => {
    expect(maskName("Mary Jane Watson")).toBe("M. J. W.");
  });

  it("returns null for null", () => {
    expect(maskName(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(maskName(undefined)).toBeNull();
  });

  it("handles extra whitespace", () => {
    expect(maskName("  John   Smith  ")).toBe("J. S.");
  });
});

// =============================================================================
// shouldMaskForRole
// =============================================================================

describe("shouldMaskForRole", () => {
  it("returns true for volunteer", () => {
    expect(shouldMaskForRole("volunteer")).toBe(true);
  });

  it("returns false for admin", () => {
    expect(shouldMaskForRole("admin")).toBe(false);
  });

  it("returns false for staff", () => {
    expect(shouldMaskForRole("staff")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(shouldMaskForRole(undefined)).toBe(false);
  });
});

// =============================================================================
// maskEntityForVolunteer
// =============================================================================

describe("maskEntityForVolunteer", () => {
  it("masks person email and phone", () => {
    const person = {
      primary_email: "test@example.com",
      primary_phone: "7075551234",
      first_name: "John",
    };
    const masked = maskEntityForVolunteer(person, "person");
    expect(masked.primary_email).toBe("t***@example.com");
    expect(masked.primary_phone).toBe("707-***-**34");
    expect(masked.first_name).toBe("John"); // not masked
  });

  it("masks request contact info", () => {
    const request = {
      requester_email: "test@example.com",
      requester_phone: "7075551234",
      status: "new",
    };
    const masked = maskEntityForVolunteer(request, "request");
    expect(masked.requester_email).toBe("t***@example.com");
    expect(masked.requester_phone).toBe("707-***-**34");
    expect(masked.status).toBe("new");
  });

  it("does not modify original object", () => {
    const person = { primary_email: "test@example.com" };
    maskEntityForVolunteer(person, "person");
    expect(person.primary_email).toBe("test@example.com");
  });
});
