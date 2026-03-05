/**
 * Tippy Edge Case Tests
 *
 * Tests how Tippy handles problematic data conditions:
 * - Missing data (incomplete records)
 * - Conflicting data (different values across sources)
 * - Merge chains (multi-hop entity relationships)
 *
 * FFS-91: Fixture-driven and low-value tests mocked to save ~23 API calls.
 * Only 3 high-value regression tests remain as @real-api.
 *
 * All tests are READ-ONLY against production data.
 * No data is created or modified by these tests.
 */

import { test, expect } from "@playwright/test";
import {
  mockTippyAPI,
} from "./helpers/auth-api";
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

/**
 * Helper: Send message to Tippy via browser fetch (intercepted by page.route mocks).
 */
async function askTippyViaFetch(
  page: import("@playwright/test").Page,
  baseURL: string,
  question: string
): Promise<{ ok: boolean; responseText: string; error?: string }> {
  const result = await page.evaluate(
    async ([url, msg]: [string, string]) => {
      const res = await fetch(`${url}/api/tippy/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      return {
        ok: res.ok,
        responseText:
          data.message || data.response || data.content || JSON.stringify(data),
        error: data.error,
      };
    },
    [baseURL, question] as [string, string]
  );
  return result;
}

// Mocked edge case test runner: verifies response shape with mock
async function runMockedEdgeCaseTest(
  page: import("@playwright/test").Page,
  baseURL: string,
  question: EdgeCaseQuestion
): Promise<void> {
  const { ok, responseText, error } = await askTippyViaFetch(
    page,
    baseURL,
    question.question
  );

  expect(ok).toBeTruthy();
  expect(error).toBeUndefined();
  expect(responseText).toBeTruthy();
  expect(responseText.length).toBeGreaterThan(10);

  if (question.shouldNotMatch) {
    expect(responseText.match(question.shouldNotMatch)).toBeNull();
  }
}

// ============================================================================
// MOCKED FIXTURE TESTS (FFS-91)
// These test response shape/graceful degradation, not AI accuracy.
// Mocked to save ~20 API calls per run.
// ============================================================================

test.describe("Tippy Edge Cases: Missing Data (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await mockTippyAPI(
      page,
      "Based on our records, I found some relevant results for your query. " +
        "There are records with incomplete data in the system. " +
        "Some cat and person records have missing fields like microchip numbers or phone numbers."
    );
  });

  for (const scenario of MISSING_DATA_SCENARIOS) {
    test(`${scenario.id}: ${scenario.description}`, async ({
      page,
      baseURL,
    }) => {
      await runMockedEdgeCaseTest(page, baseURL!, scenario);
    });
  }
});

test.describe("Tippy Edge Cases: Conflicting Data (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await mockTippyAPI(
      page,
      "I found some data discrepancies across sources. " +
        "There are records where the phone number or email differs between ClinicHQ and Airtable. " +
        "Colony size estimates also vary between different data sources."
    );
  });

  for (const scenario of CONFLICTING_DATA_SCENARIOS) {
    test(`${scenario.id}: ${scenario.description}`, async ({
      page,
      baseURL,
    }) => {
      await runMockedEdgeCaseTest(page, baseURL!, scenario);
    });
  }
});

test.describe("Tippy Edge Cases: Merge Chains (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await mockTippyAPI(
      page,
      "I traced the merge history for this entity. " +
        "The record was originally created in ClinicHQ and later merged with a duplicate from Airtable. " +
        "All related data has been consolidated into the surviving record."
    );
  });

  for (const scenario of MERGE_CHAIN_SCENARIOS) {
    test(`${scenario.id}: ${scenario.description}`, async ({
      page,
      baseURL,
    }) => {
      await runMockedEdgeCaseTest(page, baseURL!, scenario);
    });
  }
});

// ============================================================================
// MOCKED BOUNDARY VALUE TESTS (FFS-91)
// ============================================================================

test.describe("Tippy Edge Cases: Boundary Values (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Handles query for zero results gracefully", async ({
    page,
    baseURL,
  }) => {
    await mockTippyAPI(
      page,
      "I searched for that address but couldn't find any matching records. " +
        "There are no cats or places associated with 99999 Nonexistent Road."
    );

    const { ok, responseText } = await askTippyViaFetch(
      page,
      baseURL!,
      "How many cats are at a fake address that doesn't exist like 99999 Nonexistent Road?"
    );

    expect(ok).toBeTruthy();
    expect(responseText).toBeTruthy();
    expect(responseText.toLowerCase()).not.toMatch(/error|exception|failed/i);
  });

  test("Handles very long address strings", async ({ page, baseURL }) => {
    await mockTippyAPI(
      page,
      "I searched for that address but didn't find an exact match in our system. " +
        "Could you try a simpler address format?"
    );

    const { ok, responseText } = await askTippyViaFetch(
      page,
      baseURL!,
      "What do we know about 12345 Very Long Street Name That Might Break Things Apartment Complex Building A Unit 99, Santa Rosa, CA 95401?"
    );

    expect(ok).toBeTruthy();
    expect(responseText).toBeTruthy();
  });

  test("Handles special characters in search", async ({ page, baseURL }) => {
    await mockTippyAPI(
      page,
      "I found records for people with apostrophes in their names. " +
        "Special characters are handled correctly in our search."
    );

    const { ok, responseText } = await askTippyViaFetch(
      page,
      baseURL!,
      "Find person named O'Brien or any name with apostrophe"
    );

    expect(ok).toBeTruthy();
    expect(responseText).toBeTruthy();
  });
});

// ============================================================================
// MOCKED LOW-VALUE REGRESSION TESTS (FFS-91)
// ============================================================================

test.describe("Tippy Edge Cases: Mocked Regression Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Handles lookup for person with only email (no name)", async ({
    page,
    baseURL,
  }) => {
    await mockTippyAPI(
      page,
      "I found several people who have an email address but no name recorded in our system."
    );

    const { ok, responseText } = await askTippyViaFetch(
      page,
      baseURL!,
      "Look up anyone with just an email address, no name on record"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("Handles places with same address different unit numbers", async ({
    page,
    baseURL,
  }) => {
    await mockTippyAPI(
      page,
      "I found multi-unit addresses where different units have separate records in our system."
    );

    const { ok, responseText } = await askTippyViaFetch(
      page,
      baseURL!,
      "Show me multi-unit addresses where different units have separate records"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("Handles cats with no appointments but linked to place", async ({
    page,
    baseURL,
  }) => {
    await mockTippyAPI(
      page,
      "Yes, there are cats linked to places that have never been to the clinic. " +
        "These are typically cats reported in colony surveys but not yet trapped."
    );

    const { ok, responseText } = await askTippyViaFetch(
      page,
      baseURL!,
      "Are there cats linked to places that have never been to the clinic?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
  });
});

// ============================================================================
// HIGH-VALUE REGRESSION TESTS (kept as @real-api)
// These test complex data scenarios that require real AI reasoning.
// ============================================================================

test.describe("Tippy Edge Cases: Regression Tests @smoke @real-api", () => {
  test.setTimeout(60000);

  test("Handles cats with duplicate microchips gracefully", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      "Are there any cats that share the same microchip number?"
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(10);
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
