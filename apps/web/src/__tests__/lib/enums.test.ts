import { describe, it, expect } from "vitest";
import {
  REQUEST_STATUS,
  REQUEST_PRIORITY,
  HOLD_REASON,
  NO_TRAPPER_REASON,
  PERMISSION_STATUS,
  COLONY_DURATION,
  COUNT_CONFIDENCE,
  EARTIP_ESTIMATE,
  FEEDING_FREQUENCY,
  PROPERTY_TYPE,
  HANDOFF_REASON,
  HANDOFF_REASON_LABELS,
  PERSON_ENTITY_TYPE,
  TRAPPING_SKILL,
  TRAPPER_TYPE,
  PERSON_PLACE_ROLE,
  PLACE_KIND,
  DEATH_CAUSE,
  DATE_PRECISION,
  SEASON,
  ALTERED_STATUS,
  CAT_SEX,
  ENTITY_TYPE,
  ENTITY_ENUMS,
} from "@/lib/enums";

// =============================================================================
// Helper to check enum array invariants
// =============================================================================

function expectValidEnum(name: string, values: readonly string[]) {
  describe(name, () => {
    it("is non-empty", () => {
      expect(values.length).toBeGreaterThan(0);
    });

    it("contains only strings", () => {
      for (const v of values) {
        expect(typeof v).toBe("string");
      }
    });

    it("has no duplicate values", () => {
      const uniqueSet = new Set(values);
      expect(uniqueSet.size).toBe(values.length);
    });

    it("has no empty string values", () => {
      for (const v of values) {
        expect(v.trim().length).toBeGreaterThan(0);
      }
    });
  });
}

// =============================================================================
// All enum arrays
// =============================================================================

expectValidEnum("REQUEST_STATUS", REQUEST_STATUS);
expectValidEnum("REQUEST_PRIORITY", REQUEST_PRIORITY);
expectValidEnum("HOLD_REASON", HOLD_REASON);
expectValidEnum("NO_TRAPPER_REASON", NO_TRAPPER_REASON);
expectValidEnum("PERMISSION_STATUS", PERMISSION_STATUS);
expectValidEnum("COLONY_DURATION", COLONY_DURATION);
expectValidEnum("COUNT_CONFIDENCE", COUNT_CONFIDENCE);
expectValidEnum("EARTIP_ESTIMATE", EARTIP_ESTIMATE);
expectValidEnum("FEEDING_FREQUENCY", FEEDING_FREQUENCY);
expectValidEnum("PROPERTY_TYPE", PROPERTY_TYPE);
expectValidEnum("HANDOFF_REASON", HANDOFF_REASON);
expectValidEnum("PERSON_ENTITY_TYPE", PERSON_ENTITY_TYPE);
expectValidEnum("TRAPPING_SKILL", TRAPPING_SKILL);
expectValidEnum("TRAPPER_TYPE", TRAPPER_TYPE);
expectValidEnum("PERSON_PLACE_ROLE", PERSON_PLACE_ROLE);
expectValidEnum("PLACE_KIND", PLACE_KIND);
expectValidEnum("DEATH_CAUSE", DEATH_CAUSE);
expectValidEnum("DATE_PRECISION", DATE_PRECISION);
expectValidEnum("SEASON", SEASON);
expectValidEnum("ALTERED_STATUS", ALTERED_STATUS);
expectValidEnum("CAT_SEX", CAT_SEX);
expectValidEnum("ENTITY_TYPE", ENTITY_TYPE);

// =============================================================================
// ENTITY_ENUMS grouped export
// =============================================================================

