import { describe, it, expect } from "vitest";
import {
  mapToPrimaryStatus,
  getStatusesForPrimary,
  expandStatusFilter,
  isValidTransition,
  getValidTransitions,
  isTerminalStatus,
  isActiveStatus,
  getStatusLabel,
  getOutcomeLabel,
  getReasonLabel,
  isValidStatus,
  isPrimaryStatus,
  isLegacyStatus,
  isValidOutcome,
  getStatusColor,
  getKanbanColumn,
  buildStatusInClause,
  PRIMARY_STATUSES,
  SPECIAL_STATUSES,
  LEGACY_STATUSES,
  RESOLUTION_OUTCOMES,
} from "@/lib/request-status";

// =============================================================================
// mapToPrimaryStatus
// =============================================================================

describe("mapToPrimaryStatus", () => {
  it("returns primary status unchanged", () => {
    expect(mapToPrimaryStatus("new")).toBe("new");
    expect(mapToPrimaryStatus("working")).toBe("working");
    expect(mapToPrimaryStatus("paused")).toBe("paused");
    expect(mapToPrimaryStatus("completed")).toBe("completed");
  });

  it("maps special statuses to completed", () => {
    expect(mapToPrimaryStatus("redirected")).toBe("completed");
    expect(mapToPrimaryStatus("handed_off")).toBe("completed");
  });

  it("maps legacy statuses to their primary equivalents", () => {
    expect(mapToPrimaryStatus("triaged")).toBe("new");
    expect(mapToPrimaryStatus("scheduled")).toBe("working");
    expect(mapToPrimaryStatus("in_progress")).toBe("working");
    expect(mapToPrimaryStatus("on_hold")).toBe("paused");
    expect(mapToPrimaryStatus("cancelled")).toBe("completed");
    expect(mapToPrimaryStatus("partial")).toBe("completed");
    expect(mapToPrimaryStatus("needs_review")).toBe("new");
    expect(mapToPrimaryStatus("active")).toBe("working");
  });

  it("falls back to 'new' for unknown values", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mapToPrimaryStatus("bogus" as any)).toBe("new");
  });
});

// =============================================================================
// getStatusesForPrimary
// =============================================================================

describe("getStatusesForPrimary", () => {
  it("includes legacy statuses that map to 'working'", () => {
    const result = getStatusesForPrimary("working");
    expect(result).toContain("working");
    expect(result).toContain("scheduled");
    expect(result).toContain("in_progress");
    expect(result).toContain("active");
  });

  it("includes special statuses for 'completed'", () => {
    const result = getStatusesForPrimary("completed");
    expect(result).toContain("completed");
    expect(result).toContain("redirected");
    expect(result).toContain("handed_off");
    expect(result).toContain("cancelled");
    expect(result).toContain("partial");
  });

  it("includes legacy statuses mapping to 'new'", () => {
    const result = getStatusesForPrimary("new");
    expect(result).toContain("new");
    expect(result).toContain("triaged");
    expect(result).toContain("needs_review");
  });

  it("does not include special statuses for non-completed primaries", () => {
    const result = getStatusesForPrimary("working");
    expect(result).not.toContain("redirected");
    expect(result).not.toContain("handed_off");
  });
});

// =============================================================================
// expandStatusFilter
// =============================================================================

describe("expandStatusFilter", () => {
  it("expands a single primary into all equivalents", () => {
    const result = expandStatusFilter(["working"]);
    expect(result).toContain("working");
    expect(result).toContain("scheduled");
    expect(result).toContain("in_progress");
    expect(result).toContain("active");
  });

  it("deduplicates when primaries share a legacy", () => {
    // Both "new" and "working" should not create duplicates within their own sets
    const result = expandStatusFilter(["new", "working"]);
    const unique = [...new Set(result)];
    expect(result).toEqual(unique);
  });

  it("returns empty for empty input", () => {
    expect(expandStatusFilter([])).toEqual([]);
  });
});

// =============================================================================
// isValidTransition
// =============================================================================

describe("isValidTransition", () => {
  it("allows new → working", () => {
    expect(isValidTransition("new", "working")).toBe(true);
  });

  it("allows new → completed", () => {
    expect(isValidTransition("new", "completed")).toBe(true);
  });

  it("allows working → paused", () => {
    expect(isValidTransition("working", "paused")).toBe(true);
  });

  it("allows any active → redirected", () => {
    expect(isValidTransition("new", "redirected")).toBe(true);
    expect(isValidTransition("working", "redirected")).toBe(true);
    expect(isValidTransition("paused", "redirected")).toBe(true);
  });

  it("blocks completed → anything", () => {
    expect(isValidTransition("completed", "new")).toBe(false);
    expect(isValidTransition("completed", "working")).toBe(false);
  });

  it("blocks redirected → anything (terminal)", () => {
    expect(isValidTransition("redirected", "new")).toBe(false);
  });

  it("blocks handed_off → anything (terminal)", () => {
    expect(isValidTransition("handed_off", "working")).toBe(false);
  });

  it("handles legacy 'from' status by mapping first", () => {
    // in_progress maps to working, so in_progress → paused should be valid
    expect(isValidTransition("in_progress", "paused")).toBe(true);
    // on_hold maps to paused, so on_hold → working should be valid
    expect(isValidTransition("on_hold", "working")).toBe(true);
  });
});

// =============================================================================
// getValidTransitions
// =============================================================================

