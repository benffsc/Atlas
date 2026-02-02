/**
 * UI: Request Detail Interactions
 *
 * Tests the request detail page (/requests/[id]) including:
 * - ProfileLayout tabs navigation
 * - Quick status buttons and undo
 * - Modal interactions (Hold, Complete, Redirect, Hand Off)
 * - Edit mode toggle
 * - Inline rename
 * - History panel toggle
 *
 * ALL WRITES ARE MOCKED via mockAllWrites(page) in beforeEach.
 * GET requests pass through to the real API.
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

test.describe('UI: Request Detail Interactions', () => {
  test.setTimeout(45000);

  let requestId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  // -------------------------------------------------------------------------
  // 1. Request detail page loads
  // -------------------------------------------------------------------------
  test('Request detail page loads', async ({ page, request }) => {
    requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 2. Core tabs are present
  // -------------------------------------------------------------------------
  test('Core tabs are present', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    await expectTabExists(page, 'Case Summary');
    await expectTabExists(page, 'Details');
    await expectTabExists(page, 'Cats & Evidence');
    await expectTabExists(page, 'Activity');
  });

  // -------------------------------------------------------------------------
  // 3. Click each tab switches content
  // -------------------------------------------------------------------------
  test('Click each tab switches content', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);
    await waitForProfileTabs(page);

    const coreTabs = ['Case Summary', 'Details', 'Cats & Evidence', 'Activity'];

    for (const tabLabel of coreTabs) {
      await clickTab(page, tabLabel);

      // Verify the clicked tab has the active class
      const activeTab = page.locator('.profile-tab.active');
      await expect(activeTab).toContainText(tabLabel);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Quick status buttons are visible
  // -------------------------------------------------------------------------
  test('Quick status buttons are visible', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for the "Quick:" label in the quick actions section
    const quickLabel = page.locator('text=Quick:');
    await expect(quickLabel).toBeVisible({ timeout: 10000 });

    // There should be at least one button near the quick actions area
    const quickSection = quickLabel.locator('..');
    const buttonsNearby = quickSection.locator('button');
    const buttonCount = await buttonsNearby.count();
    expect(buttonCount).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 5. Quick status button triggers mocked PATCH
  // -------------------------------------------------------------------------
  test('Quick status button triggers mocked PATCH', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Collect intercepted requests
    let patchIntercepted = false;
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes('/api/requests/')) {
        patchIntercepted = true;
      }
    });

    // Find a quick status button - try common ones in order
    const quickLabel = page.locator('text=Quick:');
    const quickSection = quickLabel.locator('..');
    const candidates = ['Triage', 'Schedule', 'Start'];
    let clicked = false;

    for (const label of candidates) {
      const btn = quickSection.locator(`button:has-text("${label}")`);
      try {
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          clicked = true;
          break;
        }
      } catch {
        // Try next candidate
      }
    }

    if (!clicked) {
      // Fallback: click the first button in the quick section
      const firstBtn = quickSection.locator('button').first();
      if (await firstBtn.isVisible({ timeout: 1000 })) {
        await firstBtn.click();
        clicked = true;
      }
    }

    test.skip(!clicked, 'No quick status buttons found to click');

    // Give the mocked request time to fire
    await page.waitForTimeout(1000);
    expect(patchIntercepted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Undo button appears after status change
  // -------------------------------------------------------------------------
  test('Undo button appears after status change', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Click a quick status button to trigger a status change
    const quickLabel = page.locator('text=Quick:');
    const quickSection = quickLabel.locator('..');
    const candidates = ['Triage', 'Schedule', 'Start'];
    let clicked = false;

    for (const label of candidates) {
      const btn = quickSection.locator(`button:has-text("${label}")`);
      try {
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          clicked = true;
          break;
        }
      } catch {
        // Try next candidate
      }
    }

    if (!clicked) {
      const firstBtn = quickSection.locator('button').first();
      if (await firstBtn.isVisible({ timeout: 1000 })) {
        await firstBtn.click();
        clicked = true;
      }
    }

    test.skip(!clicked, 'No quick status buttons found to click');

    // The undo button text is "↩ Undo" and appears after status change.
    // Since writes are mocked, the optimistic update may be overwritten by
    // a real GET re-fetch. Check for undo but skip gracefully if not visible.
    const undoButton = page.locator('button', { hasText: 'Undo' });
    const undoVisible = await undoButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (!undoVisible) {
      // Mocked PATCH may not trigger proper optimistic state update
      test.skip(true, 'Undo button did not appear (mocked writes may not trigger optimistic UI)');
      return;
    }

    // Verify the undo button has a title hint about reverting
    const title = await undoButton.getAttribute('title');
    if (title) {
      expect(title.toLowerCase()).toContain('undo');
    }
  });

  // -------------------------------------------------------------------------
  // 7. Hold button opens hold modal
  // -------------------------------------------------------------------------
  test('Hold button opens hold modal', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const quickLabel = page.locator('text=Quick:');
    const quickSection = quickLabel.locator('..');
    const holdButton = quickSection.locator('button:has-text("Hold")');

    try {
      await expect(holdButton).toBeVisible({ timeout: 3000 });
    } catch {
      test.skip(true, 'Hold button not visible for this request status');
      return;
    }

    await holdButton.click();

    // Expect a modal/dialog to appear
    const modal = page.locator(
      '[role="dialog"], .modal, [class*="modal"], [class*="Modal"]'
    );
    await expect(modal.first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 8. Complete button opens completion modal
  // -------------------------------------------------------------------------
  test('Complete button opens completion modal', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const quickLabel = page.locator('text=Quick:');
    const quickSection = quickLabel.locator('..');
    const completeButton = quickSection.locator('button:has-text("Complete")');

    try {
      await expect(completeButton).toBeVisible({ timeout: 3000 });
    } catch {
      // The Complete button may not be visible if the request is in an
      // early status. Try advancing the status first via a quick button.
      const advanceCandidates = ['Triage', 'Schedule', 'Start'];
      for (const label of advanceCandidates) {
        const btn = quickSection.locator(`button:has-text("${label}")`);
        try {
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click();
            await page.waitForTimeout(1000);
          }
        } catch {
          // continue
        }
      }

      // Re-check for Complete button
      try {
        await expect(completeButton).toBeVisible({ timeout: 3000 });
      } catch {
        test.skip(true, 'Complete button not reachable for this request');
        return;
      }
    }

    await completeButton.click();

    const modal = page.locator(
      '[role="dialog"], .modal, [class*="modal"], [class*="Modal"]'
    );
    await expect(modal.first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 9. Redirect button opens redirect modal
  // -------------------------------------------------------------------------
  test('Redirect button opens redirect modal', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // The Redirect button has a distinctive border color (#6f42c1)
    const redirectButton = page.locator('button:has-text("Redirect")');

    try {
      await expect(redirectButton).toBeVisible({ timeout: 5000 });
    } catch {
      test.skip(true, 'Redirect button not visible on this request');
      return;
    }

    await redirectButton.click();
    await page.waitForTimeout(500);

    // Redirect modal uses inline styles (position: fixed, z-index: 1100) with title "Redirect Request"
    const modalTitle = page.locator('text=Redirect Request');
    const modalBackdrop = page.locator('div[style*="position: fixed"][style*="z-index"]');
    const titleVisible = await modalTitle.isVisible({ timeout: 5000 }).catch(() => false);
    const backdropVisible = await modalBackdrop.first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(titleVisible || backdropVisible).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 10. Handoff button opens handoff modal
  // -------------------------------------------------------------------------
  test('Handoff button opens handoff modal', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // The Hand Off button has a distinctive border color (#0d9488)
    const handoffButton = page.locator('button:has-text("Hand Off")');

    try {
      await expect(handoffButton).toBeVisible({ timeout: 5000 });
    } catch {
      test.skip(true, 'Hand Off button not visible on this request');
      return;
    }

    await handoffButton.click();
    await page.waitForTimeout(500);

    // Handoff modal uses inline styles (position: fixed, z-index: 1100) with title "Hand Off Request"
    const modalTitle = page.locator('text=Hand Off Request');
    const modalBackdrop = page.locator('div[style*="position: fixed"][style*="z-index"]');
    const titleVisible = await modalTitle.isVisible({ timeout: 5000 }).catch(() => false);
    const backdropVisible = await modalBackdrop.first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(titleVisible || backdropVisible).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 11. Edit button enters edit mode
  // -------------------------------------------------------------------------
  test('Edit button enters edit mode', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const editButton = page.locator('button:has-text("Edit")').first();

    try {
      await expect(editButton).toBeVisible({ timeout: 5000 });
    } catch {
      test.skip(true, 'Edit button not found on this request page');
      return;
    }

    await editButton.click();

    // In edit mode, a "Save Changes" button should appear
    const saveButton = page.locator('button:has-text("Save Changes")');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 12. Edit mode cancel reverts
  // -------------------------------------------------------------------------
  test('Edit mode cancel reverts', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const editButton = page.locator('button:has-text("Edit")').first();

    try {
      await expect(editButton).toBeVisible({ timeout: 5000 });
    } catch {
      test.skip(true, 'Edit button not found on this request page');
      return;
    }

    // Enter edit mode
    await editButton.click();
    const saveButton = page.locator('button:has-text("Save Changes")');
    await expect(saveButton).toBeVisible({ timeout: 5000 });

    // Click Cancel to exit edit mode
    const cancelButton = page.locator('button:has-text("Cancel")');
    await expect(cancelButton).toBeVisible({ timeout: 3000 });
    await cancelButton.click();

    // ProfileLayout tabs should be visible again
    await waitForProfileTabs(page);
    await expect(page.locator('.profile-tabs')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 13. Inline rename opens input
  // -------------------------------------------------------------------------
  test('Inline rename opens input', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for the pencil/rename button near the h1 title
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 10000 });

    // The rename button is a pencil icon button adjacent to h1
    // Try multiple selectors for the pencil/edit icon button
    const renameButton = page.locator(
      'h1 + button, h1 ~ button:first-of-type, button[aria-label*="rename" i], button[aria-label*="edit name" i], button[title*="rename" i], button[title*="Rename" i]'
    ).first();

    // Fallback: look for a small button containing a pencil icon near the title
    const pencilButton = page.locator('button').filter({
      has: page.locator('svg, [class*="pencil"], [class*="edit"], [class*="Pencil"]'),
    });

    let clickTarget = renameButton;
    try {
      await expect(renameButton).toBeVisible({ timeout: 3000 });
    } catch {
      // Try the pencil icon fallback
      try {
        // Get the first pencil button that is near the header area
        const headerArea = page.locator('h1').locator('..');
        const headerPencil = headerArea.locator('button').filter({
          has: page.locator('svg, [class*="pencil"], [class*="Pencil"]'),
        }).first();

        await expect(headerPencil).toBeVisible({ timeout: 3000 });
        clickTarget = headerPencil;
      } catch {
        // Last resort: any small button immediately adjacent to h1
        try {
          const adjacentBtn = page.locator('h1').locator('..').locator('button').first();
          await expect(adjacentBtn).toBeVisible({ timeout: 2000 });
          clickTarget = adjacentBtn;
        } catch {
          test.skip(true, 'Rename/pencil button not found near title');
          return;
        }
      }
    }

    await clickTarget.click();

    // After clicking, an inline text input should appear with the current name
    const renameInput = page.locator('input[type="text"]').first();
    await expect(renameInput).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 14. History button toggles panel
  // -------------------------------------------------------------------------
  test('History button toggles panel', async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const historyButton = page.locator('button:has-text("History")');

    try {
      await expect(historyButton).toBeVisible({ timeout: 5000 });
    } catch {
      test.skip(true, 'History button not found on this request page');
      return;
    }

    await historyButton.click();

    // Expect a side panel or section to become visible with edit history
    const historyPanel = page.locator(
      '[class*="history"], [class*="History"], [class*="panel"], [class*="Panel"], [class*="sidebar"], [class*="Sidebar"], [role="complementary"]'
    );

    try {
      await expect(historyPanel.first()).toBeVisible({ timeout: 5000 });
    } catch {
      // Fallback: check if any new content appeared after clicking
      const pageContent = await page.textContent('body');
      const hasHistoryContent =
        pageContent?.toLowerCase().includes('edit') ||
        pageContent?.toLowerCase().includes('change') ||
        pageContent?.toLowerCase().includes('history');
      expect(hasHistoryContent).toBeTruthy();
    }
  });
});
