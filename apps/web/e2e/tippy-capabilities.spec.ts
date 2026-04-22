// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Capability Tests
 *
 * Core regression tests for Tippy's working tools.
 * If these tests fail, something has regressed.
 *
 * NOTE: Fixture-driven tests removed — cross-source.spec.ts runs those fixtures.
 * NOTE: Person/place comprehensive lookups removed — human-questions.spec.ts covers those.
 * See FFS-91 and test suite audit for dedup rationale.
 */

import { test, expect } from "@playwright/test";
import { askTippyAuthenticated } from "./helpers/auth-api";

// ============================================================================
// POINT-IN-TIME LOOKUP CAPABILITIES
// These are Tippy's core strengths - instant database queries
// ============================================================================

test.describe("Tippy: Point-in-Time Lookups @real-api", () => {
  test("Can answer 'How many cats at [address]?'", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "How many cats do we have recorded at any Santa Rosa address?"
    );

    // Should use full_place_briefing tool and return data
    expect(response.message).toBeTruthy();
    expect(response.message.length).toBeGreaterThan(50);
    // Should include some numeric data or "found" indication
    expect(
      response.message.match(/\d+/) ||
      response.message.toLowerCase().includes("found") ||
      response.message.toLowerCase().includes("cat")
    ).toBeTruthy();
  });

  test("Can lookup person by email", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "What do we know about anyone with a forgottenfelines.org email?"
    );

    expect(response.message).toBeTruthy();
    expect(response.message.length).toBeGreaterThan(30);
  });

  // FFS-91: Removed "Can query colony status" — dup of human-questions "Colony status at [address]"

  test("Can query trapper career stats", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Who are our top trappers by total cats trapped?"
    );

    expect(response.message).toBeTruthy();
    // Should return list or mention trappers
    expect(
      response.message.toLowerCase().includes("trapper") ||
      response.message.toLowerCase().includes("cat") ||
      response.message.match(/\d+/)
    ).toBeTruthy();
  });

  test("Can query FFR impact metrics", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "What's our overall FFR impact in Sonoma County?"
    );

    expect(response.message).toBeTruthy();
    // Should mention numbers or percentages
    expect(
      response.message.match(/\d+/) ||
      response.message.includes("%") ||
      response.message.toLowerCase().includes("alter")
    ).toBeTruthy();
  });
});

// FFS-91 audit: Removed comprehensive lookups — covered by human-questions.spec.ts
// FFS-91 audit: Removed cat_lookup — covered by cross-source.spec.ts cat journey tests

// FFS-91 audit: Removed data quality tools section (4 tests)
// — "check entity data quality" + "find duplicates" + "merge history" → covered by cross-source data quality questions
// — "trace data lineage" → covered by cross-source cat journey tests

// ============================================================================
// BEACON ANALYTICS CAPABILITIES
// Population ecology queries
// ============================================================================

test.describe("Tippy: Beacon Analytics @real-api", () => {
  // FFS-91: Removed "Can query overall alteration rate" — dup of accuracy-verification

  test("Can query colony status breakdown", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "How many colonies are managed vs need attention?"
    );

    expect(response.message).toBeTruthy();
    // Should mention status categories
    expect(
      response.message.toLowerCase().includes("managed") ||
      response.message.toLowerCase().includes("attention") ||
      response.message.toLowerCase().includes("progress") ||
      response.message.match(/\d+/)
    ).toBeTruthy();
  });

  test("Can query regional stats", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "What are the FFR stats for Santa Rosa area?"
    );

    expect(response.message).toBeTruthy();
    expect(response.message.length).toBeGreaterThan(30);
  });
});

// FFS-91 audit: Removed 5 fixture-driven test blocks (Person, Cat, Place, Data Quality, Beacon easy questions)
// These run the exact same fixture questions as tippy-cross-source.spec.ts.
// Keeping them here doubled API costs with zero additional signal.

// ============================================================================
// CONVERSATION CONTINUITY
// Test that Tippy maintains context across messages
// ============================================================================

test.describe("Tippy: Conversation Context @real-api", () => {
  test("Maintains conversation ID", async ({ page }) => {
    const response1 = await askTippyAuthenticated(
      page,
      "How many cats are in our system?"
    );

    expect(response1.conversationId).toBeTruthy();

    // Second message with same conversation
    const response2 = await askTippyAuthenticated(
      page,
      "And how many are altered?",
      response1.conversationId,
      [
        { role: "user", content: "How many cats are in our system?" },
        { role: "assistant", content: response1.message },
      ]
    );

    expect(response2.message).toBeTruthy();
    expect(response2.message.length).toBeGreaterThan(10);
  });
});
