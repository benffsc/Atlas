// @real-api - This test file calls the real Anthropic API
/**
 * Staff Daily Workflow Tests
 *
 * Tests Tippy's ability to answer the questions staff ask every day.
 * Uses natural language questions from the staff-questions.ts fixture.
 *
 * Test structure:
 * - Working questions: Regular tests that should pass
 * - Gap questions: Skipped tests that document known limitations
 */

import { test, expect } from "@playwright/test";
import {
  ALL_STAFF_QUESTIONS,
  INTAKE_QUESTIONS,
  REQUEST_QUESTIONS,
  TRAPPER_QUESTIONS,
  DATA_ENTRY_QUESTIONS,
  REPORTING_QUESTIONS,
  NAVIGATION_QUESTIONS,
  EMERGENCY_QUESTIONS,
  getWorkingQuestions,
  getGapQuestions,
  getDailyQuestions,
  type StaffQuestion,
} from "./fixtures/staff-questions";

// ============================================================================
// HELPER: Send message to Tippy
// ============================================================================

interface TippyResponse {
  message: string;
  conversationId?: string;
}

async function askTippy(
  request: { post: (url: string, options: { data: unknown }) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }> },
  question: string
): Promise<TippyResponse> {
  const response = await request.post("/api/tippy/chat", {
    data: { message: question },
  });

  if (!response.ok()) {
    return { message: "ERROR: Request failed" };
  }

  return response.json();
}

// ============================================================================
// HELPER: Run test for a staff question
// ============================================================================

function runStaffQuestionTest(question: StaffQuestion) {
  const testFn = question.expectedCapability === "gap" ? test.skip : test;

  testFn(
    `[${question.persona}] ${question.question}`,
    async ({ request }) => {
      const response = await askTippy(request, question.question);

      // Basic response validation
      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(20);
      expect(response.message).not.toContain("ERROR:");

      // Question-specific validation
      const passes = question.validateResponse(response.message);
      expect(passes).toBeTruthy();
    }
  );
}

// ============================================================================
// DAILY COORDINATOR WORKFLOW
// Questions asked every morning when opening Atlas
// ============================================================================

test.describe("Daily Coordinator Workflow @workflow @real-api", () => {
  test.describe("Morning Intake Review", () => {
    for (const question of INTAKE_QUESTIONS) {
      runStaffQuestionTest(question);
    }
  });

  test.describe("Active Request Management", () => {
    for (const question of REQUEST_QUESTIONS) {
      runStaffQuestionTest(question);
    }
  });
});

// ============================================================================
// TRAPPER MANAGEMENT WORKFLOW
// Questions for managing trapper assignments and performance
// ============================================================================

test.describe("Trapper Management Workflow @real-api", () => {
  for (const question of TRAPPER_QUESTIONS) {
    runStaffQuestionTest(question);
  }
});

// ============================================================================
// DATA ENTRY WORKFLOW
// Questions for data verification and duplicate detection
// ============================================================================

test.describe("Data Entry Workflow @real-api", () => {
  for (const question of DATA_ENTRY_QUESTIONS) {
    runStaffQuestionTest(question);
  }
});

// ============================================================================
// REPORTING WORKFLOW
// Questions for monthly/quarterly reporting
// ============================================================================

test.describe("Reporting Workflow @real-api", () => {
  for (const question of REPORTING_QUESTIONS) {
    runStaffQuestionTest(question);
  }
});

// ============================================================================
// NAVIGATION HELP
// Questions about finding things in Atlas
// ============================================================================

test.describe("Navigation Help @real-api", () => {
  for (const question of NAVIGATION_QUESTIONS) {
    runStaffQuestionTest(question);
  }
});

// ============================================================================
// EMERGENCY HANDLING
// Questions during urgent situations
// ============================================================================

test.describe("Emergency Handling @real-api", () => {
  for (const question of EMERGENCY_QUESTIONS) {
    runStaffQuestionTest(question);
  }
});

// ============================================================================
// WORKFLOW SCENARIOS: Multi-Step Operations
// These test realistic multi-turn conversations
// ============================================================================

