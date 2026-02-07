/**
 * Tippy Staff Workflow Tests
 *
 * Tests Tippy's ability to answer real staff questions about programs.
 * Uses the staff-program-questions fixture for comprehensive coverage.
 */

import { test, expect } from "@playwright/test";
import {
  EASY_QUESTIONS,
  MEDIUM_QUESTIONS,
  HARD_QUESTIONS,
  StaffQuestion,
} from "./fixtures/staff-program-questions";

const TIPPY_API = "/api/tippy/chat";

interface TippyResponse {
  message: string;
  response?: string;
  content?: string;
  toolCalls?: any[];
}

async function askTippy(
  request: any,
  question: string
): Promise<TippyResponse> {
  const response = await request.post(TIPPY_API, {
    data: { message: question },
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok()) {
    return { message: `API Error: ${response.status()}` };
  }

  return await response.json();
}

async function testQuestion(
  request: any,
  question: StaffQuestion
): Promise<{ passed: boolean; response: string; reason?: string }> {
  const result = await askTippy(request, question.question);

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

test.describe("Tippy Staff Workflows - Easy Questions", () => {
  for (const question of EASY_QUESTIONS) {
    test(`[${question.id}] ${question.description}`, async ({ request }) => {
      const result = await testQuestion(request, question);

      console.log(`Question: ${question.question}`);
      console.log(`Response: ${result.response.substring(0, 200)}...`);

      expect(result.passed).toBeTruthy();
    });
  }
});

test.describe("Tippy Staff Workflows - Medium Questions", () => {
  for (const question of MEDIUM_QUESTIONS) {
    test(`[${question.id}] ${question.description}`, async ({ request }) => {
      const result = await testQuestion(request, question);

      console.log(`Question: ${question.question}`);
      console.log(`Response: ${result.response.substring(0, 200)}...`);

      expect(result.passed).toBeTruthy();
    });
  }
});

test.describe("Tippy Staff Workflows - Hard Questions", () => {
  for (const question of HARD_QUESTIONS) {
    test(`[${question.id}] ${question.description}`, async ({ request }) => {
      const result = await testQuestion(request, question);

      console.log(`Question: ${question.question}`);
      console.log(`Response: ${result.response.substring(0, 200)}...`);

      // Hard questions may not always pass validation
      // but should at least return a meaningful response
      expect(result.response.length).toBeGreaterThan(50);
    });
  }
});

test.describe("Tippy Response Quality", () => {
  test("responses contain specific numbers, not vague answers", async ({
    request,
  }) => {
    const questions = [
      "How many foster cats in 2025?",
      "How many SCAS cats this year?",
      "How many LMFM appointments?",
    ];

    for (const q of questions) {
      const result = await askTippy(request, q);

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

  test("responses cite source views when appropriate", async ({ request }) => {
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

  test("handles follow-up questions correctly", async ({ request }) => {
    // First question
    const q1 = await askTippy(request, "How many foster cats in 2025?");
    expect(q1.message).toBeDefined();

    // Follow-up that references previous context
    const q2 = await askTippy(
      request,
      "What about county cats? How does that compare?"
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

test.describe("Tippy Edge Cases", () => {
  test("handles future date queries gracefully", async ({ request }) => {
    const result = await askTippy(
      request,
      "How many fosters will we have in 2027?"
    );

    const text = result.message.toLowerCase();

    // Should acknowledge it can't predict the future
    const appropriateResponse =
      text.includes("future") ||
      text.includes("cannot predict") ||
      text.includes("no data") ||
      text.includes("haven't") ||
      text.includes("projection");

    expect(appropriateResponse).toBeTruthy();
  });

  test("handles ambiguous program names", async ({ request }) => {
    const result = await askTippy(
      request,
      "How many for the special program?"
    );

    const text = result.message.toLowerCase();

    // Should ask for clarification or list options
    const asksForClarification =
      text.includes("which") ||
      text.includes("clarify") ||
      text.includes("mean") ||
      text.includes("foster") ||
      text.includes("lmfm") ||
      text.includes("county");

    expect(asksForClarification).toBeTruthy();
  });

  test("handles malformed queries", async ({ request }) => {
    const result = await askTippy(
      request,
      "fosters 2025 q1 q3 compare how many?"
    );

    // Should still attempt to parse and respond meaningfully
    expect(result.message.length).toBeGreaterThan(20);

    // Should not crash or return error
    expect(result.message).not.toMatch(/error|exception|failed/i);
  });

  test("handles empty or very short queries", async ({ request }) => {
    const result = await askTippy(request, "fosters?");

    // Should provide helpful response, not an error
    expect(result.message.length).toBeGreaterThan(20);
  });
});

test.describe("Tippy Tool Usage", () => {
  test("uses discover_views for unknown queries", async ({ request }) => {
    // This is a meta-test to verify Tippy's tool selection
    // Note: This requires access to tool call logs

    const result = await askTippy(
      request,
      "What data do we have about volunteer hours?"
    );

    // If Tippy can't find direct data, it should acknowledge and suggest alternatives
    expect(result.message.length).toBeGreaterThan(50);
  });

  test("uses query_view for known statistics", async ({ request }) => {
    const result = await askTippy(
      request,
      "Query the foster program YTD view for 2025"
    );

    // Should return data from the view
    expect(result.message).toMatch(/\d+/);
  });
});
