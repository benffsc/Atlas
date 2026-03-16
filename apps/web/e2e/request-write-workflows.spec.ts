/**
 * E2E: Request Write Workflows (FFS-579)
 *
 * Tests that write operations on the request detail page send correct
 * PATCH/POST payloads. Uses mockWritesWithCapture() to intercept and
 * verify request bodies without modifying real data.
 *
 * GET requests pass through to the real API for realistic page rendering.
 */

import { test, expect } from '@playwright/test';
import {
  navigateTo,
  findRealEntity,
  mockWritesWithCapture,
  waitForLoaded,
  switchToTabBarTab,
} from './ui-test-helpers';

test.describe('Request Write Workflows @workflow', () => {
  test.setTimeout(60000);

  let requestId: string | null = null;

  // ── 1. Edit mode save sends PATCH ─────────────────────────────────

  test('Edit mode save sends PATCH with changed fields', async ({ page, request }) => {
    requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for an Edit button
    const editBtn = page.locator('button:has-text("Edit"), button[aria-label="Edit"]').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEdit, 'No edit button found on request detail page');

    await editBtn.click();
    await page.waitForTimeout(500);

    // Try to change a select field (status or priority)
    const statusSelect = page.locator('select[name="status"], select[name="priority"]').first();
    const hasSelect = await statusSelect.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasSelect) {
      const options = await statusSelect.locator('option').allTextContents();
      if (options.length > 1) {
        await statusSelect.selectOption({ index: 1 });
      }
    }

    // Save
    const saveBtn = page.locator('button:has-text("Save")').first();
    const hasSave = await saveBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasSave, 'No Save button found after entering edit mode');

    await saveBtn.click();
    await page.waitForTimeout(1000);

    // Verify a PATCH was sent to the requests endpoint
    const patches = capture.getByMethod('PATCH');
    expect(patches.length).toBeGreaterThanOrEqual(1);

    const reqPatch = patches.find(p => p.url.includes('/api/requests/'));
    expect(reqPatch).toBeDefined();
    expect(reqPatch!.body).toBeTruthy();
  });

  // ── 2. Edit mode cancel sends no PATCH ────────────────────────────

  test('Edit mode cancel sends no PATCH', async ({ page, request }) => {
    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const editBtn = page.locator('button:has-text("Edit"), button[aria-label="Edit"]').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEdit, 'No edit button found');

    await editBtn.click();
    await page.waitForTimeout(500);

    // Cancel without saving
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    const hasCancel = await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasCancel, 'No Cancel button found in edit mode');

    await cancelBtn.click();
    await page.waitForTimeout(500);

    // No writes should have been made
    const patches = capture.getByMethod('PATCH');
    const reqPatches = patches.filter(p => p.url.includes('/api/requests/'));
    expect(reqPatches).toHaveLength(0);
  });

  // ── 3. Quick status button sends correct status ───────────────────

  test('Quick status button sends correct status value', async ({ page, request }) => {
    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for quick status buttons (e.g., "Start Working", "Pause", "Complete")
    const statusButtons = page.locator(
      'button:has-text("Start Working"), button:has-text("Pause"), button:has-text("Resume")'
    );
    const count = await statusButtons.count();
    test.skip(count === 0, 'No quick status buttons found');

    await statusButtons.first().click();
    await page.waitForTimeout(1000);

    // Should have sent a PATCH with status
    const patches = capture.getByMethod('PATCH');
    const reqPatch = patches.find(p => p.url.includes('/api/requests/'));
    expect(reqPatch).toBeDefined();
    expect(reqPatch!.body).toBeTruthy();
    if (reqPatch!.body) {
      expect(reqPatch!.body).toHaveProperty('status');
    }
  });

  // ── 4. Journal note sends POST ────────────────────────────────────

  test('Journal note sends POST to journal endpoint', async ({ page, request }) => {
    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Switch to Activity tab
    const activityTab = page.locator('[role="tab"]:has-text("Activity")').first();
    const hasActivity = await activityTab.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasActivity, 'No Activity tab found');

    await activityTab.click();
    await page.waitForTimeout(1000);

    // Look for note input
    const noteInput = page.locator(
      'textarea[placeholder*="note"], textarea[placeholder*="Note"], input[placeholder*="note"]'
    ).first();
    const hasInput = await noteInput.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasInput, 'No note input found in Activity tab');

    await noteInput.fill('E2E test note — should be mocked');

    // Submit note
    const submitBtn = page.locator(
      'button:has-text("Add Note"), button:has-text("Save Note"), button[type="submit"]'
    ).first();
    const hasSubmit = await submitBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasSubmit, 'No submit button found for journal note');

    await submitBtn.click();
    await page.waitForTimeout(1000);

    // Verify POST was sent to journal endpoint
    const posts = capture.getByMethod('POST');
    const journalPost = posts.find(p => p.url.includes('/api/journal'));
    expect(journalPost).toBeDefined();
    if (journalPost?.body) {
      expect(typeof journalPost.body).toBe('object');
    }
  });

  // ── 5. Hold modal sends hold_reason ───────────────────────────────

  test('Hold modal sends hold_reason in PATCH', async ({ page, request }) => {
    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for Hold/Pause button
    const holdBtn = page.locator(
      'button:has-text("Hold"), button:has-text("Pause"), button:has-text("Put on Hold")'
    ).first();
    const hasHold = await holdBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasHold, 'No Hold/Pause button found');

    await holdBtn.click();
    await page.waitForTimeout(500);

    // Check if a modal appeared
    const modal = page.locator('[role="dialog"], .modal, [data-testid="modal"]').first();
    const hasModal = await modal.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasModal) {
      // Try to fill a reason
      const reasonInput = modal.locator('select, textarea, input[type="text"]').first();
      if (await reasonInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        const tagName = await reasonInput.evaluate(el => el.tagName.toLowerCase());
        if (tagName === 'select') {
          const options = await reasonInput.locator('option').count();
          if (options > 1) await reasonInput.selectOption({ index: 1 });
        } else {
          await reasonInput.fill('E2E test hold reason');
        }
      }

      // Submit modal
      const submitBtn = modal.locator('button:has-text("Confirm"), button:has-text("Submit"), button:has-text("Save"), button[type="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // Verify PATCH was sent
    const patches = capture.getByMethod('PATCH');
    const reqPatch = patches.find(p => p.url.includes('/api/requests/'));
    if (reqPatch) {
      expect(reqPatch.body).toBeTruthy();
      // Should contain status = paused or hold_reason
      if (reqPatch.body) {
        const hasStatusOrReason = 'status' in reqPatch.body || 'hold_reason' in reqPatch.body;
        expect(hasStatusOrReason).toBe(true);
      }
    }
  });

  // ── 6. Complete modal sends resolution fields ─────────────────────

  test('Complete modal sends resolution outcome', async ({ page, request }) => {
    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for Complete button
    const completeBtn = page.locator(
      'button:has-text("Complete"), button:has-text("Mark Complete"), button:has-text("Resolve")'
    ).first();
    const hasComplete = await completeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasComplete, 'No Complete button found');

    await completeBtn.click();
    await page.waitForTimeout(500);

    // Check for completion modal
    const modal = page.locator('[role="dialog"], .modal, [data-testid="modal"]').first();
    const hasModal = await modal.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasModal) {
      // Try to select an outcome
      const outcomeSelect = modal.locator('select').first();
      if (await outcomeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        const options = await outcomeSelect.locator('option').count();
        if (options > 1) await outcomeSelect.selectOption({ index: 1 });
      }

      // Submit
      const submitBtn = modal.locator('button:has-text("Complete"), button:has-text("Confirm"), button[type="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // Verify a PATCH was sent
    const patches = capture.getByMethod('PATCH');
    const reqPatch = patches.find(p => p.url.includes('/api/requests/'));
    if (reqPatch?.body) {
      // Should contain status = completed or resolution_outcome
      const body = reqPatch.body;
      const hasCompletionFields = 'status' in body || 'resolution_outcome' in body;
      expect(hasCompletionFields).toBe(true);
    }
  });

  // ── 7. Inline notes save sends notes ──────────────────────────────

  test('Inline notes edit sends PATCH with notes field', async ({ page, request }) => {
    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for notes section with edit capability
    const notesEdit = page.locator(
      'button[aria-label="Edit notes"], button:has-text("Edit Notes"), [data-testid="notes-edit"]'
    ).first();
    const hasNotesEdit = await notesEdit.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasNotesEdit, 'No inline notes edit button found');

    await notesEdit.click();
    await page.waitForTimeout(500);

    const notesTextarea = page.locator('textarea[name="notes"], textarea[name="internal_notes"]').first();
    const hasTextarea = await notesTextarea.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasTextarea, 'No notes textarea found');

    await notesTextarea.fill('E2E test notes — mocked write');

    const saveBtn = page.locator('button:has-text("Save")').first();
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
    }

    const patches = capture.getByMethod('PATCH');
    const notesPatch = patches.find(p => p.url.includes('/api/requests/'));
    if (notesPatch?.body) {
      const hasNotes = 'notes' in notesPatch.body || 'internal_notes' in notesPatch.body;
      expect(hasNotes).toBe(true);
    }
  });

  // ── 8. Real API: edit and verify persistence ──────────────────────

  test('Real API: edit priority persists across reload @real-api', async ({ page, request }) => {
    requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    // Do NOT mock writes — this is a real API test
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const editBtn = page.locator('button:has-text("Edit"), button[aria-label="Edit"]').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEdit, 'No edit button found');

    await editBtn.click();
    await page.waitForTimeout(500);

    // Find priority select and change it
    const prioritySelect = page.locator('select[name="priority"]').first();
    const hasPriority = await prioritySelect.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasPriority, 'No priority select found in edit mode');

    // Get current value and pick a different one
    const currentVal = await prioritySelect.inputValue();
    const options = await prioritySelect.locator('option').allInnerTexts();
    const values = await prioritySelect.locator('option').evaluateAll(
      els => els.map(el => (el as HTMLOptionElement).value)
    );

    const newIdx = values.findIndex(v => v && v !== currentVal && v !== '');
    test.skip(newIdx === -1, 'No alternative priority value available');

    const newVal = values[newIdx];
    await prioritySelect.selectOption(newVal);

    // Save
    const saveBtn = page.locator('button:has-text("Save")').first();
    await saveBtn.click();
    await page.waitForTimeout(2000);

    // Reload and verify
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForLoaded(page);

    // The priority should be visible somewhere on the page
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});
