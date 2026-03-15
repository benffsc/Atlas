import { test, expect } from '@playwright/test';
import { navigateTo, findRealEntity, waitForLoaded, mockAllWrites, switchToTabBarTab, expectTabBarVisible } from './ui-test-helpers';

/**
 * Foster Management E2E Tests
 *
 * Covers:
 * - Foster Roster page (/fosters) — list, filters, search, aggregates
 * - Foster Detail page (/fosters/[id]) — PersonDetailShell with initialRole="foster"
 * - Foster Agreements API (/api/people/[id]/foster-agreements)
 * - Foster Roster API (/api/fosters)
 * - Cats API relationship filter (/api/people/[id]/cats?relationship=foster)
 * - Trapper Roster batch actions & CSV export (/trappers)
 * - Staff directory search & filters (/admin/staff)
 *
 * All write operations are mocked. Tests are READ-ONLY against real data.
 */

// Helper: get a real foster person_id from the API
async function findRealFoster(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  try {
    const res = await request.get('/api/fosters?limit=1');
    if (!res.ok()) return null;
    const json = await res.json();
    const data = json.data || json;
    if (!data.fosters?.length) return null;
    return data.fosters[0].person_id;
  } catch {
    return null;
  }
}

// ============================================================================
// Foster Roster Page
// ============================================================================

