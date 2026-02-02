import { test, expect } from '@playwright/test';
import { navigateTo, waitForLoaded } from './ui-test-helpers';

/**
 * Admin Pages Smoke Test
 *
 * Verifies that each admin page loads without crashing.
 * Auth is provided via shared storageState from auth.setup.ts.
 */
test.describe('UI: Admin Pages Smoke Test', () => {
  test.setTimeout(30000);

  const adminPages = [
    { name: 'Admin staff page', path: '/admin/staff' },
    { name: 'Admin intake fields page', path: '/admin/intake-fields' },
    { name: 'Admin disease types page', path: '/admin/disease-types' },
    { name: 'Admin partner orgs page', path: '/admin/partner-orgs' },
    { name: 'Admin data engine review page', path: '/admin/data-engine/review' },
    { name: 'Admin data engine rules page', path: '/admin/data-engine' },
    { name: 'Admin Tippy corrections page', path: '/admin/tippy-corrections' },
    { name: 'Admin Tippy gaps page', path: '/admin/tippy-gaps' },
    { name: 'Admin known organizations page', path: '/admin/known-organizations' },
  ];

  for (const { name, path } of adminPages) {
    test(`${name} loads`, async ({ page }) => {
      await navigateTo(page, path);
      await waitForLoaded(page);

      // Verify page title exists and we're on the right page
      expect(await page.title()).toBeTruthy();

      // Verify the page is not showing an error
      const bodyText = await page.locator('body').textContent();
      expect(bodyText).toBeTruthy();
      expect(bodyText).not.toContain('Internal Server Error');
    });
  }
});
