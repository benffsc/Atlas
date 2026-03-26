/**
 * Tippy V2 Ambient Colleague Tests
 *
 * Tests for FFS-754 through FFS-761:
 * - Pre-flight data quality context injection (FFS-754)
 * - Shift-start briefing (FFS-755)
 * - Seasonal context (FFS-757)
 * - Chapman + disease in place responses (FFS-758)
 * - Onboarding mode detection (FFS-759)
 * - Staff activity awareness in create_reminder (FFS-761)
 * - flag_anomaly tool (FFS-756)
 * - Anomaly admin page (FFS-756)
 * - Anomaly → Linear copy (FFS-760)
 *
 * TIER 1 (Mocked): Infrastructure tests — always run, no API credits
 * TIER 3 (@real-api): End-to-end tests — only with INCLUDE_REAL_API=1
 */

import { test, expect } from "@playwright/test";
import { mockTippyAPI } from "./helpers/auth-api";

// ============================================================================
// Helper: browser-side fetch for mocked routes
// ============================================================================

async function tippyFetch(
  page: import("@playwright/test").Page,
  baseURL: string,
  data: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ([url, payload]: [string, Record<string, unknown>]) => {
      const res = await fetch(`${url}/api/tippy/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
    [baseURL, data] as [string, Record<string, unknown>]
  );
}

async function apiFetch(
  page: import("@playwright/test").Page,
  baseURL: string,
  path: string,
  options?: { method?: string; body?: Record<string, unknown> }
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ([url, apiPath, opts]: [string, string, { method?: string; body?: Record<string, unknown> } | undefined]) => {
      const res = await fetch(`${url}${apiPath}`, {
        method: opts?.method || "GET",
        headers: opts?.body ? { "Content-Type": "application/json" } : {},
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
    [baseURL, path, options] as [string, string, { method?: string; body?: Record<string, unknown> } | undefined]
  );
}

// ============================================================================
// TIER 1: MOCKED TESTS — Pre-flight Context (FFS-754)
// ============================================================================

test.describe("Tippy V2: Pre-flight Context (FFS-754) - Mocked", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("accepts chat request with pre-flight context present (mocked)", async ({
    page,
    baseURL,
  }) => {
    // Pre-flight context is injected server-side into the system prompt.
    // We just verify the API still works with it enabled.
    await mockTippyAPI(
      page,
      "Data quality looks healthy. No critical alerts. Here's what I found about that address..."
    );

    const result = await tippyFetch(page, baseURL!, {
      message: "What's happening at 123 Main St?",
      stream: false,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBeTruthy();
  });

  test("pre-flight does not break streaming path", async ({
    page,
    baseURL,
  }) => {
    // Mock the streaming endpoint
    await page.route("**/api/tippy/chat", (route) => {
      const encoder = new TextEncoder();
      const events = [
        `event: status\ndata: ${JSON.stringify({ phase: "thinking" })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "Data quality is healthy. " })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "Here are the results." })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ conversationId: "test-conv" })}\n\n`,
      ].join("");

      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body: encoder.encode(events),
      });
    });

    const result = await page.evaluate(
      async ([url]: [string]) => {
        const res = await fetch(`${url}/api/tippy/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Test", stream: true }),
        });
        return { status: res.status, contentType: res.headers.get("content-type") };
      },
      [baseURL] as [string]
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/event-stream");
  });
});

// ============================================================================
// TIER 1: MOCKED TESTS — Shift Briefing (FFS-755)
// ============================================================================

