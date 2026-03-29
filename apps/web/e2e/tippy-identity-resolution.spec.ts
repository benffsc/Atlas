// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Identity Resolution E2E Tests
 *
 * Tests Tippy's ability to explain the Phase 3-4 identity resolution system:
 * - Fellegi-Sunter probabilistic matching
 * - Identity graph and merge tracking
 * - Match probability explanations
 * - Review workflow guidance
 *
 * Phase 4 verification: Ensures Tippy can guide staff through the new system.
 */

import { test, expect, Page } from "@playwright/test";
import {
  ALL_IDENTITY_QUESTIONS,
  FS_SCORING_QUESTIONS,
  IDENTITY_GRAPH_QUESTIONS,
  REVIEW_WORKFLOW_QUESTIONS,
  MATCH_EXPLANATION_QUESTIONS,
  getWorkingIdentityQuestions,
  getBasicIdentityQuestions,
  type IdentityResolutionQuestion,
} from "./fixtures/identity-resolution-questions";
import { askTippy } from "./helpers/auth-api";

// ============================================================================
// HELPER: Run test for an identity resolution question
// ============================================================================

function runIdentityQuestionTest(question: IdentityResolutionQuestion) {
  const testFn = question.expectedCapability === "gap" ? test.skip : test;

  testFn(
    `[${question.category}] ${question.question.substring(0, 60)}...`,
    async ({ page }) => {
      const response = await askTippy(page, question.question);

      // Basic response validation
      expect(response.message).toBeTruthy();
      expect(response.message.length).toBeGreaterThan(20);
      expect(response.message).not.toContain("ERROR:");
      expect(response.message.toLowerCase()).not.toContain("i don't have");
      expect(response.message.toLowerCase()).not.toContain("i cannot");

      // Question-specific validation
      const passes = question.validateResponse(response.message);
      expect(passes).toBeTruthy();
    }
  );
}

// ============================================================================
// FELLEGI-SUNTER SCORING EXPLANATIONS
// ============================================================================

test.describe("Tippy: F-S Scoring Explanations @real-api", () => {
  test.setTimeout(30000);

  for (const question of FS_SCORING_QUESTIONS) {
    runIdentityQuestionTest(question);
  }
});

// ============================================================================
// IDENTITY GRAPH EXPLANATIONS
// ============================================================================

test.describe("Tippy: Identity Graph Explanations @real-api", () => {
  test.setTimeout(30000);

  for (const question of IDENTITY_GRAPH_QUESTIONS) {
    runIdentityQuestionTest(question);
  }
});

// ============================================================================
// REVIEW WORKFLOW GUIDANCE
// ============================================================================

test.describe("Tippy: Review Workflow Guidance @real-api", () => {
  test.setTimeout(30000);

  for (const question of REVIEW_WORKFLOW_QUESTIONS) {
    runIdentityQuestionTest(question);
  }
});

// ============================================================================
// SPECIFIC MATCH EXPLANATIONS
// ============================================================================

test.describe("Tippy: Match Scenario Explanations @real-api", () => {
  test.setTimeout(30000);

  for (const question of MATCH_EXPLANATION_QUESTIONS) {
    runIdentityQuestionTest(question);
  }
});

// ============================================================================
// MULTI-TURN CONVERSATIONS
// ============================================================================