test.describe("Workflow Scenarios @real-api", () => {
  test("Intake triage workflow", async ({ request }) => {
    // Step 1: Check pending intakes
    const step1 = await askTippy(request, "How many pending intakes do we have?");
    expect(step1.message).toBeTruthy();

    // Step 2: Check for duplicates
    const step2 = await request.post("/api/tippy/chat", {
      data: {
        message: "Is there already a request for any Santa Rosa address?",
        conversationId: step1.conversationId,
        history: [
          { role: "user", content: "How many pending intakes do we have?" },
          { role: "assistant", content: step1.message },
        ],
      },
    });
    expect(step2.ok()).toBeTruthy();
    const step2Data = await step2.json();
    expect(step2Data.message).toBeTruthy();
  });

  test("Trapper assignment workflow", async ({ request }) => {
    // Step 1: See unassigned requests
    const step1 = await askTippy(
      request,
      "How many requests need to be assigned?"
    );
    expect(step1.message).toBeTruthy();

    // Step 2: Check trapper stats
    const step2 = await request.post("/api/tippy/chat", {
      data: {
        message: "Who are our most active trappers?",
        conversationId: step1.conversationId,
        history: [
          { role: "user", content: "How many requests need to be assigned?" },
          { role: "assistant", content: step1.message },
        ],
      },
    });
    expect(step2.ok()).toBeTruthy();
    const step2Data = await step2.json();
    expect(step2Data.message).toBeTruthy();
  });

  test("Cat lookup workflow", async ({ request }) => {
    // Step 1: Find cat by microchip
    const step1 = await askTippy(
      request,
      "Look up any cat with a microchip starting with 985"
    );
    expect(step1.message).toBeTruthy();

    // Step 2: Get more details
    const step2 = await request.post("/api/tippy/chat", {
      data: {
        message: "What's the full history of that cat?",
        conversationId: step1.conversationId,
        history: [
          { role: "user", content: "Look up any cat with a microchip starting with 985" },
          { role: "assistant", content: step1.message },
        ],
      },
    });
    expect(step2.ok()).toBeTruthy();
    const step2Data = await step2.json();
    expect(step2Data.message).toBeTruthy();
  });

  test("Colony status workflow", async ({ request }) => {
    // Step 1: Find colonies needing attention
    const step1 = await askTippy(
      request,
      "Which colonies need the most attention?"
    );
    expect(step1.message).toBeTruthy();

    // Step 2: Get details on worst colony
    const step2 = await request.post("/api/tippy/chat", {
      data: {
        message: "Tell me more about any colony with low alteration rate",
        conversationId: step1.conversationId,
        history: [
          { role: "user", content: "Which colonies need the most attention?" },
          { role: "assistant", content: step1.message },
        ],
      },
    });
    expect(step2.ok()).toBeTruthy();
    const step2Data = await step2.json();
    expect(step2Data.message).toBeTruthy();
  });
});

// ============================================================================
// CAPABILITY SUMMARY TESTS
// Aggregate tests to quantify working vs gap questions
// ============================================================================

test.describe("Capability Coverage @real-api", () => {
  test("Daily questions working count", async ({ request }) => {
    const dailyQuestions = getDailyQuestions();
    const workingDaily = dailyQuestions.filter(
      (q) => q.expectedCapability === "works"
    );

    // At least 60% of daily questions should work
    const workingRatio = workingDaily.length / dailyQuestions.length;
    expect(workingRatio).toBeGreaterThanOrEqual(0.6);

    // Log coverage for visibility
    console.log(
      `Daily question coverage: ${workingDaily.length}/${dailyQuestions.length} (${Math.round(workingRatio * 100)}%)`
    );
  });

  test("Total working questions count", async ({ request }) => {
    const workingQuestions = getWorkingQuestions();
    const gapQuestions = getGapQuestions();
    const total = ALL_STAFF_QUESTIONS.length;

    // At least 50% should work
    const workingRatio = workingQuestions.length / total;
    expect(workingRatio).toBeGreaterThanOrEqual(0.5);

    console.log(
      `Total coverage: ${workingQuestions.length}/${total} working (${Math.round(workingRatio * 100)}%)`
    );
    console.log(
      `Gaps to fix: ${gapQuestions.length} questions`
    );
  });
});

// ============================================================================
// GAP DOCUMENTATION
// Explicitly list all gaps with their reasons
// ============================================================================

test.describe("Documented Gaps (Expected Failures) @real-api", () => {
  const gapQuestions = getGapQuestions();

  for (const question of gapQuestions) {
    test.skip(
      `GAP: ${question.id} - ${question.gapReason || "Unknown"}`,
      async ({ request }) => {
        const response = await askTippy(request, question.question);
        const passes = question.validateResponse(response.message);
        expect(passes).toBeTruthy();
      }
    );
  }
});
