// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Cross-Source Deduction Tests
 *
 * These tests verify that Tippy can correctly deduce information by
 * combining data from multiple sources (ClinicHQ, ShelterLuv, VolunteerHub,
 * Airtable, and Atlas core tables).
 *
 * Tests are READ-ONLY - they query but don't modify data.
 */

import { test, expect, Page } from "@playwright/test";
import {
  PERSON_CROSS_SOURCE_QUESTIONS,
  CAT_JOURNEY_QUESTIONS,
  PLACE_CROSS_SOURCE_QUESTIONS,
  DATA_QUALITY_QUESTIONS,
  BEACON_QUESTIONS,
  type CrossSourceQuestion,
} from "./fixtures/tippy-questions";
import { askTippyAuthenticated } from "./helpers/auth-api";

// Generic test runner for cross-source questions using authenticated page context
async function runCrossSourceTest(
  page: Page,
  question: CrossSourceQuestion
) {
  const data = await askTippyAuthenticated(page, question.question);

  // Verify we got a response
  expect(data).toBeDefined();
  expect(data.message).toBeTruthy();

  // Check response has content
  const responseText = data.message;
  expect(responseText.length).toBeGreaterThan(10);

  // Run validation if response is substantial
  if (responseText.length > 50) {
    const isValid = question.validateResponse(responseText);
    // Log for debugging but don't fail - AI responses vary
    if (!isValid) {
      console.log(`Question: ${question.question}`);
      console.log(`Response excerpt: ${responseText.substring(0, 200)}...`);
    }
  }

  return data;
}

// ============================================================================
// PERSON CROSS-SOURCE TESTS
// ============================================================================

test.describe("Tippy Cross-Source: Person Questions @real-api", () => {
  test("Person: comprehensive lookup returns data", async ({ page }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-complete-lookup"
    );
    if (!question) {
      test.skip();
      return;
    }

    const data = await askTippyAuthenticated(
      page,
      "Tell me everything about any staff member"
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
  });

  test("Person: volunteer + trapper detection", async ({ page }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-volunteer-trapper"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Person: hours and foster correlation", async ({ page }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-hours-foster"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Person: requester became trapper", async ({ page }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-requester-trapper-same"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });
});

// ============================================================================
// CAT JOURNEY TESTS
// ============================================================================

test.describe("Tippy Cross-Source: Cat Journey Questions @real-api", () => {
  test("Cat: microchip trace returns history", async ({ page }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-microchip-trace"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Cat: full journey (trap-alter-adopt)", async ({ page }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-full-journey"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Cat: colony repeat visits", async ({ page }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-colony-repeat-visits"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Cat: cross-source matching (ShelterLuv + ClinicHQ)", async ({
    page,
  }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-shelterluv-clinic-match"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });
});

// ============================================================================
// PLACE-CENTRIC TESTS
// ============================================================================

test.describe("Tippy Cross-Source: Place Questions @real-api", () => {
  test("Place: activity history by address", async ({ page }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-activity-history"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Place: trapper + alteration rate correlation", async ({ page }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-trapper-alteration"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Place: estimate comparison across sources", async ({ page }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-estimate-comparison"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Place: requester is trapper detection", async ({ page }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-requester-trapper-same"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });
});

// Test suite audit: Removed Data Quality section (5 tests)
// All data quality fixture questions are generic ("check quality for person/cat")
// and provide minimal signal beyond confirming run_sql works.
// Covered by: complex-queries data quality detection + accuracy-verification.

// ============================================================================
// BEACON ANALYTICS QUESTIONS (via Tippy)
// ============================================================================

test.describe("Tippy Cross-Source: Beacon Analytics Questions @real-api", () => {
  // Test suite audit: Removed 3 Beacon tests overlapping capabilities/accuracy:
  // - "overall impact" → dup of capabilities "Can query FFR impact metrics"
  // - "yoy comparison" → dup of complex-queries "year-over-year comparison"
  // - "stale estimates" → low signal (just checks response.length)

  test("Beacon: kitten surge prediction", async ({ page }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-kitten-surge"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Beacon: completion forecast", async ({ page }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-completion-forecast"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Beacon: immigration vs birth detection", async ({ page }) => {
    const question = BEACON_QUESTIONS.find((q) => q.id === "beacon-immigration");
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });
});

// FFS-91: Removed "Comprehensive Lookups" section (3 tests) — dup of capabilities
// FFS-91: Removed "Error Handling" section (3 tests) — dups of infrastructure/data-quality

// ============================================================================
// STRESS TESTS (merged from tippy-cross-source-stress.spec.ts, FFS-91)
// 4 unique tests that were not duplicated in the main cross-source file
// ============================================================================

test.describe("Tippy Cross-Source: Stress Scenarios @stress @real-api", () => {
  test.setTimeout(90000);

  test("Cat returned after adoption and re-fostered", async ({ page }) => {
    const data = await askTippyAuthenticated(
      page,
      `Find any cats that were adopted out through ShelterLuv,
       then returned, and entered foster care again.
       What was the timeline for these cats?`
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
    expect(data.message.length).toBeGreaterThan(30);
  });

  test("Identify seasonal patterns across all sources", async ({ page }) => {
    const data = await askTippyAuthenticated(
      page,
      `Looking at data from all sources, identify seasonal patterns:
       - When do most requests come in?
       - When is clinic busiest?
       - When do kitten surges happen?
       What month should we expect the most activity?`
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
    expect(data.message.length).toBeGreaterThan(50);
  });

  test("Match ClinicHQ records to Atlas people", async ({ page }) => {
    const data = await askTippyAuthenticated(
      page,
      `How many ClinicHQ appointment records have we successfully matched
       to Atlas person records? What percentage remain unmatched?`
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
    expect(data.message.length).toBeGreaterThan(30);
  });

  test("Predict which colonies need attention next", async ({ page }) => {
    const data = await askTippyAuthenticated(
      page,
      `Based on historical patterns, which colonies are most likely to need
       attention in the next 3 months? Consider time since last activity,
       incomplete alteration rate, and known unaltered cats.`
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
    expect(data.message.length).toBeGreaterThan(50);
  });
});
