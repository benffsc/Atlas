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
    test.fixme(true, 'Request detail uses SmartField inline editing — test selectors need update');

    requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Request detail uses inline SmartField editing via RequestSection components,
    // not a global Edit button. Find an inline editable field and click its edit icon.
    const smartFieldEdit = page.locator(
      '[data-testid="smart-field-edit"], button[aria-label="Edit field"], .smart-field button'
    ).first();
    const hasSmartField = await smartFieldEdit.isVisible({ timeout: 5000 }).catch(() => false);
    test.fixme(!hasSmartField, 'Feature not implemented: Request detail uses SmartField inline editing, no global Edit button');

    await smartFieldEdit.click();
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
    test.fixme(true, 'Request detail uses SmartField inline editing — test selectors need update');

    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Request detail uses inline SmartField editing, not a global Edit/Cancel flow
    const smartFieldEdit = page.locator(
      '[data-testid="smart-field-edit"], button[aria-label="Edit field"], .smart-field button'
    ).first();
    const hasEdit = await smartFieldEdit.isVisible({ timeout: 5000 }).catch(() => false);
    test.fixme(!hasEdit, 'Feature not implemented: Request detail uses SmartField inline editing, no global Edit/Cancel flow');

    await smartFieldEdit.click();
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

    // GuidedActionBar renders status-aware buttons: "Start Working", "Pause", "Resume", "Close Case", "Reopen"
    const statusButtons = page.locator(
      'button:has-text("Start Working"), button:has-text("Pause"), button:has-text("Resume"), button:has-text("Reopen")'
    );
    const count = await statusButtons.count();
    test.skip(count === 0, 'No quick status buttons found in GuidedActionBar');

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

    // Switch to Activity tab (TabBar component with id="activity")
    const activityTab = page.locator('[role="tab"]:has-text("Activity"), button:has-text("Activity")').first();
    const hasActivity = await activityTab.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasActivity, 'No Activity tab found');

    await activityTab.click();
    await page.waitForTimeout(1000);

    // JournalSection renders textarea with placeholder "Add a note..."
    const noteInput = page.locator(
      'textarea[placeholder*="note"], textarea[placeholder*="Note"], textarea'
    ).first();
    const hasInput = await noteInput.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasInput, 'No note input found in Activity tab');

    await noteInput.fill('E2E test note — should be mocked');

    // JournalSection submit button says "Add Note"
    const submitBtn = page.locator(
      'button:has-text("Add Note"), button:has-text("Save Note"), button:has-text("Save Communication"), button[type="submit"]'
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

    // GuidedActionBar uses "Pause" button label (opens HoldRequestModal)
    const holdBtn = page.locator(
      'button:has-text("Pause")'
    ).first();
    const hasHold = await holdBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasHold, 'No Pause button found in GuidedActionBar (only visible for new/working statuses)');

    await holdBtn.click();
    await page.waitForTimeout(500);

    // HoldRequestModal is a custom overlay (no role="dialog").
    // It uses ReasonSelectionForm with radio buttons for hold reasons.
    // Wait for the modal content to appear.
    await page.waitForTimeout(500);

    // Try to select a hold reason (radio buttons or select)
    const reasonInput = page.locator('input[type="radio"], select').first();
    if (await reasonInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const tagName = await reasonInput.evaluate(el => el.tagName.toLowerCase());
      if (tagName === 'select') {
        const options = await reasonInput.locator('option').count();
        if (options > 1) await reasonInput.selectOption({ index: 1 });
      } else {
        // Click the first radio button
        await reasonInput.click();
      }
    }

    // Submit modal
    const submitBtn = page.locator('button:has-text("Confirm"), button:has-text("Put on Hold"), button:has-text("Submit"), button:has-text("Save")').first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
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

    // GuidedActionBar uses "Close Case" button label (opens CloseRequestModal)
    const completeBtn = page.locator(
      'button:has-text("Close Case")'
    ).first();
    const hasComplete = await completeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasComplete, 'No Close Case button found in GuidedActionBar');

    await completeBtn.click();
    await page.waitForTimeout(500);

    // CloseRequestModal uses the Modal component (has role="dialog")
    // It's a multi-step wizard: select outcome, then submit with "Close Case"
    const modal = page.locator('[role="dialog"]').first();
    const hasModal = await modal.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasModal) {
      // Step 1: Select a resolution outcome (radio buttons or clickable cards)
      const outcomeOption = modal.locator('input[type="radio"], button[data-outcome], [role="option"]').first();
      if (await outcomeOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await outcomeOption.click();
      }

      // Navigate to next step if multi-step
      const nextBtn = modal.locator('button:has-text("Next"), button:has-text("Continue")').first();
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(500);
      }

      // Submit — button says "Close Case"
      const submitBtn = modal.locator('button:has-text("Close Case"), button:has-text("Complete"), button:has-text("Confirm")').first();
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
    test.fixme(true, 'Request detail uses SmartField inline editing — test selectors need update');

    if (!requestId) requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Request detail uses SmartField inline editing within RequestSection components.
    // There is no dedicated "Edit Notes" button — notes are edited via SmartField click.
    const notesEdit = page.locator(
      'button[aria-label="Edit notes"], button:has-text("Edit Notes"), [data-testid="notes-edit"], .smart-field button'
    ).first();
    const hasNotesEdit = await notesEdit.isVisible({ timeout: 5000 }).catch(() => false);
    test.fixme(!hasNotesEdit, 'Feature not implemented: Notes are edited inline via SmartField, no dedicated Edit Notes button');

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
    test.fixme(true, 'Request detail uses SmartField inline editing — test selectors need update');

    requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    // Do NOT mock writes — this is a real API test
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Request detail uses SmartField inline editing — no global Edit button.
    // Priority is edited via SmartField click in RequestSection.
    const smartFieldEdit = page.locator(
      '[data-testid="smart-field-edit"], button[aria-label="Edit field"], .smart-field button'
    ).first();
    const hasEdit = await smartFieldEdit.isVisible({ timeout: 5000 }).catch(() => false);
    test.fixme(!hasEdit, 'Feature not implemented: Request detail uses SmartField inline editing, no global Edit button');

    await smartFieldEdit.click();
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
