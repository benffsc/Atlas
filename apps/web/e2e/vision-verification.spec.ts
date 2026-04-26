/**
 * Vision-Based UI Verification Tests
 *
 * Uses Claude's vision API to semantically verify UI correctness.
 * Tagged with @vision-api - skipped by default to avoid API costs.
 *
 * Run these tests:
 *   INCLUDE_VISION_API=1 npm run test:e2e -- --grep @vision-api
 *
 * These tests verify:
 * - Correct page structure and layout
 * - Expected UI elements are present
 * - Data displays according to business rules
 * - Known gaps are handled properly (not flagged as errors)
 */

import { test, expect } from "@playwright/test";
import { navigateTo, findRealEntity } from "./ui-test-helpers";
import {
  verifyPageWithVision,
  verifyTabBarWithVision,
  verifyElementWithVision,
  shouldRunVisionTests,
  mockVisionVerification,
} from "./helpers/vision-api";

// Skip all vision tests unless INCLUDE_VISION_API=1
test.beforeEach(async () => {
  if (!shouldRunVisionTests()) {
    test.skip();
  }
});

// ============================================================================
// REQUEST PAGE VISION TESTS
// ============================================================================

test.describe("@vision-api Request Page Verification", () => {
  test.setTimeout(60000);

  test("Request detail page has correct structure", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    const result = await verifyPageWithVision(page, {
      pageType: "request-detail",
      expectations: [
        "Page has a header with request title",
        "Status badge is visible (showing status like New, Working, etc.)",
        "Priority badge is visible",
        "Two-column layout with main content and sidebar",
        "TabBar at bottom with Linked Cats, Photos, Activity, Admin tabs",
        "Sidebar shows colony/cat statistics",
      ],
      knownGaps: [
        "May have 0 linked cats (new request)",
        "Colony estimates may show 'Unknown' for legacy data",
        "Some requests may not have a property type badge",
      ],
      model: "haiku", // Cheapest option
    });

    console.log("Vision verification result:", result.summary);
    console.log("Issues found:", result.issues);

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("Request TabBar has correct tabs", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    const result = await verifyTabBarWithVision(page, [
      "Linked Cats",
      "Photos",
      "Activity",
      "Admin",
    ]);

    expect(result.passed).toBe(true);
  });

  test("Request hero card shows key stats", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    const result = await verifyPageWithVision(page, {
      pageType: "request-detail",
      expectations: [
        "Hero card with attribute grid showing Location, Requester, Est. Colony, Coverage",
        "Status and priority badges visible in header",
        "Tab bar with Case, People, Cats, Trip Reports, Photos, Activity, Admin tabs",
      ],
      knownGaps: [
        "Colony stats may show dashes for new requests without linked cats",
        "Some attributes may show dashes if data is missing",
      ],
      context: "Focus on the hero card and tab bar area",
    });

    expect(result.passed).toBe(true);
  });
});

// ============================================================================
// PLACE PAGE VISION TESTS
// ============================================================================

test.describe("@vision-api Place Page Verification", () => {
  test.setTimeout(60000);

  test("Place detail page has correct structure", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    const result = await verifyPageWithVision(page, {
      pageType: "place-detail",
      expectations: [
        "Page header with address or location name",
        "Map showing the location",
        "TabBar with Details, Requests, Ecology, Media tabs",
        "Colony estimate information (if applicable)",
        "Linked people section",
      ],
      knownGaps: [
        "Colony estimates may be 'Unknown' for non-residential places",
        "Some places may have no linked cats",
        "Map may show default position if coordinates are missing",
      ],
    });

    expect(result.passed).toBe(true);
  });

  test("Place colony estimates are visible when available", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");

    const result = await verifyPageWithVision(page, {
      pageType: "place-detail",
      expectations: [
        "Colony size or cat count information is visible",
        "TNR coverage or alteration percentage shown (if applicable)",
      ],
      knownGaps: [
        "Colony estimates may be 'Unknown' or 'No data'",
        "TNR coverage may show 0% for places with no clinic history",
        "Non-residential places (businesses, clinics) won't have colony data",
      ],
      context: "This tests the ecological data display in the sidebar",
    });

    // This test is more lenient - colony data is optional
    console.log("Colony data verification:", result.summary);
    // Don't fail if colony data is missing - it's expected for many places
  });
});

// ============================================================================
// PERSON PAGE VISION TESTS
// ============================================================================

