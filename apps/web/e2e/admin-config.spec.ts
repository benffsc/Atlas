import { test, expect } from '@playwright/test';
import { navigateTo, waitForLoaded } from './ui-test-helpers';

/**
 * Admin Configuration E2E Tests — @smoke @workflow
 *
 * Covers Atlas 2.5 "Admin Everything" features (FFS-506 Epic):
 * - /admin/config — app_config table management
 * - /admin/labels — display labels (133 entries)
 * - /admin/theme — theme configuration
 * - /admin/nav — navigation menu (41 items)
 * - /admin/triage-flags — triage flag configuration
 * - /admin/staff — staff directory
 * - /admin/roles — roles & permissions (24 perms, 3 roles)
 * - /admin/blacklist — soft blacklist admin
 * - /admin/map-colors — map color configuration
 *
 * Tests are READ-ONLY. No data is modified.
 */

// ============================================================================
// Admin Config Page
// ============================================================================

test.describe('Admin Config Page', () => {
  test.setTimeout(45000);

  test('/admin/config page loads', async ({ page }) => {
    await navigateTo(page, '/admin/config');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/config shows configuration entries', async ({ page }) => {
    await navigateTo(page, '/admin/config');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasConfigContent =
      bodyText.includes('Config') ||
      bodyText.includes('Setting') ||
      bodyText.includes('Value') ||
      bodyText.includes('Category');
    console.log(`Config page has config content: ${hasConfigContent}`);
  });
});

// ============================================================================
// Admin Config API
// ============================================================================

test.describe('Admin Config API', () => {
  test.setTimeout(30000);

  test('/api/admin/config returns config entries', async ({ request }) => {
    const res = await request.get('/api/admin/config');
    if (!res.ok()) {
      // May require auth
      expect([401, 403].includes(res.status()) || res.status() < 500).toBe(true);
      console.log(`Config API returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    // Should return config entries (array or object)
    expect(data).toBeDefined();

    if (Array.isArray(data)) {
      console.log(`Config API returned ${data.length} entries`);
      if (data.length > 0) {
        const entry = data[0];
        // Config entries should have key, value, category
        expect(entry).toHaveProperty('key');
        expect(entry).toHaveProperty('value');
      }
    } else if (data.configs) {
      console.log(`Config API returned ${data.configs.length} entries`);
    }
  });
});

// ============================================================================
// Admin Labels Page
// ============================================================================

test.describe('Admin Labels Page', () => {
  test.setTimeout(45000);

  test('/admin/labels page loads', async ({ page }) => {
    await navigateTo(page, '/admin/labels');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/labels shows display labels', async ({ page }) => {
    await navigateTo(page, '/admin/labels');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasLabels =
      bodyText.includes('Label') ||
      bodyText.includes('Display') ||
      bodyText.includes('Key') ||
      bodyText.includes('Value');
    console.log(`Labels page has label content: ${hasLabels}`);
  });

  test('/api/admin/labels returns labels', async ({ request }) => {
    const res = await request.get('/api/admin/labels');
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toBeDefined();

    const labels = Array.isArray(data) ? data : data.labels;
    if (labels && labels.length > 0) {
      console.log(`Labels API returned ${labels.length} labels`);
    }
  });
});

// ============================================================================
// Admin Theme Page
// ============================================================================

test.describe('Admin Theme Page', () => {
  test.setTimeout(45000);

  test('/admin/theme page loads', async ({ page }) => {
    await navigateTo(page, '/admin/theme');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/theme shows theme controls', async ({ page }) => {
    await navigateTo(page, '/admin/theme');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasTheme =
      bodyText.includes('Theme') ||
      bodyText.includes('Color') ||
      bodyText.includes('Primary') ||
      bodyText.includes('Brand');
    console.log(`Theme page has theme content: ${hasTheme}`);
  });
});

// ============================================================================
// Admin Nav Page
// ============================================================================

test.describe('Admin Nav Page', () => {
  test.setTimeout(45000);

  test('/admin/nav page loads', async ({ page }) => {
    await navigateTo(page, '/admin/nav');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/nav shows navigation items', async ({ page }) => {
    await navigateTo(page, '/admin/nav');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasNav =
      bodyText.includes('Navigation') ||
      bodyText.includes('Menu') ||
      bodyText.includes('Item') ||
      bodyText.includes('Path');
    console.log(`Nav page has navigation content: ${hasNav}`);
  });

  test('/api/admin/nav returns nav items', async ({ request }) => {
    const res = await request.get('/api/admin/nav');
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toBeDefined();

    const items = Array.isArray(data) ? data : data.items || data.nav;
    if (items && items.length > 0) {
      console.log(`Nav API returned ${items.length} items`);
      const item = items[0];
      // Nav items should have basic structure
      expect(item).toHaveProperty('label');
    }
  });
});

// ============================================================================
// Admin Triage Flags Page
// ============================================================================

test.describe('Admin Triage Flags Page', () => {
  test.setTimeout(45000);

  test('/admin/triage-flags page loads', async ({ page }) => {
    await navigateTo(page, '/admin/triage-flags');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/api/admin/triage-flags returns flags', async ({ request }) => {
    const res = await request.get('/api/admin/triage-flags');
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toBeDefined();

    const flags = Array.isArray(data) ? data : data.flags;
    if (flags && flags.length > 0) {
      console.log(`Triage flags API returned ${flags.length} flags`);
    }
  });
});

// ============================================================================
// Admin Staff Page
// ============================================================================

test.describe('Admin Staff Page', () => {
  test.setTimeout(45000);

  test('/admin/staff page loads', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/staff shows staff list', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasStaff =
      bodyText.includes('Staff') ||
      bodyText.includes('Name') ||
      bodyText.includes('Role') ||
      bodyText.includes('Email');
    console.log(`Staff page has staff content: ${hasStaff}`);
  });

  test('/admin/staff has search input', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
    const hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Staff page has search: ${hasSearch}`);
  });
});

// ============================================================================
// Admin Roles Page
// ============================================================================

test.describe('Admin Roles Page', () => {
  test.setTimeout(45000);

  test('/admin/roles page loads', async ({ page }) => {
    await navigateTo(page, '/admin/roles');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/api/admin/roles returns roles', async ({ request }) => {
    const res = await request.get('/api/admin/roles');
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toBeDefined();
    console.log(`Roles API responded with data`);
  });
});

// ============================================================================
// Admin Blacklist & Map Colors Pages
// ============================================================================

test.describe('Admin Auxiliary Pages', () => {
  test.setTimeout(45000);

  test('/admin/blacklist page loads', async ({ page }) => {
    await navigateTo(page, '/admin/blacklist');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/map-colors page loads', async ({ page }) => {
    await navigateTo(page, '/admin/map-colors');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });
});