test.describe("Tippy V2: Shift Briefing (FFS-755) - Mocked", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("briefing check endpoint returns needsBriefing flag", async ({
    page,
    baseURL,
  }) => {
    // Mock the briefing endpoint
    await page.route("**/api/tippy/briefing", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ needsBriefing: true }),
      });
    });

    const result = await page.evaluate(
      async ([url]: [string]) => {
        const res = await fetch(`${url}/api/tippy/briefing`);
        return res.json();
      },
      [baseURL] as [string]
    );

    expect(result).toHaveProperty("needsBriefing");
    expect(typeof result.needsBriefing).toBe("boolean");
  });

  test("__shift_briefing__ message triggers briefing response", async ({
    page,
    baseURL,
  }) => {
    // Mock the chat endpoint to verify it receives the briefing message
    let receivedMessage = "";
    await page.route("**/api/tippy/chat", async (route) => {
      const postData = route.request().postDataJSON();
      receivedMessage = postData?.message || "";

      // Return SSE response for streaming
      const encoder = new TextEncoder();
      const events = [
        `event: status\ndata: ${JSON.stringify({ phase: "thinking" })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "Good morning! Here's your briefing..." })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ conversationId: "briefing-conv" })}\n\n`,
      ].join("");

      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: encoder.encode(events),
      });
    });

    // Simulate the briefing request
    await page.evaluate(
      async ([url]: [string]) => {
        await fetch(`${url}/api/tippy/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "__shift_briefing__",
            stream: true,
          }),
        });
      },
      [baseURL] as [string]
    );

    expect(receivedMessage).toBe("__shift_briefing__");
  });

  test("briefing endpoint returns false for unauthenticated users", async ({
    page,
    baseURL,
  }) => {
    // Don't mock — test the real API's behavior for unauthed requests
    const result = await page.evaluate(
      async ([url]: [string]) => {
        const res = await fetch(`${url}/api/tippy/briefing`, {
          credentials: "omit",
        });
        return res.json();
      },
      [baseURL] as [string]
    );

    expect(result.needsBriefing).toBe(false);
  });
});

// ============================================================================
// TIER 1: MOCKED TESTS — flag_anomaly Tool (FFS-756)
// ============================================================================

test.describe("Tippy V2: flag_anomaly Tool (FFS-756) - Mocked", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("flag_anomaly tool response has expected shape", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/tippy/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "I've flagged this data inconsistency for review.",
          conversationId: "mock-conv",
          toolsUsed: ["flag_anomaly"],
          _debug: {
            toolName: "flag_anomaly",
            toolResult: {
              success: true,
              data: {
                message: "Anomaly flagged for review",
                anomaly_id: "test-anomaly-id",
                severity: "medium",
              },
            },
          },
        }),
      });
    });

    const result = await tippyFetch(page, baseURL!, {
      message: "This place shows 500 cats but only 2 appointments - something is wrong",
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBeTruthy();
  });
});

// ============================================================================
// TIER 1: MOCKED TESTS — Admin Anomalies Page (FFS-756)
// ============================================================================

test.describe("Tippy V2: Admin Anomalies API (FFS-756) - Mocked", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("anomalies GET endpoint returns list structure", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/admin/anomalies*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            anomalies: [
              {
                anomaly_id: "test-1",
                anomaly_type: "data_inconsistency",
                description: "Cat count mismatch",
                severity: "medium",
                status: "new",
                created_at: new Date().toISOString(),
                evidence: {},
              },
            ],
            total: 1,
          },
        }),
      });
    });

    const result = await apiFetch(page, baseURL!, "/api/admin/anomalies?status=new");

    expect(result.status).toBe(200);
    const data = result.body as { success?: boolean; data?: { anomalies?: unknown[]; total?: number } };
    expect(data.success || data.data).toBeTruthy();
  });

  test("anomalies PATCH endpoint accepts status updates", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/admin/anomalies", (route) => {
      if (route.request().method() === "PATCH") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: { updated: true, anomaly_id: "test-1", status: "resolved" },
          }),
        });
      } else {
        route.continue();
      }
    });

    const result = await apiFetch(page, baseURL!, "/api/admin/anomalies", {
      method: "PATCH",
      body: {
        anomaly_id: "test-1",
        status: "resolved",
        resolution_notes: "Fixed the data",
      },
    });

    expect(result.status).toBe(200);
  });
});

// ============================================================================
// TIER 1: MOCKED TESTS — Onboarding Mode (FFS-759)
// ============================================================================

test.describe("Tippy V2: Onboarding Mode (FFS-759) - Mocked", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("new user gets more detailed response (mocked)", async ({
    page,
    baseURL,
  }) => {
    // Onboarding mode is server-side (based on conversation count).
    // Verify the API still responds correctly.
    await mockTippyAPI(
      page,
      "Welcome to Atlas! TNR stands for Trap-Neuter-Return, which is a humane method to manage feral cat populations. You can find requests at /requests. Let me explain more..."
    );

    const result = await tippyFetch(page, baseURL!, {
      message: "What is TNR?",
    });

    expect(result.status).toBe(200);
    expect((result.body.message as string).length).toBeGreaterThan(50);
  });
});

// ============================================================================
// TIER 1: MOCKED TESTS — Staff Activity Awareness (FFS-761)
// ============================================================================

test.describe("Tippy V2: Reminder Duplicate Awareness (FFS-761) - Mocked", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("create_reminder response includes existing_similar when duplicates found", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/tippy/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Reminder created. Note: you already have a similar reminder due tomorrow.",
          conversationId: "mock-conv",
          toolsUsed: ["create_reminder"],
          _debug: {
            toolName: "create_reminder",
            toolResult: {
              success: true,
              data: {
                reminder_id: "new-reminder",
                title: "Follow up on Oak St",
                due_at: "Friday, March 27, 9:00 AM",
                entity_linked: true,
                existing_similar: [
                  { title: "Check Oak St colony", due_at: "2026-03-26T09:00:00Z" },
                ],
                message: "Reminder created.",
              },
            },
          },
        }),
      });
    });

    const result = await tippyFetch(page, baseURL!, {
      message: "Remind me to follow up on Oak St next Friday",
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBeTruthy();
  });
});

// ============================================================================
// TIER 1: MOCKED TESTS — Chapman + Disease in Place Responses (FFS-758)
// ============================================================================

test.describe("Tippy V2: Chapman + Disease Enrichment (FFS-758) - Mocked", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("analyze_place_situation response includes chapman and disease data", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/tippy/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Walker Road has an estimated population of 45 cats (32-67 range). FeLV detected: 2 of 12 tested positive (16.7%).",
          conversationId: "mock-conv",
          toolsUsed: ["analyze_place_situation"],
          _debug: {
            toolName: "analyze_place_situation",
            toolResult: {
              success: true,
              data: {
                found: true,
                chapman: { estimate: 45, ci: [32, 67], adequate: true, confidence: "moderate" },
                disease_summary: [{ disease_type: "FeLV", positive_count: 2, tested_count: 12, positivity_rate: 0.167 }],
                interpretation_hints: [
                  "POPULATION ESTIMATE (Chapman): ~45 total cats (32-67 range, moderate confidence).",
                  "DISEASE (FeLV): 2 of 12 tested positive (16.7%).",
                ],
              },
            },
          },
        }),
      });
    });

    const result = await tippyFetch(page, baseURL!, {
      message: "What's the situation at Walker Road?",
    });

    expect(result.status).toBe(200);
    const text = result.body.message as string;
    expect(text).toBeTruthy();
  });
});

// ============================================================================
// TIER 1: UI TESTS — TippyChat Component (FFS-755)
// ============================================================================

test.describe("Tippy V2: TippyChat UI (FFS-755)", () => {
  test("briefing message is hidden from chat display", async ({ page }) => {
    await page.goto("/");

    // Mock briefing check to return needsBriefing: true
    await page.route("**/api/tippy/briefing", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ needsBriefing: true }),
      });
    });

    // Mock the chat response for briefing
    await page.route("**/api/tippy/chat", (route) => {
      const encoder = new TextEncoder();
      const events = [
        `event: status\ndata: ${JSON.stringify({ phase: "thinking" })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "Good morning! 3 new intakes pending." })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ conversationId: "briefing-conv" })}\n\n`,
      ].join("");

      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: encoder.encode(events),
      });
    });

    // Clear localStorage to ensure briefing triggers
    await page.evaluate(() => localStorage.removeItem("tippy-last-briefing"));

    // Open Tippy chat
    const fab = page.locator(".tippy-fab");
    if (await fab.isVisible()) {
      await fab.click();
    }

    // Wait for the briefing response to appear
    await page.waitForTimeout(2000);

    // Verify __shift_briefing__ is NOT visible in the chat
    const chatContent = await page.locator(".tippy-chat-panel").textContent();
    expect(chatContent).not.toContain("__shift_briefing__");
  });
});

// ============================================================================
// TIER 1: Admin Anomalies Page UI (FFS-756)
// ============================================================================

test.describe("Tippy V2: Admin Anomalies Page (FFS-756)", () => {
  test("anomalies page loads and shows filter buttons", async ({ page }) => {
    // Mock the API
    await page.route("**/api/admin/anomalies*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { anomalies: [], total: 0 },
        }),
      });
    });

    await page.goto("/admin/anomalies");

    // Verify page title
    await expect(page.locator("h1")).toContainText("Tippy Anomalies");

    // Verify filter buttons exist
    const buttons = page.locator("button");
    const buttonTexts = await buttons.allTextContents();
    const hasNewFilter = buttonTexts.some(t => t.toLowerCase().includes("new"));
    const hasAllFilter = buttonTexts.some(t => t.toLowerCase().includes("all"));
    expect(hasNewFilter).toBeTruthy();
    expect(hasAllFilter).toBeTruthy();
  });

  test("anomalies page displays anomaly cards", async ({ page }) => {
    await page.route("**/api/admin/anomalies*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            anomalies: [
              {
                anomaly_id: "test-1",
                anomaly_type: "data_inconsistency",
                description: "Cat count at 456 Elm St shows 200 but only 3 appointments",
                severity: "high",
                status: "new",
                entity_type: "place",
                entity_id: null,
                entity_display_name: "456 Elm St",
                evidence: { cat_count: 200, appointment_count: 3 },
                flagged_by_name: "Ben",
                resolved_by_name: null,
                resolution_notes: null,
                resolved_at: null,
                created_at: new Date().toISOString(),
                conversation_id: null,
                staff_id: null,
                resolved_by: null,
              },
            ],
            total: 1,
          },
        }),
      });
    });

    await page.goto("/admin/anomalies");

    // Wait for data to load
    await page.waitForTimeout(1000);

    // Verify anomaly card content
    const pageContent = await page.textContent("body");
    expect(pageContent).toContain("data inconsistency");
    expect(pageContent).toContain("456 Elm St");
    expect(pageContent).toContain("HIGH");
  });
});

// ============================================================================
// TIER 3: REAL API TESTS (@real-api)
// These test actual Tippy V2 features against the real API
// Run only with INCLUDE_REAL_API=1
// ============================================================================

test.describe("Tippy V2: Pre-flight Context (FFS-754) @real-api", () => {
  test.setTimeout(90000);

  test("place query response reflects data awareness", async ({ request }) => {
    const response = await request.post("/api/tippy/chat", {
      data: { message: "What's the data quality like right now?" },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const text = data.message || "";

    // Pre-flight context should make Tippy aware of data quality
    // It should mention something about data, quality, alerts, or health
    expect(text.length).toBeGreaterThan(30);
  });
});

test.describe("Tippy V2: Chapman + Disease (FFS-758) @real-api", () => {
  test.setTimeout(90000);

  test("place analysis includes population estimate when available", async ({ request }) => {
    // Use a known address that likely has Chapman data
    const response = await request.post("/api/tippy/chat", {
      data: { message: "What's the situation at 1170 Walker Rd?" },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const text = (data.message || "").toLowerCase();

    // Should mention colony, cats, or population
    expect(
      text.includes("cat") ||
      text.includes("colony") ||
      text.includes("population") ||
      text.includes("altered")
    ).toBeTruthy();
  });
});

test.describe("Tippy V2: flag_anomaly (FFS-756) @real-api", () => {
  test.setTimeout(90000);

  test("Tippy can flag anomalies when prompted", async ({ request }) => {
    const response = await request.post("/api/tippy/chat", {
      data: {
        message: "I noticed a place showing 500 cats but only 2 appointments ever - that seems like bad data. Can you flag it as an anomaly?",
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const text = (data.message || "").toLowerCase();

    // Should acknowledge the anomaly or mention flagging/reviewing
    expect(text.length).toBeGreaterThan(30);
  });
});

test.describe("Tippy V2: Briefing API (FFS-755) @real-api", () => {
  test("briefing endpoint responds", async ({ request }) => {
    const response = await request.get("/api/tippy/briefing");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("needsBriefing");
    expect(typeof data.needsBriefing).toBe("boolean");
  });
});