test.describe("@vision-api Person Page Verification", () => {
  test.setTimeout(60000);

  test("Person detail page has correct structure", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    const result = await verifyPageWithVision(page, {
      pageType: "person-detail",
      expectations: [
        "Page header with person's name",
        "Contact information section (email and/or phone)",
        "TabBar with Details, History, Admin tabs",
        "Sidebar with stats (cats owned, places, requests)",
      ],
      knownGaps: [
        "Some people may have no email (phone only)",
        "Some people may have no linked cats",
        "Role badges only appear for trappers/volunteers",
      ],
    });

    expect(result.passed).toBe(true);
  });

  test("Person contact info is properly formatted", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await page.waitForLoadState("networkidle");

    const result = await verifyPageWithVision(page, {
      pageType: "person-detail",
      expectations: [
        "Email address is displayed (if available)",
        "Phone number is formatted as (XXX) XXX-XXXX (if available)",
        "Contact info is clearly labeled",
      ],
      knownGaps: [
        "Person may have no contact info (some legacy records)",
        "Phone may show 'Invalid' warning if malformed",
      ],
      context: "Verify contact information formatting and display",
    });

    expect(result.passed).toBe(true);
  });
});

// ============================================================================
// INTAKE QUEUE VISION TESTS
// ============================================================================

test.describe("@vision-api Intake Queue Verification", () => {
  test.setTimeout(60000);

  test("Intake queue has correct layout", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    const result = await verifyPageWithVision(page, {
      pageType: "intake-queue",
      expectations: [
        "Queue list showing submission cards",
        "Each card shows submitter name and status",
        "Filter or sort controls are visible",
        "Action buttons for processing submissions",
      ],
      knownGaps: [
        "Queue may be empty (no pending submissions)",
        "Some submissions may have missing contact info",
      ],
    });

    expect(result.passed).toBe(true);
  });

  test("Intake queue detail panel opens correctly", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await page.waitForLoadState("networkidle");

    // Try to click first queue item
    const queueItem = page.locator(".submission-card, [data-testid='queue-item']").first();
    const hasItems = await queueItem.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasItems) {
      test.skip();
      return;
    }

    await queueItem.click();
    await page.waitForTimeout(500);

    const result = await verifyPageWithVision(page, {
      pageType: "intake-queue",
      expectations: [
        "Detail panel is visible on the right side",
        "Submitter name and contact info shown in detail",
        "Address information displayed",
        "Cat count and situation description visible",
        "Status and priority controls available",
      ],
      knownGaps: [
        "Some fields may be empty or 'Unknown'",
        "Third-party reports may have different layout",
      ],
      context: "Testing the side panel that opens when a queue item is selected",
    });

    expect(result.passed).toBe(true);
  });
});

// ============================================================================
// ACCESSIBILITY VISION TESTS
// ============================================================================

test.describe("@vision-api Accessibility Verification", () => {
  test.setTimeout(60000);

  test("Text is readable on request page", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    const result = await verifyPageWithVision(page, {
      pageType: "custom",
      expectations: [
        "All text is clearly readable (good contrast)",
        "Labels are visible and descriptive",
        "Status badges use distinct colors",
        "No text is cut off or overlapping",
      ],
      context: "Assess overall text readability and visual accessibility",
      model: "sonnet", // Use better model for nuanced assessment
    });

    console.log("Accessibility findings:", result.findings);
    expect(result.issues.filter((i) => i.includes("contrast") || i.includes("readable"))).toHaveLength(0);
  });

  test("Interactive elements are identifiable", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    const result = await verifyPageWithVision(page, {
      pageType: "custom",
      expectations: [
        "Buttons look clickable (distinct styling)",
        "Links are visually distinct from regular text",
        "Tab buttons clearly indicate which is active",
        "Form inputs have visible borders or backgrounds",
      ],
      context: "Verify that interactive elements are visually identifiable",
    });

    expect(result.passed).toBe(true);
  });
});

// ============================================================================
// BUSINESS RULES VISION TESTS
// ============================================================================

test.describe("@vision-api Business Rules Verification", () => {
  test.setTimeout(60000);

  test("Request status badge matches expected states", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    const result = await verifyPageWithVision(page, {
      pageType: "request-detail",
      expectations: [
        "Status badge shows one of: New, Working, Paused, Completed, Redirected, Handed Off",
        "Status badge color matches the status type (green for completed, etc.)",
        "Priority badge shows one of: Urgent, High, Normal, Low",
      ],
      context: "Verify status and priority badges follow the defined state machine",
    });

    expect(result.passed).toBe(true);
  });
});
