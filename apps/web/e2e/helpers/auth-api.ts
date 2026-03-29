/**
 * Authenticated API Test Helpers
 *
 * The standalone `request` fixture in Playwright doesn't automatically include
 * auth cookies. These helpers use `page.request` which shares the page's auth
 * context (cookies + localStorage) from the auth setup.
 */

import { Page } from "@playwright/test";

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface TippyResponse {
  message: string;
  conversationId?: string;
  response?: string;
  content?: string;
  toolCalls?: any[];
  error?: string;
}

export interface TippyStreamingResult {
  content: string;
  durationMs: number;
  toolsUsed: string[];
  error: string | null;
}

export interface TippyTimedResult {
  ok: boolean;
  responseText: string;
  durationMs: number;
}

/**
 * Send a message to Tippy using authenticated page context.
 *
 * This uses page.request which automatically includes the session cookie
 * from the auth setup (e2e/.auth/user.json).
 */
export async function askTippyAuthenticated(
  page: Page,
  question: string,
  conversationId?: string,
  history?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<TippyResponse> {
  const response = await page.request.post("/api/tippy/chat", {
    data: {
      message: question,
      ...(conversationId && { conversationId }),
      ...(history && { history }),
    },
  });

  if (!response.ok()) {
    const text = await response.text();
    console.error("Tippy API error:", response.status(), text);
    return { message: `ERROR: ${response.status()} - ${text}` };
  }

  return response.json();
}

/**
 * Make an authenticated API GET request using the page context.
 */
export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  if (!response.ok()) {
    throw new Error(`API GET ${path} failed: ${response.status()}`);
  }
  return response.json();
}

/**
 * Make an authenticated API POST request using the page context.
 */
export async function apiPost<T>(
  page: Page,
  path: string,
  data: unknown
): Promise<T> {
  const response = await page.request.post(path, { data });
  if (!response.ok()) {
    throw new Error(`API POST ${path} failed: ${response.status()}`);
  }
  return response.json();
}

// ============================================================================
// TIPPY MOCK HELPERS
// Use these to test Tippy infrastructure without burning API credits
// ============================================================================

/**
 * Mock the Tippy chat API to return a canned response.
 * Use this for infrastructure tests (auth, error handling, routing).
 *
 * @param page - Playwright page
 * @param response - Custom response message (optional)
 * @param options - Additional mock options
 */
export async function mockTippyAPI(
  page: Page,
  response?: string,
  options?: {
    conversationId?: string;
    status?: number;
    error?: string;
  }
): Promise<void> {
  await page.route("**/api/tippy/chat", (route) => {
    const status = options?.status ?? 200;

    if (options?.error) {
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: options.error }),
      });
    } else {
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          message: response ?? "This is a mocked Tippy response for testing infrastructure.",
          conversationId: options?.conversationId ?? `mock-conv-${Date.now()}`,
        }),
      });
    }
  });
}

/**
 * Mock Tippy to simulate various error conditions.
 */
export async function mockTippyError(
  page: Page,
  errorType: "auth" | "rate-limit" | "server-error" | "timeout"
): Promise<void> {
  await page.route("**/api/tippy/chat", (route) => {
    switch (errorType) {
      case "auth":
        route.fulfill({
          status: 200, // Tippy returns 200 with error message for auth issues
          contentType: "application/json",
          body: JSON.stringify({
            message: "I'm sorry, but your account doesn't have access to Tippy.",
          }),
        });
        break;
      case "rate-limit":
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: "Rate limit exceeded" }),
        });
        break;
      case "server-error":
        route.fulfill({
          status: 200, // Tippy catches errors and returns 200 with error message
          contentType: "application/json",
          body: JSON.stringify({
            message: "I'm having trouble connecting right now.",
          }),
        });
        break;
      case "timeout":
        // Delay then abort to simulate timeout
        route.abort("timedout");
        break;
    }
  });
}

/**
 * Mock Tippy with a tool call response (simulates AI using a tool).
 */
export async function mockTippyWithToolResult(
  page: Page,
  toolName: string,
  toolResult: unknown,
  finalMessage: string
): Promise<void> {
  await page.route("**/api/tippy/chat", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: finalMessage,
        conversationId: `mock-conv-${Date.now()}`,
        toolsUsed: [toolName],
        // Include tool result for tests that need to verify tool execution
        _debug: { toolName, toolResult },
      }),
    });
  });
}

// ============================================================================
// CONSOLIDATED TIPPY HELPERS
// These replace duplicate helpers across multiple spec files.
// ============================================================================

