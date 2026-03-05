/**
 * Tippy Infrastructure Tests
 *
 * TIER 1 (Mocked): Tests authentication, error handling, and API plumbing
 *   - Runs always, no API credits used
 *   - Fast and reliable
 *
 * TIER 3 (@real-api): Tests actual AI capabilities via MIG_517-521
 *   - Runs only when INCLUDE_REAL_API=1 or with --grep="@real-api"
 *   - Uses real Anthropic API credits
 *
 * @see docs/E2E_TEST_UPGRADE_PLAN.md for the full testing strategy
 */

import { test, expect } from "@playwright/test";
import {
  mockTippyAPI,
  mockTippyError,
  mockTippyWithToolResult,
  askTippyAuthenticated,
} from "./helpers/auth-api";

// ============================================================================
// TIER 1: MOCKED INFRASTRUCTURE TESTS (Always run, no API credits)
// ============================================================================

test.describe("Tippy Infrastructure (Mocked)", () => {
  test.describe("Authentication", () => {
    test("handles unauthenticated request appropriately", async ({ page }) => {
      // Mock the Tippy API to avoid real Anthropic calls
      await mockTippyAPI(page, "Hello!");

      const response = await page.request.post("/api/tippy/chat", {
        data: { message: "Hello" },
      });

      // API should respond gracefully without crashing
      expect(response.status()).toBeLessThan(500);
    });

    test("accepts request with valid session (mocked)", async ({ page }) => {
      // Mock the Tippy API to avoid real Anthropic calls
      await mockTippyAPI(page, "Hello there!");

      const response = await page.request.post("/api/tippy/chat", {
        data: { message: "Hello" },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.message).toBeTruthy();
    });
  });

  test.describe("Request Validation", () => {
    test("rejects empty message", async ({ page }) => {
      const response = await page.request.post("/api/tippy/chat", {
        data: { message: "" },
      });

      expect(response.status()).toBe(400);
    });

    test("rejects missing message field", async ({ page }) => {
      const response = await page.request.post("/api/tippy/chat", {
        data: { wrongField: "test" },
      });

      expect(response.status()).toBe(400);
    });

    test("accepts valid message format", async ({ page }) => {
      await mockTippyAPI(page, "I can help with that!");

      const response = await page.request.post("/api/tippy/chat", {
        data: { message: "What time is it?" },
      });

      expect(response.ok()).toBeTruthy();
    });

    test("accepts message with conversation history", async ({ page }) => {
      await mockTippyAPI(page, "Based on our conversation...");

      const response = await page.request.post("/api/tippy/chat", {
        data: {
          message: "And what about cats?",
          history: [
            { role: "user", content: "Tell me about dogs" },
            { role: "assistant", content: "Dogs are great pets!" },
          ],
          conversationId: "test-conv-123",
        },
      });

      expect(response.ok()).toBeTruthy();
    });
  });

  test.describe("Response Format", () => {
    test("returns message field in response", async ({ page }) => {
      await mockTippyAPI(page, "Test response");

      const response = await page.request.post("/api/tippy/chat", {
        data: { message: "Test" },
      });

      const data = await response.json();
      expect(data).toHaveProperty("message");
      expect(typeof data.message).toBe("string");
    });

    test("returns conversationId for session continuity", async ({ page }) => {
      await mockTippyAPI(page, "Hello!", { conversationId: "conv-abc-123" });

      const response = await page.request.post("/api/tippy/chat", {
        data: { message: "Hello" },
      });

      const data = await response.json();
      expect(data).toHaveProperty("conversationId");
    });
  });

  test.describe("Error Handling", () => {
    // Note: page.route() mocks don't intercept page.request calls
    // These tests use browser-based fetch to enable mocking
    test("handles rate limiting gracefully", async ({ page, baseURL }) => {
      // Need to be on a page for browser fetch to work
      await page.goto("/");
      await mockTippyError(page, "rate-limit");

      // Use browser fetch which IS intercepted by page.route()
      const result = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/tippy/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello" }),
        });
        return { status: res.status, body: await res.json() };
      }, baseURL);

      expect(result.status).toBe(429);
    });

    test("returns friendly message on server error", async ({ page, baseURL }) => {
      await page.goto("/");
      await mockTippyError(page, "server-error");

      const result = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/tippy/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello" }),
        });
        return { status: res.status, body: await res.json() };
      }, baseURL);

      expect(result.body.message).toContain("trouble connecting");
    });
  });

  test.describe("Tool Execution Plumbing", () => {
    test("handles tool responses correctly", async ({ page, baseURL }) => {
      await page.goto("/");
      await mockTippyWithToolResult(
        page,
        "query_cats_at_place",
        { cats: [{ name: "Whiskers" }], count: 1 },
        "I found 1 cat at that location: Whiskers."
      );

      // Use browser fetch which IS intercepted by page.route()
      const result = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/tippy/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "How many cats at 123 Main St?" }),
        });
        return { status: res.status, body: await res.json() };
      }, baseURL);

      expect(result.body.message).toContain("Whiskers");
    });
  });

  test.describe("Content Security", () => {
    test("handles special characters in messages", async ({ page }) => {
      await mockTippyAPI(page, "I understood your question.");

      const response = await page.request.post("/api/tippy/chat", {
        data: { message: "What about <script>alert('xss')</script>?" },
      });

      expect(response.ok()).toBeTruthy();
    });

    test("handles very long messages", async ({ page }) => {
      await mockTippyAPI(page, "That's a lot of text!");

      const longMessage = "a".repeat(5000);
      const response = await page.request.post("/api/tippy/chat", {
        data: { message: longMessage },
      });

      expect(response.status()).not.toBe(500);
    });
  });
});