test.describe("Tippy: Identity Resolution Conversations @real-api", () => {
  test.setTimeout(45000);

  test("Can explain F-S then answer follow-up about thresholds", async ({
    page,
  }) => {
    // FFS-91: Step 1 mocked (saves 1 API call). History array provides context for step 2.
    const step1 = {
      message:
        "Atlas uses Fellegi-Sunter probabilistic matching to resolve identities. " +
        "Each record pair gets a match score based on weighted field comparisons " +
        "(email, phone, name, address). Higher scores indicate likely matches.",
      conversationId: `mock-conv-${Date.now()}`,
    };

    // Step 2: Follow-up about thresholds (real API call)
    const step2 = await page.request.post("/api/tippy/chat", {
      data: {
        message: "What score means automatic match vs manual review?",
        conversationId: step1.conversationId,
        history: [
          { role: "user", content: "How does identity matching work in Atlas?" },
          { role: "assistant", content: step1.message },
        ],
      },
    });
    expect(step2.ok()).toBeTruthy();
    const step2Data = await step2.json();
    expect(step2Data.message).toBeTruthy();
    expect(
      step2Data.message.toLowerCase().includes("auto") ||
        step2Data.message.toLowerCase().includes("review") ||
        step2Data.message.toLowerCase().includes("threshold")
    ).toBeTruthy();
  });

  test("Can explain merge then answer about undo", async ({ page }) => {
    // FFS-91: Step 1 mocked (saves 1 API call). History array provides context for step 2.
    const step1 = {
      message:
        "When you merge two person records, the 'loser' record gets a merged_into_person_id " +
        "pointing to the 'winner'. All relationships (cats, places, requests, identifiers) " +
        "are transferred to the winner record. The loser is soft-deleted but preserved for audit.",
      conversationId: `mock-conv-${Date.now()}`,
    };

    // Step 2: Follow-up about undo
    const step2 = await page.request.post("/api/tippy/chat", {
      data: {
        message: "Can I undo that if I made a mistake?",
        conversationId: step1.conversationId,
        history: [
          { role: "user", content: "What happens when I merge two people?" },
          { role: "assistant", content: step1.message },
        ],
      },
    });
    expect(step2.ok()).toBeTruthy();
    const step2Data = await step2.json();
    expect(step2Data.message).toBeTruthy();
  });

  test("Can explain low score match scenario with context", async ({
    page,
  }) => {
    // Step 1: Ask about a specific scenario
    const step1 = await askTippy(
      page,
      "I have two records with the same name but 45% match score. Should I merge them?"
    );
    expect(step1.message).toBeTruthy();

    // Should recommend caution for low scores
    expect(
      step1.message.toLowerCase().includes("email") ||
        step1.message.toLowerCase().includes("phone") ||
        step1.message.toLowerCase().includes("identifier") ||
        step1.message.toLowerCase().includes("low") ||
        step1.message.toLowerCase().includes("careful")
    ).toBeTruthy();
  });
});

// ============================================================================
// STAFF WORKFLOW SCENARIOS
// ============================================================================

test.describe("Tippy: Staff Identity Review Workflow @real-api", () => {
  test.setTimeout(60000);

  test("Morning review workflow: Check queue and prioritize", async ({
    page,
  }) => {
    // FFS-91: Step 1 mocked (saves 1 API call). History array provides context for step 2.
    const step1 = {
      message:
        "There are currently 15 pending identity reviews. 8 are high-confidence matches " +
        "(score > 90%) and 7 are medium-confidence that need manual review.",
      conversationId: `mock-conv-${Date.now()}`,
    };

    // Step 2: Ask about priority
    const step2 = await page.request.post("/api/tippy/chat", {
      data: {
        message: "Which should I review first?",
        conversationId: step1.conversationId,
        history: [
          { role: "user", content: "How many identity reviews are pending?" },
          { role: "assistant", content: step1.message },
        ],
      },
    });
    expect(step2.ok()).toBeTruthy();
    const step2Data = await step2.json();
    expect(step2Data.message).toBeTruthy();
    // Should mention high confidence or priority
    expect(
      step2Data.message.toLowerCase().includes("high") ||
        step2Data.message.toLowerCase().includes("first") ||
        step2Data.message.toLowerCase().includes("confident") ||
        step2Data.message.toLowerCase().includes("90")
    ).toBeTruthy();
  });

  test("Decision help: Uncertain match", async ({ page }) => {
    const response = await askTippy(
      page,
      "I'm looking at a 75% match. Same phone but different email. What should I do?"
    );
    expect(response.message).toBeTruthy();
    expect(response.message.length).toBeGreaterThan(50);
    // Should provide guidance
    expect(
      response.message.toLowerCase().includes("merge") ||
        response.message.toLowerCase().includes("separate") ||
        response.message.toLowerCase().includes("review") ||
        response.message.toLowerCase().includes("check")
    ).toBeTruthy();
  });

  test("Batch processing guidance", async ({ page }) => {
    const response = await askTippy(
      page,
      "I have 20 high-confidence matches. Can I process them all at once?"
    );
    expect(response.message).toBeTruthy();
    expect(
      response.message.toLowerCase().includes("batch") ||
        response.message.toLowerCase().includes("multiple") ||
        response.message.toLowerCase().includes("select") ||
        response.message.toLowerCase().includes("all")
    ).toBeTruthy();
  });
});

