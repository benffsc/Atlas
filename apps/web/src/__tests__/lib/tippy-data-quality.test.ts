import { describe, it, expect } from "vitest";
import {
  getPlaceDataCaveats,
  checkSuspiciousPatterns,
  matchesGapTrigger,
  KNOWN_GAPS,
} from "@/app/api/tippy/data-quality";

// =============================================================================
// PR 1 (FFS-1157 + FFS-1158) — auto-applied data quality
//
// The modules already exist; PR 1 wires them to the tool-result boundary.
// These tests lock in the helper behavior that `wrapPlaceResult` relies on.
// =============================================================================

describe("getPlaceDataCaveats", () => {
  it("surfaces NULL status warning when >50% of cats have unknown status", () => {
    const caveats = getPlaceDataCaveats({
      total_cats: 100,
      altered_cats: 6,
      null_status_count: 80,
    });

    expect(caveats.length).toBeGreaterThan(0);
    // Message should mention both the null count and total
    const joined = caveats.join(" ");
    expect(joined).toMatch(/80/);
    expect(joined).toMatch(/100/);
  });

  it("infers NULL status issue when rate is suspiciously low and count is high", () => {
    // No explicit null_status_count, but rate < 20 and total > 50 should warn
    const caveats = getPlaceDataCaveats({
      total_cats: 187,
      altered_cats: 11, // ~5.9% — the 1688 Jennings Way case
    });

    expect(caveats.length).toBeGreaterThan(0);
    expect(caveats.join(" ")).toMatch(/data gap|legacy/i);
  });

  it("does NOT surface warnings for healthy data", () => {
    const caveats = getPlaceDataCaveats({
      total_cats: 20,
      altered_cats: 18,
      null_status_count: 0,
    });

    expect(caveats).toEqual([]);
  });

  it("flags reported-vs-verified gap when caretaker count exceeds clinic count", () => {
    const caveats = getPlaceDataCaveats({
      total_cats: 10, // verified
      altered_cats: 8,
      reported_cats: 25, // caretaker reported
    });

    expect(caveats.length).toBeGreaterThan(0);
    expect(caveats.join(" ")).toMatch(/reported|caretaker|verified/i);
  });
});

describe("checkSuspiciousPatterns", () => {
  it("detects very low alteration rate with many cats", () => {
    const patterns = checkSuspiciousPatterns({
      alteration_rate: 6,
      total_cats: 187,
    });

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].likely_cause).toMatch(/NULL|legacy/i);
    expect(patterns[0].severity).toBe("warning");
  });

  it("detects zero-cats-with-active-request pattern", () => {
    const patterns = checkSuspiciousPatterns({
      cat_count: 0,
      has_active_request: true,
    });

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.map((p) => p.pattern).join(" ")).toMatch(
      /Zero cats at place with active request/,
    );
  });

  it("does not false-positive on healthy data", () => {
    const patterns = checkSuspiciousPatterns({
      alteration_rate: 92,
      total_cats: 20,
      has_active_request: false,
    });

    expect(patterns).toEqual([]);
  });
});

describe("matchesGapTrigger", () => {
  it("triggers DATA_GAP_059 when null_status_count exceeds 50% of total", () => {
    const matches = matchesGapTrigger({
      total_cats: 100,
      altered_cats: 6,
      null_status_count: 80,
      rate_overall: 6,
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe(KNOWN_GAPS.DATA_GAP_059.id);
    expect(matches[0].caveat).toBe(KNOWN_GAPS.DATA_GAP_059.caveat);
  });

  it("triggers DATA_GAP_059 when null count + low rate even if null < 50%", () => {
    const matches = matchesGapTrigger({
      total_cats: 100,
      altered_cats: 10,
      null_status_count: 40, // 40% — below 50% threshold
      rate_overall: 10,
    });

    expect(matches.map((m) => m.id)).toContain(KNOWN_GAPS.DATA_GAP_059.id);
  });

  it("triggers DATA_GAP_059 when no null count provided but rate looks suspicious", () => {
    const matches = matchesGapTrigger({
      total_cats: 187,
      altered_cats: 11,
      rate_overall: 6,
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe(KNOWN_GAPS.DATA_GAP_059.id);
  });

  it("does NOT trigger on healthy data", () => {
    const matches = matchesGapTrigger({
      total_cats: 20,
      altered_cats: 18,
      null_status_count: 0,
      rate_overall: 90,
    });

    expect(matches).toEqual([]);
  });

  it("does NOT trigger when sample is small", () => {
    // 3 cats with 1 altered — low rate but not enough data to flag
    const matches = matchesGapTrigger({
      total_cats: 3,
      altered_cats: 1,
      rate_overall: 33,
    });

    expect(matches).toEqual([]);
  });
});
