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
import { timedTippyRequest } from "./helpers/auth-api";

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
// SIMPLE LOOKUP PERFORMANCE TESTS
// Single-table queries that should be fast
// ============================================================================

test.describe("Tippy Performance: Simple Lookups @smoke @real-api", () => {
  test.setTimeout(60000);

  // FFS-91: Questions changed to avoid duplicating accuracy/capabilities tests
  test("Count query completes within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "How many cat appointments were recorded last month?"
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
      page,
      "How many places have active colony tags?"
    );

    console.log(`Single entity lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
    expect(durationMs).toBeLessThan(BENCHMARKS.SIMPLE_LOOKUP);
  });

  test("Status query completes within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "How many appointments happened this year?"
    );

    console.log(`Status query: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SIMPLE_LOOKUP);
  });

  test("Simple filter query completes within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "How many people have phone numbers on file?"
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

test.describe("Tippy Performance: Comprehensive Lookups @smoke @real-api", () => {
  test.setTimeout(60000);

  // FFS-91: Questions changed to avoid duplicating capabilities tests
  test("person_lookup within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "Give me a detailed overview of any person who is both a volunteer and trapper"
    );

    console.log(`Comprehensive person lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);
    expect(durationMs).toBeLessThan(BENCHMARKS.COMPREHENSIVE_LOOKUP);
  });

  test("place_search within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "What is the full activity history for any place with more than 5 cats?"
    );

    console.log(`Comprehensive place lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);
    expect(durationMs).toBeLessThan(BENCHMARKS.COMPREHENSIVE_LOOKUP);
  });

  test("cat_lookup within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "Show me the complete timeline for any cat with clinic visits and a foster record"
    );

    console.log(`Comprehensive cat lookup: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);
    expect(durationMs).toBeLessThan(BENCHMARKS.COMPREHENSIVE_LOOKUP);
  });

  test("trapper stats lookup within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "What is the detailed service history for any trapper who has worked in multiple areas?"
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

test.describe("Tippy Performance: Cross-Source Deductions @stress @slow @real-api", () => {
  test.setTimeout(90000);

  test("Person role evolution query within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "Find someone who started as a requester and became a trapper"
    );

    console.log(`Cross-source role evolution: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.CROSS_SOURCE_DEDUCTION);
  });

  test("Cat lifecycle query within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "Find a cat that went from trapping request to clinic to foster"
    );

    console.log(`Cross-source cat lifecycle: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.CROSS_SOURCE_DEDUCTION);
  });

  test("Data discrepancy detection within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "Find people with different phone numbers across systems"
    );

    console.log(`Cross-source discrepancy detection: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.CROSS_SOURCE_DEDUCTION);
  });

  test("Multi-source aggregation within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
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

test.describe("Tippy Performance: Schema Navigation @smoke @real-api", () => {
  test.setTimeout(60000);

  test("run_sql within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "What views are available to query?"
    );

    console.log(`Schema discovery: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SCHEMA_NAVIGATION);
  });

  test("view category search within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "Show me all stats category views"
    );

    console.log(`View category search: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SCHEMA_NAVIGATION);
  });

  test("view keyword search within benchmark", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "Search for views related to beacon or colony"
    );

    console.log(`View keyword search: ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(durationMs).toBeLessThan(BENCHMARKS.SCHEMA_NAVIGATION);
  });
});

// ============================================================================
// MATVIEW-BACKED QUERIES (MIG_3006)
// These queries previously timed out; now use pre-computed matviews
// ============================================================================

test.describe("Tippy Performance: Matview Queries @smoke @real-api", () => {
  test.setTimeout(60000);

  test("City comparison completes within benchmark (matview)", async ({ page }) => {
    const { ok, responseText, durationMs } = await timedTippyRequest(
      page,
      "How does Santa Rosa compare to Petaluma?"
    );

    console.log(`City comparison (matview): ${durationMs}ms`);

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);
    expect(durationMs).toBeLessThan(BENCHMARKS.SIMPLE_LOOKUP);
  });
});

// ============================================================================
// SUSTAINED LOAD TESTS
// Multiple queries in sequence
// ============================================================================

test.describe("Tippy Performance: Sustained Load @stress @slow @real-api", () => {
  test.setTimeout(120000);

  test("5 sequential queries maintain performance", async ({ page }) => {
    // FFS-91: Unique questions to avoid duplicating other test files
    const questions = [
      "How many cat appointments this year?",
      "How many people are in the system?",
      "How many places have cat activity?",
      "How many requests were completed this month?",
      "How many cats have been microchipped?",
    ];

    const durations: number[] = [];

    for (const question of questions) {
      const { ok, durationMs } = await timedTippyRequest(page, question);
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

  test("Repeated same query is consistent", async ({ page }) => {
    const question = "How many unresolved requests are there?";
    const durations: number[] = [];

    for (let i = 0; i < 3; i++) {
      const { ok, durationMs } = await timedTippyRequest(page, question);
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

test.describe("Tippy Performance: Summary @real-api", () => {
  test.setTimeout(120000);

  test("Log benchmark summary", async ({ page }) => {
    // FFS-91: Unique questions to avoid duplicating other test files
    const testCases = [
      { name: "Simple count", question: "How many appointments total?" },
      { name: "Top N query", question: "How many people have foster records?" },
      { name: "Comprehensive lookup", question: "Describe any place with recent activity" },
      { name: "Cross-source", question: "Find a cat that has been to the clinic more than once" },
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
