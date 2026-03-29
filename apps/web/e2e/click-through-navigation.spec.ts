/**
 * E2E: Click-Through Navigation (FFS-582)
 *
 * Tests that clicking on entity rows in list pages navigates to the correct
 * detail page, and that cross-entity links work (e.g., person → cat).
 *
 * All read-only — no write mocking needed.
 * Tagged @smoke for inclusion in quick validation runs.
 */

import { test, expect } from '@playwright/test';
import {
  navigateTo,
  findRealEntity,
  mockAllWrites,
  waitForLoaded,
} from './ui-test-helpers';

test.describe('Click-Through Navigation @smoke', () => {
  test.setTimeout(45000);

  // ── 1. Requests list → detail ─────────────────────────────────────

  test('Requests list row click navigates to detail page', async ({ page }) => {
    await mockAllWrites(page);
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Wait for table rows or cards to load
    const row = page.locator('table tbody tr, [data-testid="request-row"], tr[data-href]').first();
    const hasRow = await row.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasRow, 'No request rows visible');

    // Click the row (or the link within it)
    const link = row.locator('a').first();
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
    } else {
      await row.click();
    }

    await page.waitForTimeout(2000);

    // Should be on a detail page with a UUID in the URL
    const url = page.url();
    const isDetailPage = /\/requests\/[0-9a-f-]{36}/i.test(url);
    expect(isDetailPage).toBe(true);
  });

  // ── 2. People list → detail ───────────────────────────────────────

  test('People list row click navigates to detail page', async ({ page }) => {
    await mockAllWrites(page);
    await navigateTo(page, '/people');
    await waitForLoaded(page);

    const row = page.locator('table tbody tr, [data-testid="person-row"], tr[data-href]').first();
    const hasRow = await row.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasRow, 'No person rows visible');

    const link = row.locator('a').first();
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
    } else {
      await row.click();
    }

    await page.waitForTimeout(2000);

    const url = page.url();
    const isDetailPage = /\/people\/[0-9a-f-]{36}/i.test(url);
    expect(isDetailPage).toBe(true);
  });

  // ── 3. Cats list → detail ─────────────────────────────────────────

  test('Cats list row click navigates to detail page', async ({ page }) => {
    await mockAllWrites(page);
    await navigateTo(page, '/cats');
    await waitForLoaded(page);

    const row = page.locator('table tbody tr, [data-testid="cat-row"], tr[data-href]').first();
    const hasRow = await row.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasRow, 'No cat rows visible');

    const link = row.locator('a').first();
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
    } else {
      await row.click();
    }

    await page.waitForTimeout(2000);

    const url = page.url();
    const isDetailPage = /\/cats\/[0-9a-f-]{36}/i.test(url);
    expect(isDetailPage).toBe(true);
  });

  // ── 4. Places list → detail ───────────────────────────────────────

  test('Places list row click navigates to detail page', async ({ page }) => {
    await mockAllWrites(page);
    await navigateTo(page, '/places');
    await waitForLoaded(page);

    const row = page.locator('table tbody tr, [data-testid="place-row"], tr[data-href]').first();
    const hasRow = await row.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasRow, 'No place rows visible');

    const link = row.locator('a').first();
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
    } else {
      await row.click();
    }

    await page.waitForTimeout(2000);

    const url = page.url();
    const isDetailPage = /\/places\/[0-9a-f-]{36}/i.test(url);
    expect(isDetailPage).toBe(true);
  });

  // ── 5. Person detail → linked cat ─────────────────────────────────

  test('Person detail shows linked cat that navigates to cat detail', async ({ page, request }) => {
    await mockAllWrites(page);
    const personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person available');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Look for cat links in the overview/connections area
    const catLink = page.locator('a[href*="/cats/"]').first();
    const hasCatLink = await catLink.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasCatLink, 'No linked cat found on person detail');

    await catLink.click();
    await page.waitForTimeout(2000);

    const url = page.url();
    expect(url).toMatch(/\/cats\/[0-9a-f-]{36}/i);
  });

  // ── 6. Person detail → linked place ───────────────────────────────

  test('Person detail shows linked place that navigates to place detail', async ({ page, request }) => {
    await mockAllWrites(page);
    const personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person available');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    const placeLink = page.locator('a[href*="/places/"]').first();
    const hasPlaceLink = await placeLink.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPlaceLink, 'No linked place found on person detail');

    await placeLink.click();
    await page.waitForTimeout(2000);

    const url = page.url();
    expect(url).toMatch(/\/places\/[0-9a-f-]{36}/i);
  });

  // ── 7. Request detail → linked cat ────────────────────────────────

  test('Request detail linked cat navigates to cat detail', async ({ page, request }) => {
    await mockAllWrites(page);
    const requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No request available');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Click Linked Cats tab
    const catsTab = page.locator('[role="tab"]:has-text("Linked Cats"), [role="tab"]:has-text("Cats")').first();
    if (await catsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await catsTab.click();
      await page.waitForTimeout(1000);
    }

    const catLink = page.locator('a[href*="/cats/"]').first();
    const hasCatLink = await catLink.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasCatLink, 'No linked cat found on request detail');

    await catLink.click();
    await page.waitForTimeout(2000);

    const url = page.url();
    expect(url).toMatch(/\/cats\/[0-9a-f-]{36}/i);
  });

  // ── 8. Back button returns to list ────────────────────────────────

  test('Browser back button returns to list from detail', async ({ page, request }) => {
    await mockAllWrites(page);

    // Navigate to requests list first
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Click into a detail page
    const row = page.locator('table tbody tr, tr[data-href]').first();
    const hasRow = await row.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasRow, 'No request rows visible');

    const link = row.locator('a').first();
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
    } else {
      await row.click();
    }

    await page.waitForTimeout(2000);

    // Verify we're on detail
    const detailUrl = page.url();
    test.skip(!/\/requests\/[0-9a-f-]{36}/i.test(detailUrl), 'Did not navigate to detail');

    // Go back
    await page.goBack();
    await page.waitForTimeout(2000);

    // Should be back on the requests list
    const backUrl = page.url();
    expect(backUrl).toContain('/requests');
    expect(backUrl).not.toMatch(/\/requests\/[0-9a-f-]{36}/i);
  });

  // ── 9. Global search navigates to entity ──────────────────────────

  test('Global search result click navigates to entity detail', async ({ page }) => {
    await mockAllWrites(page);
    await navigateTo(page, '/');
    await waitForLoaded(page);

    // Look for a global search input on the dashboard
    let searchInput = page.locator(
      'input[placeholder*="Search"], input[type="search"], [data-testid="global-search"]'
    ).first();
    let hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    // Fallback: try /search page if dashboard doesn't have search
    if (!hasSearch) {
      await navigateTo(page, '/search');
      await waitForLoaded(page);
      searchInput = page.locator(
        'input[placeholder*="Search"], input[type="search"], [data-testid="global-search"]'
      ).first();
      hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    }

    test.skip(!hasSearch, 'No global search input found on dashboard or /search');

    // Type a generic query
    await searchInput.fill('cat');
    await page.waitForTimeout(2000);

    // Look for search results
    const result = page.locator(
      'a[href*="/cats/"], a[href*="/people/"], a[href*="/places/"], a[href*="/requests/"]'
    ).first();
    const hasResult = await result.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasResult, 'No search results appeared');

    await result.click();
    await page.waitForTimeout(2000);

    // Should be on a detail page
    const url = page.url();
    const isDetailPage = /\/(cats|people|places|requests)\/[0-9a-f-]{36}/i.test(url);
    expect(isDetailPage).toBe(true);
  });
});