/**
 * Send a question to Tippy via page.request.post (authenticated, non-streaming).
 * Use this for @real-api tests that need authenticated access.
 */
export async function askTippy(
  page: Page,
  question: string,
  conversationId?: string,
  history?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<TippyResponse & { ok: boolean }> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await page.request.post("/api/tippy/chat", {
      data: {
        message: question,
        ...(conversationId && { conversationId }),
        ...(history && { history }),
      },
    });

    const ok = response.ok();

    if (!ok) {
      const text = await response.text();
      // Retry on 429 rate limit
      if (response.status() === 429 && attempt < maxRetries) {
        const backoffMs = Math.min(10_000 * 2 ** attempt, 30_000) + Math.random() * 2_000;
        console.log(`[askTippy] 429 rate limited, retrying in ${(backoffMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      return { ok, message: `API Error: ${response.status()} - ${text}` };
    }

    const data = await response.json();

    // Tippy returns 200 with rate limit message in the body (Anthropic 429 caught server-side)
    if (data.message?.includes("lot of questions") && attempt < maxRetries) {
      const backoffMs = Math.min(10_000 * 2 ** attempt, 30_000) + Math.random() * 2_000;
      console.log(`[askTippy] Rate limited, retrying in ${(backoffMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    return {
      ok,
      message: data.message || "",
      conversationId: data.conversationId,
      response: data.response,
      content: data.content,
      toolCalls: data.toolCalls,
    };
  }

  return { ok: false, message: "Max retries exceeded due to rate limiting" };
}

/**
 * Send a streaming request to Tippy and collect the full SSE response.
 * This mirrors exactly what TippyChat.tsx does in production.
 */
export async function askTippyStreaming(
  page: Page,
  question: string,
  { maxRetries = 2 }: { maxRetries?: number } = {}
): Promise<TippyStreamingResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await _doStreamingRequest(page, question);

    // Retry on rate limit (matches Anthropic's retry-after pattern)
    if (result.error?.includes("lot of questions") && attempt < maxRetries) {
      const backoffMs = Math.min(10_000 * 2 ** attempt, 30_000) + Math.random() * 2_000;
      console.log(`[askTippyStreaming] Rate limited, retrying in ${(backoffMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    return result;
  }

  // Unreachable, but TypeScript needs it
  return { content: "", durationMs: 0, toolsUsed: [], error: "Max retries exceeded" };
}

async function _doStreamingRequest(
  page: Page,
  question: string
): Promise<TippyStreamingResult> {
  const startTime = Date.now();

  const response = await page.request.post("/api/tippy/chat", {
    data: {
      message: question,
      stream: true,
    },
  });

  const body = await response.text();
  const durationMs = Date.now() - startTime;

  let content = "";
  const toolsUsed: string[] = [];
  let error: string | null = null;

  // Handle non-streaming JSON fallback (when API returns JSON instead of SSE)
  if (body.startsWith("{")) {
    try {
      const json = JSON.parse(body);
      const payload = json?.success === true && "data" in json ? json.data : json;
      content = payload?.message || payload?.response || "";
      if (content.includes("doesn't have access")) {
        error = content;
        content = "";
      }
    } catch {
      // Not JSON either
    }
    return { content, durationMs, toolsUsed, error };
  }

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

/**
 * Send a timed request to Tippy via page.request.post (authenticated, non-streaming).
 * Returns duration alongside the response for performance benchmarking.
 */
export async function timedTippyRequest(
  page: Page,
  question: string
): Promise<TippyTimedResult> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();

    const response = await page.request.post("/api/tippy/chat", {
      data: { message: question },
    });

    const durationMs = Date.now() - startTime;
    const ok = response.ok();
    const data = await response.json();

    const responseText =
      typeof data === "string"
        ? data
        : data.message || data.response || data.content || JSON.stringify(data);

    // Retry on rate limit (Tippy returns 200 with friendly message for Anthropic 429s)
    if (responseText.includes("lot of questions") && attempt < maxRetries) {
      const backoffMs = Math.min(10_000 * 2 ** attempt, 30_000) + Math.random() * 2_000;
      console.log(`[timedTippyRequest] Rate limited, retrying in ${(backoffMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    return { ok, responseText, durationMs };
  }

  return { ok: false, responseText: "Max retries exceeded", durationMs: 0 };
}

/**
 * Browser-side fetch helper for mocked routes.
 * page.route() only intercepts browser-originated requests, NOT page.request.post().
 * Use this when you need mocked route interception (Tier 1 infrastructure tests).
 */
export async function tippyFetch(
  page: Page,
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
