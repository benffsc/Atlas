// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Capability Tests
 *
 * These tests validate what Tippy CAN currently do today.
 * They test the working tools and ensure they continue to function.
 *
 * If these tests fail, something has regressed in Tippy's capabilities.
 */

import { test, expect } from "@playwright/test";
import {
  PERSON_CROSS_SOURCE_QUESTIONS,
  CAT_JOURNEY_QUESTIONS,
  PLACE_CROSS_SOURCE_QUESTIONS,
  DATA_QUALITY_QUESTIONS,
  BEACON_QUESTIONS,
  type CrossSourceQuestion,
} from "./fixtures/tippy-questions";
import { askTippyAuthenticated, TippyResponse } from "./helpers/auth-api";

// ============================================================================
// POINT-IN-TIME LOOKUP CAPABILITIES
// These are Tippy's core strengths - instant database queries
// ============================================================================

test.describe("Tippy: Point-in-Time Lookups", () => {
  test("Can answer 'How many cats at [address]?'", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "How many cats do we have recorded at any Santa Rosa address?"
    );

    // Should use query_cats_at_place tool and return data
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

  test("Can query colony status", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "What's the colony status at any address in Santa Rosa?"
    );

    expect(response.message).toBeTruthy();
    // Should mention alteration rate or status terms
    expect(
      response.message.toLowerCase().includes("alter") ||
      response.message.toLowerCase().includes("managed") ||
      response.message.toLowerCase().includes("colony") ||
      response.message.toLowerCase().includes("rate")
    ).toBeTruthy();
  });

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

// ============================================================================
// COMPREHENSIVE LOOKUP CAPABILITIES
// These tools aggregate data from multiple sources
// ============================================================================

test.describe("Tippy: Comprehensive Lookups", () => {
  test("comprehensive_person_lookup works", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Tell me everything about any person who has submitted a request"
    );

    expect(response.message).toBeTruthy();
    expect(response.message.length).toBeGreaterThan(50);
  });

  test("comprehensive_place_lookup works", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Tell me everything about any place that has cat activity"
    );

    expect(response.message).toBeTruthy();
    expect(response.message.length).toBeGreaterThan(50);
  });

  test("query_cat_journey traces full history", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Trace the journey of any cat with a microchip through our system"
    );

    expect(response.message).toBeTruthy();
    // Should reference appointments, clinic, or microchip
    expect(
      response.message.toLowerCase().includes("microchip") ||
      response.message.toLowerCase().includes("appointment") ||
      response.message.toLowerCase().includes("clinic") ||
      response.message.toLowerCase().includes("cat")
    ).toBeTruthy();
  });
});

// ============================================================================
// DATA QUALITY TOOL CAPABILITIES
// These help staff maintain data integrity
// ============================================================================

test.describe("Tippy: Data Quality Tools", () => {
  test("Can check entity data quality", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Check the data quality for any person record"
    );

    expect(response.message).toBeTruthy();
    // Should mention quality, completeness, or missing fields
    expect(
      response.message.toLowerCase().includes("quality") ||
      response.message.toLowerCase().includes("complete") ||
      response.message.toLowerCase().includes("missing") ||
      response.message.toLowerCase().includes("field")
    ).toBeTruthy();
  });

  test("Can find potential duplicates", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Are there any potential duplicate person records for the name Smith?"
    );

    expect(response.message).toBeTruthy();
  });

  test("Can query merge history", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Show me the merge history for any merged records"
    );

    expect(response.message).toBeTruthy();
  });

  test("Can trace data lineage", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "Where did the data for any cat come from? What was the original source?"
    );

    expect(response.message).toBeTruthy();
    // Should mention source system
    expect(
      response.message.toLowerCase().includes("source") ||
      response.message.toLowerCase().includes("airtable") ||
      response.message.toLowerCase().includes("clinichq") ||
      response.message.toLowerCase().includes("origin")
    ).toBeTruthy();
  });
});

// ============================================================================
// BEACON ANALYTICS CAPABILITIES
// Population ecology queries
// ============================================================================

test.describe("Tippy: Beacon Analytics", () => {
  test("Can query overall alteration rate", async ({ page }) => {
    const response = await askTippyAuthenticated(
      page,
      "What's our overall alteration rate across all colonies?"
    );

    expect(response.message).toBeTruthy();
    // Should mention rate or percentage
    expect(
      response.message.includes("%") ||
      response.message.toLowerCase().includes("rate") ||
      response.message.match(/\d+/)
    ).toBeTruthy();
  });

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

// ============================================================================
// FIXTURE-BASED CAPABILITY TESTS
// Run subset of fixture questions to verify capabilities
// ============================================================================

test.describe("Tippy: Person Cross-Source Questions (Easy)", () => {
  const easyQuestions = PERSON_CROSS_SOURCE_QUESTIONS.filter(
    (q) => q.difficulty === "easy"
  );

  for (const question of easyQuestions) {
    test(question.id, async ({ page }) => {
      const response = await askTippyAuthenticated(page, question.question);

      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(30);

      // Validate using the fixture's validation function
      const passes = question.validateResponse(response.message);
      expect(passes).toBeTruthy();
    });
  }
});

test.describe("Tippy: Cat Journey Questions (Easy)", () => {
  const easyQuestions = CAT_JOURNEY_QUESTIONS.filter(
    (q) => q.difficulty === "easy"
  );

  for (const question of easyQuestions) {
    test(question.id, async ({ page }) => {
      const response = await askTippyAuthenticated(page, question.question);

      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(30);

      const passes = question.validateResponse(response.message);
      expect(passes).toBeTruthy();
    });
  }
});

test.describe("Tippy: Place Questions (Easy)", () => {
  const easyQuestions = PLACE_CROSS_SOURCE_QUESTIONS.filter(
    (q) => q.difficulty === "easy"
  );

  for (const question of easyQuestions) {
    test(question.id, async ({ page }) => {
      const response = await askTippyAuthenticated(page, question.question);

      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(30);

      const passes = question.validateResponse(response.message);
      expect(passes).toBeTruthy();
    });
  }
});

test.describe("Tippy: Data Quality Questions (Easy)", () => {
  const easyQuestions = DATA_QUALITY_QUESTIONS.filter(
    (q) => q.difficulty === "easy"
  );

  for (const question of easyQuestions) {
    test(question.id, async ({ page }) => {
      const response = await askTippyAuthenticated(page, question.question);

      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(30);

      const passes = question.validateResponse(response.message);
      expect(passes).toBeTruthy();
    });
  }
});

test.describe("Tippy: Beacon Questions (Easy)", () => {
  const easyQuestions = BEACON_QUESTIONS.filter(
    (q) => q.difficulty === "easy"
  );

  for (const question of easyQuestions) {
    test(question.id, async ({ page }) => {
      const response = await askTippyAuthenticated(page, question.question);

      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(30);

      const passes = question.validateResponse(response.message);
      expect(passes).toBeTruthy();
    });
  }
});

// ============================================================================
// CONVERSATION CONTINUITY
// Test that Tippy maintains context across messages
// ============================================================================

test.describe("Tippy: Conversation Context", () => {
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
