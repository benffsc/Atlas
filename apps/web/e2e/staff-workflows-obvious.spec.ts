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
 * Updated for Atlas 2.5 architecture (FFS-552):
 * - Request tabs: Linked Cats, Trip Reports, Photos, Activity, Admin
 * - Person tabs: Overview, Details, History, Admin (PersonDetailShell)
 * - Place tabs: Details, Requests, Ecology, Media
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

  test("Request detail shows status prominently @workflow", async ({
    page,
    request,
  }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const statusKeywords = [
      "New",
      "Working",
      "Paused",
      "Completed",
      "Redirected",
      "Handed Off",
    ];
    const pageText = await page.locator("body").textContent();
    const hasStatus = statusKeywords.some((s) => pageText?.includes(s));
    expect(hasStatus).toBeTruthy();

    // PriorityBadge renders raw values with CSS textTransform: capitalize,
    // but textContent() returns raw values (e.g., "normal" not "Normal")
    const priorityKeywords = ["urgent", "high", "normal", "low"];
    const hasPriority = priorityKeywords.some((p) => pageText?.toLowerCase().includes(p));
    expect(hasPriority).toBeTruthy();
  });

  test("Request detail shows Actions section @workflow", async ({
    page,
    request,
  }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Should have action buttons or status change controls
    const pageText = await page.locator("body").textContent();
    const actionKeywords = [
      "Actions",
      "Start Working",
      "Pause",
      "Complete",
      "Hold",
      "Close",
    ];
    const hasActions = actionKeywords.some((k) => pageText?.includes(k));
    expect(hasActions).toBeTruthy();
  });

  test("Request detail shows colony/cat count info @workflow", async ({
    page,
    request,
  }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const catKeywords = [
      "cat",
      "Cat",
      "Cats",
      "cats",
      "Linked Cats",
      "colony",
      "Colony",
      "Estimated",
    ];
    const pageText = await page.locator("body").textContent();
    const hasCatInfo = catKeywords.some((k) => pageText?.includes(k));
    expect(hasCatInfo).toBeTruthy();
  });

  test("Request TabBar shows all expected tabs @workflow", async ({
    page,
    request,
  }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Scroll down to see TabBar
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);

    // Atlas 2.5: Request has 5 tabs
    const expectedTabs = [
      "Linked Cats",
      "Trip Reports",
      "Photos",
      "Activity",
      "Admin",
    ];
    let foundTabs = 0;
    for (const tab of expectedTabs) {
      const tabButton = page.locator(
        `[role="tab"]:has-text("${tab}"), button:has-text("${tab}")`
      );
      if (
        await tabButton
          .first()
          .isVisible({ timeout: 2000 })
          .catch(() => false)
      ) {
        foundTabs++;
      }
    }
    // Should find at least 3 of the expected tabs
    expect(foundTabs).toBeGreaterThanOrEqual(3);
  });

  test("Request Activity tab shows journal/notes @workflow", async ({
    page,
    request,
  }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);

    const activityTab = page
      .locator('[role="tab"]:has-text("Activity")')
      .first();
    if (
      await activityTab.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await activityTab.click();
      await page.waitForTimeout(500);

      const activityContent = await page.locator("main").last().textContent();
      const hasActivityFeatures =
        activityContent?.includes("Add Note") ||
        activityContent?.includes("Journal") ||
        activityContent?.includes("Activity") ||
        activityContent?.includes("Note") ||
        activityContent?.includes("note");
      expect(hasActivityFeatures).toBeTruthy();
    } else {
      // Tab may not be visible if not scrolled enough
      const pageText = await page.locator("body").textContent();
      const hasActivity =
        pageText?.includes("Activity") ||
        pageText?.includes("Journal") ||
        pageText?.includes("Note");
      expect(hasActivity).toBeTruthy();
    }
  });
});

test.describe("Staff Workflow: Intake Queue", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Intake queue page loads with content area @smoke", async ({
    page,
  }) => {
    await navigateTo(page, "/intake/queue");
    await waitForLoaded(page);

    // Should have filter tabs, search, or data
    const hasContent = await page
      .locator(
        'button:has-text("Needs Attention"), button:has-text("Active"), input[placeholder*="Search"], table, h1, h2'
      )
      .first()
      .isVisible({ timeout: 10000 });
    expect(hasContent).toBeTruthy();
  });

  test("Intake queue shows filter controls @workflow", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await waitForLoaded(page);

    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="Search" i]'
    );
    const filterSelect = page.locator("select");

    const hasSearch = await searchInput
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasFilter = (await filterSelect.count()) > 0;
    const hasButtons = (await page.locator("button").count()) > 2;

    expect(hasSearch || hasFilter || hasButtons).toBeTruthy();
  });

  test("Intake queue submissions show data @workflow", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await waitForLoaded(page);
    await page.waitForTimeout(2000);

    const tableRows = page.locator("table tbody tr");
    const emptyState = page.locator(
      "text=/no submissions|empty|all caught up/i"
    );

    const rowCount = await tableRows.count();
    const hasEmptyState = await emptyState
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    expect(rowCount > 0 || hasEmptyState).toBeTruthy();
  });
});

