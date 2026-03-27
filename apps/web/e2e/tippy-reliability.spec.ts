// @real-api - This test file calls the real Anthropic API via SSE streaming
/**
 * Tippy Reliability Tests
 *
 * Tests the ACTUAL streaming path (stream: true / SSE) that the production
 * widget uses. Previous tests used the non-streaming JSON path which has
 * completely different timing characteristics.
 *
 * These tests validate that the curated demo questions:
 * 1. Complete within the Vercel time budget (90s max)
 * 2. Return non-empty, substantive responses
 * 3. Don't hit timeout or error conditions
 *
 * Run: INCLUDE_REAL_API=1 npx playwright test tippy-reliability
 */

import { test, expect } from "@playwright/test";
import { Page } from "@playwright/test";

// Hard budget: Vercel maxDuration=120s, internal budget=110s, our test=90s
const RELIABILITY_TIMEOUT_MS = 90_000;

// Curated questions that MUST work for demos/board meetings
const CURATED_QUESTIONS = [
  "What do we know about Pozzan Road in Healdsburg?",
  "Tell me about 175 Scenic Avenue in Santa Rosa",
  "What happened at the Silveira Ranch?",
  "How does Santa Rosa compare to Petaluma?",
  "What do we know about the Roseland area - zip code 95407?",
  "Where should we focus trapping resources next month?",
  "Tell me about TNR activity in West County",
  "What's happening in the Russian River area?",
  "Which areas might have cats but little data?",
];

/**
 * Send a streaming request to Tippy and collect the full SSE response.
 * This mirrors exactly what TippyChat.tsx does in production.
 */
async function askTippyStreaming(
  page: Page,
  question: string
): Promise<{ content: string; durationMs: number; toolsUsed: string[]; error: string | null }> {
  const startTime = Date.now();

  const response = await page.request.post("/api/tippy/chat", {
    data: {
      message: question,
      stream: true,
    },
  });

  const body = await response.text();
  const durationMs = Date.now() - startTime;

  // Parse SSE events (same as TippyChat.tsx parseSSE)
  let content = "";
  const toolsUsed: string[] = [];
  let error: string | null = null;

  const parts = body.split("\n\n");
  for (const part of parts) {
    if (!part.trim()) continue;
    let eventType = "message";
    let dataStr = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        dataStr = line.slice(6);
      }
    }
    if (!dataStr) continue;

    try {
      const data = JSON.parse(dataStr);
      if (eventType === "delta" && data.text) {
        content += data.text;
      } else if (eventType === "status" && data.phase === "tool_call" && data.tool) {
        toolsUsed.push(data.tool);
      } else if (eventType === "error") {
        error = data.message || "Unknown error";
      }
    } catch {
      // Skip malformed events
    }
  }

  return { content, durationMs, toolsUsed, error };
}

// ============================================================================
// RELIABILITY TESTS — Curated Questions (Streaming Path)
// ============================================================================

test.describe("Tippy Reliability: Curated Demo Questions @real-api", () => {
  // Each test gets the full budget — these are sequential, not parallel
  test.setTimeout(RELIABILITY_TIMEOUT_MS + 10_000); // extra 10s for setup

  for (const question of CURATED_QUESTIONS) {
    test(`"${question.slice(0, 50)}..." completes with content`, async ({ page }) => {
      const { content, durationMs, toolsUsed, error } = await askTippyStreaming(page, question);

      console.log(`[Reliability] "${question.slice(0, 40)}..." → ${durationMs}ms, ${content.length} chars, tools: [${toolsUsed.join(", ")}]`);

      // MUST NOT have an error
      expect(error, `Tippy returned error: ${error}`).toBeNull();

      // MUST have substantive content (not empty, not just "I'm not sure")
      expect(content.length, "Response was empty").toBeGreaterThan(50);
      expect(content).not.toContain("I'm not sure how to help");
      expect(content).not.toContain("needed more research than I could finish");
      expect(content).not.toContain("having trouble connecting");

      // MUST complete within time budget
      expect(durationMs, `Took ${durationMs}ms (budget: ${RELIABILITY_TIMEOUT_MS}ms)`).toBeLessThan(RELIABILITY_TIMEOUT_MS);

      // SHOULD have used at least one tool (these are data questions)
      expect(toolsUsed.length, "No tools were used — Tippy may not be querying the database").toBeGreaterThan(0);
    });
  }
});

// ============================================================================
// RELIABILITY TESTS — Temporal Queries
// ============================================================================

test.describe("Tippy Reliability: Temporal Queries @real-api", () => {
  test.setTimeout(RELIABILITY_TIMEOUT_MS + 10_000);

  const TEMPORAL_QUESTIONS = [
    "How many cats were altered this week?",
    "How many cats were altered this month?",
    "What's our FFR impact this year?",
  ];

  for (const question of TEMPORAL_QUESTIONS) {
    test(`"${question}" completes with content`, async ({ page }) => {
      const { content, durationMs, toolsUsed, error } = await askTippyStreaming(page, question);

      console.log(`[Reliability] "${question}" → ${durationMs}ms, ${content.length} chars, tools: [${toolsUsed.join(", ")}]`);

      expect(error, `Tippy returned error: ${error}`).toBeNull();
      expect(content.length, "Response was empty").toBeGreaterThan(20);
      expect(content).not.toContain("I'm not sure how to help");
      expect(content).not.toContain("needed more research than I could finish");
      expect(durationMs).toBeLessThan(RELIABILITY_TIMEOUT_MS);
    });
  }
});

// ============================================================================
// RELIABILITY TESTS — Latency Budget
// ============================================================================

test.describe("Tippy Reliability: Latency Budget @real-api", () => {
  test.setTimeout(RELIABILITY_TIMEOUT_MS + 10_000);

  test("Simple question completes under 60 seconds", async ({ page }) => {
    const { content, durationMs, error } = await askTippyStreaming(
      page,
      "How many active requests do we have?"
    );

    console.log(`[Reliability] Simple question: ${durationMs}ms`);

    expect(error).toBeNull();
    expect(content.length).toBeGreaterThan(10);
    // Simple queries should be fast — 60s not 90s
    expect(durationMs, `Simple query took ${durationMs}ms — too slow`).toBeLessThan(60_000);
  });

  test("Two back-to-back questions both complete (prompt caching)", async ({ page }) => {
    // First question primes the prompt cache
    const first = await askTippyStreaming(page, "How many cats are in our system?");
    expect(first.error).toBeNull();
    expect(first.content.length).toBeGreaterThan(10);

    // Second question should benefit from cached system prompt
    const second = await askTippyStreaming(page, "How many places have colonies?");
    expect(second.error).toBeNull();
    expect(second.content.length).toBeGreaterThan(10);

    console.log(`[Reliability] Back-to-back: first=${first.durationMs}ms, second=${second.durationMs}ms`);

    // Second should be noticeably faster if caching works
    // (not a hard requirement — just log for visibility)
    if (second.durationMs < first.durationMs) {
      console.log(`[Reliability] Prompt caching appears active: ${first.durationMs - second.durationMs}ms saved`);
    }
  });
});
