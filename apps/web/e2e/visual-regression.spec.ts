/**
 * Visual Regression Tests
 *
 * Screenshot-based tests to catch unintended visual changes to:
 * - Page layouts (TwoColumnLayout)
 * - Component styling (Section, StatsSidebar)
 * - Responsive design
 *
 * These tests generate baseline screenshots that are compared on subsequent runs.
 * Run with: npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 * to update baselines.
 */

import { test, expect } from "@playwright/test";
import { navigateTo, findRealEntity, passPasswordGate } from "./ui-test-helpers";

// ============================================================================
// PAGE LAYOUT SCREENSHOTS
// ============================================================================

test.describe("Page Layout Screenshots", () => {
  test.setTimeout(60000);

  test("Request detail page layout", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000); // Allow animations to complete

    // Take full page screenshot
    await expect(page).toHaveScreenshot("request-detail-layout.png", {
      maxDiffPixels: 500, // Allow some variation
      fullPage: true,
    });
  });

  test("Person detail page layout", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("person-detail-layout.png", {
      maxDiffPixels: 500,
      fullPage: true,
    });
  });

  test("Place detail page layout", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("place-detail-layout.png", {
      maxDiffPixels: 500,
      fullPage: true,
    });
  });

  test("Cat detail page layout", async ({ page, request }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("cat-detail-layout.png", {
      maxDiffPixels: 500,
      fullPage: true,
    });
  });

  test("Intake queue layout", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("intake-queue-layout.png", {
      maxDiffPixels: 500,
      fullPage: true,
    });
  });
});

// ============================================================================
// INTAKE QUEUE SIDE PANEL SCREENSHOTS
// ============================================================================

test.describe("Intake Queue Side Panel", () => {
  test.setTimeout(60000);

  test("Queue with detail panel open", async ({ page }) => {
    await navigateTo(page, "/intake/queue");
    await page.waitForLoadState("networkidle");

    // Find and click first queue item
    const queueItems = page.locator(
      '[data-testid="queue-item"], .submission-card, .queue-row'
    );
    const hasItems = await queueItems.first().isVisible({ timeout: 10000 }).catch(() => false);

    if (hasItems) {
      await queueItems.first().click();
      await page.waitForTimeout(500); // Animation time

      // Screenshot with panel open
      await expect(page).toHaveScreenshot("intake-queue-with-panel.png", {
        maxDiffPixels: 500,
        fullPage: true,
      });
    }
  });
});

// ============================================================================
// RESPONSIVE LAYOUT SCREENSHOTS
// ============================================================================

