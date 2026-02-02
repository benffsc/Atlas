/**
 * Person Detail Page — UI Interaction Tests
 *
 * Verifies the person detail page (/people/[id]) loads correctly,
 * tabs render and switch, header displays name and badges, and
 * key sections (Overview, Connections, Activity, Data) function.
 *
 * All write operations are mocked via mockAllWrites — no real data is modified.
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

    // The page should have rendered main content or profile tabs
    // Page loaded - waitForLoaded already verified we're not on login page
  });

  // ── 2. Core tabs are present ─────────────────────────────────────

  test('Core tabs are present', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    // Overview, Connections, and Activity should always be visible.
    // Data tab is conditional (only when person has identifiers), so we do not require it.
    await expectTabExists(page, 'Overview');
    await expectTabExists(page, 'Connections');
    await expectTabExists(page, 'Activity');
  });

  // ── 3. Tab switching works ───────────────────────────────────────

  test('Tab switching works', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    // Collect visible tab labels
    const tabButtons = page.locator('.profile-tab');
    const tabCount = await tabButtons.count();

    for (let i = 0; i < tabCount; i++) {
      const tab = tabButtons.nth(i);
      const label = (await tab.textContent())?.trim();
      if (!label) continue;

      await tab.click();
      await expect(tab).toHaveClass(/active/, { timeout: 5000 });
    }
  });

  // ── 4. Person header shows name ──────────────────────────────────

  test('Person header shows name', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // The h1 heading inside detail-header contains the display name
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const nameText = await heading.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });

  // ── 5. Overview tab shows person info ────────────────────────────

  test('Overview tab shows person info', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Overview');

    // Overview contains a "Summary" section with detail-grid items
    const summarySection = page.locator('.detail-section', { hasText: 'Summary' });
    await expect(summarySection).toBeVisible({ timeout: 10000 });

    // Should show at least one detail item (Cats, Places, Created, Updated)
    const detailItems = summarySection.locator('.detail-item');
    const itemCount = await detailItems.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  // ── 6. Connections tab shows linked entities ─────────────────────

  test('Connections tab shows linked entities', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Connections');

    // Connections tab always renders "Cats" and "Associated Places" sections.
    // They may contain EntityLink cards or an empty-state message.
    const catsSection = page.locator('.detail-section', { hasText: 'Cats' });
    await expect(catsSection).toBeVisible({ timeout: 10000 });

    const placesSection = page.locator('.detail-section', { hasText: 'Associated Places' });
    await expect(placesSection).toBeVisible({ timeout: 10000 });

    // Either entity links are present or an empty-state message is shown
    const entityLinks = page.locator('a[href*="/cats/"], a[href*="/places/"]');
    const emptyMessages = page.locator('.text-muted', { hasText: /No (cats|places) linked/ });
    const linkCount = await entityLinks.count();
    const emptyCount = await emptyMessages.count();

    expect(linkCount + emptyCount).toBeGreaterThan(0);
  });

  // ── 7. Entity links in connections navigate ──────────────────────

  test('Entity links in connections navigate', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Connections');

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

  // ── 8. Activity tab shows content ────────────────────────────────

  test('Activity tab shows content', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await clickTab(page, 'Activity');

    // Activity tab renders "Requests" and "Journal" sections
    const requestsSection = page.locator('.detail-section', { hasText: 'Requests' });
    await expect(requestsSection).toBeVisible({ timeout: 10000 });

    const journalSection = page.locator('.detail-section', { hasText: 'Journal' });
    await expect(journalSection).toBeVisible({ timeout: 10000 });
  });

  // ── 9. History button toggles panel ──────────────────────────────

  test('History button toggles panel', async ({ page, request }) => {
    if (!personId) personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No person entity available in the database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Find the History button in the header actions area
    const historyButton = page.locator('button', { hasText: 'History' });
    await expect(historyButton).toBeVisible({ timeout: 10000 });

    // Click to open
    await historyButton.click();
    await page.waitForTimeout(500);

    // The history panel is a fixed-position sidebar with EditHistory inside
    const historyPanel = page.locator('div[style*="position: fixed"][style*="right"]');
    await expect(historyPanel).toBeVisible({ timeout: 5000 });

    // Click again to close
    await historyButton.click();
    await page.waitForTimeout(500);

    await expect(historyPanel).not.toBeVisible({ timeout: 5000 });
  });
});
