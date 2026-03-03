/**
 * Shared UI Test Helpers
 *
 * Reusable utilities for Playwright UI tests.
 * All write operations are mocked to keep real data safe.
 *
 * Authentication flow:
 * 1. Login via API to get atlas_session cookie
 * 2. Set atlas_authenticated in localStorage for PasswordGate
 * 3. Navigate to pages with full auth
 */

import { Page, APIRequestContext, expect, BrowserContext } from '@playwright/test';

// Auth credentials
const ACCESS_CODE = process.env.ATLAS_ACCESS_CODE || 'ffsc2024';
const TEST_EMAIL = process.env.TEST_ACCOUNT_EMAIL || 'test@forgottenfelines.com';
const TEST_PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || process.env.STAFF_DEFAULT_PASSWORD || 'test123';

/**
 * Authenticate a browser context via the login API.
 * Sets the atlas_session cookie and localStorage for PasswordGate.
 * Call this once per test or in beforeAll/beforeEach.
 */
export async function authenticate(page: Page) {
  const context = page.context();

  // First, try to login via the login page (handles both auth layers in one go)
  await page.goto('/login');

  // Check if we're actually on the login page (exact selectors from login/page.tsx)
  const emailInput = page.locator('#email');
  const isLoginPage = await emailInput.isVisible({ timeout: 3000 }).catch(() => false);

  if (isLoginPage) {
    // Fill in login credentials using exact IDs from the login form
    await emailInput.fill(TEST_EMAIL);
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Login page uses window.location.href = redirect (full page reload)
    try {
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    } catch {
      // If login fails (wrong credentials), try API-based login
      console.log('Browser login failed, trying API login...');
      await loginViaAPI(context);
    }
  }

  // Set localStorage for PasswordGate (client-side gate)
  await page.evaluate((code) => {
    const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    localStorage.setItem('atlas_authenticated', JSON.stringify({ expiry }));
  }, ACCESS_CODE);
}

/**
 * Login via API and set cookies on the browser context.
 * Fallback when browser-based login fails.
 */
async function loginViaAPI(context: BrowserContext) {
  try {
    // Create a temporary page for the API call
    const page = await context.newPage();
    const response = await page.evaluate(async (creds) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
      });
      return { ok: res.ok, status: res.status };
    }, { email: TEST_EMAIL, password: TEST_PASSWORD });

    await page.close();

    if (!response.ok) {
      console.warn(`API login returned ${response.status} - tests may fail on auth-required pages`);
    }
  } catch (e) {
    console.warn('API login failed:', e);
  }
}

/**
 * Navigate to a page.
 * Auth is handled by Playwright's storageState (set in auth.setup.ts).
 * Falls back to login if session expired.
 */
export async function navigateTo(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });

  // If session expired and we got redirected to login, re-authenticate
  if (page.url().includes('/login')) {
    const emailInput = page.locator('#email');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill(TEST_EMAIL);
      await page.locator('#password').fill(TEST_PASSWORD);
      await page.locator('button[type="submit"]').click();
      try {
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
      } catch {
        // Login may have failed
      }
      // If we were redirected away from target, navigate again
      if (!page.url().includes(path)) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
      }
    }
  }
}

/**
 * Pass the PasswordGate if present (client-side localStorage gate)
 */
export async function passPasswordGate(page: Page) {
  try {
    // Set localStorage to bypass gate
    await page.evaluate(() => {
      const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
      localStorage.setItem('atlas_authenticated', JSON.stringify({ expiry }));
    });

    // Check if password gate form is visible
    const gate = page.locator('[data-testid="password-gate"]');
    if (await gate.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.fill('[data-testid="access-code-input"]', ACCESS_CODE);
      await page.click('[data-testid="access-code-submit"]');
      await page.waitForTimeout(500);
    }
  } catch {
    // Gate not present, continue
  }
}

/**
 * Mock all write operations (PATCH/POST/DELETE) for a URL pattern.
 * GET requests pass through to the real API.
 */
export async function mockWritesFor(page: Page, pattern: string) {
  await page.route(pattern, (route) => {
    const method = route.request().method();
    if (['PATCH', 'POST', 'DELETE', 'PUT'].includes(method)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id: 'mock-id' }),
      });
    }
    return route.continue();
  });
}

/**
 * Mock writes for all common API endpoints.
 * IMPORTANT: Must be called BEFORE mockWritesFor login routes.
 * Login API must NOT be mocked.
 */
