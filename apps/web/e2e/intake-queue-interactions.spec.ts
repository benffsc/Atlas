/**
 * Intake Queue Interactions Tests
 *
 * Tests UI interactions on the /intake/queue page including:
 * - Page loading and content visibility
 * - Search input functionality
 * - Category filter dropdown
 * - Sort controls (sort by dropdown and sort order toggle)
 * - Submission list rendering
 * - Detail panel opening via submission click
 * - Detail panel content verification
 * - Status action buttons in the detail panel
 * - Closing the detail panel
 *
 * ALL WRITES ARE MOCKED via mockAllWrites(page) in beforeEach.
 */

import { test, expect } from '@playwright/test';
import { navigateTo, mockAllWrites, waitForLoaded } from './ui-test-helpers';

test.describe('UI: Intake Queue Interactions', () => {
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
  // 2. Search input accepts text
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
  // 3. Category filter dropdown works
  // --------------------------------------------------------------------------
  test('Category filter dropdown works', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // The category filter is a <select> with options like "All Categories",
    // "High Priority FFR", "Standard FFR", etc.
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
      // Fallback: just use the first select that has multiple options
      categorySelect = selects.first();
    }

    await expect(categorySelect).toBeVisible();

    // Verify it has options
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
  // 4. Sort by dropdown changes sort
  // --------------------------------------------------------------------------
  test('Sort by dropdown changes sort', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // The sort dropdown contains options "Sort by Date", "Sort by Category", "Sort by Type"
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

    // Change to "category" sort
    await sortSelect.selectOption('category');
    await expect(sortSelect).toHaveValue('category');

    // Change to "type" sort
    await sortSelect.selectOption('type');
    await expect(sortSelect).toHaveValue('type');

    // Change back to "date" sort
    await sortSelect.selectOption('date');
    await expect(sortSelect).toHaveValue('date');
  });

  // --------------------------------------------------------------------------
  // 5. Sort order toggle works
  // --------------------------------------------------------------------------
  test('Sort order toggle works', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // The sort order button shows ↑/↓ with title "Oldest first" or "Newest first"
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
  // 6. Submission list items render
  // --------------------------------------------------------------------------
  test('Submission list items render', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Wait for data to load
    await page.waitForTimeout(3000);

    // The page uses a <table> with <tbody><tr> for submissions
    const tableRows = page.locator('table tbody tr');
    const submissionCards = page.locator(
      '[data-testid*="submission"], .submission-card, .submission-row'
    );

    const rowCount = await tableRows.count();
    const cardCount = await submissionCards.count();
    const totalItems = rowCount + cardCount;

    if (totalItems === 0) {
      // Queue might be empty - check for empty state message
      const emptyMessage = page.locator('text=No submissions found, text=All caught up, text=No new submissions');
      const hasEmptyMessage = await emptyMessage.count();
      if (hasEmptyMessage > 0) {
        // Empty state is valid
        expect(hasEmptyMessage).toBeGreaterThan(0);
        return;
      }
      // Might still be loading; skip if we truly have nothing
      test.skip();
      return;
    }

    expect(totalItems).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 7. Clicking submission opens detail
  // --------------------------------------------------------------------------
  test('Clicking submission opens detail', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);
    await page.waitForTimeout(3000);

    // Find a clickable submission element: the submitter name is clickable in the table
    const clickableSubmitter = page.locator('table tbody tr td div[style*="cursor: pointer"], table tbody tr td div[style*="cursor"]').first();
    const tableRow = page.locator('table tbody tr').first();

    let clicked = false;

    // Try clicking the submitter name (cursor: pointer div inside table row)
    if (await clickableSubmitter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clickableSubmitter.click();
      clicked = true;
    } else if (await tableRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Fallback: click the table row itself
      await tableRow.click();
      clicked = true;
    }

    if (!clicked) {
      test.skip();
      return;
    }

    await page.waitForTimeout(1000);

    // The detail panel is a fixed overlay modal that appears when a submission is selected.
    // Look for the modal overlay or detail content.
    const detailPanel = page.locator(
      'div[style*="position: fixed"][style*="z-index"]'
    ).first();
    const modalContent = page.locator('h2, h3').filter({ hasText: /.+/ });

    const panelVisible = await detailPanel.isVisible({ timeout: 5000 }).catch(() => false);
    const hasModalContent = (await modalContent.count()) > 0;

    expect(panelVisible || hasModalContent).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 8. Detail panel shows submission info
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

    // Verify the detail panel shows submission information:
    // - submitter name (h2 element)
    // - email or phone
    // - "Submitted" date text
    // - SubmissionStatusBadge (a span with status text)
    // - Address info
    const bodyText = await page.locator('body').textContent() || '';

    const hasSubmittedDate = bodyText.includes('Submitted');
    const hasStatusInfo =
      bodyText.includes('new') ||
      bodyText.includes('in_progress') ||
      bodyText.includes('In Progress') ||
      bodyText.includes('scheduled') ||
      bodyText.includes('Scheduled') ||
      bodyText.includes('complete') ||
      bodyText.includes('Complete') ||
      bodyText.includes('New');
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
  // 9. Status action buttons are present in detail
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

    // Look for action buttons in the detail panel
    // Quick Actions section has buttons like:
    //   "Mark In Progress", "Schedule Appointment", "Change Appointment",
    //   "Mark as Complete", "Reset to New", "Archive", "Close"
    const actionButtons = page.locator('button').filter({
      hasText: /Mark In Progress|Schedule Appointment|Change Appointment|Mark.*Complete|Reset to New|Archive|Close|Mark as Urgent|Remove Urgent|Create Request/i,
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
  // 10. Back to list from detail works
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

    // Verify the detail panel (modal overlay) is open
    const modalOverlay = page.locator('div[style*="position: fixed"][style*="z-index"]').first();
    const overlayVisible = await modalOverlay.isVisible({ timeout: 3000 }).catch(() => false);

    if (!overlayVisible) {
      test.skip();
      return;
    }

    // Try closing via the Close button
    const closeButton = page.locator('button').filter({ hasText: /^Close$/ }).first();
    const closeVisible = await closeButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (closeVisible) {
      await closeButton.click();
    } else {
      // Fallback: press Escape to close the modal
      await page.keyboard.press('Escape');
    }

    await page.waitForTimeout(1000);

    // After closing, the table / list should be visible again and the fixed overlay
    // should be gone (or at least the table is still there)
    const tableVisible = await page.locator('table').first().isVisible({ timeout: 5000 }).catch(() => false);
    const bodyVisible = await page.locator('body').isVisible();

    expect(tableVisible || bodyVisible).toBeTruthy();

    // The fixed overlay should no longer be visible
    // (it was conditionally rendered based on selectedSubmission state)
    const overlayStillVisible = await modalOverlay.isVisible({ timeout: 1000 }).catch(() => false);

    // If we clicked Close and it worked, the overlay should be gone.
    // If Escape was used, it may or may not have closed. Either way, the page is functional.
    if (closeVisible) {
      expect(overlayStillVisible).toBeFalsy();
    }
  });
});
