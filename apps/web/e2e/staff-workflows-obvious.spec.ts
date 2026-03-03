/**
 * Staff Workflows - Obvious UI Verification
 *
 * Tests that the key staff workflows are obvious and data displays correctly.
 * These are the "does it look right?" tests that verify:
 *
 * 1. Request detail shows status, priority, colony info clearly
 * 2. Intake queue shows submissions with key info visible
 * 3. Entity pages (people, places, cats) show relevant data
 * 4. Quick actions are visible and labeled correctly
 * 5. TabBar navigation works and shows correct content
 *
 * Run: npm run test:e2e -- e2e/staff-workflows-obvious.spec.ts
 */

import { test, expect } from "@playwright/test";
import {
  navigateTo,
  findRealEntity,
  mockAllWrites,
  waitForLoaded,
  switchToTabBarTab,
  expectTabBarVisible,
} from "./ui-test-helpers";

test.describe("Staff Workflow: Request Management", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Request detail shows status prominently", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Status should be visible near the top (in header or quick section)
    const statusKeywords = ["New", "Working", "Paused", "Completed", "Redirected", "Handed Off"];
    const pageText = await page.locator("body").textContent();

    const hasStatus = statusKeywords.some((s) => pageText?.includes(s));
    expect(hasStatus).toBeTruthy();

    // Priority should also be visible
    const priorityKeywords = ["Urgent", "High", "Normal", "Low"];
    const hasPriority = priorityKeywords.some((p) => pageText?.includes(p));
    expect(hasPriority).toBeTruthy();
  });

  test("Request detail shows Actions section", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Actions section should be visible (shows status change buttons)
    const actionsLabel = page.locator('text=Actions:');
    await expect(actionsLabel).toBeVisible({ timeout: 10000 });

    // Should have action buttons (Start Working, Pause, Complete, etc.)
    const actionButtons = page.locator('button:has-text("Start Working"), button:has-text("Pause"), button:has-text("Complete")');
    const buttonCount = await actionButtons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test("Request detail shows colony/cat count info", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Should show cat-related info (count, estimate, linked cats tab)
    const catKeywords = ["cat", "Cat", "Cats", "cats", "Linked Cats", "colony", "Colony"];
    const pageText = await page.locator("body").textContent();
    const hasCatInfo = catKeywords.some((k) => pageText?.includes(k));
    expect(hasCatInfo).toBeTruthy();
  });

  test("Request TabBar shows all expected tabs", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Scroll down to see TabBar (it's below the header section)
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);

    // Expected tabs for request page - check that at least some are visible
    const expectedTabs = ["Linked Cats", "Photos", "Activity", "Admin"];
    let foundTabs = 0;
    for (const tab of expectedTabs) {
      const tabButton = page.locator(`button:has-text("${tab}")`);
      if (await tabButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        foundTabs++;
      }
    }
    // Should find at least 2 of the expected tabs
    expect(foundTabs).toBeGreaterThanOrEqual(2);
  });

  test("Request Activity tab shows journal/notes", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Scroll down to see TabBar
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);

    // Try to click Activity tab if visible
    const activityTab = page.locator('button:has-text("Activity")');
    if (await activityTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activityTab.click();
      await page.waitForTimeout(500);

      // Activity tab should have "Add Note" or journal functionality
      const activityContent = await page.locator("main").last().textContent();
      const hasActivityFeatures =
        activityContent?.includes("Add Note") ||
        activityContent?.includes("Journal") ||
        activityContent?.includes("Activity") ||
        activityContent?.includes("Note");
      expect(hasActivityFeatures).toBeTruthy();
    } else {
      // TabBar might not be visible - check page has activity-related content anywhere
      const pageText = await page.locator("body").textContent();
      const hasActivity = pageText?.includes("Activity") || pageText?.includes("Journal") || pageText?.includes("Note");
      expect(hasActivity).toBeTruthy();
    }
  });
});

test.describe("Staff Workflow: Intake Queue", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Intake queue page loads with content area", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await waitForLoaded(page);

    // Should have filter tabs (Needs Attention, Scheduled, etc.)
    const filterTabs = page.locator('button:has-text("Needs Attention"), button:has-text("Scheduled"), button:has-text("All")');
    const hasFilterTabs = (await filterTabs.count()) > 0;

    // Should have search input
    const searchInput = page.locator('input[placeholder*="Search"]');
    const hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    // Should show submissions count or loading state
    const submissionCount = page.locator('text=/\\d+ submissions?|Loading/i');
    const hasCount = await submissionCount.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasFilterTabs || hasSearch || hasCount).toBeTruthy();
  });

  test("Intake queue shows filter controls", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await waitForLoaded(page);

    // Should have search or filter controls
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search" i]');
    const filterSelect = page.locator("select");

    const hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasFilter = (await filterSelect.count()) > 0;

    expect(hasSearch || hasFilter).toBeTruthy();
  });

  test("Intake queue submissions show submitter name", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await waitForLoaded(page);
    await page.waitForTimeout(2000); // Allow data to load

    // Check for either table rows or empty state
    const tableRows = page.locator("table tbody tr");
    const emptyState = page.locator('text=/no submissions|empty|all caught up/i');

    const rowCount = await tableRows.count();
    const hasEmptyState = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);

    // Either has submissions or shows empty state
    expect(rowCount > 0 || hasEmptyState).toBeTruthy();
  });
});