describe("getValidTransitions", () => {
  it("returns targets for 'new'", () => {
    const targets = getValidTransitions("new");
    expect(targets).toContain("working");
    expect(targets).toContain("paused");
    expect(targets).toContain("completed");
    expect(targets).toContain("redirected");
    expect(targets).toContain("handed_off");
  });

  it("returns empty for terminal statuses", () => {
    expect(getValidTransitions("completed")).toEqual([]);
    expect(getValidTransitions("redirected")).toEqual([]);
    expect(getValidTransitions("handed_off")).toEqual([]);
  });

  it("maps legacy status before returning targets", () => {
    // in_progress → working targets
    const targets = getValidTransitions("in_progress");
    expect(targets).toContain("paused");
    expect(targets).toContain("completed");
  });
});

// =============================================================================
// isTerminalStatus / isActiveStatus
// =============================================================================

describe("isTerminalStatus", () => {
  it("completed is terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
  });

  it("redirected is terminal", () => {
    expect(isTerminalStatus("redirected")).toBe(true);
  });

  it("handed_off is terminal", () => {
    expect(isTerminalStatus("handed_off")).toBe(true);
  });

  it("cancelled maps to completed, so terminal", () => {
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("new is not terminal", () => {
    expect(isTerminalStatus("new")).toBe(false);
  });

  it("working is not terminal", () => {
    expect(isTerminalStatus("working")).toBe(false);
  });
});

describe("isActiveStatus", () => {
  it("new is active", () => {
    expect(isActiveStatus("new")).toBe(true);
  });

  it("working is active", () => {
    expect(isActiveStatus("working")).toBe(true);
  });

  it("completed is not active", () => {
    expect(isActiveStatus("completed")).toBe(false);
  });

  it("redirected is not active", () => {
    expect(isActiveStatus("redirected")).toBe(false);
  });
});

// =============================================================================
// Label formatters
// =============================================================================

describe("getStatusLabel", () => {
  it("returns 'New' for 'new'", () => {
    expect(getStatusLabel("new")).toBe("New");
  });

  it("maps legacy to modern label", () => {
    expect(getStatusLabel("in_progress")).toBe("Working");
    expect(getStatusLabel("on_hold")).toBe("Paused");
    expect(getStatusLabel("triaged")).toBe("New");
  });

  it("returns raw value for unknown status", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getStatusLabel("unknown_val" as any)).toBe("unknown_val");
  });
});

describe("getOutcomeLabel", () => {
  it("returns label for known outcomes", () => {
    expect(getOutcomeLabel("successful")).toBe("TNR Successful");
    expect(getOutcomeLabel("partial")).toBe("Partial Success");
    expect(getOutcomeLabel("referred_out")).toBe("Referred Out");
  });

  it("returns raw value for unknown outcomes", () => {
    expect(getOutcomeLabel("custom_outcome")).toBe("custom_outcome");
  });
});

describe("getReasonLabel", () => {
  it("converts snake_case to Title Case", () => {
    expect(getReasonLabel("all_cats_fixed")).toBe("All Cats Fixed");
  });

  it("handles single word", () => {
    expect(getReasonLabel("done")).toBe("Done");
  });
});

// =============================================================================
// Type guards
// =============================================================================

describe("isValidStatus", () => {
  it("accepts primary statuses", () => {
    for (const s of PRIMARY_STATUSES) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it("accepts special statuses", () => {
    for (const s of SPECIAL_STATUSES) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it("accepts legacy statuses", () => {
    for (const s of LEGACY_STATUSES) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it("rejects invalid strings", () => {
    expect(isValidStatus("bogus")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidStatus(42)).toBe(false);
    expect(isValidStatus(null)).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
  });
});

describe("isPrimaryStatus", () => {
  it("returns true for primary statuses", () => {
    expect(isPrimaryStatus("new")).toBe(true);
    expect(isPrimaryStatus("working")).toBe(true);
  });

  it("returns false for legacy statuses", () => {
    expect(isPrimaryStatus("triaged")).toBe(false);
    expect(isPrimaryStatus("in_progress")).toBe(false);
  });

  it("returns false for special statuses", () => {
    expect(isPrimaryStatus("redirected")).toBe(false);
  });
});

describe("isLegacyStatus", () => {
  it("returns true for legacy statuses", () => {
    expect(isLegacyStatus("triaged")).toBe(true);
    expect(isLegacyStatus("in_progress")).toBe(true);
    expect(isLegacyStatus("cancelled")).toBe(true);
  });

  it("returns false for primary statuses", () => {
    expect(isLegacyStatus("new")).toBe(false);
    expect(isLegacyStatus("working")).toBe(false);
  });
});

describe("isValidOutcome", () => {
  it("accepts valid outcomes", () => {
    for (const o of RESOLUTION_OUTCOMES) {
      expect(isValidOutcome(o)).toBe(true);
    }
  });

  it("rejects invalid strings", () => {
    expect(isValidOutcome("nope")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidOutcome(null)).toBe(false);
    expect(isValidOutcome(123)).toBe(false);
  });
});

// =============================================================================
// Other helpers
// =============================================================================

describe("getStatusColor", () => {
  it("returns a color scheme for known statuses", () => {
    const color = getStatusColor("new");
    expect(color).toHaveProperty("bg");
    expect(color).toHaveProperty("color");
    expect(color).toHaveProperty("border");
  });

  it("falls back to 'new' colors for unknown status", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const color = getStatusColor("bogus" as any);
    expect(color).toEqual(getStatusColor("new"));
  });
});

describe("getKanbanColumn", () => {
  it("maps status to primary for kanban", () => {
    expect(getKanbanColumn("in_progress")).toBe("working");
    expect(getKanbanColumn("redirected")).toBe("completed");
  });
});

describe("buildStatusInClause", () => {
  it("builds SQL IN clause", () => {
    const clause = buildStatusInClause("working");
    expect(clause).toContain("'working'");
    expect(clause).toContain("'scheduled'");
    expect(clause).toContain("'in_progress'");
    expect(clause).toContain("'active'");
    expect(clause).toMatch(/^\(.+\)$/);
  });
});
