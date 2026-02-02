/**
 * Playwright Auth Setup
 *
 * Authenticates once before all tests run, saving the session state
 * (cookies + localStorage) to a JSON file. All test workers reuse
 * this shared auth state, preventing concurrent login race conditions.
 */

import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'e2e/.auth/user.json';
const TEST_EMAIL = process.env.TEST_ACCOUNT_EMAIL || 'test@forgottenfelines.com';
const TEST_PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || process.env.STAFF_DEFAULT_PASSWORD || 'test123';

setup('authenticate', async ({ page }) => {
  setup.setTimeout(60000);

  // Navigate to the login page
  await page.goto('/login');

  // Check for "Account is locked" message and wait if present
  const lockedMessage = page.locator('text=/Account is locked/i');
  if (await lockedMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Extract wait time and wait it out
    const text = await lockedMessage.textContent() || '';
    const minutesMatch = text.match(/(\d+)\s*minute/);
    const waitMs = minutesMatch ? (parseInt(minutesMatch[1]) + 1) * 60 * 1000 : 60000;
    console.log(`Account locked, waiting ${Math.ceil(waitMs / 60000)} minutes...`);
    await page.waitForTimeout(Math.min(waitMs, 45000)); // Cap at 45s for test timeout
    await page.reload();
  }

  // Fill in login credentials (exact IDs from login/page.tsx)
  await page.locator('#email').fill(TEST_EMAIL);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Wait for redirect away from login page (uses window.location.href)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

  // Set PasswordGate localStorage (client-side gate, 7-day session)
  await page.evaluate(() => {
    const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem('atlas_authenticated', JSON.stringify({ expiry }));
  });

  // Save auth state (cookies + localStorage) for all test workers
  await page.context().storageState({ path: AUTH_FILE });
});
