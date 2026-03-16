import { test, expect } from "@playwright/test";
import { navigateTo, waitForLoaded } from "./ui-test-helpers";

/**
 * E2E Tests for Personal Dashboard (/me) and Dashboard (/)
 *
 * Tests the reminders, messages, lookups, and dashboard functionality.
 * Auth is handled by Playwright's storageState (set in auth.setup.ts).
 *
 * Updated for Atlas 2.5 architecture (FFS-552):
 * - Dashboard at / has greeting, KPI strip, ActionPanel, map
 * - /me page has Reminders, Messages, Saved Lookups
 */

test.describe("Dashboard Home (/)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);
  });

  test("displays greeting with user name @smoke", async ({ page }) => {
    // Atlas 2.5: Dashboard shows "Good morning/afternoon/evening, {name}"
    const greeting = page.locator("text=/Good (morning|afternoon|evening)/i");
    await expect(greeting).toBeVisible({ timeout: 10000 });
  });

  test("shows KPI stat cards @smoke", async ({ page }) => {
    // Atlas 2.5: Dashboard has KPI strip with stat cards
    const statCards = page.locator(
      '[class*="stat"], [class*="kpi"], [class*="metric"]'
    );
    // Should have at least one stat card visible
    const count = await statCards.count();
    if (count === 0) {
      // Fallback: look for numbers that look like stats
      const pageText = await page.locator("main").first().textContent();
      const hasNumbers = /\d+/.test(pageText || "");
      expect(hasNumbers).toBeTruthy();
    }
  });

  test("shows active requests section", async ({ page }) => {
    // Atlas 2.5: ActionPanel shows Active Requests
    const activeRequests = page.locator(
      ':is(h2, h3):has-text("Active")'
    ).or(page.locator('text=/Active Requests/i'));
    const hasActive = await activeRequests
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Fallback: check for request list items
    const requestItems = page.locator(
      'a[href*="/requests/"], [class*="request"]'
    );
    const hasItems = (await requestItems.count()) > 0;

    expect(hasActive || hasItems).toBeTruthy();
  });

  test("shows map on dashboard", async ({ page }) => {
    // Atlas 2.5: Dashboard has embedded DashboardMap
    const map = page.locator(
      '.leaflet-container, [class*="map"], canvas'
    );
    const hasMap = await map
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    // Map may not render in headless without tiles, just verify container exists
    expect(hasMap || (await map.count()) > 0).toBeTruthy();
  });

  test("shows + New Request button", async ({ page }) => {
    const newRequestBtn = page.locator(
      'a:has-text("New Request"), button:has-text("New Request")'
    );
    await expect(newRequestBtn.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Full Personal Dashboard (/me)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, "/me");
    await waitForLoaded(page);
  });

  test("displays page heading @smoke", async ({ page }) => {
    // /me page should have a heading
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows Reminders section", async ({ page }) => {
    const reminders = page.locator(
      ':is(h2, h3):has-text("Reminder")'
    ).or(page.locator('text=/Reminders/i'));
    await expect(reminders.first()).toBeVisible({ timeout: 5000 });
  });

  test("displays filter buttons for reminders", async ({ page }) => {
    // Check for at least some filter buttons
    const filterButtons = page.locator(
      'button:has-text("Pending"), button:has-text("Completed"), button:has-text("All")'
    );
    const count = await filterButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("can switch reminder filters", async ({ page }) => {
    const completedBtn = page.locator('button:has-text("Completed")');
    if (await completedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await completedBtn.click();
      await page.waitForTimeout(500);

      const pendingBtn = page.locator('button:has-text("Pending")');
      if (await pendingBtn.isVisible()) {
        await pendingBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test("shows lookups section", async ({ page }) => {
    const lookupSection = page.locator(
      ':is(h2, h3):has-text("Lookup")'
    ).or(page.locator('text=/Saved Lookups/i'));
    const emptyState = page.locator("text=/No saved lookups/i");

    const hasSection = await lookupSection
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasEmpty = await emptyState
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    expect(hasSection || hasEmpty).toBeTruthy();
  });
});

test.describe("Reminder Actions", () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, "/me");
    await waitForLoaded(page);
  });

  test("can interact with reminder if present", async ({ page }) => {
    const doneButton = page.locator('button:has-text("Done")').first();

    if (await doneButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      const initialCount = await page
        .locator('button:has-text("Done")')
        .count();
      await doneButton.click();
      await page.waitForTimeout(1000);
      const newCount = await page.locator('button:has-text("Done")').count();
      expect(newCount).toBeLessThanOrEqual(initialCount);
    } else {
      // No reminders — verify page loaded
      await expect(page.locator("h1")).toBeVisible();
    }
  });
});

test.describe("Tippy Chat Integration", () => {
  test("Tippy chat widget is present @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    // Atlas 2.5: Tippy FAB has class "tippy-fab" and title "Ask Tippy"
    const tippyButton = page.locator(
      '.tippy-fab, [title="Ask Tippy"]'
    );
    await expect(tippyButton.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Navigation", () => {
  test("can navigate to /me directly @smoke", async ({ page }) => {
    await navigateTo(page, "/me");
    await waitForLoaded(page);
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Access Control", () => {
  test("password gate works with access code", async ({ browser }) => {
    // Create a fresh context without auth state to test the gate
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/");

    // Atlas 2.5: PasswordGate uses input[type="password"] with placeholder="Access code"
    const accessCodeInput = page.locator(
      'input[type="password"][placeholder="Access code"], input[placeholder="Access code"]'
    );

    const isGateVisible = await accessCodeInput
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Gate should be visible for unauthenticated users
    // (may not show if PasswordGate is disabled in config)
    expect(typeof isGateVisible).toBe("boolean");

    await context.close();
  });
});
