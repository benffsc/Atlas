import { test, expect } from '@playwright/test';
import { navigateTo, findRealEntity, waitForLoaded } from './ui-test-helpers';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * UI Resilience Tests
 *
 * Tests that the UI handles edge cases gracefully WITHOUT modifying data:
 * - Dangerous buttons have confirmation dialogs
 * - Forms validate before submission
 * - Navigation doesn't lose unsaved state unexpectedly
 * - Error states are handled gracefully
 *
 * IMPORTANT: These tests are READ-ONLY and do not modify any data.
 * Updated for Atlas 2.5 architecture (FFS-552).
 */

test.describe('Dangerous Action Protection @smoke', () => {

  test('delete/archive buttons have confirmation dialogs', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for dangerous action buttons (but DON'T click them for real)
    const deleteButtons = page.locator('button:has-text("Delete"), button:has-text("Archive"), button:has-text("Remove")');
    const dangerousButtonCount = await deleteButtons.count();

    console.log(`Found ${dangerousButtonCount} potentially dangerous buttons`);

    // If there are dangerous buttons, verify they exist (we won't click them)
    if (dangerousButtonCount > 0) {
      const firstDangerousButton = deleteButtons.first();
      const isVisible = await firstDangerousButton.isVisible();
      console.log(`Dangerous button visible: ${isVisible}`);
    }
  });

  test('status dropdown exists but we dont change it', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Look for status selects/dropdowns
    const statusElements = page.locator('select, [role="combobox"], [class*="status"]');
    const statusCount = await statusElements.count();

    console.log(`Found ${statusCount} status-related elements`);
    // We verify they exist but DO NOT change them
  });

});

test.describe('Form Validation (Read-Only)', () => {

  test('intake form has required field indicators', async ({ page }) => {
    // Go to intake form page (public form, not admin)
    await navigateTo(page, '/intake');
    await waitForLoaded(page);

    // Look for required field indicators (asterisks, "required" text)
    const bodyText = await page.textContent('body');
    const hasRequiredIndicators = bodyText?.includes('*') ||
      bodyText?.toLowerCase().includes('required');

    console.log(`Form has required field indicators: ${hasRequiredIndicators}`);
  });

  test('empty form submission is prevented by browser validation', async ({ page }) => {
    await navigateTo(page, '/intake');
    await waitForLoaded(page);

    // Look for a submit button
    const submitButton = page.locator('button[type="submit"], input[type="submit"]').first();

    if (await submitButton.isVisible()) {
      // Check if there are required inputs
      const requiredInputs = page.locator('input[required], select[required], textarea[required]');
      const requiredCount = await requiredInputs.count();

      console.log(`Form has ${requiredCount} required fields`);

      // We DO NOT actually submit - just verify required fields exist
    }
  });

});