export async function mockAllWrites(page: Page) {
  // Mock writes for entity endpoints (not auth endpoints)
  await mockWritesFor(page, '**/api/requests/**');
  await mockWritesFor(page, '**/api/cats/**');
  await mockWritesFor(page, '**/api/places/**');
  await mockWritesFor(page, '**/api/people/**');
  await mockWritesFor(page, '**/api/journal/**');
  await mockWritesFor(page, '**/api/annotations/**');
  await mockWritesFor(page, '**/api/intake/**');
  // Note: NOT mocking /api/auth/** to keep login working
}

/**
 * Fetch a real entity ID from the list API.
 * Returns null if no entities are available.
 */
export async function findRealEntity(
  request: APIRequestContext,
  type: 'requests' | 'cats' | 'places' | 'people'
): Promise<string | null> {
  const idFields: Record<string, string> = {
    requests: 'request_id',
    cats: 'cat_id',
    places: 'place_id',
    people: 'person_id',
  };

  // Retry up to 3 times with backoff (handles DB connection pool exhaustion)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request.get(`/api/${type}?limit=1`, { timeout: 15000 });
      if (!res.ok()) return null;
      const json = await res.json();
      // Handle both { data: { [type]: [...] } } and { [type]: [...] } formats
      const items = json.data?.[type] || json[type];
      if (!items?.length) return null;
      return items[0][idFields[type]];
    } catch {
      if (attempt < 2) {
        // Wait before retrying: 2s, 4s
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      }
    }
  }
  return null;
}

/**
 * Wait for ProfileLayout tabs to render
 */
export async function waitForProfileTabs(page: Page) {
  await expect(page.locator('.profile-tabs')).toBeVisible({ timeout: 15000 });
}

/**
 * Click a ProfileLayout tab by label text
 */
export async function clickTab(page: Page, labelText: string) {
  const tab = page.locator('.profile-tab', { hasText: labelText });
  await tab.click();
  // Give tab switch time to update active class
  await expect(tab).toHaveClass(/active/, { timeout: 5000 });
}

/**
 * Verify that a tab with the given label exists
 */
export async function expectTabExists(page: Page, label: string) {
  await expect(page.locator('.profile-tab', { hasText: label })).toBeVisible();
}

// ============================================================================
// TABBAR HELPERS (New standardized TabBar component)
// ============================================================================

/**
 * Switch to a tab in the new TabBar component.
 * Works with the standardized TabBar from @/components/ui
 */
export async function switchToTabBarTab(page: Page, tabLabel: string) {
  // Find tab button by text content (TabBar uses buttons with text labels)
  const tab = page.locator(`button:has-text("${tabLabel}")`).first();
  await tab.click();
  await page.waitForLoadState('networkidle');
  // Short wait for tab panel transition
  await page.waitForTimeout(300);
}

/**
 * Verify TabBar is present on the page
 */
export async function expectTabBarVisible(page: Page) {
  // TabBar has a distinctive borderBottom style
  const tabBar = page.locator('div[style*="borderBottom: 2px solid"]').first();
  await expect(tabBar).toBeVisible({ timeout: 5000 });
}

/**
 * Get the currently active TabBar tab label
 */
export async function getActiveTabBarTab(page: Page): Promise<string | null> {
  // Active tab has fontWeight 600 and a specific border style
  const activeTab = page.locator('button[style*="fontWeight: 600"]').first();
  if (await activeTab.isVisible().catch(() => false)) {
    return await activeTab.textContent();
  }
  return null;
}

/**
 * Get count badge value from a TabBar tab
 */
export async function getTabBarBadgeCount(page: Page, tabLabel: string): Promise<number | null> {
  const tab = page.locator(`button:has-text("${tabLabel}")`).first();
  const badge = tab.locator('span[style*="borderRadius: 999px"]');
  if (await badge.isVisible().catch(() => false)) {
    const text = await badge.textContent();
    return text ? parseInt(text, 10) : null;
  }
  return null;
}

/**
 * Wait for the page to finish loading (no loading spinners).
 * Verifies we're NOT on the login page.
 */
export async function waitForLoaded(page: Page) {
  // First verify we're not stuck on the login page
  if (page.url().includes('/login')) {
    throw new Error('Still on login page - authentication may have failed');
  }

  // Wait for loading indicator to disappear
  try {
    await page.locator('.loading').waitFor({ state: 'hidden', timeout: 10000 });
  } catch {
    // No loading indicator, continue
  }
  // Wait for main content
  await expect(page.locator('main, .profile-tabs, h1').first()).toBeVisible({ timeout: 10000 });
}

/**
 * Check if the page is on the login screen
 */
export async function isOnLoginPage(page: Page): Promise<boolean> {
  return page.url().includes('/login') ||
    await page.locator('text="Sign in to your account"').isVisible({ timeout: 1000 }).catch(() => false);
}
