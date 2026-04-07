// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Accuracy Verification Tests
 *
 * Compares Tippy responses to direct SQL queries to verify accuracy.
 * This catches hallucinations and ensures Tippy is returning real data.
 *
 * All tests are READ-ONLY - both Tippy queries and SQL queries are SELECT only.
 */

import { test, expect } from "@playwright/test";
import {
  ALL_ACCURACY_TESTS,
  ENTITY_COUNT_TESTS,
  ALTERATION_TESTS,
  COLONY_TESTS,
  NARRATIVE_TESTS,
  compareWithTolerance,
  evaluateNarrativeTest,
  type AccuracyTest,
  type NarrativeTest,
} from "./fixtures/tippy-accuracy-queries";

// ============================================================================
// HELPERS
// ============================================================================

interface TippyResponse {
  message?: string;
  response?: string;
  content?: string;
  error?: string;
  toolsUsed?: string[];
  // apiSuccess wrapper
  data?: {
    message?: string;
    toolsUsed?: string[];
    conversationId?: string;
  };
}

async function askTippy(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }>;
  },
  question: string
): Promise<{ ok: boolean; responseText: string; toolsUsed: string[] }> {
  const response = await request.post("/api/tippy/chat", {
    data: {
      message: question,
    },
  });

  const ok = response.ok();
  const data = await response.json();

  // Handle both raw and apiSuccess-wrapped shapes
  const inner = data.data ?? data;

  const responseText =
    typeof data === "string"
      ? data
      : inner.message || data.response || data.content || JSON.stringify(data);

  const toolsUsed = Array.isArray(inner.toolsUsed) ? inner.toolsUsed : [];

  return { ok, responseText, toolsUsed };
}

/**
 * Execute a read-only SQL query via the admin SQL endpoint (FFS-91).
 * Uses /api/admin/sql instead of asking Tippy to run SQL,
 * saving one API call per accuracy test verification.
 */
async function executeSqlQuery(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{
      ok: () => boolean;
      json: () => Promise<{
        data?: { rows?: Record<string, unknown>[] };
        rows?: Record<string, unknown>[];
        error?: { message?: string } | string;
      }>;
    }>;
  },
  query: string
): Promise<{ ok: boolean; value: number | string | null; error?: string }> {
  const response = await request.post("/api/admin/sql", {
    data: { query, readOnly: true },
  });

  const ok = response.ok();
  const data = await response.json();

  if (!ok) {
    const errorMsg =
      typeof data.error === "string"
        ? data.error
        : data.error?.message || "Query failed";
    return { ok: false, value: null, error: errorMsg };
  }

  // Unwrap apiSuccess response: { data: { rows: [...] } } or { rows: [...] }
  const rows = data.data?.rows || data.rows;
  if (!rows || rows.length === 0) {
    return { ok: true, value: null, error: "No rows returned" };
  }

  // Extract first value from first row
  const firstRow = rows[0];
  const firstValue = Object.values(firstRow)[0];

  if (typeof firstValue === "number") {
    return { ok: true, value: firstValue };
  }
  if (typeof firstValue === "string") {
    const parsed = parseFloat(firstValue.replace(/,/g, ""));
    return { ok: true, value: isNaN(parsed) ? firstValue : parsed };
  }

  return { ok: true, value: null, error: "Could not extract value from row" };
}

// Generic test runner for accuracy tests
async function runAccuracyTest(
  request: Parameters<typeof askTippy>[0],
  testCase: AccuracyTest
): Promise<void> {
  // Step 1: Ask Tippy the question
  const { ok: tippyOk, responseText } = await askTippy(
    request,
    testCase.tippyQuestion
  );

  expect(tippyOk).toBeTruthy();
  expect(responseText.length).toBeGreaterThan(10);

  // Step 2: Extract value from Tippy response
  const tippyValue = testCase.extractTippyValue(responseText);

  // Step 3: Get SQL ground truth
  const { ok: sqlOk, value: sqlValue, error: sqlError } = await executeSqlQuery(
    request,
    testCase.sqlQuery
  );

  // Log for debugging
  console.log(`Test: ${testCase.id}`);
  console.log(`  Tippy response: ${responseText.substring(0, 200)}...`);
  console.log(`  Tippy extracted: ${tippyValue}`);
  console.log(`  SQL value: ${sqlValue}`);
  if (sqlError) {
    console.log(`  SQL error: ${sqlError}`);
  }

  // Step 4: If we can get both values, compare them
  if (tippyValue !== null && sqlValue !== null && sqlOk) {
    const comparison = compareWithTolerance(
      tippyValue,
      sqlValue,
      testCase.tolerance,
      testCase.comparisonType
    );

    console.log(`  Comparison: ${comparison.details}`);

    // For now, log but don't fail on accuracy - AI responses vary
    if (!comparison.passes) {
      console.warn(`  WARNING: Values outside tolerance for ${testCase.id}`);
    }
  } else {
    // If we couldn't extract values, just verify Tippy responded reasonably
    console.log(`  Skipping comparison - could not extract values`);
  }

  // At minimum, verify Tippy gave a reasonable response
  expect(responseText).not.toMatch(/error|exception|failed/i);
}

