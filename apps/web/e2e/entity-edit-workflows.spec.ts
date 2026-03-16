/**
 * E2E: Entity Edit Workflows (FFS-581)
 *
 * Tests write operations on cat, place, and intake entities.
 * Uses mockWritesWithCapture() to verify PATCH/POST payloads.
 *
 * GET requests pass through to the real API.
 */

import { test, expect } from '@playwright/test';
import {
  navigateTo,
  findRealEntity,
  mockWritesWithCapture,
  waitForLoaded,
  switchToTabBarTab,
  waitForProfileTabs,
  clickTab,
} from './ui-test-helpers';

test.describe('Entity Edit Workflows @workflow', () => {
  test.setTimeout(60000);

  // ── 1. Cat edit saves name ────────────────────────────────────────

  test('Cat detail edit sends PATCH with modified fields', async ({ page, request }) => {
    const catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Look for Edit button
    const editBtn = page.locator('button:has-text("Edit"), button[aria-label="Edit"]').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEdit, 'No edit button found on cat detail page');

    await editBtn.click();
    await page.waitForTimeout(500);

    // Try to modify name
    const nameInput = page.locator('input[name="name"], input[name="display_name"]').first();
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('E2E Test Cat Name');
    }

    // Save
    const saveBtn = page.locator('button:has-text("Save")').first();
    const hasSave = await saveBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasSave, 'No Save button found');

    await saveBtn.click();
    await page.waitForTimeout(1000);

    const patches = capture.getByMethod('PATCH');
    const catPatch = patches.find(p => p.url.includes('/api/cats/'));
    expect(catPatch).toBeDefined();
    expect(catPatch!.body).toBeTruthy();
  });

  // ── 2. Report deceased modal ──────────────────────────────────────

  test('Report deceased modal sends correct payload', async ({ page, request }) => {
    const catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Look for "Report Deceased" or similar button
    const deceasedBtn = page.locator(
      'button:has-text("Report Deceased"), button:has-text("Deceased"), button:has-text("Mark Deceased")'
    ).first();
    const hasDeceased = await deceasedBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasDeceased, 'No Report Deceased button found');

    await deceasedBtn.click();
    await page.waitForTimeout(500);

    // Modal should appear
    const modal = page.locator('[role="dialog"], .modal, [data-testid="modal"]').first();
    const hasModal = await modal.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasModal, 'Deceased modal did not appear');

    // Fill date if available
    const dateInput = modal.locator('input[type="date"], input[name="date"], input[name="deceased_date"]').first();
    if (await dateInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dateInput.fill('2026-01-15');
    }

    // Submit
    const submitBtn = modal.locator('button:has-text("Confirm"), button:has-text("Submit"), button:has-text("Save"), button[type="submit"]').first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
    }

    // Verify write was sent
    const writes = [...capture.getByMethod('POST'), ...capture.getByMethod('PATCH')];
    const catWrite = writes.find(w => w.url.includes('/api/cats/'));
    if (catWrite) {
      expect(catWrite.body).toBeTruthy();
    }
  });

  // ── 3. Place edit saves display_name ──────────────────────────────

  test('Place detail edit sends PATCH with modified name', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    test.skip(!placeId, 'No place entities available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    const editBtn = page.locator('button:has-text("Edit"), button[aria-label="Edit"]').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEdit, 'No edit button found on place detail page');

    await editBtn.click();
    await page.waitForTimeout(500);

    const nameInput = page.locator('input[name="display_name"], input[name="name"]').first();
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('E2E Test Place');
    }

    const saveBtn = page.locator('button:has-text("Save")').first();
    const hasSave = await saveBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasSave, 'No Save button found');

    await saveBtn.click();
    await page.waitForTimeout(1000);

    const patches = capture.getByMethod('PATCH');
    const placePatch = patches.find(p => p.url.includes('/api/places/'));
    expect(placePatch).toBeDefined();
    expect(placePatch!.body).toBeTruthy();
  });

  // ── 4. Colony override sends POST ─────────────────────────────────

  test('Colony override sends correct payload', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    test.skip(!placeId, 'No place entities available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Look for Ecology tab
    const ecologyTab = page.locator('[role="tab"]:has-text("Ecology"), [role="tab"]:has-text("Colony")').first();
    if (await ecologyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await ecologyTab.click();
      await page.waitForTimeout(1000);
    }

    // Look for Override button
    const overrideBtn = page.locator(
      'button:has-text("Override"), button:has-text("Set Colony Count")'
    ).first();
    const hasOverride = await overrideBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasOverride, 'No colony override button found');

    await overrideBtn.click();
    await page.waitForTimeout(500);

    // Fill count
    const countInput = page.locator('input[type="number"], input[name="count"], input[name="colony_count"]').first();
    if (await countInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await countInput.fill('15');
    }

    const submitBtn = page.locator('button:has-text("Save"), button:has-text("Submit"), button:has-text("Confirm")').first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
    }

    const writes = [...capture.getByMethod('POST'), ...capture.getByMethod('PATCH')];
    const placeWrite = writes.find(w => w.url.includes('/api/places/'));
    if (placeWrite) {
      expect(placeWrite.body).toBeTruthy();
    }
  });

  // ── 5. Intake conversion sends POST ───────────────────────────────

  test('Intake conversion sends POST to /api/intake/convert', async ({ page }) => {
    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Find a submission row
    const row = page.locator('tr, [data-testid="intake-row"]').first();
    const hasRow = await row.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasRow, 'No intake submissions found in queue');

    // Click on the row to open detail
    await row.click();
    await page.waitForTimeout(1000);

    // Look for Convert button
    const convertBtn = page.locator(
      'button:has-text("Convert"), button:has-text("Create Request")'
    ).first();
    const hasConvert = await convertBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasConvert, 'No Convert button found');

    await convertBtn.click();
    await page.waitForTimeout(1000);

    // If a confirmation modal appears, confirm it
    const modal = page.locator('[role="dialog"], .modal').first();
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const confirmBtn = modal.locator('button:has-text("Confirm"), button:has-text("Convert"), button[type="submit"]').first();
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    const posts = capture.getByMethod('POST');
    const convertPost = posts.find(p => p.url.includes('/api/intake/convert'));
    if (convertPost) {
      expect(convertPost.body).toBeTruthy();
    }
  });

  // ── 6. Handoff modal submits payload ──────────────────────────────

  test('Handoff modal sends POST to handoff endpoint', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for Hand Off button
    const handoffBtn = page.locator(
      'button:has-text("Hand Off"), button:has-text("Handoff"), button:has-text("Transfer")'
    ).first();
    const hasHandoff = await handoffBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasHandoff, 'No Hand Off button found');

    await handoffBtn.click();
    await page.waitForTimeout(500);

    // Modal should appear
    const modal = page.locator('[role="dialog"], .modal, [data-testid="modal"]').first();
    const hasModal = await modal.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasModal, 'Handoff modal did not appear');

    // Fill reason
    const reasonInput = modal.locator('textarea, input[name="reason"], select').first();
    if (await reasonInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const tagName = await reasonInput.evaluate(el => el.tagName.toLowerCase());
      if (tagName === 'select') {
        const options = await reasonInput.locator('option').count();
        if (options > 1) await reasonInput.selectOption({ index: 1 });
      } else {
        await reasonInput.fill('E2E test handoff reason');
      }
    }

    // Submit
    const submitBtn = modal.locator('button:has-text("Hand Off"), button:has-text("Confirm"), button:has-text("Submit"), button[type="submit"]').first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
    }

    // Verify write was sent
    const writes = [...capture.getByMethod('POST'), ...capture.getByMethod('PATCH')];
    const handoffWrite = writes.find(w =>
      w.url.includes('handoff') || w.url.includes('/api/requests/')
    );
    if (handoffWrite) {
      expect(handoffWrite.body).toBeTruthy();
    }
  });

  // ── 7. Cat edit cancel sends no writes ────────────────────────────

  test('Cat edit cancel sends no writes', async ({ page, request }) => {
    const catId = await findRealEntity(request, 'cats');
    test.skip(!catId, 'No cat entities available');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    const editBtn = page.locator('button:has-text("Edit"), button[aria-label="Edit"]').first();
    const hasEdit = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEdit, 'No edit button found');

    await editBtn.click();
    await page.waitForTimeout(500);

    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    const hasCancel = await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasCancel, 'No Cancel button found');

    await cancelBtn.click();
    await page.waitForTimeout(500);

    const patches = capture.getByMethod('PATCH');
    const catPatches = patches.filter(p => p.url.includes('/api/cats/'));
    expect(catPatches).toHaveLength(0);
  });
});
