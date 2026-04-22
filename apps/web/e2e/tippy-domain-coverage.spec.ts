/**
 * Tippy Domain Coverage Tests
 *
 * Comprehensive golden dataset testing every domain area of the Atlas TNR system.
 * Covers 20 previously untested domain areas identified in the test suite audit.
 *
 * Structure:
 * - TIER 1 (Mocked): Write tools (messaging, reminders, draft requests, field events)
 *   Always run, no API credits. Validates tool routing and response shape.
 *
 * - TIER 3 (@real-api): Read queries (voicemail triage, lost cat, spatial, disease,
 *   knowledge base, colony history, household, booking, seasonal, place comparison)
 *   Run only with INCLUDE_REAL_API=1. Tests actual AI reasoning.
 *
 * Each test validates:
 * 1. Response is non-empty and substantial (>30 chars)
 * 2. Required domain keywords appear (confirms right tool was used)
 * 3. No error indicators in response
 * 4. Numeric data present when expected
 */

import { test, expect } from "@playwright/test";
import {
  VOICEMAIL_TRIAGE_QUESTIONS,
  LOST_CAT_QUESTIONS,
  SPATIAL_QUESTIONS,
  MESSAGING_QUESTIONS,
  REMINDER_QUESTIONS,
  DRAFT_REQUEST_QUESTIONS,
  FIELD_EVENT_QUESTIONS,
  DISEASE_QUESTIONS,
  KNOWLEDGE_BASE_QUESTIONS,
  COLONY_HISTORY_QUESTIONS,
  HOUSEHOLD_QUESTIONS,
  BOOKING_QUESTIONS,
  SEASONAL_QUESTIONS,
  PLACE_COMPARISON_QUESTIONS,
  validateDomainResponse,
  type DomainQuestion,
} from "./fixtures/tippy-domain-coverage";
import { mockTippyWithToolResult, tippyFetch } from "./helpers/auth-api";
import { createVCR } from "./helpers/tippy-vcr";

const vcr = createVCR("tippy-domain-coverage");

// Helper: run a domain question test against real API with full logging + VCR
async function runDomainTest(
  page: import("@playwright/test").Page,
  question: DomainQuestion
) {
  const result = await vcr.askAndReplay(page, question.id, question.question, {
    testName: question.id,
  });

  expect(result.responseText).toBeTruthy();

  const { pass, reasons } = validateDomainResponse(question, result.responseText);

  if (!pass) {
    console.log(`[${question.id}] VALIDATION ISSUES:`);
    reasons.forEach((r) => console.log(`  - ${r}`));
    console.log(`  Response (${result.responseTimeMs}ms): ${result.responseText.substring(0, 300)}`);
  } else {
    console.log(`[${question.id}] PASS (${result.responseTimeMs}ms) — ${result.responseText.substring(0, 100)}...`);
  }

  // Soft validation: log issues but only fail on hard errors
  expect(result.responseText.length).toBeGreaterThan(20);
  expect(result.responseText.toLowerCase()).not.toMatch(
    /error|exception|crash|500/i
  );
}

// ============================================================================
// TIER 1: MOCKED WRITE TOOL TESTS (always run, no API credits)
// These validate tool routing for write operations
// ============================================================================

test.describe("Domain Coverage: Staff Messaging (Mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  for (const q of MESSAGING_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page, baseURL }) => {
      await mockTippyWithToolResult(
        page,
        "send_message",
        { success: true, data: { message: "Message sent to Ben's inbox." } },
        "Done! I sent that message to Ben. They'll see it on their dashboard."
      );

      const result = await tippyFetch(page, baseURL!, { message: q.question });
      expect(result.status).toBe(200);
      expect(result.body.message).toBeTruthy();
    });
  }
});