describe("ENTITY_ENUMS", () => {
  const expectedKeys = [
    "REQUEST_STATUS",
    "REQUEST_PRIORITY",
    "HOLD_REASON",
    "NO_TRAPPER_REASON",
    "PERMISSION_STATUS",
    "COLONY_DURATION",
    "COUNT_CONFIDENCE",
    "EARTIP_ESTIMATE",
    "FEEDING_FREQUENCY",
    "PROPERTY_TYPE",
    "HANDOFF_REASON",
    "PERSON_ENTITY_TYPE",
    "TRAPPING_SKILL",
    "TRAPPER_TYPE",
    "PERSON_PLACE_ROLE",
    "PLACE_KIND",
    "DEATH_CAUSE",
    "DATE_PRECISION",
    "SEASON",
    "ALTERED_STATUS",
    "CAT_SEX",
    "ENTITY_TYPE",
  ];

  it("has all expected keys", () => {
    for (const key of expectedKeys) {
      expect(ENTITY_ENUMS).toHaveProperty(key);
    }
  });

  it("each value is a non-empty array", () => {
    for (const key of Object.keys(ENTITY_ENUMS)) {
      const arr = (ENTITY_ENUMS as Record<string, readonly string[]>)[key];
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// HANDOFF_REASON_LABELS completeness
// =============================================================================

describe("HANDOFF_REASON_LABELS", () => {
  it("has a label for every HANDOFF_REASON value", () => {
    for (const reason of HANDOFF_REASON) {
      expect(HANDOFF_REASON_LABELS).toHaveProperty(reason);
      expect(typeof HANDOFF_REASON_LABELS[reason]).toBe("string");
      expect(HANDOFF_REASON_LABELS[reason].length).toBeGreaterThan(0);
    }
  });

  it("has no extra keys beyond HANDOFF_REASON values", () => {
    const labelKeys = Object.keys(HANDOFF_REASON_LABELS);
    for (const key of labelKeys) {
      expect((HANDOFF_REASON as readonly string[]).includes(key)).toBe(true);
    }
  });
});

// =============================================================================
// Spot checks — specific values that MUST exist
// =============================================================================

describe("spot checks for critical enum values", () => {
  it("REQUEST_STATUS contains primary statuses", () => {
    expect(REQUEST_STATUS).toContain("new");
    expect(REQUEST_STATUS).toContain("working");
    expect(REQUEST_STATUS).toContain("paused");
    expect(REQUEST_STATUS).toContain("completed");
  });

  it("REQUEST_STATUS contains special statuses", () => {
    expect(REQUEST_STATUS).toContain("redirected");
    expect(REQUEST_STATUS).toContain("handed_off");
  });

  it("REQUEST_STATUS contains legacy statuses", () => {
    expect(REQUEST_STATUS).toContain("triaged");
    expect(REQUEST_STATUS).toContain("in_progress");
    expect(REQUEST_STATUS).toContain("cancelled");
  });

  it("REQUEST_PRIORITY contains expected values", () => {
    expect(REQUEST_PRIORITY).toContain("urgent");
    expect(REQUEST_PRIORITY).toContain("high");
    expect(REQUEST_PRIORITY).toContain("normal");
    expect(REQUEST_PRIORITY).toContain("low");
  });

  it("CAT_SEX contains expected values", () => {
    expect(CAT_SEX).toContain("male");
    expect(CAT_SEX).toContain("female");
    expect(CAT_SEX).toContain("unknown");
  });

  it("ALTERED_STATUS contains expected values", () => {
    expect(ALTERED_STATUS).toContain("altered");
    expect(ALTERED_STATUS).toContain("intact");
    expect(ALTERED_STATUS).toContain("unknown");
  });

  it("SEASON contains all four seasons", () => {
    expect(SEASON).toContain("spring");
    expect(SEASON).toContain("summer");
    expect(SEASON).toContain("fall");
    expect(SEASON).toContain("winter");
    expect(SEASON).toHaveLength(4);
  });

  it("ENTITY_TYPE contains core entity types", () => {
    expect(ENTITY_TYPE).toContain("person");
    expect(ENTITY_TYPE).toContain("cat");
    expect(ENTITY_TYPE).toContain("place");
    expect(ENTITY_TYPE).toContain("request");
  });

  it("PLACE_KIND contains expected values", () => {
    expect(PLACE_KIND).toContain("residential_house");
    expect(PLACE_KIND).toContain("business");
    expect(PLACE_KIND).toContain("clinic");
    expect(PLACE_KIND).toContain("unknown");
  });

  it("PERSON_PLACE_ROLE contains resident", () => {
    expect(PERSON_PLACE_ROLE).toContain("resident");
    expect(PERSON_PLACE_ROLE).toContain("colony_caretaker");
    expect(PERSON_PLACE_ROLE).toContain("transporter");
  });

  it("TRAPPER_TYPE contains expected types", () => {
    expect(TRAPPER_TYPE).toContain("ffsc_trapper");
    expect(TRAPPER_TYPE).toContain("community_trapper");
    expect(TRAPPER_TYPE).toContain("coordinator");
  });
});
