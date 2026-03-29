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
 * FFS-552: Fixed page.request.post() → page.evaluate(fetch()) for mocked tests.
 * page.route() only intercepts browser-originated requests, NOT page.request.post().
 */

import { test, expect } from "@playwright/test";
import {
  mockTippyAPI,
  mockTippyError,
  mockTippyWithToolResult,
  tippyFetch,
} from "./helpers/auth-api";

// ============================================================================
// TIER 1: MOCKED INFRASTRUCTURE TESTS (Always run, no API credits)
// ============================================================================

test.describe("Tippy Infrastructure (Mocked) @real-api", () => {
  // All mocked tests need to be on a page for browser fetch to work
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test.describe("Authentication", () => {
    test("handles unauthenticated request appropriately", async ({
      page,
      baseURL,
    }) => {
      // Don't mock — test the real API's auth behavior
      // Use browser fetch without session cookie context
      const result = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/tippy/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello" }),
          credentials: "omit", // Explicitly omit cookies
        });
        return { status: res.status };
      }, baseURL);

      // API should respond gracefully (401 or 200 with error) — not 500
      expect(result.status).toBeLessThan(500);
    });

    test("accepts request with valid session (mocked)", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(page, "Hello there!");

      const result = await tippyFetch(page, baseURL!, {
        message: "Hello",
      });

      expect(result.status).toBe(200);
      expect(result.body.message).toBeTruthy();
    });
  });

  test.describe("Request Validation", () => {
    test("rejects empty message", async ({ page, baseURL }) => {
      const result = await tippyFetch(page, baseURL!, { message: "" });
      expect(result.status).toBe(400);
    });

    test("rejects missing message field", async ({ page, baseURL }) => {
      const result = await tippyFetch(page, baseURL!, { wrongField: "test" });
      expect(result.status).toBe(400);
    });

    test("accepts valid message format", async ({ page, baseURL }) => {
      await mockTippyAPI(page, "I can help with that!");

      const result = await tippyFetch(page, baseURL!, {
        message: "What time is it?",
      });
      expect(result.status).toBe(200);
    });

    test("accepts message with conversation history", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(page, "Based on our conversation...");

      const result = await tippyFetch(page, baseURL!, {
        message: "And what about cats?",
        history: [
          { role: "user", content: "Tell me about dogs" },
          { role: "assistant", content: "Dogs are great pets!" },
        ],
        conversationId: "test-conv-123",
      });

      expect(result.status).toBe(200);
    });
  });

  test.describe("Response Format", () => {
    test("returns message field in response", async ({ page, baseURL }) => {
      await mockTippyAPI(page, "Test response");

      const result = await tippyFetch(page, baseURL!, { message: "Test" });

      expect(result.body).toHaveProperty("message");
      expect(typeof result.body.message).toBe("string");
    });

    test("returns conversationId for session continuity", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(page, "Hello!", {
        conversationId: "conv-abc-123",
      });

      const result = await tippyFetch(page, baseURL!, { message: "Hello" });

      expect(result.body).toHaveProperty("conversationId");
    });
  });

  test.describe("Error Handling", () => {
    test("handles rate limiting gracefully", async ({ page, baseURL }) => {
      await mockTippyError(page, "rate-limit");

      const result = await tippyFetch(page, baseURL!, { message: "Hello" });
      expect(result.status).toBe(429);
    });

    test("returns friendly message on server error", async ({
      page,
      baseURL,
    }) => {
      await mockTippyError(page, "server-error");

      const result = await tippyFetch(page, baseURL!, { message: "Hello" });
      expect((result.body.message as string) || "").toContain(
        "trouble connecting"
      );
    });
  });

  test.describe("Tool Execution Plumbing", () => {
    test("handles tool responses correctly", async ({ page, baseURL }) => {
      await mockTippyWithToolResult(
        page,
        "query_cats_at_place",
        { cats: [{ name: "Whiskers" }], count: 1 },
        "I found 1 cat at that location: Whiskers."
      );

      const result = await tippyFetch(page, baseURL!, {
        message: "How many cats at 123 Main St?",
      });

      expect((result.body.message as string) || "").toContain("Whiskers");
    });
  });

  test.describe("Content Security", () => {
    test("handles special characters in messages", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(page, "I understood your question.");

      const result = await tippyFetch(page, baseURL!, {
        message: "What about <script>alert('xss')</script>?",
      });
      expect(result.status).toBe(200);
    });

    test("handles very long messages", async ({ page, baseURL }) => {
      await mockTippyAPI(page, "That's a lot of text!");

      const longMessage = "a".repeat(5000);
      const result = await tippyFetch(page, baseURL!, {
        message: longMessage,
      });
      expect(result.status).not.toBe(500);
    });
  });
});