test.describe("Responsive Layout Screenshots", () => {
  test.setTimeout(60000);

  test("Request page mobile layout", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("request-detail-mobile.png", {
      maxDiffPixels: 500,
      fullPage: true,
    });
  });

  test("Person page tablet layout", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    await navigateTo(page, `/people/${personId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("person-detail-tablet.png", {
      maxDiffPixels: 500,
      fullPage: true,
    });
  });

  test("Place page widescreen layout", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    // Set widescreen viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("place-detail-widescreen.png", {
      maxDiffPixels: 500,
      fullPage: true,
    });
  });
});

// ============================================================================
// COMPONENT SCREENSHOTS
// ============================================================================

test.describe("Component Screenshots", () => {
  test.setTimeout(60000);

  test("Sidebar component styling", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    // Find sidebar element
    const sidebar = page.locator(
      '[data-testid="stats-sidebar"], [class*="sidebar"], [class*="lg:w-[35%]"]'
    ).first();

    const hasSidebar = await sidebar.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasSidebar) {
      await expect(sidebar).toHaveScreenshot("sidebar-component.png", {
        maxDiffPixels: 200,
      });
    }
  });

  test("Section component collapsed state", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");

    // Find a collapsible section
    const section = page.locator(
      '[role="button"][class*="cursor-pointer"], .collapsible-section'
    ).first();

    const hasSection = await section.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasSection) {
      await expect(section).toHaveScreenshot("section-collapsed.png", {
        maxDiffPixels: 100,
      });
    }
  });

  test("Section component expanded state", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");

    // Find an expanded section (look for down arrow indicator)
    const expandedSection = page.locator(':text("▼")').first();

    const hasExpanded = await expandedSection.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasExpanded) {
      // Get parent section container
      const sectionContainer = expandedSection.locator('xpath=ancestor::div[contains(@class, "bg-white")]').first();
      const hasContainer = await sectionContainer.isVisible().catch(() => false);

      if (hasContainer) {
        await expect(sectionContainer).toHaveScreenshot("section-expanded.png", {
          maxDiffPixels: 200,
        });
      }
    }
  });
});

// ============================================================================
// BADGE AND STATUS SCREENSHOTS
// ============================================================================

test.describe("Badge and Status Screenshots", () => {
  test.setTimeout(60000);

  test("Request status badges", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    // Find status badge
    const statusBadge = page.locator(
      '.status-badge, [data-testid="request-status"], .badge'
    ).first();

    const hasBadge = await statusBadge.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasBadge) {
      await expect(statusBadge).toHaveScreenshot("request-status-badge.png", {
        maxDiffPixels: 50,
      });
    }
  });

  test("Relationship type badges", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await page.waitForLoadState("networkidle");

    // Find relationship badges
    const relationshipBadge = page.locator(
      '.relationship-badge, [data-testid="relationship-type"], .badge:has-text("Resident"), .badge:has-text("Owner")'
    ).first();

    const hasBadge = await relationshipBadge.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasBadge) {
      await expect(relationshipBadge).toHaveScreenshot("relationship-badge.png", {
        maxDiffPixels: 50,
      });
    }
  });
});

// ============================================================================
// EMPTY STATE SCREENSHOTS
// ============================================================================

test.describe("Empty State Screenshots", () => {
  test.setTimeout(60000);

  test("Empty linked cats section", async ({ page, request }) => {
    // This test looks for a place without linked cats
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");

    // Look for empty state message
    const emptyState = page.locator(':text("No cats")').first();

    const hasEmptyState = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasEmptyState) {
      // Get parent container
      const container = emptyState.locator('xpath=ancestor::div[contains(@class, "bg-white")]').first();
      if (await container.isVisible().catch(() => false)) {
        await expect(container).toHaveScreenshot("empty-cats-section.png", {
          maxDiffPixels: 100,
        });
      }
    }
  });
});

// ============================================================================
// TABBAR COMPONENT SCREENSHOTS (New standardized tabs)
// ============================================================================

test.describe("TabBar Component Screenshots", () => {
  test.setTimeout(60000);

  test("Request page TabBar - all tabs", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Find TabBar
    const tabBar = page.locator('[style*="borderBottom: 2px solid"]').first();
    const hasTabBar = await tabBar.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTabBar) {
      // Screenshot default state (cats tab active)
      await expect(tabBar).toHaveScreenshot("tabbar-request-cats-active.png", {
        maxDiffPixels: 100,
      });

      // Click through each tab and screenshot
      const tabs = ["Photos", "Activity", "Admin"];
      for (const tabName of tabs) {
        const tab = page.locator(`button:has-text("${tabName}")`).first();
        if (await tab.isVisible().catch(() => false)) {
          await tab.click();
          await page.waitForTimeout(300);
          await expect(tabBar).toHaveScreenshot(`tabbar-request-${tabName.toLowerCase()}-active.png`, {
            maxDiffPixels: 100,
          });
        }
      }
    }
  });

  test("Place page TabBar - all tabs", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Find TabBar (place page has Details, Requests, Ecology, Media tabs)
    const tabs = ["Requests", "Ecology", "Media"];
    for (const tabName of tabs) {
      const tab = page.locator(`button:has-text("${tabName}")`).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(300);

        // Screenshot the active tab content area
        await expect(page).toHaveScreenshot(`place-tab-${tabName.toLowerCase()}.png`, {
          maxDiffPixels: 500,
          fullPage: true,
        });
      }
    }
  });

  test("Person page TabBar - all tabs", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Find TabBar (person page has Details, History, Admin tabs)
    const tabs = ["History", "Admin"];
    for (const tabName of tabs) {
      const tab = page.locator(`button:has-text("${tabName}")`).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(300);

        // Screenshot the active tab content area
        await expect(page).toHaveScreenshot(`person-tab-${tabName.toLowerCase()}.png`, {
          maxDiffPixels: 500,
          fullPage: true,
        });
      }
    }
  });

  test("TabBar count badges", async ({ page, request }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState("networkidle");

    // Find tabs with count badges
    const countBadge = page.locator('button:has-text("Linked Cats") span[style*="borderRadius: 999px"]').first();
    const hasBadge = await countBadge.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasBadge) {
      await expect(countBadge).toHaveScreenshot("tabbar-count-badge.png", {
        maxDiffPixels: 50,
      });
    }
  });
});

// ============================================================================
// MAP COMPONENT SCREENSHOTS
// ============================================================================

test.describe("Map Component Screenshots", () => {
  test.setTimeout(60000);

  test("Place page map", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000); // Wait for map tiles to load

    // Find map container
    const mapContainer = page.locator(
      '[data-testid="place-map"], .leaflet-container, #map'
    ).first();

    const hasMap = await mapContainer.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasMap) {
      await expect(mapContainer).toHaveScreenshot("place-map.png", {
        maxDiffPixels: 1000, // Maps have more variation
      });
    }
  });
});
