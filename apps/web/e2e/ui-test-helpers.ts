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
    // Check for account lock before attempting login
    const lockedMessage = page.locator('text=/Account is locked/i');
    if (await lockedMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = await lockedMessage.textContent() || '';
      const minutesMatch = text.match(/(\d+)\s*minute/);
      const waitMs = minutesMatch ? (parseInt(minutesMatch[1]) + 1) * 60 * 1000 : 60000;
      await page.waitForTimeout(Math.min(waitMs, 30000));
      await page.reload();
    }

    // Fill in login credentials using exact IDs from the login form
    await emailInput.fill(TEST_EMAIL);
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Login page uses window.location.href = redirect (full page reload)
    try {
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
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
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
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

    // Check if password gate form is visible (PasswordGate has no data-testid)
    const gateInput = page.locator('input[type="password"][placeholder="Access code"]');
    if (await gateInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await gateInput.fill(ACCESS_CODE);
      await page.locator('button[type="submit"]').click();
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

// =============================================================================
// WRITE CAPTURE (FFS-578)
// =============================================================================

export interface CapturedWrite {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  timestamp: number;
}

export interface WriteCapture {
  requests: CapturedWrite[];
  getByMethod(method: string): CapturedWrite[];
  getByUrl(pattern: string): CapturedWrite[];
  last(): CapturedWrite | undefined;
  clear(): void;
}

/**
 * Mock all writes AND capture request bodies for assertion.
 * Use this instead of mockAllWrites() when you need to verify PATCH/POST payloads.
 *
 * @example
 * const capture = await mockWritesWithCapture(page);
 * // ... trigger a save action ...
 * const patches = capture.getByMethod('PATCH');
 * expect(patches).toHaveLength(1);
 * expect(patches[0].body).toMatchObject({ status: 'working' });
 */
export async function mockWritesWithCapture(page: Page): Promise<WriteCapture> {
  const captured: CapturedWrite[] = [];

  // Match both base endpoints (POST /api/requests) and sub-paths (/api/requests/123)
  // CRITICAL: Without the base patterns, creating new entities bypasses the mock
  // because glob `**/api/requests/**` requires a trailing path segment.
  const patterns = [
    '**/api/requests',
    '**/api/requests/**',
    '**/api/cats',
    '**/api/cats/**',
    '**/api/places',
    '**/api/places/**',
    '**/api/people',
    '**/api/people/**',
    '**/api/journal',
    '**/api/journal/**',
    '**/api/annotations',
    '**/api/annotations/**',
    '**/api/intake',
    '**/api/intake/**',
    '**/api/trappers',
    '**/api/trappers/**',
    '**/api/fosters',
    '**/api/fosters/**',
    '**/api/staff',
    '**/api/staff/**',
  ];

  for (const pattern of patterns) {
    await page.route(pattern, (route) => {
      const method = route.request().method();
      if (['PATCH', 'POST', 'DELETE', 'PUT'].includes(method)) {
        let body: Record<string, unknown> | null = null;
        try {
          const postData = route.request().postData();
          if (postData) body = JSON.parse(postData);
        } catch {
          // Non-JSON body, leave as null
        }

        captured.push({
          method,
          url: route.request().url(),
          body,
          timestamp: Date.now(),
        });

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { id: 'mock-id' } }),
        });
      }
      return route.continue();
    });
  }

  return {
    requests: captured,
    getByMethod(method: string) {
      return captured.filter(r => r.method === method);
    },
    getByUrl(pattern: string) {
      return captured.filter(r => r.url.includes(pattern));
    },
    last() {
      return captured[captured.length - 1];
    },
    clear() {
      captured.length = 0;
    },
  };
}

/**
 * Mock writes for all common API endpoints.
 * IMPORTANT: Must be called BEFORE mockWritesFor login routes.
 * Login API must NOT be mocked.
 */
export async function mockAllWrites(page: Page) {
  // Mock writes for entity endpoints (not auth endpoints)
  // CRITICAL: Must include both base paths and sub-paths.
  // `**/api/requests/**` does NOT match `POST /api/requests` (no trailing segment).
  const endpoints = [
    'requests', 'cats', 'places', 'people', 'journal',
    'annotations', 'intake', 'trappers', 'fosters', 'staff',
  ];
  for (const ep of endpoints) {
    await mockWritesFor(page, `**/api/${ep}`);
    await mockWritesFor(page, `**/api/${ep}/**`);
  }
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
  await expect(page.locator('[role="tablist"]').first()).toBeVisible({ timeout: 15000 });
}

/**
 * Click a ProfileLayout tab by label text
 */
export async function clickTab(page: Page, labelText: string) {
  const tab = page.locator('[role="tab"]', { hasText: labelText });
  await tab.click();
  // Give tab switch time to update aria-selected
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
}

/**
 * Verify that a tab with the given label exists
 */
export async function expectTabExists(page: Page, label: string) {
  await expect(page.locator('[role="tab"]', { hasText: label })).toBeVisible();
}

// ============================================================================
// TABBAR HELPERS (New standardized TabBar component)
// ============================================================================

/**
 * Switch to a tab in the new TabBar component.
 * Works with the standardized TabBar from @/components/ui
 */
export async function switchToTabBarTab(page: Page, tabLabel: string) {
  const tab = page.locator(`[role="tab"]:has-text("${tabLabel}")`).first();
  await tab.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

/**
 * Verify TabBar is present on the page
 * Looks for common tab labels used across entity detail pages
 */
export async function expectTabBarVisible(page: Page) {
  const tablist = page.locator('[role="tablist"]').first();
  await expect(tablist).toBeVisible({ timeout: 5000 });
  const tabs = tablist.locator('[role="tab"]');
  expect(await tabs.count()).toBeGreaterThanOrEqual(2);
}

/**
 * Get the currently active TabBar tab label
 */
export async function getActiveTabBarTab(page: Page): Promise<string | null> {
  const activeTab = page.locator('[role="tab"][aria-selected="true"]').first();
  if (await activeTab.isVisible().catch(() => false)) {
    return await activeTab.textContent();
  }
  return null;
}

/**
 * Get count badge value from a TabBar tab
 */
export async function getTabBarBadgeCount(page: Page, tabLabel: string): Promise<number | null> {
  const tab = page.locator(`[role="tab"]:has-text("${tabLabel}")`).first();
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
  // Wait for main content (Atlas 2.5: uses TabBar with role="tablist", not .profile-tabs)
  await expect(page.locator('main, [role="tablist"], h1').first()).toBeVisible({ timeout: 10000 });
}

/**
 * Check if the page is on the login screen
 */
export async function isOnLoginPage(page: Page): Promise<boolean> {
  return page.url().includes('/login') ||
    await page.locator('text="Sign in to your account"').isVisible({ timeout: 1000 }).catch(() => false);
}
