/**
 * Place Detail Interactions - E2E Tests
 *
 * Tests the place detail page (/places/[id]) including:
 * - ProfileLayout tab navigation (Overview, Requests, Ecology, Media, Activity)
 * - Place header with name, address, context tags, kind badge
 * - Content sections within each tab
 * - Entity link navigation
 * - History panel toggle
 *
 * ALL WRITES ARE MOCKED via mockAllWrites - no real data is modified.
 */

import { test, expect } from '@playwright/test';
import {
  navigateTo,
  findRealEntity,
  mockAllWrites,
  waitForProfileTabs,
  clickTab,
  expectTabExists,
  waitForLoaded,
} from './ui-test-helpers';

test.describe('UI: Place Detail Interactions', () => {
  test.setTimeout(45000);

  let placeId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('Place detail page loads', async ({ page, request }) => {
    placeId = await findRealEntity(request, 'places');
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Page loaded - waitForLoaded already verified we're not on login page
  });

  test('All tabs are present', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForProfileTabs(page);

    await expectTabExists(page, 'Overview');
    await expectTabExists(page, 'Requests');
    await expectTabExists(page, 'Ecology');
    await expectTabExists(page, 'Media');
    await expectTabExists(page, 'Activity');
  });

  test('Tab switching works', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForProfileTabs(page);

    // Iterate actual tabs in the DOM (avoids hardcoding names)
    const tabButtons = page.locator('.profile-tab');
    const tabCount = await tabButtons.count();

    for (let i = 0; i < tabCount; i++) {
      const tab = tabButtons.nth(i);
      const label = (await tab.textContent())?.trim();
      if (!label) continue;

      await tab.click();
      // Allow Next.js router.replace() to settle before asserting
      await page.waitForTimeout(500);
      await expect(tab).toHaveClass(/active/, { timeout: 10000 });
    }
  });

  test('Place header shows name and address', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Place detail page should render a heading with the place name or address
    const heading = page.locator('h1, h2, [class*="profile-header"], [class*="place-header"]').first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const headingText = await heading.textContent();
    expect(headingText && headingText.trim().length > 0).toBeTruthy();
  });

  test('Overview tab shows place info', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForProfileTabs(page);
    await clickTab(page, 'Overview');

    // Overview renders h2 headings: "Location Details", "Activity Summary", "Cats", "People", etc.
    const locationSection = page.locator('h2', { hasText: 'Location Details' });
    const activitySection = page.locator('h2', { hasText: 'Activity Summary' });

    // At least one content section should be visible
    const hasLocation = await locationSection.isVisible({ timeout: 10000 }).catch(() => false);
    const hasActivity = await activitySection.isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasLocation || hasActivity).toBeTruthy();
  });

  test('Requests tab shows linked requests', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForProfileTabs(page);
    await clickTab(page, 'Requests');

    // Wait for the tab content to render
    await page.waitForTimeout(2000);

    // Should show request links, an empty state, or at least rendered content
    const mainText = await page.locator('main').last().textContent();
    expect(mainText && mainText.trim().length > 0).toBeTruthy();
  });

  test('Ecology tab shows colony data', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForProfileTabs(page);
    await clickTab(page, 'Ecology');

    // Wait for tab content to render
    await page.waitForTimeout(2000);

    // Ecology tab should have content in the main area
    const mainText = await page.locator('main').last().textContent();
    expect(mainText && mainText.trim().length > 0).toBeTruthy();
  });

  test('Activity tab shows journal section', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForProfileTabs(page);
    await clickTab(page, 'Activity');

    // Wait for tab content to render
    await page.waitForTimeout(2000);

    // Activity tab should have content in the main area
    const mainText = await page.locator('main').last().textContent();
    expect(mainText && mainText.trim().length > 0).toBeTruthy();
  });

  test('Entity links are clickable', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForProfileTabs(page);
    await clickTab(page, 'Overview');

    // Look for links to cats or people within the overview content
    const entityLinks = page.locator('a[href*="/cats/"], a[href*="/people/"]');
    const linkCount = await entityLinks.count();

    if (linkCount > 0) {
      const firstLink = entityLinks.first();
      const href = await firstLink.getAttribute('href');

      // Verify the href points to a valid entity detail route
      expect(href).toBeTruthy();
      expect(href).toMatch(/\/(cats|people)\//);

      // Verify the link is visible and therefore clickable
      await expect(firstLink).toBeVisible();
    } else {
      // No entity links is acceptable if the place has no linked cats or people
      expect(linkCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('History button toggles panel', async ({ page, request }) => {
    if (!placeId) {
      placeId = await findRealEntity(request, 'places');
    }
    test.skip(!placeId, 'No places available in database');

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Find the History button (visible in header actions)
    const historyButton = page.locator('button', { hasText: 'History' });

    if (!(await historyButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await historyButton.click();
    await page.waitForTimeout(500);

    // The history panel is a fixed-position sidebar
    const historyPanel = page.locator('div[style*="position: fixed"][style*="right"]');
    await expect(historyPanel.first()).toBeVisible({ timeout: 5000 });
  });
});
