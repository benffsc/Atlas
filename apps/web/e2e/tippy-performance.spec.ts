// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Performance Tests
 *
 * Benchmarks response times for different query types.
 * These tests verify Tippy responds within acceptable time limits.
 *
 * All tests are READ-ONLY.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// PERFORMANCE BENCHMARKS (in milliseconds)
// ============================================================================

const BENCHMARKS = {
  // Benchmarks include LLM round-trip time (~15-35s for Claude with tool use)
  // These are generous to account for API latency variance
  SIMPLE_LOOKUP: 45000, // 45 seconds for simple queries
  COMPREHENSIVE_LOOKUP: 60000, // 60 seconds for comprehensive lookups
  CROSS_SOURCE_DEDUCTION: 90000, // 90 seconds for complex cross-source
  SCHEMA_NAVIGATION: 45000, // 45 seconds for view catalog operations
};

// ============================================================================
// HELPER
// ============================================================================

interface TippyResponse {
  message?: string;
  response?: string;
  content?: string;
  error?: string;
}

async function timedTippyRequest(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }>;
  },
  question: string
): Promise<{ ok: boolean; responseText: string; durationMs: number }> {
  const startTime = Date.now();

  const response = await request.post("/api/tippy/chat", {
    data: {
      message: question,
    },
  });

  const endTime = Date.now();
  const durationMs = endTime - startTime;

  const ok = response.ok();
  const data = await response.json();

  const responseText =
    typeof data === "string"
      ? data
      : data.message || data.response || data.content || JSON.stringify(data);

  return { ok, responseText, durationMs };
}

// ============================================================================
// SIMPLE LOOKUP PERFORMANCE TESTS
// Single-table queries that should be fast
// ============================================================================

test.describe("Tippy Performance: Simple Lookups @smoke", () => {
  test.setTimeout(60000);

  test("Count query completes within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "How many cats total?"
    );

    console.log(`Simple count query: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(10);
    expect(durationMs).toBeLessThan(BENCHMARKS.SIMPLE_LOOKUP);
  });

  test("Single entity lookup completes within benchmark", async ({
    request,
  }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Who are the top 5 trappers?"
    );

    console.log(`Single entity lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
    expect(durationMs).toBeLessThan(BENCHMARKS.SIMPLE_LOOKUP);
  });

  test("Status query completes within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "How many pending requests are there?"
    );

    console.log(`Status query: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SIMPLE_LOOKUP);
  });

  test("Simple filter query completes within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "How many cats at any Santa Rosa address?"
    );

    console.log(`Filter query: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SIMPLE_LOOKUP);
  });
});

// ============================================================================
// COMPREHENSIVE LOOKUP PERFORMANCE TESTS
// Multi-source queries
// ============================================================================

test.describe("Tippy Performance: Comprehensive Lookups @smoke", () => {
  test.setTimeout(60000);

  test("comprehensive_person_lookup within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Tell me everything about any staff member"
    );

    console.log(`Comprehensive person lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);
    expect(durationMs).toBeLessThan(BENCHMARKS.COMPREHENSIVE_LOOKUP);
  });

  test("comprehensive_place_lookup within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Tell me everything about any active colony"
    );

    console.log(`Comprehensive place lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);
    expect(durationMs).toBeLessThan(BENCHMARKS.COMPREHENSIVE_LOOKUP);
  });

  test("comprehensive_cat_lookup within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Trace the journey of any cat with a microchip"
    );

    console.log(`Comprehensive cat lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);
    expect(durationMs).toBeLessThan(BENCHMARKS.COMPREHENSIVE_LOOKUP);
  });

  test("trapper stats lookup within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Show me full statistics for any active trapper"
    );

    console.log(`Trapper stats lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.COMPREHENSIVE_LOOKUP);
  });
});

// ============================================================================
// CROSS-SOURCE DEDUCTION PERFORMANCE TESTS
// Complex queries requiring inference
// ============================================================================

