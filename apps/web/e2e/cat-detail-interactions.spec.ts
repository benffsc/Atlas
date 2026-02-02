/**
 * Cat Detail Interactions Tests
 *
 * Tests the cat detail page (/cats/[id]) UI interactions:
 * - Page loading and profile layout
 * - Tab navigation (Overview, Medical, Connections, Activity)
 * - Profile header with name and badges
 * - Content rendering in each tab
 * - Entity links in connections tab
 * - History panel toggle
 *
 * ALL WRITES ARE MOCKED -- these tests are read-only against real data.
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

test.describe('UI: Cat Detail Interactions', () => {
  test.setTimeout(45000);

  let catId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  // -------------------------------------------------------------------------
  // 1. Cat detail page loads
  // -------------------------------------------------------------------------
  test('Cat detail page loads', async ({ page, request }) => {
    catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Page loaded - waitForLoaded already verified we're not on login page
  });

  // -------------------------------------------------------------------------
  // 2. All tabs are present
  // -------------------------------------------------------------------------
  test('All tabs are present', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await expectTabExists(page, 'Overview');
    await expectTabExists(page, 'Medical');
    await expectTabExists(page, 'Connections');
    await expectTabExists(page, 'Activity');
  });

  // -------------------------------------------------------------------------
  // 3. Tab switching works
  // -------------------------------------------------------------------------
  test('Tab switching works', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    const tabLabels = ['Overview', 'Medical', 'Connections', 'Activity'];

    for (const label of tabLabels) {
      await clickTab(page, label);

      const activeTab = page.locator('.profile-tab.active', { hasText: label });
      await expect(activeTab).toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // 4. Cat profile header shows name
  // -------------------------------------------------------------------------
  test('Cat profile header shows name', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const heading = page.locator('h1, h2, [class*="profile-name"], [class*="header"] [class*="name"]').first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. Overview tab shows basic info
  // -------------------------------------------------------------------------
  test('Overview tab shows basic info', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Overview');

    // Expect some content sections: cards, info blocks, or descriptive text
    const overviewContent = page.locator(
      '[class*="card"], [class*="section"], [class*="info"], [class*="detail"], [class*="overview"], table, dl, .profile-tab-content'
    );

    const count = await overviewContent.count();
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 6. Medical tab shows clinic data
  // -------------------------------------------------------------------------
  test('Medical tab shows clinic data', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Medical');

    // Medical tab should have some content area -- clinic visits, vitals,
    // conditions, or an empty state message
    const medicalContent = page.locator(
      '[class*="medical"], [class*="clinic"], [class*="visit"], [class*="vital"], [class*="condition"], [class*="test-result"], [class*="card"], [class*="section"], [class*="empty"], table, .profile-tab-content'
    );

    const count = await medicalContent.count();
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 7. Connections tab shows linked entities
  // -------------------------------------------------------------------------
  test('Connections tab shows linked entities', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Connections');

    // Look for entity links to people or places, or a section/card container,
    // or an empty state if no connections exist
    const connectionsContent = page.locator(
      'a[href*="/people/"], a[href*="/places/"], [class*="connection"], [class*="entity"], [class*="linked"], [class*="card"], [class*="section"], [class*="empty"], .profile-tab-content'
    );

    const count = await connectionsContent.count();
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 8. Entity links in connections are clickable
  // -------------------------------------------------------------------------
  test('Entity links in connections are clickable', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Connections');

    // Find entity links pointing to people or places detail pages
    const entityLinks = page.locator('a[href*="/people/"], a[href*="/places/"]');
    const linkCount = await entityLinks.count();

    if (linkCount === 0) {
      // No linked entities for this cat -- skip gracefully
      test.skip();
      return;
    }

    const firstLink = entityLinks.first();
    await expect(firstLink).toBeVisible();

    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toMatch(/\/(people|places)\/[a-f0-9-]+/);
  });

  // -------------------------------------------------------------------------
  // 9. Activity tab shows journal section
  // -------------------------------------------------------------------------
  test('Activity tab shows journal section', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Activity');

    // Activity tab should have a journal/activity area or empty state
    const activityContent = page.locator(
      '[class*="journal"], [class*="activity"], [class*="timeline"], [class*="entry"], [class*="card"], [class*="section"], [class*="empty"], [class*="log"], .profile-tab-content'
    );

    const count = await activityContent.count();
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 10. History button toggles panel
  // -------------------------------------------------------------------------
  test('History button toggles panel', async ({ page, request }) => {
    if (!catId) catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available in database');

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const historyButton = page.locator('button', { hasText: 'History' });

    const buttonVisible = await historyButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (!buttonVisible) {
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