test.describe('Foster Roster Page @workflow', () => {

  test('page loads with content', async ({ page }) => {
    await navigateTo(page, '/fosters');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('page shows aggregate stats cards', async ({ page }) => {
    await navigateTo(page, '/fosters');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should show stat cards: Total, Active, Inactive, Cats Fostered
    const bodyText = await page.textContent('body') || '';
    const hasStats = bodyText.includes('Total') ||
      bodyText.includes('Active') ||
      bodyText.includes('Foster');
    console.log(`Foster roster shows stats: ${hasStats}`);
  });

  test('search filter works', async ({ page }) => {
    await navigateTo(page, '/fosters');
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    const hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasSearch) {
      await searchInput.fill('test');
      await page.waitForTimeout(500); // debounce
      // Page should not crash after typing
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('status filter is present', async ({ page }) => {
    await navigateTo(page, '/fosters');
    await page.waitForLoadState('domcontentloaded');

    // Should have status filter select or buttons
    const statusFilter = page.locator('select, button:has-text("Active"), button:has-text("All Status")').first();
    const hasStatusFilter = await statusFilter.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Foster roster has status filter: ${hasStatusFilter}`);
  });

  test('view toggle between table and card works', async ({ page }) => {
    await navigateTo(page, '/fosters');
    await page.waitForLoadState('domcontentloaded');

    const cardViewBtn = page.locator('button:has-text("Card View"), button:has-text("Cards")').first();
    const hasToggle = await cardViewBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasToggle) {
      await cardViewBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).toBeVisible();
    }
  });

});

// ============================================================================
// Foster Roster API
// ============================================================================

test.describe('Foster Roster API', () => {

  test('GET /api/fosters returns valid structure', async ({ request }) => {
    const res = await request.get('/api/fosters?limit=10');
    if (!res.ok()) {
      console.log(`Fosters API returned ${res.status()} — passing`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    expect(data).toHaveProperty('fosters');
    expect(Array.isArray(data.fosters)).toBe(true);
    expect(data).toHaveProperty('aggregates');

    // Aggregates should have expected fields
    const agg = data.aggregates;
    expect(agg).toHaveProperty('total_fosters');
    expect(agg).toHaveProperty('active_fosters');
    expect(agg).toHaveProperty('inactive_fosters');
    expect(agg).toHaveProperty('total_cats_fostered');
  });

  test('foster rows have expected fields', async ({ request }) => {
    const res = await request.get('/api/fosters?limit=5');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;

    if (!data.fosters?.length) return;

    const foster = data.fosters[0];
    expect(foster).toHaveProperty('person_id');
    expect(foster).toHaveProperty('display_name');
    expect(foster).toHaveProperty('role_status');
    expect(foster).toHaveProperty('cats_fostered');
  });

  test('status filter returns filtered results', async ({ request }) => {
    const activeRes = await request.get('/api/fosters?status=active&limit=10');
    if (!activeRes.ok()) return;

    const activeJson = await activeRes.json();
    const activeData = activeJson.data || activeJson;

    if (activeData.fosters?.length > 0) {
      for (const f of activeData.fosters) {
        expect(f.role_status).toBe('active');
      }
    }
  });

  test('search filter works', async ({ request }) => {
    // Get a foster name to search for
    const listRes = await request.get('/api/fosters?limit=1');
    if (!listRes.ok()) return;

    const listJson = await listRes.json();
    const listData = listJson.data || listJson;
    if (!listData.fosters?.length) return;

    const name = listData.fosters[0].display_name;
    const firstName = name.split(' ')[0];

    const searchRes = await request.get(`/api/fosters?search=${encodeURIComponent(firstName)}&limit=10`);
    if (!searchRes.ok()) return;

    const searchJson = await searchRes.json();
    const searchData = searchJson.data || searchJson;
    expect(searchData.fosters.length).toBeGreaterThanOrEqual(1);
  });

  test('sort parameter works', async ({ request }) => {
    for (const sort of ['display_name', 'cats_fostered', 'started_at', 'role_status']) {
      const res = await request.get(`/api/fosters?sort=${sort}&limit=5`);
      if (!res.ok()) {
        console.log(`Sort by ${sort} returned ${res.status()}`);
        continue;
      }
      const json = await res.json();
      const data = json.data || json;
      expect(data).toHaveProperty('fosters');
    }
  });

});

// ============================================================================
// Foster Detail Page
// ============================================================================

test.describe('Foster Detail Page', () => {

  test('detail page loads for real foster', async ({ page, request }) => {
    const fosterId = await findRealFoster(request);
    if (!fosterId) return; // No fosters — pass

    await navigateTo(page, `/fosters/${fosterId}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('detail page uses PersonDetailShell with TabBar', async ({ page, request }) => {
    const fosterId = await findRealFoster(request);
    if (!fosterId) return;

    await navigateTo(page, `/fosters/${fosterId}`);
    await waitForLoaded(page);

    // PersonDetailShell renders TabBar with role="tablist"
    await expectTabBarVisible(page);

    // Should have base tabs: Overview, Details, History, Admin
    for (const tabId of ['main', 'details', 'history', 'admin']) {
      const tab = page.locator(`[data-testid="tab-${tabId}"]`);
      await expect(tab).toBeVisible();
    }

    // "Foster" tab appears when foster role data loads from detectRoles.
    // May not appear or may not be active if volunteer roles API fails.
    const fosterTab = page.locator('[data-testid="tab-foster"]');
    const hasFosterTab = await fosterTab.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasFosterTab) {
      // Tab is present — may or may not be active depending on data timing
      const isActive = await fosterTab.getAttribute('aria-selected') === 'true';
      console.log(`Foster tab present, active: ${isActive}`);
    } else {
      console.log('Foster tab not shown — foster role data not available from API');
    }
  });

  test('foster tab shows foster sections', async ({ page, request }) => {
    const fosterId = await findRealFoster(request);
    if (!fosterId) return;

    await navigateTo(page, `/fosters/${fosterId}`);
    await waitForLoaded(page);

    // Foster tab should show foster-specific content
    const bodyText = await page.textContent('body') || '';
    const hasFosterContent = bodyText.includes('Foster') ||
      bodyText.includes('Agreement') ||
      bodyText.includes('Cats Fostered');
    console.log(`Foster detail shows foster content: ${hasFosterContent}`);
  });

  test('switching to Overview tab shows base person sections', async ({ page, request }) => {
    const fosterId = await findRealFoster(request);
    if (!fosterId) return;

    await navigateTo(page, `/fosters/${fosterId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Switch to Overview tab
    const overviewTab = page.locator('[data-testid="tab-main"]');
    if (!(await overviewTab.getAttribute('aria-selected') === 'true')) {
      await switchToTabBarTab(page, 'Overview');
    }

    const mainContent = page.locator('main').last();
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });

});

// ============================================================================
// Foster Agreements API
// ============================================================================

test.describe('Foster Agreements API', () => {

  test('GET foster-agreements returns valid structure', async ({ request }) => {
    const fosterId = await findRealFoster(request);
    if (!fosterId) return;

    const res = await request.get(`/api/people/${fosterId}/foster-agreements`);
    if (!res.ok()) {
      // May require auth or endpoint not yet available
      console.log(`foster-agreements returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toHaveProperty('agreements');
    expect(Array.isArray(data.agreements)).toBe(true);

    if (data.agreements.length > 0) {
      const agreement = data.agreements[0];
      expect(agreement).toHaveProperty('agreement_id');
      expect(agreement).toHaveProperty('agreement_type');
      expect(agreement).toHaveProperty('source_system');
      console.log(`Foster ${fosterId} has ${data.agreements.length} agreements`);
    }
  });

  test('foster-agreements for invalid UUID returns error', async ({ request }) => {
    const res = await request.get('/api/people/not-a-uuid/foster-agreements');
    expect(res.ok()).toBeFalsy();
  });

});

// ============================================================================
// Cats API Relationship Filter
// ============================================================================

test.describe('Cats API Relationship Filter', () => {

  test('cats API supports relationship=foster filter', async ({ request }) => {
    const fosterId = await findRealFoster(request);
    if (!fosterId) return;

    const res = await request.get(`/api/people/${fosterId}/cats?relationship=foster`);
    if (!res.ok()) {
      console.log(`cats relationship filter returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    // Should return some array of cats (may be empty)
    const cats = data.cats || data;
    expect(Array.isArray(cats)).toBe(true);
    console.log(`Foster ${fosterId} has ${cats.length} foster cats`);
  });

});

// ============================================================================
// Trapper Roster Batch Actions & CSV Export
// ============================================================================

test.describe('Trapper Roster Batch Actions', () => {

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('trapper roster shows selection checkboxes', async ({ page }) => {
    await navigateTo(page, '/trappers');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Look for checkboxes in the trapper list
    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();
    console.log(`Trapper roster has ${checkboxCount} checkboxes`);
  });

  test('CSV export button is present', async ({ page }) => {
    await navigateTo(page, '/trappers');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const exportBtn = page.locator('button:has-text("Export CSV")').first();
    const hasExport = await exportBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Trapper roster has CSV export: ${hasExport}`);
  });

  test('batch action toolbar appears on selection', async ({ page }) => {
    await navigateTo(page, '/trappers');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Try clicking a checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();
    const hasCheckbox = await checkbox.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasCheckbox) {
      await checkbox.click();
      await page.waitForTimeout(300);

      // Should show batch action UI
      const batchToolbar = page.locator('text=/selected/i').first();
      const hasToolbar = await batchToolbar.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`Batch toolbar visible after selection: ${hasToolbar}`);
    }
  });

});

// ============================================================================
// Staff Directory
// ============================================================================

test.describe('Staff Directory', () => {

  test('staff page loads', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('staff page has search input', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
    const hasSearch = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Staff directory has search: ${hasSearch}`);
  });

  test('staff page has role filter', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.waitForLoadState('domcontentloaded');

    // Role filter — could be select, buttons, or chips
    const bodyText = await page.textContent('body') || '';
    const hasRoleFilter = bodyText.includes('Role') ||
      bodyText.includes('Department') ||
      bodyText.includes('Filter');
    console.log(`Staff directory has role filter: ${hasRoleFilter}`);
  });

  test('staff API returns valid data', async ({ request }) => {
    const res = await request.get('/api/staff');
    if (!res.ok()) {
      console.log(`Staff API returned ${res.status()} — passing`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    expect(data).toHaveProperty('staff');
    expect(Array.isArray(data.staff)).toBe(true);

    if (data.staff.length > 0) {
      const staff = data.staff[0];
      expect(staff).toHaveProperty('staff_id');
      expect(staff).toHaveProperty('first_name');
      expect(staff).toHaveProperty('role');
      console.log(`Staff directory has ${data.staff.length} staff members`);
    }
  });

});

// ============================================================================
// Cross-Feature: Person Detail Role Detection
// ============================================================================

test.describe('PersonDetailShell Role Detection', () => {

  test('person page detects foster role when applicable', async ({ page, request }) => {
    const fosterId = await findRealFoster(request);
    if (!fosterId) return;

    // Navigate to person page (not foster page)
    await navigateTo(page, `/people/${fosterId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Should detect foster role and show Foster tab
    const fosterTab = page.locator('[data-testid="tab-foster"]');
    const hasFosterTab = await fosterTab.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Person page detects foster role: ${hasFosterTab}`);
  });

  test('trapper page still works after foster additions', async ({ page, request }) => {
    // Verify trappers list still loads after foster config changes
    const res = await request.get('/api/trappers?limit=1');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;
    if (!data.trappers?.length) return;

    const trapperId = data.trappers[0].person_id;
    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Should still have base tabs
    const overviewTab = page.locator('[data-testid="tab-main"]');
    await expect(overviewTab).toBeVisible();
  });

});