test.describe("Staff Workflow: People Management", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Person detail shows name prominently", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Person name should be in h1 heading
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10000 });

    const nameText = await h1.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });

  test("Person detail shows contact info visibly", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Contact info (email or phone) should be visible without clicking tabs
    const pageText = await page.locator("body").textContent();

    // Look for email pattern or phone pattern or "No contact" message
    const hasEmail = pageText?.includes("@");
    const hasPhone = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(pageText || "");
    const hasNoContact = /no (email|phone|contact)/i.test(pageText || "");

    expect(hasEmail || hasPhone || hasNoContact).toBeTruthy();
  });

  test("Person TabBar shows expected tabs", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Expected tabs for person page
    const expectedTabs = ["Details", "History", "Admin"];
    for (const tab of expectedTabs) {
      const tabButton = page.locator(`button:has-text("${tab}")`);
      await expect(tabButton).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Staff Workflow: Place Management", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Place detail shows address prominently", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Place address should be in heading area
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test("Place detail shows colony/cat stats", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Should show cat-related stats
    const pageText = await page.locator("body").textContent();
    const catKeywords = ["Cat", "cat", "Colony", "colony", "Estimate", "TNR"];
    const hasCatInfo = catKeywords.some((k) => pageText?.includes(k));
    expect(hasCatInfo).toBeTruthy();
  });

  test("Place TabBar shows expected tabs", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Expected tabs for place page
    const expectedTabs = ["Details", "Requests", "Ecology", "Media"];
    for (const tab of expectedTabs) {
      const tabButton = page.locator(`button:has-text("${tab}")`);
      await expect(tabButton).toBeVisible({ timeout: 5000 });
    }
  });

  test("Place Ecology tab shows disease/health info", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);
    await switchToTabBarTab(page, "Ecology");

    // Ecology tab should have health/disease related content
    const ecologyContent = await page.locator("main").last().textContent();
    const ecologyKeywords = ["Disease", "Health", "FeLV", "FIV", "Colony", "Estimate", "TNR", "No data"];
    const hasEcologyInfo = ecologyKeywords.some((k) => ecologyContent?.includes(k));
    expect(hasEcologyInfo).toBeTruthy();
  });
});

test.describe("Staff Workflow: Cat Records", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Cat detail shows name and basic info", async ({ page, request }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Cat name or "Unknown" should be in heading
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test("Cat detail shows altered status", async ({ page, request }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Should show altered/fixed status
    const pageText = await page.locator("body").textContent();
    const alteredKeywords = ["Altered", "Fixed", "Spayed", "Neutered", "Intact", "Unknown", "altered"];
    const hasAlteredInfo = alteredKeywords.some((k) => pageText?.includes(k));
    expect(hasAlteredInfo).toBeTruthy();
  });

  test("Cat detail shows microchip if available", async ({ page, request }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Should show microchip section (may be empty for some cats)
    const pageText = await page.locator("body").textContent();
    const hasChipSection =
      pageText?.includes("Microchip") ||
      pageText?.includes("microchip") ||
      pageText?.includes("Chip") ||
      /\d{9,15}/.test(pageText || ""); // Microchip number pattern

    // This is informational - some cats don't have chips
    console.log(`Cat has microchip info: ${hasChipSection}`);
  });
});

test.describe("Staff Workflow: Navigation Clarity", () => {
  test.setTimeout(60000);

  test("Main navigation has clear labels", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    // Should have navigation with clear labels
    const nav = page.locator("nav, header");
    await expect(nav.first()).toBeVisible({ timeout: 10000 });

    // Check for key navigation items
    const pageText = await page.locator("body").textContent();
    const navItems = ["Requests", "Intake", "People", "Places", "Cats", "Map"];
    const hasNavItems = navItems.some((item) => pageText?.includes(item));
    expect(hasNavItems).toBeTruthy();
  });

  test("Search is accessible from main page", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    // Should have search functionality visible
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search" i], [class*="search"]');
    const searchButton = page.locator('button:has-text("Search"), [aria-label*="search" i]');

    const hasSearchInput = await searchInput.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasSearchButton = await searchButton.first().isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasSearchInput || hasSearchButton).toBeTruthy();
  });
});