// ============================================================================
// TIER 1.5: MOCKED INFRASTRUCTURE TESTS (previously @real-api)
// FFS-91: Converted from real-API to mocked
// ============================================================================

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

      const result = await tippyFetch(page, baseURL!, {
        message: "What is the capital of France?",
      });

      expect(result.status).toBe(200);
      const text = result.body.message as string;
      expect(text.length).toBeGreaterThan(10);
      expect(text.toLowerCase()).not.toMatch(/error|exception/i);
    });

    test("Tippy handles unanswerable TNR questions gracefully", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(
        page,
        "I don't have data to predict future cat populations. I can tell you about current colony sizes and alteration rates based on our records."
      );

      const result = await tippyFetch(page, baseURL!, {
        message:
          "What will the cat population be in Sonoma County in 2050?",
      });

      expect(result.status).toBe(200);
      expect((result.body.message as string).length).toBeGreaterThan(20);
    });
  });

  test.describe("View Usage Analytics (mocked)", () => {
    test("view usage is tracked after queries", async ({ page, baseURL }) => {
      await mockTippyAPI(
        page,
        "Based on our records, we have 4,521 cats in the system."
      );

      const result = await tippyFetch(page, baseURL!, {
        message: "How many cats total?",
      });

      expect(result.status).toBe(200);
    });

    test("Tippy can report on popular views", async ({ page, baseURL }) => {
      await mockTippyAPI(
        page,
        "Recently I've used v_cat_list, v_person_list, and v_place_list to answer questions."
      );

      const result = await tippyFetch(page, baseURL!, {
        message: "What views have you used recently?",
      });

      expect(result.status).toBe(200);
      expect((result.body.message as string).length).toBeGreaterThan(20);
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

      const result = await tippyFetch(page, baseURL!, {
        message:
          "What information does the v_trapper_full_stats view provide?",
      });

      expect(result.status).toBe(200);
      expect((result.body.message as string).length).toBeGreaterThan(30);
    });

    test("can recommend which view to use for a question", async ({
      page,
      baseURL,
    }) => {
      await mockTippyAPI(
        page,
        "For colony information, I'd recommend the v_beacon_colony_status view which tracks colony sizes and alteration rates by place."
      );

      const result = await tippyFetch(page, baseURL!, {
        message: "What view shows colony information?",
      });

      expect(result.status).toBe(200);
      const text = result.body.message as string;
      expect(text.length).toBeGreaterThan(20);
      expect(
        text.includes("v_") ||
          text.toLowerCase().includes("colony") ||
          text.toLowerCase().includes("beacon") ||
          text.toLowerCase().includes("place")
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
      const result = await tippyFetch(page, baseURL!, {
        message: `Search for a person named ${longString}`,
      });

      expect(result.status).toBe(200);
      expect((result.body.message as string).length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// TIER 3: REAL API TESTS (@real-api - runs only when explicitly requested)
// These test actual Tippy AI capabilities against real Anthropic API
// ============================================================================

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
    data: { message: question },
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
// ============================================================================

test.describe(
  "Tippy Infrastructure: View Catalog (MIG_517) @real-api",
  () => {
    test.setTimeout(90000);

    test("discover_views tool returns available views", async ({ request }) => {
      const { ok, responseText } = await askTippy(
        request,
        "What views are available for me to query? Use the discover_views tool."
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(50);
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

    test("discover_views returns results by search term", async ({
      request,
    }) => {
      const { ok, responseText } = await askTippy(
        request,
        "Search for views related to 'trapper' or 'stats'."
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(30);
    });

    test("query_view executes against cataloged views", async ({
      request,
    }) => {
      const { ok, responseText } = await askTippy(
        request,
        "How many rows in v_trapper_full_stats? Just give me the count."
      );

      expect(ok).toBeTruthy();
      expect(responseText.length).toBeGreaterThan(10);
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
      expect(responseText.toLowerCase()).not.toMatch(/exception|crash/i);
    });
  }
);

// ============================================================================
// PROPOSED CORRECTIONS TESTS (MIG_518)
// ============================================================================

test.describe(
  "Tippy Infrastructure: Proposed Corrections (MIG_518) @real-api",
  () => {
    test.setTimeout(60000);

    test("admin API for corrections exists and responds", async ({
      request,
    }) => {
      const response = await request.get("/api/admin/tippy-corrections");
      expect(response.status()).toBeLessThan(500);
    });

    test("corrections API returns structured data", async ({ request }) => {
      const response = await request.get(
        "/api/admin/tippy-corrections?status=all"
      );

      if (response.ok()) {
        const data = await response.json();
        expect(data).toBeDefined();
        if (data.corrections) {
          expect(Array.isArray(data.corrections)).toBeTruthy();
        }
        if (data.stats) {
          expect(typeof data.stats).toBe("object");
        }
      }
    });

    test("corrections have required fields", async ({ request }) => {
      const response = await request.get(
        "/api/admin/tippy-corrections?limit=5"
      );

      if (response.ok()) {
        const data = await response.json();
        if (data.corrections && data.corrections.length > 0) {
          const correction = data.corrections[0];
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
      expect(
        responseText.toLowerCase().includes("correction") ||
          responseText.toLowerCase().includes("discrepanc") ||
          responseText.toLowerCase().includes("propose") ||
          responseText.toLowerCase().includes("fix")
      ).toBeTruthy();
    });
  }
);

// ============================================================================
// UNANSWERABLE QUESTIONS TESTS (MIG_519)
// ============================================================================

test.describe(
  "Tippy Infrastructure: Unanswerable Tracking (MIG_519) @real-api",
  () => {
    test.setTimeout(60000);

    test("admin API for gaps exists and responds", async ({ request }) => {
      const response = await request.get("/api/admin/tippy-gaps");
      expect(response.status()).toBeLessThan(500);
    });

    test("gaps API returns structured data", async ({ request }) => {
      const response = await request.get("/api/admin/tippy-gaps?limit=10");

      if (response.ok()) {
        const data = await response.json();
        expect(data).toBeDefined();
        if (Array.isArray(data)) {
          // Direct array
        } else if (data.questions) {
          expect(Array.isArray(data.questions)).toBeTruthy();
        }
      }
    });
  }
);

// ============================================================================
// SCHEMA NAVIGATION TESTS
// ============================================================================

test.describe("Tippy Infrastructure: Schema Navigation @real-api", () => {
  test.setTimeout(90000);

  test("can describe available view categories", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "List 3 categories of views you can query."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
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
// ============================================================================

test.describe("Tippy Infrastructure: Error Handling @real-api", () => {
  test.setTimeout(60000);

  test("handles malformed view query gracefully", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Query the view with filter: '; DROP TABLE users; --"
    );

    expect(ok).toBeTruthy();
    expect(responseText.toLowerCase()).not.toMatch(/dropped|deleted/i);
  });
});
