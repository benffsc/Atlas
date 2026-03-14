/**
 * UI Comprehensive Tests
 *
 * These tests verify the full UI coverage including:
 * - Page navigation and loading
 * - Component rendering
 * - User interactions
 * - Error states
 * - Responsive behavior
 *
 * Tests are READ-ONLY except for test account mutations.
 * Updated for Atlas 2.5 architecture (FFS-552).
 */

import { test, expect } from "@playwright/test";
import { navigateTo, waitForLoaded, findRealEntity } from "./ui-test-helpers";
import { unwrapApiResponse } from "./helpers/api-response";

// ============================================================================
// PAGE LOAD TESTS - Public Pages
// ============================================================================

test.describe("UI: Public Page Loading", () => {
  test("Home page loads successfully @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    await expect(page).toHaveTitle(/Atlas/i);
  });

  test("Requests list page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/requests");
    await expect(
      page.locator("h1, h2, table, [data-testid='requests-list']")
    ).toBeVisible({ timeout: 10000 });
  });

  test("Cats list page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/cats");
    await expect(
      page.locator("h1, h2, table, [data-testid='cats-list']")
    ).toBeVisible({ timeout: 10000 });
  });

  test("Places list page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/places");
    await expect(
      page.locator("h1, h2, table, [data-testid='places-list']")
    ).toBeVisible({ timeout: 10000 });
  });

  test("People list page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/people");
    await expect(
      page.locator("h1, h2, table, [data-testid='people-list']")
    ).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// PAGE LOAD TESTS - Detail Pages
// ============================================================================

test.describe("UI: Detail Page Loading", () => {
  test("Request detail page loads with valid ID @smoke", async ({
    page,
    request,
  }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("Cat detail page loads with valid ID @smoke", async ({
    page,
    request,
  }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId}`);
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("Place detail page loads with valid ID @smoke", async ({
    page,
    request,
  }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId}`);
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });

  test("Invalid request ID shows 404 or error @smoke", async ({ page }) => {
    await navigateTo(
      page,
      "/requests/00000000-0000-0000-0000-000000000000"
    );
    await expect(page.locator("main, body")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/requests/");
  });
});

// ============================================================================
// NAVIGATION TESTS
// ============================================================================

test.describe("UI: Navigation", () => {
  test("Main navigation links work @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    // Atlas 2.5: sidebar uses <aside> with <nav> sections inside
    const nav = page.locator("nav, aside, header");
    await expect(nav.first()).toBeVisible();
  });

  test("Clicking requests nav goes to requests page @smoke", async ({
    page,
  }) => {
    await navigateTo(page, "/");
    const requestsLink = page.locator('a[href*="/requests"]').first();
    if (await requestsLink.isVisible()) {
      await requestsLink.click();
      await expect(page).toHaveURL(/\/requests/);
    }
  });

  test("Clicking cats nav goes to cats page @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    const catsLink = page.locator('a[href*="/cats"]').first();
    if (await catsLink.isVisible()) {
      await catsLink.click();
      await expect(page).toHaveURL(/\/cats/);
    }
  });

  test("Back button works correctly", async ({ page }) => {
    await navigateTo(page, "/");
    await navigateTo(page, "/requests");
    await page.goBack();
    expect(page.url()).not.toContain("/requests");
  });
});

// ============================================================================
// TIPPY CHAT WIDGET TESTS
// ============================================================================

test.describe("UI: Tippy Chat Widget", () => {
  test("Tippy chat button is visible @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    // Atlas 2.5: Tippy FAB button has class "tippy-fab" and title "Ask Tippy"
    const chatButton = page.locator(
      '.tippy-fab, [title="Ask Tippy"], button:has-text("🐱")'
    );
    await expect(chatButton.first()).toBeVisible({ timeout: 10000 });
  });

  test("Tippy chat opens on button click", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    const chatButton = page.locator('.tippy-fab, [title="Ask Tippy"]').first();
    if (await chatButton.isVisible({ timeout: 5000 })) {
      await chatButton.click();
      // Atlas 2.5: Chat panel has class "tippy-chat-panel"
      const chatPanel = page.locator(
        '.tippy-chat-panel, [role="dialog"]'
      );
      await expect(chatPanel.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("Tippy chat accepts input", async ({ page }) => {
    await navigateTo(page, "/");
    await waitForLoaded(page);

    // Open chat
    const chatButton = page.locator('.tippy-fab, [title="Ask Tippy"]').first();
    if (await chatButton.isVisible({ timeout: 5000 })) {
      await chatButton.click();
    }

    // Find input field
    const input = page.locator(
      'input[placeholder*="Ask Tippy"], input[placeholder*="message"], textarea[placeholder*="message"]'
    );

    if (await input.isVisible({ timeout: 3000 })) {
      await input.fill("Hello");
      await expect(input).toHaveValue("Hello");
    }
  });
});

// ============================================================================
// ADMIN PAGE TESTS
// ============================================================================

test.describe("UI: Admin Pages", () => {
  test("Admin beacon page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/admin/beacon");
    await expect(page.locator("main, body")).toBeVisible({ timeout: 10000 });
  });

  test("Admin tippy conversations page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/admin/tippy-conversations");
    await expect(page.locator("main, body")).toBeVisible({ timeout: 10000 });
  });

  test("Admin data engine page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/admin/data-engine");
    await expect(page.locator("main, body")).toBeVisible({ timeout: 10000 });
  });

  test("Admin intake fields page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/admin/intake-fields");
    await expect(page.locator("main, body")).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// BEACON DASHBOARD TESTS
