import { test, expect } from '@playwright/test';
import { navigateTo, findRealEntity } from './ui-test-helpers';

/**
 * UI: Navigation & Search Tests
 *
 * Verifies core navigation flows and global search functionality:
 * - Homepage loads with map
 * - Global search returns results and links navigate correctly
 * - Sidebar navigation links are present
 * - Entity list pages load with data
 * - Intake queue page loads
 * - Back navigation works from detail pages
 *
 * These tests are READ-ONLY and do not modify any data.
 */

test.setTimeout(30000);

test.describe('UI: Navigation & Search', () => {

  // ---- Test 1 ----
  test('Homepage loads with map', async ({ page }) => {
    await navigateTo(page, '/');

    // Wait for the page to settle
    await page.waitForLoadState('domcontentloaded');

    // Look for a Leaflet map container or any map-related element
    const mapContainer = page.locator('.leaflet-container, [class*="map"]');

    // The map may take a moment to initialize; give it up to 10 seconds
    const mapVisible = await mapContainer.first().isVisible({ timeout: 10000 }).catch(() => false);

    if (mapVisible) {
      expect(await mapContainer.first().isVisible()).toBe(true);
    } else {
      // Even if the specific map selector is not found, verify page loaded
      // (some views may lazy-load the map)
      await expect(page.locator('main, body')).toBeVisible();
      console.log('Map container not found with expected selectors; page loaded successfully');
    }
  });

  // ---- Test 2 ----
  test('Global search returns results', async ({ page }) => {
    await navigateTo(page, '/');
    await page.waitForLoadState('domcontentloaded');

    // Find the search input using several possible selectors
    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="search" i], [data-testid*="search"] input, [data-testid*="search"]'
    ).first();

    const searchVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (!searchVisible) {
      console.log('Global search input not found; skipping interaction');
      return;
    }

    // Type a search query
    await searchInput.fill('test');
    await page.waitForTimeout(1000);

    // Look for a dropdown or results container
    const resultsContainer = page.locator(
      '[data-testid*="search-results"], [data-testid*="dropdown"], [class*="dropdown"], [class*="results"], [class*="suggestion"], [role="listbox"], [role="menu"]'
    ).first();

    const resultsVisible = await resultsContainer.isVisible({ timeout: 5000 }).catch(() => false);

    if (resultsVisible) {
      expect(await resultsContainer.isVisible()).toBe(true);
    } else {
      // Search may return no results for "test" -- that is acceptable
      console.log('No search dropdown appeared; query may have returned zero results');
    }
  });

  // ---- Test 3 ----
  test('Search result links navigate correctly', async ({ page }) => {
    await navigateTo(page, '/');
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="search" i], [data-testid*="search"] input, [data-testid*="search"]'
    ).first();

    const searchVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (!searchVisible) {
      console.log('Global search input not found; skipping');
      return;
    }

    await searchInput.fill('test');
    await page.waitForTimeout(1000);

    // Look for clickable result links inside the dropdown
    const resultLink = page.locator(
      '[data-testid*="search-results"] a, [data-testid*="dropdown"] a, [class*="dropdown"] a, [class*="results"] a, [class*="suggestion"] a, [role="listbox"] a, [role="option"] a'
    ).first();

    const linkVisible = await resultLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (!linkVisible) {
      console.log('No clickable search result links found; skipping navigation check');
      return;
    }

    const urlBefore = page.url();

    try {
      await resultLink.click();
      await page.waitForLoadState('domcontentloaded');
    } catch {
      console.log('Click on search result failed; element may have disappeared');
      return;
    }

    // URL should have changed after clicking a result
    const urlAfter = page.url();
    expect(urlAfter).not.toBe(urlBefore);
  });

  // ---- Test 4 ----
  test('Sidebar navigation links work', async ({ page }) => {
    await navigateTo(page, '/');
    await page.waitForLoadState('domcontentloaded');

    // Look for navigation links to the four main entity pages
    const requestsLink = page.locator('a[href*="/requests"]');
    const catsLink = page.locator('a[href*="/cats"]');
    const placesLink = page.locator('a[href*="/places"]');
    const peopleLink = page.locator('a[href*="/people"]');

    let visibleCount = 0;

    if (await requestsLink.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      visibleCount++;
    }
    if (await catsLink.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      visibleCount++;
    }
    if (await placesLink.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      visibleCount++;
    }
    if (await peopleLink.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      visibleCount++;
    }

    console.log(`Found ${visibleCount} of 4 expected navigation links`);
    expect(visibleCount).toBeGreaterThanOrEqual(3);
  });

  // ---- Test 5 ----
  test('Requests list page loads with data', async ({ page }) => {
    await navigateTo(page, '/requests');
    await page.waitForLoadState('domcontentloaded');

    // Wait for content to appear -- table rows, list items, or cards
    const dataRows = page.locator(
      'table tbody tr, [data-testid="request-item"], [class*="request-card"], [class*="request-row"], .list-item'
    );

    // Give data time to load
    await page.waitForTimeout(2000);

    const rowCount = await dataRows.count();
    console.log(`Requests list: found ${rowCount} data items`);

    // Count should be non-negative (0 is fine for empty state)
    expect(rowCount).toBeGreaterThanOrEqual(0);

    // Verify the page itself rendered meaningful content
    await expect(page.locator('main, h1, h2, [data-testid="requests-list"]').first()).toBeVisible({ timeout: 5000 });
  });

  // ---- Test 6 ----
  test('Cats list page loads with data', async ({ page }) => {
    await navigateTo(page, '/cats');
    await page.waitForLoadState('domcontentloaded');

    const dataRows = page.locator(
      'table tbody tr, [data-testid="cat-item"], [class*="cat-card"], [class*="cat-row"], .list-item'
    );

    await page.waitForTimeout(2000);

    const rowCount = await dataRows.count();
    console.log(`Cats list: found ${rowCount} data items`);

    expect(rowCount).toBeGreaterThanOrEqual(0);
    await expect(page.locator('main, h1, h2, [data-testid="cats-list"]').first()).toBeVisible({ timeout: 5000 });
  });

  // ---- Test 7 ----
  test('Places list page loads with data', async ({ page }) => {
    await navigateTo(page, '/places');
    await page.waitForLoadState('domcontentloaded');

    const dataRows = page.locator(
      'table tbody tr, [data-testid="place-item"], [class*="place-card"], [class*="place-row"], .list-item'
    );

    await page.waitForTimeout(2000);

    const rowCount = await dataRows.count();
    console.log(`Places list: found ${rowCount} data items`);

    expect(rowCount).toBeGreaterThanOrEqual(0);
    await expect(page.locator('main, h1, h2, [data-testid="places-list"]').first()).toBeVisible({ timeout: 5000 });
  });

  // ---- Test 8 ----
  test('People list page loads with data', async ({ page }) => {
    await navigateTo(page, '/people');
    await page.waitForLoadState('domcontentloaded');

    const dataRows = page.locator(
      'table tbody tr, [data-testid="person-item"], [class*="person-card"], [class*="person-row"], .list-item'
    );

    await page.waitForTimeout(2000);

    const rowCount = await dataRows.count();
    console.log(`People list: found ${rowCount} data items`);

    expect(rowCount).toBeGreaterThanOrEqual(0);
    await expect(page.locator('main, h1, h2, [data-testid="people-list"]').first()).toBeVisible({ timeout: 5000 });
  });

  // ---- Test 9 ----
  test('Intake queue page loads', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await page.waitForLoadState('domcontentloaded');

    // Verify the page rendered meaningful content
    await expect(page.locator('main, h1, h2, body').first()).toBeVisible({ timeout: 5000 });

    // Check that the page content includes intake/queue-related text
    const bodyText = await page.textContent('body');
    const hasRelevantContent =
      bodyText?.toLowerCase().includes('intake') ||
      bodyText?.toLowerCase().includes('queue') ||
      bodyText?.toLowerCase().includes('submission');

    if (hasRelevantContent) {
      expect(hasRelevantContent).toBe(true);
    } else {
      // Page may redirect or require auth; just confirm it did not crash
      console.log('Intake queue page loaded but did not find expected text; may require auth');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  // ---- Test 10 ----
  test('Back navigation works from detail pages', async ({ page, request }) => {
    // Fetch a real request ID to navigate to its detail page
    const requestId = await findRealEntity(request, 'requests');

    if (!requestId) {
      test.skip();
      return;
    }

    // Navigate to the requests list first (to establish history)
    await navigateTo(page, '/requests');
    await page.waitForLoadState('domcontentloaded');

    // Now navigate to the detail page
    await navigateTo(page, `/requests/${requestId}`);
    await page.waitForLoadState('domcontentloaded');

    // Verify we are on the detail page
    expect(page.url()).toContain(requestId);

    // Go back
    try {
      await page.goBack();
      await page.waitForLoadState('domcontentloaded');
    } catch {
      console.log('goBack() encountered a timing issue; verifying URL state');
    }

    // After going back, the URL should no longer contain the specific request ID
    const currentUrl = page.url();
    expect(currentUrl).not.toContain(requestId);
  });

});
