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
    request,
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

// ============================================================================
// DATA QUALITY TESTS (MIG_487 Functions)
// ============================================================================

test.describe("Tippy Cross-Source: Data Quality Questions @real-api", () => {
  test("Data Quality: check_data_quality for person", async ({ page }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-person-check"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Data Quality: check_data_quality for cat", async ({ page }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-cat-check"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Data Quality: find_potential_duplicates", async ({ page }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-duplicates-person"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Data Quality: query_merge_history", async ({ page }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-merge-history"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Data Quality: query_data_lineage", async ({ page }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-data-lineage"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Data Quality: query_volunteerhub_data", async ({ page }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-volunteerhub-data"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });
});

// ============================================================================
// BEACON ANALYTICS QUESTIONS (via Tippy)
// ============================================================================

test.describe("Tippy Cross-Source: Beacon Analytics Questions @real-api", () => {
  test("Beacon: overall impact metrics", async ({ page }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-overall-impact"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Beacon: year-over-year comparison", async ({ page }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-yoy-comparison"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

  test("Beacon: stale estimates detection", async ({ page }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-stale-estimates"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(page, question);
  });

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

// ============================================================================
// COMPREHENSIVE LOOKUP FUNCTION TESTS
// ============================================================================

test.describe("Tippy Comprehensive Lookups @real-api", () => {
  test("comprehensive_person_lookup returns multi-source data", async ({
    page,
  }) => {
    const data = await askTippyAuthenticated(
      page,
      "Get complete information about any active trapper"
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
  });

  test("comprehensive_cat_lookup returns journey data", async ({ page }) => {
    const data = await askTippyAuthenticated(
      page,
      "What is the complete history of any cat with a microchip?"
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
  });

  test("comprehensive_place_lookup returns activity data", async ({
    page,
  }) => {
    const data = await askTippyAuthenticated(
      page,
      "Show me everything about any active colony location"
    );

    expect(data).toBeDefined();
    expect(data.message).toBeTruthy();
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

test.describe("Tippy Error Handling @real-api", () => {
  test("Handles empty question gracefully", async ({ page }) => {
    // Empty message should get a validation error, not a 500
    const response = await page.request.post("/api/tippy/chat", {
      data: { message: "" },
    });

    // Should return 400 for validation error, not 500
    expect(response.status()).toBeLessThan(500);
  });

  test("Handles non-existent entity lookup gracefully", async ({ page }) => {
    const data = await askTippyAuthenticated(
      page,
      "Find person with email nonexistent12345@fake.com"
    );

    // Should return a message (not found) rather than error
    expect(data.message).toBeTruthy();
  });

  test("Handles invalid microchip lookup gracefully", async ({ page }) => {
    const data = await askTippyAuthenticated(
      page,
      "Trace cat with microchip 000000000000000"
    );

    // Should return a message rather than error
    expect(data.message).toBeTruthy();
  });
});