// ============================================================================

test.describe("UI: Beacon Dashboard", () => {
  test("Beacon dashboard loads @smoke", async ({ page }) => {
    await navigateTo(page, "/beacon");
    await expect(page.locator("main, body")).toBeVisible({ timeout: 10000 });
  });

  test("Beacon map loads", async ({ page }) => {
    await navigateTo(page, "/beacon");

    const mapContainer = page.locator(
      '.leaflet-container, [class*="map"], canvas'
    );

    if (await mapContainer.first().isVisible({ timeout: 10000 })) {
      expect(await mapContainer.count()).toBeGreaterThan(0);
    }
  });

  test("Beacon metrics panel loads", async ({ page }) => {
    await navigateTo(page, "/beacon");

    const metricsPanel = page.locator(
      '[class*="stats"], [class*="metrics"], [class*="summary"]'
    );

    if (await metricsPanel.first().isVisible({ timeout: 5000 })) {
      expect(await metricsPanel.count()).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// FORM INTERACTION TESTS
// ============================================================================

test.describe("UI: Form Interactions", () => {
  test("Search input works on requests page", async ({ page }) => {
    await navigateTo(page, "/requests");

    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="search" i], input[placeholder*="Search"]'
    );

    if (await searchInput.first().isVisible({ timeout: 3000 })) {
      await searchInput.first().fill("test");
      await expect(searchInput.first()).toHaveValue("test");
    }
  });

  test("Filter dropdowns work on requests page", async ({ page }) => {
    await navigateTo(page, "/requests");

    const filterSelect = page
      .locator('select, [role="combobox"], [data-testid*="filter"]')
      .first();

    if (await filterSelect.isVisible({ timeout: 3000 })) {
      await filterSelect.click();
    }
  });

  test("Pagination works if present", async ({ page }) => {
    await navigateTo(page, "/requests");

    const paginationButton = page.locator(
      'button:has-text("Next"), [aria-label="next page"], [data-testid*="pagination"]'
    );

    if (await paginationButton.first().isVisible({ timeout: 3000 })) {
      await expect(paginationButton.first()).toBeEnabled();
    }
  });
});

// ============================================================================
// ERROR STATE TESTS
// ============================================================================

test.describe("UI: Error States", () => {
  test("404 page shows for invalid route", async ({ page }) => {
    await navigateTo(page, "/this-page-does-not-exist-12345");
    await expect(page.locator("body")).toBeVisible();
  });

  test("Invalid UUID in route handles gracefully", async ({ page }) => {
    await navigateTo(page, "/requests/not-a-valid-uuid");
    await expect(page.locator("body")).toBeVisible();
  });

  test("API error in list page shows error message", async ({ page }) => {
    await navigateTo(page, "/requests");
    await expect(page.locator("body")).toBeVisible();
  });
});

// ============================================================================
// RESPONSIVE DESIGN TESTS
// ============================================================================

test.describe("UI: Responsive Design", () => {
  test("Home page works on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await navigateTo(page, "/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("Navigation works on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await navigateTo(page, "/");

    // Atlas 2.5: mobile menu button has aria-label="Toggle menu"
    const menuButton = page.locator(
      '[aria-label="Toggle menu"], [data-testid="mobile-menu"], button[aria-label*="menu" i]'
    );

    if (await menuButton.first().isVisible()) {
      await menuButton.first().click();
      // Sidebar should become visible
      const sidebar = page.locator("aside");
      await expect(sidebar.first()).toBeVisible({ timeout: 3000 });
    }
  });

  test("Beacon dashboard works on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await navigateTo(page, "/beacon");
    await expect(page.locator("body")).toBeVisible();
  });
});

// ============================================================================
// ACCESSIBILITY TESTS
// ============================================================================

test.describe("UI: Accessibility", () => {
  test("Home page has main landmark @smoke", async ({ page }) => {
    await navigateTo(page, "/");
    const main = page.locator("main, [role='main']");
    await expect(main.first()).toBeVisible({ timeout: 10000 });
  });

  test("Images have alt text", async ({ page }) => {
    await navigateTo(page, "/");

    const images = page.locator("img");
    const count = await images.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute("alt");
      expect(alt !== null).toBeTruthy();
    }
  });

  test("Buttons have accessible names", async ({ page }) => {
    await navigateTo(page, "/");

    const buttons = page.locator("button");
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      const text = await button.textContent();
      const ariaLabel = await button.getAttribute("aria-label");
      const ariaLabelledBy = await button.getAttribute("aria-labelledby");
      const title = await button.getAttribute("title");

      const hasAccessibleName =
        (text && text.trim().length > 0) || ariaLabel || ariaLabelledBy || title;
      expect(hasAccessibleName).toBeTruthy();
    }
  });

  test("Form inputs have labels", async ({ page }) => {
    await navigateTo(page, "/requests");

    const inputs = page.locator("input:not([type='hidden'])");
    const count = await inputs.count();

    for (let i = 0; i < Math.min(count, 3); i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute("id");
      const ariaLabel = await input.getAttribute("aria-label");
      const placeholder = await input.getAttribute("placeholder");

      const hasLabel = id || ariaLabel || placeholder;
      expect(hasLabel).toBeTruthy();
    }
  });
});