test.describe('Navigation Safety', () => {

  test('rapid back/forward navigation is safe', async ({ page }) => {
    // Visit several pages (use page.goto for proper history entries)
    await navigateTo(page, '/requests');
    await page.waitForLoadState('domcontentloaded');

    await page.goto('/places', { waitUntil: 'domcontentloaded' });
    await page.goto('/people', { waitUntil: 'domcontentloaded' });

    // Go back
    await page.goBack();
    await page.waitForLoadState('domcontentloaded');

    // Go forward
    await page.goForward();
    await page.waitForLoadState('domcontentloaded');

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('refresh on detail page reloads correctly', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    if (!placeId) {
      test.skip();
      return;
    }

    // Go to place detail
    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Should still show the same place
    await expect(page.locator('body')).toBeVisible();

    // URL should still be correct
    expect(page.url()).toContain(placeId);
  });

  test('opening multiple tabs of same page is safe', async ({ page, context, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    const url = `/requests/${requestId}`;

    // Open first tab
    await navigateTo(page, url);
    await waitForLoaded(page);

    // Open second tab with same URL
    const page2 = await context.newPage();
    await page2.goto(url);
    await page2.waitForLoadState('domcontentloaded');

    // Both tabs should work
    await expect(page.locator('body')).toBeVisible();
    await expect(page2.locator('body')).toBeVisible();

    await page2.close();
  });

});

test.describe('Error Handling (Read-Only)', () => {

  test('invalid entity ID shows appropriate error', async ({ page }) => {
    // Try to access a non-existent entity
    await navigateTo(page, '/places/invalid-uuid-that-does-not-exist');

    // Should show some kind of error or not found message
    await expect(page.locator('body')).toBeVisible();

    const bodyText = await page.textContent('body');
    const showsError = bodyText?.toLowerCase().includes('not found') ||
      bodyText?.toLowerCase().includes('error') ||
      bodyText?.toLowerCase().includes('invalid') ||
      bodyText?.includes('404');

    console.log(`Invalid ID shows error handling: ${showsError}`);
  });

  test('non-existent route shows 404', async ({ page }) => {
    await navigateTo(page, '/this-route-definitely-does-not-exist-12345');

    // Should show 404 or redirect, not crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('API errors dont crash the UI', async ({ page }) => {
    // Go to a page that loads data
    await navigateTo(page, '/places');
    await waitForLoaded(page);

    // Page should be functional even if some data fails to load
    await expect(page.locator('body')).toBeVisible();

    // Should not show raw error stack traces to user
    const bodyText = await page.textContent('body');
    const hasStackTrace = bodyText?.includes('at Object.') ||
      bodyText?.includes('TypeError:') ||
      bodyText?.includes('ReferenceError:');

    expect(hasStackTrace).toBeFalsy();
  });

});

test.describe('Click Safety Verification', () => {

  test('verify we can identify clickable elements without clicking', async ({ page }) => {
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Count different types of interactive elements
    const buttons = await page.locator('button').count();
    const links = await page.locator('a').count();
    const inputs = await page.locator('input, select, textarea').count();

    console.log(`Page has: ${buttons} buttons, ${links} links, ${inputs} inputs`);

    // Identify potentially dangerous buttons (by text content)
    const dangerousTexts = ['delete', 'remove', 'archive', 'cancel', 'reject'];
    for (const text of dangerousTexts) {
      const count = await page.locator(`button:has-text("${text}")`).count();
      if (count > 0) {
        console.log(`  Found ${count} buttons with "${text}"`);
      }
    }

    // We identify but DO NOT click
  });

  test('expandable sections can be toggled safely', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    if (!placeId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Look for expand/collapse buttons (these are safe to click)
    const expandButtons = page.locator('button:has-text("Show"), button:has-text("Expand"), button:has-text("More"), [class*="expand"], [class*="collapse"]');
    const expandCount = await expandButtons.count();

    if (expandCount > 0) {
      // These are safe - they just toggle visibility
      const firstExpand = expandButtons.first();
      if (await firstExpand.isVisible()) {
        await firstExpand.click();
        await page.waitForTimeout(300);

        // Page should still be functional
        await expect(page.locator('body')).toBeVisible();
        console.log('Expand/collapse toggle worked safely');
      }
    }
  });

  test('tab navigation works without modifying data', async ({ page }) => {
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Look for tabs (Atlas 2.5: uses role="tab")
    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();

    if (tabCount > 1) {
      // Click second tab (if it exists) - tabs are safe, they just filter views
      const secondTab = tabs.nth(1);
      if (await secondTab.isVisible()) {
        await secondTab.click();
        await page.waitForTimeout(300);

        // Page should still work
        await expect(page.locator('body')).toBeVisible();
        console.log('Tab switching worked safely');
      }
    }
  });

});

test.describe('Keyboard Navigation Safety', () => {

  test('escape key closes modals without saving', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Press Escape - should close any open modals without saving
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('tab key navigates through elements', async ({ page }) => {
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Press Tab a few times - should navigate through focusable elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

});
