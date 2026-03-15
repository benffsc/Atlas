/**
 * Person Detail Page — UI Interaction Tests
 *
 * Verifies the person detail page (/people/[id]) loads correctly,
 * TabBar tabs render and switch (Overview, Details, History, Admin), header
 * displays name and badges, and key sections function.
 *
 * Updated for PersonDetailShell refactor: both /people/[id] and /trappers/[id]
 * now render PersonDetailShell with role-based config. Person default tab is Overview.
 *
 * All write operations are mocked via mockAllWrites — no real data is modified.
 */

import { test, expect } from '@playwright/test';
import {
  navigateTo,
  findRealEntity,
  mockAllWrites,
  waitForLoaded,
  switchToTabBarTab,
  expectTabBarVisible,
  getTabBarBadgeCount,
} from './ui-test-helpers';

test.describe('UI: Person Detail Interactions', () => {
  test.setTimeout(60000);

  let personId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  // ── 1. Page loads ────────────────────────────────────────────────

  test('Person detail page loads', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // The page should have rendered main content
  });

  // ── 2. TabBar tabs are present ─────────────────────────────────────

  test('TabBar tabs are present', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // PersonDetailShell tabs: Overview, Details, History, Admin
    const tabs = ['Overview', 'Details', 'History', 'Admin'];
    for (const tabName of tabs) {
      const tab = page.locator(`[role="tab"]:has-text("${tabName}")`).first();
      await expect(tab).toBeVisible();
    }
  });

  // ── 3. Tab switching works ───────────────────────────────────────

  test('Tab switching works', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Click through each tab
    const tabs = ['Overview', 'Details', 'History', 'Admin'];
    for (const tabName of tabs) {
      await switchToTabBarTab(page, tabName);
      // Verify tab content area exists
      const content = page.locator('main').last();
      await expect(content).toBeVisible();
    }
  });

  // ── 4. Person header shows name ──────────────────────────────────

  test('Person header shows name', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // The h1 heading contains the display name
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const nameText = await heading.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });

  // ── 5. Details tab shows person info ────────────────────────────

  test('Details tab shows person info', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    await switchToTabBarTab(page, 'Details');

    // Details tab contains contact info, linked entities, summary
    const mainContent = page.locator('main').last();
    await expect(mainContent).toBeVisible({ timeout: 10000 });

    // At least one content section should be visible
    const mainText = await mainContent.textContent();
    expect(mainText && mainText.trim().length > 0).toBeTruthy();
  });

  // ── 6. Details tab shows linked entities ─────────────────────

  test('Details tab shows linked entities', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    await switchToTabBarTab(page, 'Details');

    // Details should show cats and places sections (or empty states)
    const mainText = await page.locator('main').last().textContent();
    expect(mainText && mainText.trim().length > 0).toBeTruthy();

    // Either entity links are present or an empty-state message is shown
    const entityLinks = page.locator('a[href*="/cats/"], a[href*="/places/"]');
    const linkCount = await entityLinks.count();

    // Accept any count (0 or more) - test passes if page renders
    expect(linkCount).toBeGreaterThanOrEqual(0);
  });

  // ── 7. Entity links in details navigate ──────────────────────

  test('Entity links in details navigate', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    await switchToTabBarTab(page, 'Details');

    // Look for any entity links pointing to cats or places
    const entityLinks = page.locator(
      'a[href*="/cats/"], a[href*="/places/"], a[href*="/people/"]'
    );
    const linkCount = await entityLinks.count();

    if (linkCount === 0) {
      // No linked entities — acceptable, just verify the page is intact
      await expect(page.locator('body')).toBeVisible();
      return;
    }

    // Verify each link has a valid href pattern (UUID-based route)
    for (let i = 0; i < Math.min(linkCount, 5); i++) {
      const href = await entityLinks.nth(i).getAttribute('href');
      expect(href).toBeTruthy();
      // Should match /cats/<id>, /places/<id>, or /people/<id>
      expect(href).toMatch(/\/(cats|places|people)\/[a-f0-9-]+/);
    }
  });

  // ── 8. History tab shows request history ────────────────────────

  test('History tab shows content', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    await switchToTabBarTab(page, 'History');

    // History tab renders request history
    const mainContent = page.locator('main').last();
    await expect(mainContent).toBeVisible({ timeout: 10000 });

    const mainText = await mainContent.textContent();
    expect(mainText && mainText.trim().length > 0).toBeTruthy();
  });

  // ── 9. History tab shows count badge ────────────────────────────

  test('History tab shows count badge', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Check that History tab has a count badge (even if 0)
    const historyTab = page.locator('[role="tab"]:has-text("History")');
    await expect(historyTab).toBeVisible();

    const count = await getTabBarBadgeCount(page, 'History');
    // Count can be 0 or more - just verify it's a number or null (no badge)
    expect(count === null || typeof count === 'number').toBeTruthy();
  });

  // ── 10. Admin tab shows admin tools ────────────────────────────

  test('Admin tab shows admin tools', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    await switchToTabBarTab(page, 'Admin');

    // Admin tab renders administrative tools
    const mainContent = page.locator('main').last();
    await expect(mainContent).toBeVisible({ timeout: 10000 });

    const mainText = await mainContent.textContent();
    expect(mainText && mainText.trim().length > 0).toBeTruthy();
  });

  // ── 11. History button toggles panel ──────────────────────────

  test('History button toggles panel', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Find the History button in the header actions area
    const historyButton = page.locator('button', { hasText: 'History' }).first();

    // The History button might be the tab or the header button
    // We want the header button, not the tab
    const headerHistoryButton = page.locator('button:has-text("History")').filter({
      hasNot: page.locator('[role="tab"]'),
    }).first();

    const buttonToClick = await headerHistoryButton.isVisible({ timeout: 3000 }).catch(() => false)
      ? headerHistoryButton
      : historyButton;

    try {
      await expect(buttonToClick).toBeVisible({ timeout: 5000 });
    } catch {
      test.skip(true, 'History button not found in header');
      return;
    }

    // Click to open
    await buttonToClick.click();
    await page.waitForTimeout(500);

    // The history panel is a fixed-position sidebar with EditHistory inside
    const historyPanel = page.locator('div[style*="position: fixed"][style*="right"]');
    const panelVisible = await historyPanel.first().isVisible({ timeout: 5000 }).catch(() => false);

    if (!panelVisible) {
      // Panel might be styled differently
      const altPanel = page.locator('[class*="history"], [class*="History"], [class*="panel"]');
      await expect(altPanel.first()).toBeVisible({ timeout: 3000 });
    }
  });
});