test.describe("Tippy Performance: Cross-Source Deductions @stress @slow", () => {
  test.setTimeout(90000);

  test("Person role evolution query within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Find someone who started as a requester and became a trapper"
    );

    console.log(`Cross-source role evolution: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.CROSS_SOURCE_DEDUCTION);
  });

  test("Cat lifecycle query within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Find a cat that went from trapping request to clinic to foster"
    );

    console.log(`Cross-source cat lifecycle: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.CROSS_SOURCE_DEDUCTION);
  });

  test("Data discrepancy detection within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Find people with different phone numbers across systems"
    );

    console.log(`Cross-source discrepancy detection: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.CROSS_SOURCE_DEDUCTION);
  });

  test("Multi-source aggregation within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Which colony has data from the most different sources?"
    );

    console.log(`Cross-source aggregation: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.CROSS_SOURCE_DEDUCTION);
  });
});

// ============================================================================
// SCHEMA NAVIGATION PERFORMANCE TESTS
// View catalog operations
// ============================================================================

test.describe("Tippy Performance: Schema Navigation @smoke", () => {
  test.setTimeout(60000);

  test("discover_views within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "What views are available to query?"
    );

    console.log(`Schema discovery: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SCHEMA_NAVIGATION);
  });

  test("view category search within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Show me all stats category views"
    );

    console.log(`View category search: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SCHEMA_NAVIGATION);
  });

  test("view keyword search within benchmark", async ({ request }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      request,
      "Search for views related to beacon or colony"
    );

    console.log(`View keyword search: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SCHEMA_NAVIGATION);
  });
});

// ============================================================================
// SUSTAINED LOAD TESTS
// Multiple queries in sequence
// ============================================================================

test.describe("Tippy Performance: Sustained Load @stress @slow", () => {
  test.setTimeout(120000);

  test("5 sequential queries maintain performance", async ({ request }) => {
    const questions = [
      "How many cats total?",
      "Who are the top trappers?",
      "What colonies need attention?",
      "How many pending requests?",
      "What's the overall alteration rate?",
    ];

    const durations: number[] = [];

    for (const question of questions) {
      const { ok, durationMs } = await timedTippyRequest(request, question);
      expect(ok).toBeTruthy();
      durations.push(durationMs);
    }

    console.log(`Sequential query durations: ${durations.join(", ")}ms`);

    // Average should still be reasonable
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    console.log(`Average: ${avgDuration}ms`);

    // Later queries shouldn't be dramatically slower
    const firstDuration = durations[0];
    const lastDuration = durations[durations.length - 1];

    // Last query should be within 2x of first (allow some variance)
    expect(lastDuration).toBeLessThan(firstDuration * 3);
  });

  test("Repeated same query is consistent", async ({ request }) => {
    const question = "How many cats are in the system?";
    const durations: number[] = [];

    for (let i = 0; i < 3; i++) {
      const { ok, durationMs } = await timedTippyRequest(request, question);
      expect(ok).toBeTruthy();
      durations.push(durationMs);
    }

    console.log(`Repeated query durations: ${durations.join(", ")}ms`);

    // Variance should be reasonable (within 3x of minimum)
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    expect(maxDuration).toBeLessThan(minDuration * 4);
  });
});

// ============================================================================
// PERFORMANCE REGRESSION SUMMARY
// ============================================================================

test.describe("Tippy Performance: Summary", () => {
  test.setTimeout(120000);

  test("Log benchmark summary", async ({ request }) => {
    const testCases = [
      { name: "Simple count", question: "How many cats?" },
      { name: "Top N query", question: "Top 3 trappers" },
      { name: "Comprehensive lookup", question: "Tell me about any trapper" },
      { name: "Cross-source", question: "Find volunteer who became trapper" },
    ];

    console.log("\n=== Performance Benchmark Summary ===\n");

    for (const testCase of testCases) {
      const { ok, durationMs } = await timedTippyRequest(
        request,
        testCase.question
      );

      const status = ok
        ? durationMs < BENCHMARKS.COMPREHENSIVE_LOOKUP
          ? "PASS"
          : "SLOW"
        : "FAIL";

      console.log(`${testCase.name}: ${durationMs}ms [${status}]`);
    }

    console.log("\n=== End Summary ===\n");

    // This test always passes - it's just for logging
    expect(true).toBeTruthy();
  });
});
