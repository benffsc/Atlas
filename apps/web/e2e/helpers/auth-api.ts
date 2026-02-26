/**
 * Authenticated API Test Helpers
 *
 * The standalone `request` fixture in Playwright doesn't automatically include
 * auth cookies. These helpers use `page.request` which shares the page's auth
 * context (cookies + localStorage) from the auth setup.
 */

import { Page } from "@playwright/test";

export interface TippyResponse {
  message: string;
  conversationId?: string;
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