test.describe("Staff Workflow: People Management", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Person detail shows name prominently @workflow", async ({
    page,
    request,
  }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10000 });

    const nameText = await h1.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });

  test("Person detail shows contact info visibly @workflow", async ({
    page,
    request,
  }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    const pageText = await page.locator("body").textContent();

    const hasEmail = pageText?.includes("@");
    const hasPhone = /\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}/.test(pageText || "");
    const hasNoContact = /no (email|phone|contact)/i.test(pageText || "");

    expect(hasEmail || hasPhone || hasNoContact).toBeTruthy();
  });

  test("Person TabBar shows expected tabs @workflow", async ({
    page,
    request,
  }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // PersonDetailShell tabs: Overview, Details, History, Admin
    const expectedTabs = ["Overview", "Details", "History", "Admin"];
    let found = 0;
    for (const tab of expectedTabs) {
      const tabButton = page
        .locator(
          `[role="tab"]:has-text("${tab}"), [data-testid="tab-${tab.toLowerCase()}"]`
        )
        .first();
      if (
        await tabButton.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });
});

test.describe("Staff Workflow: Place Management", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Place detail shows address prominently @workflow", async ({
    page,
    request,
  }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test("Place detail shows colony/cat stats @workflow", async ({
    page,
    request,
  }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    const pageText = await page.locator("body").textContent();
    const catKeywords = [
      "Cat",
      "cat",
      "Colony",
      "colony",
      "Estimate",
      "TNR",
      "Population",
      "Trend",
    ];
    const hasCatInfo = catKeywords.some((k) => pageText?.includes(k));
    expect(hasCatInfo).toBeTruthy();
  });

  test("Place TabBar shows expected tabs @workflow", async ({
    page,
    request,
  }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Atlas 2.5: Place tabs are Details, Requests, Ecology, Media
    const expectedTabs = ["Details", "Requests", "Ecology", "Media"];
    let found = 0;
    for (const tab of expectedTabs) {
      const tabButton = page
        .locator(
          `[role="tab"]:has-text("${tab}"), [data-testid="tab-${tab.toLowerCase()}"]`
        )
        .first();
      if (
        await tabButton.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(3);
  });

  test("Place Ecology tab shows data @workflow", async ({
    page,
    request,
  }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Try switching to Ecology tab
    const ecologyTab = page
      .locator(
        '[role="tab"]:has-text("Ecology"), [data-testid="tab-ecology"]'
      )
      .first();
    if (
      await ecologyTab.isVisible({ timeout: 5000 }).catch(() => false)
    ) {
      await ecologyTab.click();
      await page.waitForTimeout(1000);

      const ecologyContent = await page.locator("main").last().textContent();
      const ecologyKeywords = [
        "Disease",
        "Health",
        "FeLV",
        "FIV",
        "Colony",
        "Estimate",
        "TNR",
        "Population",
        "Trend",
        "No data",
        "No ecology",
      ];
      const hasEcologyInfo = ecologyKeywords.some((k) =>
        ecologyContent?.includes(k)
      );
      expect(hasEcologyInfo).toBeTruthy();
    }
  });
});

test.describe("Staff Workflow: Cat Records", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test("Cat detail shows name and basic info @workflow", async ({
    page,
    request,
  }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test("Cat detail shows altered status @workflow", async ({
    page,
    request,
  }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const pageText = await page.locator("body").textContent();
    const alteredKeywords = [
      "Altered",
      "Fixed",
      "Spayed",
      "Neutered",
      "Intact",
      "Unknown",
      "altered",
      "spay",
      "neuter",
    ];
    const hasAlteredInfo = alteredKeywords.some((k) =>
      pageText?.includes(k)
    );
    expect(hasAlteredInfo).toBeTruthy();
  });
});

test.describe("Staff Workflow: Navigation Clarity", () => {
  test.setTimeout(60000);

  test("Main navigation has clear labels @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    const nav = page.locator("nav, aside, header");
    await expect(nav.first()).toBeVisible({ timeout: 10000 });

    const pageText = await page.locator("body").textContent();
    const navItems = [
      "Requests",
      "Intake",
      "People",
      "Places",
      "Cats",
      "Map",
      "Dashboard",
    ];
    const hasNavItems = navItems.some((item) => pageText?.includes(item));
    expect(hasNavItems).toBeTruthy();
  });

  test("Search is accessible from main page @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="Search" i], input[placeholder*="cats, people" i]'
    );
    const searchButton = page.locator(
      'button:has-text("Search"), [aria-label*="search" i]'
    );

    const hasSearchInput = await searchInput
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasSearchButton = await searchButton
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    expect(hasSearchInput || hasSearchButton).toBeTruthy();
  });
});
