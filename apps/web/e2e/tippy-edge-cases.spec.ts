// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Edge Case Tests
 *
 * Tests how Tippy handles problematic data conditions:
 * - Missing data (incomplete records)
 * - Conflicting data (different values across sources)
 * - Merge chains (multi-hop entity relationships)
 *
 * All tests are READ-ONLY against production data.
 * No data is created or modified by these tests.
 */

import { test, expect } from "@playwright/test";
import {
  MISSING_DATA_SCENARIOS,
  CONFLICTING_DATA_SCENARIOS,
  MERGE_CHAIN_SCENARIOS,
  type EdgeCaseQuestion,
} from "./fixtures/tippy-edge-cases";

// ============================================================================
// HELPER: Send message to Tippy and get response
// ============================================================================

interface TippyResponse {
  message?: string;
  response?: string;
  content?: string;
  error?: string;
  conversationId?: string;
}

async function askTippy(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }>;
  },
  question: string
): Promise<{ ok: boolean; data: TippyResponse; responseText: string }> {
  const response = await request.post("/api/tippy/chat", {
    data: {
      message: question,
    },
  });

  const ok = response.ok();
  const data = await response.json();

  // Extract response text from various possible fields
  const responseText =
    typeof data === "string"
      ? data
      : data.message || data.response || data.content || JSON.stringify(data);

  return { ok, data, responseText };
}

// Generic test runner for edge case questions
async function runEdgeCaseTest(
  request: Parameters<typeof askTippy>[0],
  question: EdgeCaseQuestion
): Promise<void> {
  const { ok, data, responseText } = await askTippy(request, question.question);

  // Should not throw server error
  expect(ok).toBeTruthy();
  expect(data.error).toBeUndefined();

  // Should get some response
  expect(responseText).toBeTruthy();
  expect(responseText.length).toBeGreaterThan(10);

  // Check shouldNotMatch patterns
  if (question.shouldNotMatch) {
    const matches = responseText.match(question.shouldNotMatch);
    if (matches) {
      console.log(
        `Question ${question.id}: Response matched forbidden pattern: ${matches[0]}`
      );
      console.log(`Response excerpt: ${responseText.substring(0, 200)}...`);
    }
    expect(matches).toBeNull();
  }

  // Check shouldContain keywords (soft check - log but don't fail)
  if (question.shouldContain && question.shouldContain.length > 0) {
    const lowerResponse = responseText.toLowerCase();
    const found = question.shouldContain.filter((kw) =>
      lowerResponse.includes(kw.toLowerCase())
    );
    if (found.length === 0) {
      console.log(
        `Question ${question.id}: Response missing expected keywords: ${question.shouldContain.join(", ")}`
      );
    }
  }
}

// ============================================================================
// MISSING DATA TESTS
// Tests how Tippy handles records with incomplete information
// ============================================================================

test.describe("Tippy Edge Cases: Missing Data @stress @real-api", () => {
  test.setTimeout(60000);

  for (const scenario of MISSING_DATA_SCENARIOS) {
    test(`${scenario.id}: ${scenario.description}`, async ({ request }) => {
      await runEdgeCaseTest(request, scenario);
    });
  }
});

// ============================================================================
// CONFLICTING DATA TESTS
// Tests how Tippy handles records with different values across sources
// ============================================================================

test.describe("Tippy Edge Cases: Conflicting Data @stress @real-api", () => {
  test.setTimeout(60000);

  for (const scenario of CONFLICTING_DATA_SCENARIOS) {
    test(`${scenario.id}: ${scenario.description}`, async ({ request }) => {
      await runEdgeCaseTest(request, scenario);
    });
  }
});

// ============================================================================
// MERGE CHAIN TESTS
// Tests how Tippy handles multi-hop merged entity relationships
// ============================================================================

test.describe("Tippy Edge Cases: Merge Chains @stress @real-api", () => {
  test.setTimeout(60000);

  for (const scenario of MERGE_CHAIN_SCENARIOS) {
    test(`${scenario.id}: ${scenario.description}`, async ({ request }) => {
      await runEdgeCaseTest(request, scenario);
    });
  }
});

// ============================================================================
// SPECIFIC EDGE CASE REGRESSION TESTS
// Hand-crafted tests for known problematic scenarios
// ============================================================================

test.describe("Tippy Edge Cases: Regression Tests @smoke @real-api", () => {
  // Tippy queries can take 30+ seconds for complex lookups
  test.setTimeout(60000);

  test("Handles lookup for person with only email (no name)", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "Look up anyone with just an email address, no name on record"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("Handles cats with duplicate microchips gracefully", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "Are there any cats that share the same microchip number?"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    // Should not crash, even if answer is "no duplicates"
    expect(responseText.length).toBeGreaterThan(10);
  });

  test("Handles places with same address different unit numbers", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "Show me multi-unit addresses where different units have separate records"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("Handles person appearing in multiple source systems", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "Find a person who appears in at least 3 different source systems"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("Handles cats with no appointments but linked to place", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "Are there cats linked to places that have never been to the clinic?"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("Handles requests older than 2 years", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "What is our oldest unresolved request?"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(20);
  });
});

// ============================================================================
// BOUNDARY VALUE TESTS
// Tests edge cases with numeric boundaries
// ============================================================================

test.describe("Tippy Edge Cases: Boundary Values @stress @real-api", () => {
  test.setTimeout(60000);

  test("Handles query for zero results gracefully", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "How many cats are at a fake address that doesn't exist like 99999 Nonexistent Road?"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    // Should report zero or not found, not error
    expect(responseText).toBeTruthy();
    expect(responseText.toLowerCase()).not.toMatch(/error|exception|failed/i);
  });

  test("Handles very long address strings", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "What do we know about 12345 Very Long Street Name That Might Break Things Apartment Complex Building A Unit 99, Santa Rosa, CA 95401?"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText).toBeTruthy();
  });

  test("Handles special characters in search", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "Find person named O'Brien or any name with apostrophe"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText).toBeTruthy();
  });
});
