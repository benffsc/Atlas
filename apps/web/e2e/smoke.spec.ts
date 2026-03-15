import { test, expect } from '@playwright/test';
import { navigateTo } from './ui-test-helpers';

/**
 * Smoke Tests - Basic health checks for Atlas
 *
 * These tests verify that core pages load correctly.
 * Auth handled by storageState + navigateTo() fallback.
 */

test.describe('Smoke Tests @smoke', () => {

  test('dashboard loads and shows stats', async ({ page }) => {
    await navigateTo(page, '/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();

    // Should not show an error page
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('requests page loads', async ({ page }) => {
    await navigateTo(page, '/requests');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const content = await page.textContent('body');
    expect(content).toBeTruthy();
  });

  test('places page loads', async ({ page }) => {
    await navigateTo(page, '/places');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
  });

  test('people page loads', async ({ page }) => {
    await navigateTo(page, '/people');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
  });

  test('cats page loads', async ({ page }) => {
    await navigateTo(page, '/cats');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
  });

  test('intake queue loads', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
  });

  test('admin intake fields loads', async ({ page }) => {
    await navigateTo(page, '/admin/intake-fields');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
  });

});
