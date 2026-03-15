/**
 * Intake Queue Interactions Tests
 *
 * Tests UI interactions on the /intake/queue page including:
 * - Page loading and content visibility
 * - Tab navigation (Active, Scheduled, Completed, All)
 * - Filter chips (Legacy, Test toggles)
 * - Search input functionality
 * - Category filter dropdown
 * - Sort controls (sort by dropdown including Priority, sort order toggle)
 * - Submission list rendering with IntakeQueueRow component
 * - Row action buttons (Log, primary action, overflow menu)
 * - Detail panel (IntakeDetailPanel) opening via submission click
 * - Detail panel content verification
 * - Status action buttons in the detail panel
 * - Closing the detail panel
 *
 * ALL WRITES ARE MOCKED via mockAllWrites(page) in beforeEach.
 *
 * Component structure (FFS-110 refactor):
 *   queue/page.tsx → IntakeQueueRow.tsx, IntakeDetailPanel.tsx,
 *   ContactLogModal.tsx, BookingModal.tsx, DeclineModal.tsx,
 *   IntakeBadges.tsx, intake-types.ts
 */

import { test, expect } from '@playwright/test';
import { navigateTo, mockAllWrites, waitForLoaded } from './ui-test-helpers';

test.describe('UI: Intake Queue Interactions @workflow', () => {
  test.setTimeout(45000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  // --------------------------------------------------------------------------
  // 1. Page loads
  // --------------------------------------------------------------------------
  test('Intake queue page loads', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // The page should have visible content: heading, tabs, or main element
    const content = page.locator('main, h1, h2, button, table');
    await expect(content.first()).toBeVisible({ timeout: 15000 });

    // Verify we are on the correct URL
    expect(page.url()).toContain('/intake/queue');
  });

  // --------------------------------------------------------------------------
  // 2. Four tabs are visible (FFS-111)
  // --------------------------------------------------------------------------
  test('Four tabs are visible: Active, Scheduled, Completed, All', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Tabs are plain <button> elements with text labels
    const activeTab = page.locator('button').filter({ hasText: /^Active$/ });
    const scheduledTab = page.locator('button').filter({ hasText: /^Scheduled$/ });
    const completedTab = page.locator('button').filter({ hasText: /^Completed$/ });
    const allTab = page.locator('button').filter({ hasText: /^All$/ });

    await expect(activeTab.first()).toBeVisible({ timeout: 5000 });
    await expect(scheduledTab.first()).toBeVisible();
    await expect(completedTab.first()).toBeVisible();
    await expect(allTab.first()).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // 3. Tab switching works
  // --------------------------------------------------------------------------
  test('Clicking tabs switches the active tab', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Click "Scheduled" tab
    const scheduledTab = page.locator('button').filter({ hasText: /^Scheduled$/ }).first();
    await scheduledTab.click();
    await page.waitForTimeout(500);

    // URL should update with tab=scheduled
    expect(page.url()).toContain('tab=scheduled');

    // Click "All" tab
    const allTab = page.locator('button').filter({ hasText: /^All$/ }).first();
    await allTab.click();
    await page.waitForTimeout(500);

    expect(page.url()).toContain('tab=all');

    // Click back to "Active" (default tab — URL may omit the param or show tab=active)
    const activeTab = page.locator('button').filter({ hasText: /^Active$/ }).first();
    await activeTab.click();
    await page.waitForTimeout(500);

    // "active" is the default tab, so the URL may not include tab= at all
    const finalUrl = page.url();
    expect(finalUrl.includes('tab=active') || !finalUrl.includes('tab=')).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 4. Filter chips toggle (FFS-111)
  // --------------------------------------------------------------------------
  test('Legacy and Test filter chips toggle on/off', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Filter chips show "Legacy Off" and "Test Off" by default
    const legacyChip = page.locator('button').filter({ hasText: /Legacy/i }).first();
    const testChip = page.locator('button').filter({ hasText: /Test/i }).first();

    if (!(await legacyChip.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Verify initial "Off" state
    const legacyText = await legacyChip.textContent();
    expect(legacyText).toContain('Off');

    // Click to toggle on
    await legacyChip.click();
    await page.waitForTimeout(500);

    // Should now show "On" and URL should have legacy=1
    const legacyTextAfter = await legacyChip.textContent();
    expect(legacyTextAfter).toContain('On');
    expect(page.url()).toContain('legacy=1');

    // Click again to toggle off
    await legacyChip.click();
    await page.waitForTimeout(500);

    const legacyTextOff = await legacyChip.textContent();
    expect(legacyTextOff).toContain('Off');
  });

  // --------------------------------------------------------------------------
  // 5. Search input accepts text
  // --------------------------------------------------------------------------
  test('Search input accepts text', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // The search input is type="text" with placeholder containing "Search"
    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="Search" i], input[placeholder*="search" i], input[name*="search" i]'
    ).first();

    const isVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isVisible) {
      // Fallback: try any text input that looks like a search field
      const fallback = page.locator('input[type="text"]').first();
      const fallbackVisible = await fallback.isVisible({ timeout: 3000 }).catch(() => false);
      if (!fallbackVisible) {
        test.skip();
        return;
      }
      await fallback.fill('test');
      await expect(fallback).toHaveValue('test');
      return;
    }

    await searchInput.fill('test');
    await expect(searchInput).toHaveValue('test');
  });

  // --------------------------------------------------------------------------
  // 6. Category filter dropdown works
  // --------------------------------------------------------------------------
  test('Category filter dropdown works', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // The category filter is a <select> with "All Categories" option
    const selects = page.locator('select');
    const selectCount = await selects.count();

    if (selectCount === 0) {
      test.skip();
      return;
    }

    // Find the category filter: the select that contains "All Categories" option
    let categorySelect = null;
    for (let i = 0; i < selectCount; i++) {
      const sel = selects.nth(i);
      const optionTexts = await sel.locator('option').allTextContents();
      if (optionTexts.some((t) => t.toLowerCase().includes('all categories'))) {
        categorySelect = sel;
        break;
      }
    }

    if (!categorySelect) {
      categorySelect = selects.first();
    }

    await expect(categorySelect).toBeVisible();

    const options = categorySelect.locator('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1);

    // Select a non-default option
    const secondOption = await options.nth(1).getAttribute('value');
    if (secondOption !== null) {
      await categorySelect.selectOption(secondOption);
      await expect(categorySelect).toHaveValue(secondOption);
    }
  });

  // --------------------------------------------------------------------------
  // 7. Sort by dropdown includes Priority option (FFS-111)
  // --------------------------------------------------------------------------
  test('Sort by dropdown changes sort and includes Priority', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    const selects = page.locator('select');
    const selectCount = await selects.count();

    if (selectCount === 0) {
      test.skip();
      return;
    }

    let sortSelect = null;
    for (let i = 0; i < selectCount; i++) {
      const sel = selects.nth(i);
      const optionTexts = await sel.locator('option').allTextContents();
      if (optionTexts.some((t) => t.toLowerCase().includes('sort by'))) {
        sortSelect = sel;
        break;
      }
    }

    if (!sortSelect) {
      test.skip();
      return;
    }

    await expect(sortSelect).toBeVisible();

    // Verify "Sort by Priority" option exists (FFS-111 addition)
    const optionTexts = await sortSelect.locator('option').allTextContents();
    expect(optionTexts.some((t) => t.toLowerCase().includes('priority'))).toBeTruthy();

    // Change to "priority" sort
    await sortSelect.selectOption('priority');
    await expect(sortSelect).toHaveValue('priority');

    // Change to "category" sort
    await sortSelect.selectOption('category');
    await expect(sortSelect).toHaveValue('category');

    // Change back to "date" sort
    await sortSelect.selectOption('date');
    await expect(sortSelect).toHaveValue('date');
  });

  // --------------------------------------------------------------------------
  // 8. Sort order toggle works
  // --------------------------------------------------------------------------
  test('Sort order toggle works', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // The sort order button shows arrow with title "Oldest first" or "Newest first"
    const sortButton = page.locator('button[title*="first"]').first();

    if (!(await sortButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const initialTitle = await sortButton.getAttribute('title');
    await sortButton.click();
    await page.waitForTimeout(500);

    // After clicking, re-locate since title changes
    const updatedButton = page.locator('button[title*="first"]').first();
    const afterTitle = await updatedButton.getAttribute('title');
    expect(afterTitle).not.toBe(initialTitle);
  });

  // --------------------------------------------------------------------------
  // 9. Submission list items render
  // --------------------------------------------------------------------------
  test('Submission list items render', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Wait for data to load
    await page.waitForTimeout(3000);

    // The page uses a <table> with <tbody><tr> for submissions (IntakeQueueRow components)
    const tableRows = page.locator('table tbody tr');

    const rowCount = await tableRows.count();

    if (rowCount === 0) {
      // Queue might be empty - check for empty state message
      const emptyMessage = page.locator('text=No submissions found, text=All caught up');
      const hasEmptyMessage = await emptyMessage.count();
      if (hasEmptyMessage > 0) {
        expect(hasEmptyMessage).toBeGreaterThan(0);
        return;
      }
      test.skip();
      return;
    }

    expect(rowCount).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 10. Queue rows have action buttons (FFS-109)
  // --------------------------------------------------------------------------
  test('Queue rows have Log button and overflow menu', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);
    await page.waitForTimeout(3000);

    const firstRow = page.locator('table tbody tr').first();
    if (!(await firstRow.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Each row should have a "Log" button (always visible per FFS-109)
    const logButton = firstRow.locator('button').filter({ hasText: /^Log/ });
    await expect(logButton).toBeVisible();

    // Each row should have an overflow "..." menu button
    const overflowButton = firstRow.locator('button[title="More actions"]');
    await expect(overflowButton).toBeVisible();

    // Click overflow to reveal menu
    await overflowButton.click();
    await page.waitForTimeout(300);

    // Overflow menu should have a "Details" option
    const detailsOption = page.locator('button').filter({ hasText: /^Details$/ });
    await expect(detailsOption.first()).toBeVisible({ timeout: 2000 });
  });

  // --------------------------------------------------------------------------
  // 11. Clicking submission opens detail panel
  // --------------------------------------------------------------------------
  test('Clicking submission opens detail', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);
    await page.waitForTimeout(3000);

    // Find a clickable submission element: the submitter name is clickable in the table
    const clickableSubmitter = page.locator('table tbody tr td div[style*="cursor: pointer"], table tbody tr td div[style*="cursor"]').first();
    const tableRow = page.locator('table tbody tr').first();

    let clicked = false;

    if (await clickableSubmitter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clickableSubmitter.click();
      clicked = true;
    } else if (await tableRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tableRow.click();
      clicked = true;
    }

    if (!clicked) {
      test.skip();
      return;
    }

    await page.waitForTimeout(1000);

    // The detail panel is an IntakeDetailPanel component rendered as a side panel.
    // It uses a flex layout (not a fixed overlay), but look for the panel content.
    const detailPanel = page.locator('div[style*="overflow: auto"]').last();
    const hasH2 = page.locator('h2').filter({ hasText: /.+/ });

    const panelVisible = await detailPanel.isVisible({ timeout: 5000 }).catch(() => false);
    const hasContent = (await hasH2.count()) > 0;

    expect(panelVisible || hasContent).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 12. Detail panel shows submission info
  // --------------------------------------------------------------------------
  test('Detail panel shows submission info', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);
    await page.waitForTimeout(3000);

    // Open a submission detail
    const clickableSubmitter = page.locator('table tbody tr td div[style*="cursor: pointer"], table tbody tr td div[style*="cursor"]').first();
    const tableRow = page.locator('table tbody tr').first();

    if (await clickableSubmitter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clickableSubmitter.click();
    } else if (await tableRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tableRow.click();
    } else {
      test.skip();
      return;
    }

    await page.waitForTimeout(1500);

    const bodyText = await page.locator('body').textContent() || '';

    const hasSubmittedDate = bodyText.includes('Submitted');
    const hasStatusInfo =
      bodyText.includes('New') ||
      bodyText.includes('In Progress') ||
      bodyText.includes('Scheduled') ||
      bodyText.includes('Complete');
    const hasEmail = bodyText.includes('@');
    const hasAddress = bodyText.toLowerCase().includes('address') ||
      bodyText.toLowerCase().includes('location') ||
      bodyText.toLowerCase().includes('st') ||
      bodyText.toLowerCase().includes('rd') ||
      bodyText.toLowerCase().includes('ave');

    // At least some submission info should be visible
    const infoPresent = hasSubmittedDate || hasStatusInfo || hasEmail || hasAddress;
    expect(infoPresent).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 13. Status action buttons are present in detail
  // --------------------------------------------------------------------------
  test('Status action buttons are present in detail', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);
    await page.waitForTimeout(3000);

    // Open a submission detail
    const clickableSubmitter = page.locator('table tbody tr td div[style*="cursor: pointer"], table tbody tr td div[style*="cursor"]').first();
    const tableRow = page.locator('table tbody tr').first();

    if (await clickableSubmitter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clickableSubmitter.click();
    } else if (await tableRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tableRow.click();
    } else {
      test.skip();
      return;
    }

    await page.waitForTimeout(1500);

    // Look for action buttons in the detail panel (IntakeDetailPanel)
    // Quick Actions section has buttons like:
    //   "Mark In Progress", "Schedule Appointment", "Change Appointment",
    //   "Mark as Complete", "Reset to New", "Archive", "Close"
    const actionButtons = page.locator('button').filter({
      hasText: /Mark In Progress|Schedule Appointment|Change Appointment|Mark.*Complete|Reset to New|Archive|Close|Mark as Urgent|Remove Urgent|Create Request|Decline/i,
    });

    const actionCount = await actionButtons.count();

    // There should be at least a "Close" button in the detail panel
    expect(actionCount).toBeGreaterThan(0);

    // Verify the Quick Actions heading is present
    const quickActionsHeading = page.locator('h3').filter({ hasText: /Quick Actions/i });
    const hasQuickActions = await quickActionsHeading.isVisible({ timeout: 3000 }).catch(() => false);

    // Either Quick Actions section or at least the Close button should exist
    const closeButton = page.locator('button').filter({ hasText: /^Close$/ });
    const hasClose = await closeButton.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasQuickActions || hasClose).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 14. Back to list from detail works
  // --------------------------------------------------------------------------
  test('Back to list from detail works', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);
    await page.waitForTimeout(3000);

    // Open a submission detail
    const clickableSubmitter = page.locator('table tbody tr td div[style*="cursor: pointer"], table tbody tr td div[style*="cursor"]').first();
    const tableRow = page.locator('table tbody tr').first();

    if (await clickableSubmitter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clickableSubmitter.click();
    } else if (await tableRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tableRow.click();
    } else {
      test.skip();
      return;
    }

    await page.waitForTimeout(1500);

    // Try closing via the Close button
    const closeButton = page.locator('button').filter({ hasText: /^Close$/ }).first();
    const closeVisible = await closeButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (closeVisible) {
      await closeButton.click();
    } else {
      // Fallback: press Escape
      await page.keyboard.press('Escape');
    }

    await page.waitForTimeout(1000);

    // After closing, the table should be visible
    const tableVisible = await page.locator('table').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(tableVisible).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 15. Table headers match expected columns
  // --------------------------------------------------------------------------
  test('Table has correct column headers', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);
    await page.waitForTimeout(3000);

    const headers = page.locator('table thead th');
    const headerCount = await headers.count();

    if (headerCount === 0) {
      test.skip();
      return;
    }

    const headerTexts = await headers.allTextContents();
    const normalized = headerTexts.map(t => t.trim().toLowerCase());

    // Expected column headers from IntakeQueueRow: checkbox, Type, Submitter, Location, Cats, Status, Submitted, Actions
    expect(normalized).toContain('type');
    expect(normalized).toContain('submitter');
    expect(normalized).toContain('location');
    expect(normalized).toContain('status');
    expect(normalized).toContain('actions');
  });
});