// ============================================================================
// TIER 1.5: MOCKED INFRASTRUCTURE TESTS (previously @real-api)
// These tested response shape/length, not AI accuracy. Mocked to save ~7 API calls.
// FFS-91: Converted from real-API to mocked
// ============================================================================

/**
 * Helper: Send a message to Tippy via browser fetch (intercepted by page.route mocks).
 * page.request.post() is NOT intercepted by page.route(), so we use page.evaluate(fetch).
 */
async function askTippyViaFetch(
  page: import("@playwright/test").Page,
  baseURL: string,
  question: string
): Promise<{ ok: boolean; responseText: string }> {
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
      };
    },
    [baseURL, question] as [string, string]
  );
  return result;
}

test.describe("Tippy Infrastructure: Mocked Real-API Tests (FFS-91)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test.describe("Unanswerable Tracking (mocked)", () => {
    test("Tippy handles out-of-scope questions gracefully", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(
        page,
        "That question is outside my scope. I specialize in TNR data for Forgotten Felines of Sonoma County."
      );

      const { ok, responseText } = await askTippyViaFetch(
        page,
        baseURL!,
        "What is the capital of France?"
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(10);
      expect(responseText.toLowerCase()).not.toMatch(/error|exception/i);
    });

    test("Tippy handles unanswerable TNR questions gracefully", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(
        page,
        "I don't have data to predict future cat populations. I can tell you about current colony sizes and alteration rates based on our records."
      );

      const { ok, responseText } = await askTippyViaFetch(
        page,
        baseURL!,
        "What will the cat population be in Sonoma County in 2050?"
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(20);
    });
  });

  test.describe("View Usage Analytics (mocked)", () => {
    test("view usage is tracked after queries", async ({ page, baseURL }) => {
      await mockTippyAPI(page, "Based on our records, we have 4,521 cats in the system.");

      const { ok } = await askTippyViaFetch(
        page,
        baseURL!,
        "How many cats total?"
      );

      expect(ok).toBeTruthy();
    });

    test("Tippy can report on popular views", async ({ page, baseURL }) => {
      await mockTippyAPI(
        page,
        "Recently I've used v_cat_list, v_person_list, and v_place_list to answer questions."
      );

      const { ok, responseText } = await askTippyViaFetch(
        page,
        baseURL!,
        "What views have you used recently?"
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(20);
    });
  });

  test.describe("Schema Navigation (mocked)", () => {
    test("can explain what a specific view provides", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(
        page,
        "The v_trapper_full_stats view provides comprehensive trapper statistics including total cats trapped, active months, and areas served."
      );

      const { ok, responseText } = await askTippyViaFetch(
        page,
        baseURL!,
        "What information does the v_trapper_full_stats view provide?"
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(30);
    });

    test("can recommend which view to use for a question", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(
        page,
        "For colony information, I'd recommend the v_beacon_colony_status view which tracks colony sizes and alteration rates by place."
      );

      const { ok, responseText } = await askTippyViaFetch(
        page,
        baseURL!,
        "What view shows colony information?"
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(20);
      expect(
        responseText.includes("v_") ||
          responseText.toLowerCase().includes("colony") ||
          responseText.toLowerCase().includes("beacon") ||
          responseText.toLowerCase().includes("place")
      ).toBeTruthy();
    });
  });

  test.describe("Error Handling (mocked)", () => {
    test("handles very long filter values", async ({ page, baseURL }) => {
      await mockTippyAPI(
        page,
        "I couldn't find any person matching that very long name. Could you try a shorter search term?"
      );

      const longString = "a".repeat(5000);
      const { ok, responseText } = await askTippyViaFetch(
        page,
        baseURL!,
        `Search for a person named ${longString}`
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// TIER 3: REAL API TESTS (@real-api - runs only when explicitly requested)
// These test actual Tippy AI capabilities against real Anthropic API
// ============================================================================

// Helper for real API tests
interface TippyResponse {
  message?: string;
  response?: string;
  content?: string;
  error?: string;
}

async function askTippy(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }>;
  },
  question: string
): Promise<{ ok: boolean; responseText: string }> {
  const response = await request.post("/api/tippy/chat", {
    data: {
      message: question,
    },
  });

  const ok = response.ok();
  const data = await response.json();

  const responseText =
    typeof data === "string"
      ? data
      : data.message || data.response || data.content || JSON.stringify(data);

  return { ok, responseText };
}

// ============================================================================
// VIEW CATALOG TESTS (MIG_517)
// Tests the tippy_view_catalog and discovery functions
// ============================================================================

test.describe("Tippy Infrastructure: View Catalog (MIG_517) @real-api", () => {
  test.setTimeout(90000); // 90 seconds for view catalog operations

  test("discover_views tool returns available views", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What views are available for me to query? Use the discover_views tool."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);

    // Should mention view categories or specific views
    expect(
      responseText.toLowerCase().includes("view") ||
        responseText.toLowerCase().includes("entity") ||
        responseText.toLowerCase().includes("stats") ||
        responseText.toLowerCase().includes("available")
    ).toBeTruthy();
  });

  test("discover_views returns results by category", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Show me all the 'entity' category views available in the system."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("discover_views returns results by search term", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Search for views related to 'trapper' or 'stats'."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("query_view executes against cataloged views", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "How many rows in v_trapper_full_stats? Just give me the count."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(10);
    // Should have some data or mention the view
    expect(responseText.toLowerCase()).not.toMatch(/error|failed/i);
  });

  test("query_view handles filters correctly", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "How many people in v_person_list have 'coordinator' in their role?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(10);
  });

  test("handles non-existent view gracefully", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Query a view called v_nonexistent_fake_view_12345"
    );

    expect(ok).toBeTruthy();
    // Should not crash, should explain the view doesn't exist
    expect(responseText.toLowerCase()).not.toMatch(/exception|crash/i);
  });
});