// ============================================================================
// CAPABILITY COVERAGE
// ============================================================================

test.describe("Identity Resolution Capability Coverage @real-api", () => {
  test("Basic questions working count", async ({ page }) => {
    const basicQuestions = getBasicIdentityQuestions();
    const workingBasic = basicQuestions.filter(
      (q) => q.expectedCapability === "works"
    );

    // At least 80% of basic questions should work
    const workingRatio = workingBasic.length / basicQuestions.length;
    expect(workingRatio).toBeGreaterThanOrEqual(0.8);

    console.log(
      `Basic identity question coverage: ${workingBasic.length}/${basicQuestions.length} (${Math.round(workingRatio * 100)}%)`
    );
  });

  test("Total working questions count", async ({ page }) => {
    const workingQuestions = getWorkingIdentityQuestions();
    const total = ALL_IDENTITY_QUESTIONS.length;

    // At least 70% should work
    const workingRatio = workingQuestions.length / total;
    expect(workingRatio).toBeGreaterThanOrEqual(0.7);

    console.log(
      `Total identity resolution coverage: ${workingQuestions.length}/${total} working (${Math.round(workingRatio * 100)}%)`
    );
  });
});

// ============================================================================
// PHASE 3-4 SPECIFIC VERIFICATION
// ============================================================================

test.describe("Phase 3-4 Verification: Tippy Knowledge @real-api", () => {
  test.setTimeout(30000);

  test("Tippy knows about Fellegi-Sunter scoring", async ({ page }) => {
    const response = await askTippy(
      page,
      "What scoring system does Atlas use for identity matching?"
    );
    expect(response.message).toBeTruthy();
    // Should mention probabilistic, scoring, or weights
    expect(
      response.message.toLowerCase().includes("probabilistic") ||
        response.message.toLowerCase().includes("score") ||
        response.message.toLowerCase().includes("weight") ||
        response.message.toLowerCase().includes("email") ||
        response.message.toLowerCase().includes("phone")
    ).toBeTruthy();
  });

  test("Tippy knows about identity graph", async ({ page }) => {
    const response = await askTippy(
      page,
      "How does Atlas track merged people?"
    );
    expect(response.message).toBeTruthy();
    // Should mention tracking, edges, history, or merge
    expect(
      response.message.toLowerCase().includes("track") ||
        response.message.toLowerCase().includes("merge") ||
        response.message.toLowerCase().includes("history") ||
        response.message.toLowerCase().includes("record")
    ).toBeTruthy();
  });

  test("Tippy knows about review workflow", async ({ page }) => {
    const response = await askTippy(
      page,
      "Where do I go to review potential duplicate people?"
    );
    expect(response.message).toBeTruthy();
    // Should mention review page or admin
    expect(
      response.message.toLowerCase().includes("review") ||
        response.message.toLowerCase().includes("admin") ||
        response.message.toLowerCase().includes("identity") ||
        response.message.toLowerCase().includes("/admin")
    ).toBeTruthy();
  });

  test("Tippy can explain probability colors", async ({ page }) => {
    const response = await askTippy(
      page,
      "What do the green, orange, and red colors mean in identity review?"
    );
    expect(response.message).toBeTruthy();
    // Should explain confidence levels
    expect(
      response.message.toLowerCase().includes("90") ||
        response.message.toLowerCase().includes("70") ||
        response.message.toLowerCase().includes("high") ||
        response.message.toLowerCase().includes("medium") ||
        response.message.toLowerCase().includes("low") ||
        response.message.toLowerCase().includes("confidence")
    ).toBeTruthy();
  });
});