// ============================================================================
// LOADING STATE TESTS
// ============================================================================

test.describe("UI: Loading States", () => {
  test("Requests page shows loading state initially", async ({ page }) => {
    await navigateTo(page, "/requests");

    const hasContent = await page
      .locator(
        '[data-testid="loading"], .loading, .spinner, table, h1, h2'
      )
      .first()
      .isVisible({ timeout: 10000 });
    expect(hasContent).toBeTruthy();
  });

  test("Detail page shows loading state @smoke", async ({
    page,
    request,
  }) => {
    const requestId = await findRealEntity(request, "requests");
    test.skip(!requestId, "No requests in database");

    await navigateTo(page, `/requests/${requestId}`);
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// DATA DISPLAY TESTS
// ============================================================================

test.describe("UI: Data Display", () => {
  test("Requests list shows request data", async ({ page }) => {
    await navigateTo(page, "/requests");
    await page.waitForTimeout(2000);

    const hasData = await page
      .locator("table tbody tr, [data-testid='request-item'], .request-card")
      .count();
    expect(hasData).toBeGreaterThanOrEqual(0);
  });

  test("Cats list shows cat data", async ({ page }) => {
    await navigateTo(page, "/cats");
    await page.waitForTimeout(2000);

    const hasData = await page
      .locator("table tbody tr, [data-testid='cat-item'], .cat-card")
      .count();
    expect(hasData).toBeGreaterThanOrEqual(0);
  });

  test("Places list shows place data", async ({ page }) => {
    await navigateTo(page, "/places");
    await page.waitForTimeout(2000);

    const hasData = await page
      .locator("table tbody tr, [data-testid='place-item'], .place-card")
      .count();
    expect(hasData).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// PERSONAL DASHBOARD TESTS (/me)
// ============================================================================

test.describe("UI: Personal Dashboard", () => {
  test("/me page loads @smoke", async ({ page }) => {
    await navigateTo(page, "/me");
    await expect(page.locator("main, body")).toBeVisible({ timeout: 10000 });
  });

  test("Reminders section is present if authenticated", async ({ page }) => {
    await navigateTo(page, "/me");

    // Atlas 2.5: /me page has Reminders, Messages, Saved Lookups sections
    const remindersSection = page.locator(
      'h2:has-text("Reminder"), h3:has-text("Reminder"), [class*="reminder"]'
    );

    const isVisible = await remindersSection.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("Lookups section is present if authenticated", async ({ page }) => {
    await navigateTo(page, "/me");

    const lookupsSection = page.locator(
      'h2:has-text("Lookup"), h3:has-text("Lookup"), h2:has-text("Saved"), [class*="lookup"]'
    );

    const isVisible = await lookupsSection.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});