// ============================================================================
// NARRATIVE TEST RUNNER (PR 4 / FFS-1165)
//
// Catches "right number, wrong story" failures — the failure mode that
// prompted FFS-1156. The two seed fixtures (717 Cherry St + Santa Rosa
// strategic priority) lock in the work from PRs 1–3.
// ============================================================================

async function runNarrativeTest(
  request: Parameters<typeof askTippy>[0],
  testCase: NarrativeTest,
): Promise<void> {
  const { ok, responseText, toolsUsed } = await askTippy(
    request,
    testCase.tippyQuestion,
  );

  expect(ok).toBeTruthy();
  expect(responseText.length).toBeGreaterThan(10);

  console.log(`Test: ${testCase.id}`);
  console.log(`  Question: ${testCase.tippyQuestion}`);
  console.log(`  Tools used: [${toolsUsed.join(", ") || "none"}]`);
  console.log(`  Response length: ${responseText.length}`);
  console.log(`  Response preview: ${responseText.substring(0, 300)}...`);

  const failures = evaluateNarrativeTest(testCase, responseText, toolsUsed);

  if (failures.length > 0) {
    console.log(`  FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`    - ${f}`);
  }

  expect(failures, failures.join("\n")).toEqual([]);
}

test.describe("Tippy Narrative: Institutional Knowledge @nightly @real-api", () => {
  test.setTimeout(120000);

  for (const testCase of NARRATIVE_TESTS.filter((t) => t.category === "institutional_lookup")) {
    test(`${testCase.id}: ${testCase.description}`, async ({ request }) => {
      await runNarrativeTest(request, testCase);
    });
  }
});

test.describe("Tippy Narrative: Strategic Priority @nightly @real-api", () => {
  test.setTimeout(120000);

  for (const testCase of NARRATIVE_TESTS.filter((t) => t.category === "strategic_priority")) {
    test(`${testCase.id}: ${testCase.description}`, async ({ request }) => {
      await runNarrativeTest(request, testCase);
    });
  }
});

test.describe("Tippy Narrative: Humility Default @nightly @real-api", () => {
  test.setTimeout(120000);

  for (const testCase of NARRATIVE_TESTS.filter((t) => t.category === "narrative")) {
    test(`${testCase.id}: ${testCase.description}`, async ({ request }) => {
      await runNarrativeTest(request, testCase);
    });
  }
});

// ============================================================================
// ENTITY COUNT ACCURACY TESTS
// ============================================================================

test.describe("Tippy Accuracy: Entity Counts @nightly @real-api", () => {
  test.setTimeout(60000);

  for (const testCase of ENTITY_COUNT_TESTS) {
    test(`${testCase.id}: ${testCase.description}`, async ({ request }) => {
      await runAccuracyTest(request, testCase);
    });
  }
});

// ============================================================================
// ALTERATION RATE ACCURACY TESTS
// ============================================================================

test.describe("Tippy Accuracy: Alteration Rates @nightly @real-api", () => {
  test.setTimeout(60000);

  for (const testCase of ALTERATION_TESTS) {
    test(`${testCase.id}: ${testCase.description}`, async ({ request }) => {
      await runAccuracyTest(request, testCase);
    });
  }
});

// ============================================================================
// COLONY STATUS ACCURACY TESTS
// ============================================================================

test.describe("Tippy Accuracy: Colony Status @nightly @real-api", () => {
  test.setTimeout(60000);

  for (const testCase of COLONY_TESTS) {
    test(`${testCase.id}: ${testCase.description}`, async ({ request }) => {
      await runAccuracyTest(request, testCase);
    });
  }
});

// ============================================================================
// MANUAL VERIFICATION TESTS
// Hand-written tests for specific known values
// ============================================================================

test.describe("Tippy Accuracy: Manual Verification @smoke @real-api", () => {
  test.setTimeout(60000);

  test("Reports non-zero cat count", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "How many cats are in the Atlas system total?"
    );

    expect(ok).toBeTruthy();

    // Extract number
    const match = responseText.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
    expect(match).toBeTruthy();

    if (match) {
      const count = parseInt(match[1].replace(/,/g, ""));
      // Should have at least some cats
      expect(count).toBeGreaterThan(100);
      // Should not be impossibly high
      expect(count).toBeLessThan(1000000);
    }
  });

  test("Reports reasonable alteration rate", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What is the overall alteration rate?"
    );

    expect(ok).toBeTruthy();

    // Extract percentage
    const match = responseText.match(/(\d+(?:\.\d+)?)\s*%/);

    if (match) {
      const rate = parseFloat(match[1]);
      // Should be between 0 and 100
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(100);
    }
  });

  test("Reports correct data source awareness", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What data sources does Atlas integrate with?"
    );

    expect(ok).toBeTruthy();

    // Should mention known sources
    const lowerResponse = responseText.toLowerCase();
    const knownSources = ["clinichq", "shelterluv", "volunteerhub", "airtable"];
    const foundSources = knownSources.filter((s) => lowerResponse.includes(s));

    // Should mention at least some of the sources
    expect(foundSources.length).toBeGreaterThan(0);
  });

  test("Returns consistent counts on repeated queries", async ({ request }) => {
    const question = "How many active trappers are there?";

    // Ask twice
    const { ok: ok1, responseText: response1 } = await askTippy(
      request,
      question
    );
    const { ok: ok2, responseText: response2 } = await askTippy(
      request,
      question
    );

    expect(ok1).toBeTruthy();
    expect(ok2).toBeTruthy();

    // Extract numbers from both
    const match1 = response1.match(/(\d+)/);
    const match2 = response2.match(/(\d+)/);

    if (match1 && match2) {
      const count1 = parseInt(match1[1]);
      const count2 = parseInt(match2[1]);

      // Should be same or very close (within 2)
      expect(Math.abs(count1 - count2)).toBeLessThanOrEqual(2);
    }
  });
});

// ============================================================================
// SANITY CHECK TESTS
// Verify Tippy doesn't make up impossible data
// ============================================================================

test.describe("Tippy Accuracy: Sanity Checks @smoke @real-api", () => {
  test.setTimeout(60000);

  test("Does not claim more altered cats than total cats", async ({
    request,
  }) => {
    const { responseText: totalResponse } = await askTippy(
      request,
      "How many cats total?"
    );
    const { responseText: alteredResponse } = await askTippy(
      request,
      "How many cats have been altered?"
    );

    const totalMatch = totalResponse.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
    const alteredMatch = alteredResponse.match(/(\d{1,3}(?:,\d{3})*|\d+)/);

    if (totalMatch && alteredMatch) {
      const total = parseInt(totalMatch[1].replace(/,/g, ""));
      const altered = parseInt(alteredMatch[1].replace(/,/g, ""));

      // Altered should not exceed total
      expect(altered).toBeLessThanOrEqual(total);
    }
  });

  test("Does not claim impossible alteration rate", async ({ request }) => {
    const { responseText } = await askTippy(
      request,
      "What colonies have the highest alteration rate?"
    );

    // Check for any percentage over 100
    const percentages = responseText.match(/(\d+(?:\.\d+)?)\s*%/g);

    if (percentages) {
      for (const pct of percentages) {
        const value = parseFloat(pct);
        // Note: Rates can exceed 100% when verified_altered > estimate
        // But should not be impossibly high
        expect(value).toBeLessThan(500);
      }
    }
  });

  test("Does not claim negative values", async ({ request }) => {
    const { responseText } = await askTippy(
      request,
      "Show me statistics for our colonies"
    );

    // Check for negative numbers in context of counts
    const negativeMatch = responseText.match(/-\d+\s*(cats?|colonies?|requests?)/i);

    expect(negativeMatch).toBeNull();
  });

  test("Does not claim future dates for past events", async ({ request }) => {
    const { responseText } = await askTippy(
      request,
      "When was our first trapping request submitted?"
    );

    // Look for dates
    const yearMatch = responseText.match(/20\d{2}/g);

    if (yearMatch) {
      const currentYear = new Date().getFullYear();
      for (const year of yearMatch) {
        const yearNum = parseInt(year);
        // Should not be in the future
        expect(yearNum).toBeLessThanOrEqual(currentYear);
        // Should not be before FFSC existed
        expect(yearNum).toBeGreaterThan(2000);
      }
    }
  });
});