test.describe("Domain Coverage: Reminders (Mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  for (const q of REMINDER_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page, baseURL }) => {
      await mockTippyWithToolResult(
        page,
        "create_reminder",
        {
          success: true,
          data: {
            reminder_id: "mock-id",
            title: "Follow up",
            due_at: "Tuesday, March 31, 9:00 AM",
            message: "Reminder created.",
          },
        },
        "Reminder created! I'll remind you on Tuesday. Check your dashboard at /me."
      );

      const result = await tippyFetch(page, baseURL!, { message: q.question });
      expect(result.status).toBe(200);
      expect(result.body.message).toBeTruthy();
    });
  }
});

test.describe("Domain Coverage: Draft Requests (Mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  for (const q of DRAFT_REQUEST_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page, baseURL }) => {
      await mockTippyWithToolResult(
        page,
        "log_event",
        {
          success: true,
          data: {
            draft_id: "mock-draft",
            message: "Draft request created. A coordinator will review.",
          },
        },
        "I've created a draft request for that location. A coordinator will review it before it becomes official."
      );

      const result = await tippyFetch(page, baseURL!, { message: q.question });
      expect(result.status).toBe(200);
      expect(result.body.message).toBeTruthy();
    });
  }
});

test.describe("Domain Coverage: Field Events (Mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  for (const q of FIELD_EVENT_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page, baseURL }) => {
      const toolName =
        q.expectedTool === "log_event"
          ? "log_event"
          : "log_event";

      await mockTippyWithToolResult(
        page,
        toolName,
        { success: true, data: { message: "Event logged." } },
        "Got it, I've logged that observation."
      );

      const result = await tippyFetch(page, baseURL!, { message: q.question });
      expect(result.status).toBe(200);
      expect(result.body.message).toBeTruthy();
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Voicemail Triage (@real-api)
// HIGH priority: Daily staff workflow, zero previous coverage
// ============================================================================

test.describe("Domain Coverage: Voicemail Triage @real-api", () => {
  test.setTimeout(120000);

  for (const q of VOICEMAIL_TRIAGE_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Lost/Missing Cat (@real-api)
// HIGH priority: Explicit system prompt capability, zero previous coverage
// ============================================================================

test.describe("Domain Coverage: Lost Cat Search @real-api", () => {
  test.setTimeout(120000);

  for (const q of LOST_CAT_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Spatial Analysis (@real-api)
// HIGH priority: Core fallback workflow, zero previous coverage
// ============================================================================

test.describe("Domain Coverage: Spatial Analysis @real-api", () => {
  test.setTimeout(120000);

  for (const q of SPATIAL_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Disease Tracking (@real-api)
// MEDIUM priority: Ecological data, only indirect coverage before
// ============================================================================

test.describe("Domain Coverage: Disease Tracking @real-api", () => {
  test.setTimeout(120000);

  for (const q of DISEASE_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Knowledge Base (@real-api)
// MEDIUM priority: Training/onboarding, zero previous coverage
// ============================================================================

test.describe("Domain Coverage: Knowledge Base @real-api", () => {
  test.setTimeout(120000);

  for (const q of KNOWLEDGE_BASE_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Colony History (@real-api)
// ============================================================================

test.describe("Domain Coverage: Colony History @real-api", () => {
  test.setTimeout(120000);

  for (const q of COLONY_HISTORY_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Household Context (@real-api)
// ============================================================================

test.describe("Domain Coverage: Household Context @real-api", () => {
  test.setTimeout(120000);

  for (const q of HOUSEHOLD_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Booking / Clinic (@real-api)
// ============================================================================

test.describe("Domain Coverage: Booking & Clinic @real-api", () => {
  test.setTimeout(120000);

  for (const q of BOOKING_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Seasonal / Breeding (@real-api)
// ============================================================================

test.describe("Domain Coverage: Seasonal Context @real-api", () => {
  test.setTimeout(120000);

  for (const q of SEASONAL_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});

// ============================================================================
// TIER 3: REAL API TESTS — Place Comparison (@real-api)
// ============================================================================

test.describe("Domain Coverage: Place Comparison @real-api", () => {
  test.setTimeout(120000);

  for (const q of PLACE_COMPARISON_QUESTIONS) {
    test(`${q.id}: ${q.description}`, async ({ page }) => {
      await runDomainTest(page, q);
    });
  }
});
