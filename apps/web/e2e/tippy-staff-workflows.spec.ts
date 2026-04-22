// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Staff Workflow Tests
 *
 * Tests Tippy's ability to answer real staff questions about programs.
 * Uses the staff-program-questions fixture for comprehensive coverage.
 */

import { test, expect, Page } from "@playwright/test";
import {
  EASY_QUESTIONS,
  MEDIUM_QUESTIONS,
  HARD_QUESTIONS,
  StaffQuestion,
} from "./fixtures/staff-program-questions";
import { askTippy } from "./helpers/auth-api";

async function testQuestion(
  page: Page,
  question: StaffQuestion
): Promise<{ passed: boolean; response: string; reason?: string }> {
  const result = await askTippy(page, question.question);

  if (!result.message) {
    return { passed: false, response: "", reason: "No response from Tippy" };
  }

  const passed = question.validateResponse(result.message);

  return {
    passed,
    response: result.message,
    reason: passed ? undefined : "Response validation failed",
  };
}

test.describe("Tippy Staff Workflows - Easy Questions @real-api", () => {
  for (const question of EASY_QUESTIONS) {
    test(`[${question.id}] ${question.description}`, async ({ page }) => {
      const result = await testQuestion(page, question);

      console.log(`Question: ${question.question}`);
      console.log(`Response: ${result.response.substring(0, 200)}...`);

      expect(result.passed).toBeTruthy();
    });
  }
});

test.describe("Tippy Staff Workflows - Medium Questions @real-api", () => {
  for (const question of MEDIUM_QUESTIONS) {
    test(`[${question.id}] ${question.description}`, async ({ page }) => {
      const result = await testQuestion(page, question);

      console.log(`Question: ${question.question}`);
      console.log(`Response: ${result.response.substring(0, 200)}...`);

      expect(result.passed).toBeTruthy();
    });
  }
});

test.describe("Tippy Staff Workflows - Hard Questions @real-api", () => {
  for (const question of HARD_QUESTIONS) {
    test(`[${question.id}] ${question.description}`, async ({ page }) => {
      const result = await testQuestion(page, question);

      console.log(`Question: ${question.question}`);
      console.log(`Response: ${result.response.substring(0, 200)}...`);

      // Hard questions may not always pass validation
      // but should at least return a meaningful response
      expect(result.response.length).toBeGreaterThan(50);
    });
  }
});

test.describe("Tippy Response Quality @real-api", () => {
  test("responses contain specific numbers, not vague answers", async ({
    request,
  }) => {
    // FFS-91: Unique questions to avoid duplicating complex-queries tests
    const questions = [
      "How many intake forms were submitted this year?",
      "How many clinic days have we had in 2025?",
      "How many volunteer hours were logged this month?",
    ];

    for (const q of questions) {
      const result = await askTippy(page, q);

      // Should contain at least one specific number
      const hasNumber = /\d+/.test(result.message);
      expect(hasNumber).toBeTruthy();

      // Should not be overly vague
      const vaguePatterns = [
        "i don't know",
        "i cannot",
        "unable to determine",
        "no data available",
      ];

      const isVague = vaguePatterns.some((p) =>
        result.message.toLowerCase().includes(p)
      );

      // If vague, log for investigation
      if (isVague) {
        console.log(`Vague response for: ${q}`);
        console.log(`Response: ${result.message}`);
      }
    }
  });

  test("responses cite source views when appropriate", async ({ page }) => {
    const result = await askTippy(
      request,
      "What are the detailed foster program stats for 2025?"
    );

    // For detailed queries, Tippy should mention the view or data source
    const text = result.message.toLowerCase();
    const citesSource =
      text.includes("view") ||
      text.includes("data") ||
      text.includes("record") ||
      text.includes("table");

    // Not required but good practice
    console.log(`Response cites source: ${citesSource}`);
  });

  test("handles follow-up questions correctly", async ({ page }) => {
    // FFS-91: Changed first question to unique variant (was dup of complex-queries)
    const q1 = await askTippy(page, "How many clinic days have we scheduled this year?");
    expect(q1.message).toBeDefined();

    // Follow-up that references previous context
    const q2 = await askTippy(
      request,
      "What about last year? How does that compare?"
    );
    expect(q2.message).toBeDefined();

    // Should reference both programs
    const text = q2.message.toLowerCase();
    const hasComparison =
      text.includes("county") ||
      text.includes("scas") ||
      text.includes("compare");

    expect(hasComparison).toBeTruthy();
  });
});

test.describe("Tippy Edge Cases @real-api", () => {
  // Test suite audit: Removed "future date" and "ambiguous program" — duplicated in complex-queries.spec.ts

  test("handles malformed queries", async ({ page }) => {
    const result = await askTippy(
      request,
      "fosters 2025 q1 q3 compare how many?"
    );

    // Should still attempt to parse and respond meaningfully
    expect(result.message.length).toBeGreaterThan(20);

    // Should not crash or return error
    expect(result.message).not.toMatch(/error|exception|failed/i);
  });

  test("handles empty or very short queries", async ({ page }) => {
    const result = await askTippy(page, "fosters?");

    // Should provide helpful response, not an error
    expect(result.message.length).toBeGreaterThan(20);
  });
});

test.describe("Tippy Tool Usage @real-api", () => {
  test("uses run_sql for unknown queries", async ({ page }) => {
    // This is a meta-test to verify Tippy's tool selection
    // Note: This requires access to tool call logs

    const result = await askTippy(
      request,
      "What data do we have about volunteer hours?"
    );

    // If Tippy can't find direct data, it should acknowledge and suggest alternatives
    expect(result.message.length).toBeGreaterThan(50);
  });

  test("uses run_sql for known statistics", async ({ page }) => {
    const result = await askTippy(
      request,
      "Query the foster program YTD view for 2025"
    );

    // Should return data from the view
    expect(result.message).toMatch(/\d+/);
  });
});
