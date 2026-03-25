import { describe, it, expect } from "vitest";
import {
  PUBLIC_TERMS,
  STAFF_TERMS,
  getProgramTerm,
  getProgramFullName,
  getActionTerm,
  getActionPastTerm,
  getAlterationStatusLabel,
  ALTERATION_STATUS_LABELS,
} from "@/lib/terminology";

// =============================================================================
// getProgramTerm
// =============================================================================

describe("getProgramTerm", () => {
  it("returns FFR for public context", () => {
    expect(getProgramTerm(true)).toBe("FFR");
  });

  it("returns TNR for staff context", () => {
    expect(getProgramTerm(false)).toBe("TNR");
  });
});

// =============================================================================
// getProgramFullName
// =============================================================================

describe("getProgramFullName", () => {
  it("returns full public name", () => {
    expect(getProgramFullName(true)).toBe("Find Fix Return (FFR)");
  });

  it("returns full staff name", () => {
    expect(getProgramFullName(false)).toBe("Trap-Neuter-Return");
  });
});

// =============================================================================
// getActionTerm
// =============================================================================

describe("getActionTerm", () => {
  it("returns 'fix' for public", () => {
    expect(getActionTerm(true)).toBe("fix");
  });

  it("returns 'alter' for staff", () => {
    expect(getActionTerm(false)).toBe("alter");
  });
});

// =============================================================================
// getActionPastTerm
// =============================================================================

describe("getActionPastTerm", () => {
  it("returns 'fixed' for public", () => {
    expect(getActionPastTerm(true)).toBe("fixed");
  });

  it("returns 'altered' for staff", () => {
    expect(getActionPastTerm(false)).toBe("altered");
  });
});

// =============================================================================
// getAlterationStatusLabel
// =============================================================================

describe("getAlterationStatusLabel", () => {
  it("returns public label for spayed", () => {
    expect(getAlterationStatusLabel("spayed", true)).toBe("Fixed (Female)");
  });

  it("returns staff label for spayed", () => {
    expect(getAlterationStatusLabel("spayed", false)).toBe("Spayed");
  });

  it("returns public label for intact", () => {
    expect(getAlterationStatusLabel("intact", true)).toBe("Not Fixed");
  });

  it("handles case-insensitive input", () => {
    expect(getAlterationStatusLabel("SPAYED", true)).toBe("Fixed (Female)");
  });

  it("returns raw value for unknown status", () => {
    expect(getAlterationStatusLabel("nonexistent", true)).toBe("nonexistent");
  });
});

// =============================================================================
// Constants structure
// =============================================================================

describe("PUBLIC_TERMS", () => {
  it("has required fields", () => {
    expect(PUBLIC_TERMS.program).toBeDefined();
    expect(PUBLIC_TERMS.programShort).toBe("FFR");
    expect(PUBLIC_TERMS.action).toBe("fix");
    expect(PUBLIC_TERMS.actionPast).toBe("fixed");
    expect(PUBLIC_TERMS.description).toBeDefined();
    expect(PUBLIC_TERMS.tagline).toBeDefined();
  });
});

describe("STAFF_TERMS", () => {
  it("has required fields", () => {
    expect(STAFF_TERMS.program).toBe("TNR");
    expect(STAFF_TERMS.programFull).toBe("Trap-Neuter-Return");
    expect(STAFF_TERMS.action).toBe("alter");
    expect(STAFF_TERMS.actionPast).toBe("altered");
  });
});

describe("ALTERATION_STATUS_LABELS", () => {
  it("has all expected statuses", () => {
    expect(ALTERATION_STATUS_LABELS).toHaveProperty("spayed");
    expect(ALTERATION_STATUS_LABELS).toHaveProperty("neutered");
    expect(ALTERATION_STATUS_LABELS).toHaveProperty("altered");
    expect(ALTERATION_STATUS_LABELS).toHaveProperty("intact");
    expect(ALTERATION_STATUS_LABELS).toHaveProperty("unknown");
  });
});
