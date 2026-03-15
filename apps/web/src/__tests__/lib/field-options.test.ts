import { describe, it, expect } from "vitest";
import {
  COUNTY,
  PROPERTY_TYPE_PRINT,
  OWNERSHIP_STATUS,
  EARTIP_STATUS,
  HANDLEABILITY,
  COLONY_DURATION_PRINT,
  FEEDING_FREQUENCY_PRINT,
  KITTEN_AGE_ESTIMATE,
  KITTEN_BEHAVIOR,
  MOM_PRESENT,
  KITTEN_URGENCY,
  REFERRAL_SOURCE_PRINT,
  IMPORTANT_NOTES,
  IMPORTANT_NOTES_SHORT,
} from "@/lib/field-options";

// =============================================================================
// Helper to validate all exported arrays
// =============================================================================

function expectValidFieldOptions(name: string, values: readonly string[]) {
  describe(name, () => {
    it("is non-empty", () => {
      expect(values.length).toBeGreaterThan(0);
    });

    it("all values are strings", () => {
      for (const v of values) {
        expect(typeof v).toBe("string");
      }
    });

    it("all values are non-empty strings", () => {
      for (const v of values) {
        expect(v.trim().length).toBeGreaterThan(0);
      }
    });

    it("has no duplicate values", () => {
      const uniqueSet = new Set(values);
      expect(uniqueSet.size).toBe(values.length);
    });
  });
}

// =============================================================================
// Validate all exported option arrays
// =============================================================================

expectValidFieldOptions("COUNTY", COUNTY);
expectValidFieldOptions("PROPERTY_TYPE_PRINT", PROPERTY_TYPE_PRINT);
expectValidFieldOptions("OWNERSHIP_STATUS", OWNERSHIP_STATUS);
expectValidFieldOptions("EARTIP_STATUS", EARTIP_STATUS);
expectValidFieldOptions("HANDLEABILITY", HANDLEABILITY);
expectValidFieldOptions("COLONY_DURATION_PRINT", COLONY_DURATION_PRINT);
expectValidFieldOptions("FEEDING_FREQUENCY_PRINT", FEEDING_FREQUENCY_PRINT);
expectValidFieldOptions("KITTEN_AGE_ESTIMATE", KITTEN_AGE_ESTIMATE);
expectValidFieldOptions("KITTEN_BEHAVIOR", KITTEN_BEHAVIOR);
expectValidFieldOptions("MOM_PRESENT", MOM_PRESENT);
expectValidFieldOptions("KITTEN_URGENCY", KITTEN_URGENCY);
expectValidFieldOptions("REFERRAL_SOURCE_PRINT", REFERRAL_SOURCE_PRINT);
expectValidFieldOptions("IMPORTANT_NOTES", IMPORTANT_NOTES);
expectValidFieldOptions("IMPORTANT_NOTES_SHORT", IMPORTANT_NOTES_SHORT);

// =============================================================================
// IMPORTANT_NOTES / IMPORTANT_NOTES_SHORT correspondence
// =============================================================================

describe("IMPORTANT_NOTES and IMPORTANT_NOTES_SHORT", () => {
  it("have the same length", () => {
    expect(IMPORTANT_NOTES).toHaveLength(IMPORTANT_NOTES_SHORT.length);
  });

  it("each SHORT entry is shorter or equal to its NOTES counterpart", () => {
    for (let i = 0; i < IMPORTANT_NOTES.length; i++) {
      expect(IMPORTANT_NOTES_SHORT[i].length).toBeLessThanOrEqual(
        IMPORTANT_NOTES[i].length
      );
    }
  });
});

// =============================================================================
// Spot checks for specific values
// =============================================================================

describe("specific value spot checks", () => {
  it("COUNTY contains Sonoma", () => {
    expect(COUNTY).toContain("Sonoma");
  });

  it("COUNTY contains Marin", () => {
    expect(COUNTY).toContain("Marin");
  });

  it("COUNTY contains Other", () => {
    expect(COUNTY).toContain("Other");
  });

  it("PROPERTY_TYPE_PRINT contains House", () => {
    expect(PROPERTY_TYPE_PRINT).toContain("House");
  });

  it("PROPERTY_TYPE_PRINT contains Biz", () => {
    expect(PROPERTY_TYPE_PRINT).toContain("Biz");
  });

  it("EARTIP_STATUS contains None", () => {
    expect(EARTIP_STATUS).toContain("None");
  });

  it("EARTIP_STATUS contains Unknown", () => {
    expect(EARTIP_STATUS).toContain("Unknown");
  });

  it("HANDLEABILITY contains Trap needed", () => {
    expect(HANDLEABILITY).toContain("Trap needed");
  });

  it("KITTEN_BEHAVIOR contains Friendly", () => {
    expect(KITTEN_BEHAVIOR).toContain("Friendly");
  });

  it("KITTEN_BEHAVIOR contains Unknown", () => {
    expect(KITTEN_BEHAVIOR).toContain("Unknown");
  });

  it("MOM_PRESENT contains Yes", () => {
    expect(MOM_PRESENT).toContain("Yes");
  });

  it("KITTEN_URGENCY contains Bottle babies", () => {
    expect(KITTEN_URGENCY).toContain("Bottle babies");
  });

  it("IMPORTANT_NOTES contains withhold food note", () => {
    expect(IMPORTANT_NOTES).toContain("Withhold food 24hr before");
  });

  it("IMPORTANT_NOTES_SHORT contains abbreviated withhold food", () => {
    expect(IMPORTANT_NOTES_SHORT).toContain("Withhold food");
  });

  it("OWNERSHIP_STATUS contains 'My pet'", () => {
    expect(OWNERSHIP_STATUS).toContain("My pet");
  });

  it("REFERRAL_SOURCE_PRINT contains 'Website'", () => {
    expect(REFERRAL_SOURCE_PRINT).toContain("Website");
  });
});

// =============================================================================
// Size checks (ensuring curated print subsets are smaller than full sets)
// =============================================================================

describe("print option sizes are reasonable", () => {
  it("COUNTY has 4 print options", () => {
    expect(COUNTY).toHaveLength(4);
  });

  it("PROPERTY_TYPE_PRINT has 5 print options", () => {
    expect(PROPERTY_TYPE_PRINT).toHaveLength(5);
  });

  it("EARTIP_STATUS has 4 print options", () => {
    expect(EARTIP_STATUS).toHaveLength(4);
  });

  it("HANDLEABILITY has 4 print options", () => {
    expect(HANDLEABILITY).toHaveLength(4);
  });

  it("COLONY_DURATION_PRINT has 4 print options", () => {
    expect(COLONY_DURATION_PRINT).toHaveLength(4);
  });

  it("FEEDING_FREQUENCY_PRINT has 3 print options", () => {
    expect(FEEDING_FREQUENCY_PRINT).toHaveLength(3);
  });

  it("KITTEN_AGE_ESTIMATE has 6 print options", () => {
    expect(KITTEN_AGE_ESTIMATE).toHaveLength(6);
  });

  it("KITTEN_BEHAVIOR has 4 print options", () => {
    expect(KITTEN_BEHAVIOR).toHaveLength(4);
  });

  it("MOM_PRESENT has 3 print options", () => {
    expect(MOM_PRESENT).toHaveLength(3);
  });

  it("IMPORTANT_NOTES has 9 entries", () => {
    expect(IMPORTANT_NOTES).toHaveLength(9);
  });

  it("IMPORTANT_NOTES_SHORT has 9 entries", () => {
    expect(IMPORTANT_NOTES_SHORT).toHaveLength(9);
  });
});