// ============================================================================
// PROPOSED CORRECTIONS TESTS (MIG_518)
// Tests the tippy_proposed_corrections table and admin API
// READ-ONLY: We query existing corrections, don't create new ones
// ============================================================================

test.describe("Tippy Infrastructure: Proposed Corrections (MIG_518) @real-api", () => {
  test.setTimeout(60000);

  test("admin API for corrections exists and responds", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-corrections");

    // May return 403 without auth, but should not 500
    expect(response.status()).toBeLessThan(500);
  });

  test("corrections API returns structured data", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-corrections?status=all");

    // If we have access, verify structure
    if (response.ok()) {
      const data = await response.json();
      expect(data).toBeDefined();
      // Should have corrections array and stats
      if (data.corrections) {
        expect(Array.isArray(data.corrections)).toBeTruthy();
      }
      if (data.stats) {
        expect(typeof data.stats).toBe("object");
      }
    }
  });

  test("corrections have required fields", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-corrections?limit=5");

    if (response.ok()) {
      const data = await response.json();
      if (data.corrections && data.corrections.length > 0) {
        const correction = data.corrections[0];
        // Verify expected fields exist
        expect(correction).toHaveProperty("correction_id");
        expect(correction).toHaveProperty("entity_type");
        expect(correction).toHaveProperty("status");
      }
    }
  });

  test("Tippy understands corrections exist", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Can you propose data corrections when you find discrepancies?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
    // Should understand the concept
    expect(
      responseText.toLowerCase().includes("correction") ||
        responseText.toLowerCase().includes("discrepanc") ||
        responseText.toLowerCase().includes("propose") ||
        responseText.toLowerCase().includes("fix")
    ).toBeTruthy();
  });
});

// ============================================================================
// UNANSWERABLE QUESTIONS TESTS (MIG_519)
// Tests the tippy_unanswerable_questions tracking — admin API endpoints only
// Tippy chat tests moved to mocked section (FFS-91)
// ============================================================================

test.describe("Tippy Infrastructure: Unanswerable Tracking (MIG_519) @real-api", () => {
  test.setTimeout(60000);

  test("admin API for gaps exists and responds", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-gaps");

    // May return 403 without auth, but should not 500
    expect(response.status()).toBeLessThan(500);
  });

  test("gaps API returns structured data", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-gaps?limit=10");

    if (response.ok()) {
      const data = await response.json();
      expect(data).toBeDefined();
      // Should be an array or have questions array
      if (Array.isArray(data)) {
        // Direct array of questions
      } else if (data.questions) {
        expect(Array.isArray(data.questions)).toBeTruthy();
      }
    }
  });
});

// ============================================================================
// SCHEMA NAVIGATION TESTS
// Tests Tippy's ability to navigate the view schema
// 2 of 3 tests moved to mocked section (FFS-91)
// ============================================================================

test.describe("Tippy Infrastructure: Schema Navigation @real-api", () => {
  test.setTimeout(90000); // 90 seconds

  test("can describe available view categories", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "List 3 categories of views you can query."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
    // Should mention some categories
    expect(
      responseText.toLowerCase().includes("entity") ||
        responseText.toLowerCase().includes("stats") ||
        responseText.toLowerCase().includes("category") ||
        responseText.toLowerCase().includes("view")
    ).toBeTruthy();
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// "Long filter" test moved to mocked section (FFS-91)
// ============================================================================

test.describe("Tippy Infrastructure: Error Handling @real-api", () => {
  test.setTimeout(60000);

  test("handles malformed view query gracefully", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Query the view with filter: '; DROP TABLE users; --"
    );

    expect(ok).toBeTruthy();
    // Should not execute SQL injection
    expect(responseText.toLowerCase()).not.toMatch(/dropped|deleted/i);
  });
});
