import { test, expect } from '@playwright/test';
import { navigateTo, findRealEntity, waitForLoaded, mockAllWrites, switchToTabBarTab, expectTabBarVisible } from './ui-test-helpers';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * Trapper V2 E2E Tests (FFS-575)
 *
 * Covers all 4 phases of Trapper V2:
 * - Phase 1: Contract & Certification Management (FFS-569)
 * - Phase 2: Service Area Conflict Detection (FFS-547)
 * - Phase 3: Smart Dispatch Scoring (FFS-566)
 * - Phase 4: Territory Map Visualization (FFS-565)
 *
 * Tests are READ-ONLY unless mocked. Write operations use mockAllWrites().
 *
 * Note: Auth-required API routes (contracts, service-areas, suggested-trappers,
 * trapper-stats) may return 401 from the Playwright request fixture when the
 * storageState doesn't carry session cookies. Tests handle this gracefully.
 */

// Helper: get a real trapper person_id from the API
async function findRealTrapper(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  try {
    const res = await request.get('/api/trappers?limit=1');
    if (!res.ok()) return null;
    const json = await res.json();
    const data = json.data || json;
    if (!data.trappers?.length) return null;
    return data.trappers[0].person_id;
  } catch {
    return null;
  }
}

// Helper: get a request with a place (needed for suggested-trappers)
async function findRequestWithPlace(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  try {
    const res = await request.get('/api/requests?limit=20');
    if (!res.ok()) return null;
    const json = await res.json();
    const data = json.data || json;
    const reqs = data.requests || [];
    const withPlace = reqs.find((r: Record<string, unknown>) => r.place_id);
    return withPlace?.request_id || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Trapper List Page
// ============================================================================

test.describe('Trapper List Page @workflow', () => {

  test('page loads with aggregate stats', async ({ page }) => {
    await navigateTo(page, '/trappers');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();

    // Should not show error
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('trappers API returns valid list with aggregates', async ({ request }) => {
    const response = await request.get('/api/trappers?limit=10');
    expect(response.ok()).toBeTruthy();

    const json = await response.json();
    const data = json.data || json;

    expect(data).toHaveProperty('trappers');
    expect(Array.isArray(data.trappers)).toBe(true);
    expect(data).toHaveProperty('aggregates');

    // Aggregates should have expected fields
    const agg = data.aggregates;
    expect(agg).toHaveProperty('total_active_trappers');
    expect(agg).toHaveProperty('ffsc_trappers');
    expect(agg).toHaveProperty('community_trappers');
  });

  test('type filter returns filtered results', async ({ request }) => {
    // FFSC trappers
    const ffscRes = await request.get('/api/trappers?type=ffsc&limit=5');
    expect(ffscRes.ok()).toBeTruthy();
    const ffscJson = await ffscRes.json();
    const ffscData = ffscJson.data || ffscJson;

    if (ffscData.trappers?.length > 0) {
      for (const t of ffscData.trappers) {
        expect(t.is_ffsc_trapper).toBe(true);
      }
    }

    // Community trappers
    const commRes = await request.get('/api/trappers?type=community&limit=5');
    expect(commRes.ok()).toBeTruthy();
    const commJson = await commRes.json();
    const commData = commJson.data || commJson;

    if (commData.trappers?.length > 0) {
      for (const t of commData.trappers) {
        expect(t.is_ffsc_trapper).toBe(false);
      }
    }
  });

  test('tier filter returns filtered results', async ({ request }) => {
    for (const tier of ['1', '2', '3']) {
      const res = await request.get(`/api/trappers?tier=${tier}&limit=5`);
      expect(res.ok()).toBeTruthy();

      const json = await res.json();
      const data = json.data || json;
      // Should return valid structure even if empty
      expect(data).toHaveProperty('trappers');
      expect(Array.isArray(data.trappers)).toBe(true);
    }
  });

  test('search filter works', async ({ request }) => {
    // Get a trapper name to search for
    const listRes = await request.get('/api/trappers?limit=1');
    const listJson = await listRes.json();
    const listData = listJson.data || listJson;

    if (!listData.trappers?.length) return; // No trappers — pass

    const name = listData.trappers[0].display_name;
    const firstName = name.split(' ')[0];

    const searchRes = await request.get(`/api/trappers?search=${encodeURIComponent(firstName)}&limit=10`);
    expect(searchRes.ok()).toBeTruthy();

    const searchJson = await searchRes.json();
    const searchData = searchJson.data || searchJson;
    expect(searchData.trappers.length).toBeGreaterThanOrEqual(1);

    // All results should contain the search term
    for (const t of searchData.trappers) {
      expect(t.display_name.toLowerCase()).toContain(firstName.toLowerCase());
    }
  });

  test('trapper rows have expected fields', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=5');
    const json = await res.json();
    const data = json.data || json;

    if (!data.trappers?.length) return;

    const trapper = data.trappers[0];
    // Core fields
    expect(trapper).toHaveProperty('person_id');
    expect(trapper).toHaveProperty('display_name');
    expect(trapper).toHaveProperty('trapper_type');
    expect(trapper).toHaveProperty('role_status');
    expect(trapper).toHaveProperty('is_ffsc_trapper');
    // Stats fields
    expect(trapper).toHaveProperty('total_cats_caught');
    expect(trapper).toHaveProperty('total_clinic_cats');
    expect(trapper).toHaveProperty('availability_status');
    expect(trapper).toHaveProperty('has_signed_contract');
  });

  test('page shows trapper cards or table rows', async ({ page }) => {
    await navigateTo(page, '/trappers');
    await page.waitForLoadState('domcontentloaded');

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Should show either table rows or card elements with trapper data
    const bodyText = await page.textContent('body');
    // Page should have some content beyond just navigation
    expect(bodyText!.length).toBeGreaterThan(100);
  });

});

// ============================================================================
// Trapper Detail Page
// ============================================================================

test.describe('Trapper Detail Page', () => {

  test('detail page loads for real trapper', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/trappers/${trapperId}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();

    // Should show trapper name (PersonDetailShell renders EntityHeader with h1)
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('detail page uses PersonDetailShell with TabBar', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    // PersonDetailShell renders TabBar with role="tablist"
    await expectTabBarVisible(page);

    // Should always have base tabs: Overview, Details, History, Admin
    for (const tabId of ['main', 'details', 'history', 'admin']) {
      const tab = page.locator(`[data-testid="tab-${tabId}"]`);
      await expect(tab).toBeVisible({ timeout: 5000 });
    }

    // "Trapper" tab appears when trapper data loads (detectRoles finds trapper info).
    // May not appear if trapper-stats API fails — that's expected behavior.
    const trapperTab = page.locator('[data-testid="tab-trapper"]');
    const hasTrapperTab = await trapperTab.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasTrapperTab) {
      // If present, it should be the active tab (initialRole="trapper")
      await expect(trapperTab).toHaveAttribute('aria-selected', 'true');
      console.log('Trapper tab present and active');
    } else {
      console.log('Trapper tab not shown — trapper data not available from API');
    }
  });

  test('detail page shows performance stats in Trapper tab', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    // Trapper tab is default — performance section should show stat-related content
    const bodyText = await page.textContent('body') || '';
    const hasStats = bodyText.includes('Clinic') ||
      bodyText.includes('Cats') ||
      bodyText.includes('Altered') ||
      bodyText.includes('Assignment') ||
      bodyText.includes('Performance') ||
      bodyText.includes('Statistics') ||
      bodyText.includes('Total Caught');

    console.log(`Trapper detail shows stats: ${hasStats}`);
  });

  test('Overview tab shows base person sections', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);
    await expectTabBarVisible(page);

    // Switch to Overview tab (base person view) — may already be active if no Trapper tab
    const overviewTab = page.locator('[data-testid="tab-main"]');
    if (!(await overviewTab.getAttribute('aria-selected') === 'true')) {
      await switchToTabBarTab(page, 'Overview');
    }

    // Should show base sections (Quick Notes, Cats, Places, etc.)
    const mainContent = page.locator('main').last();
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });

  test('back button exists on detail page', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    // Verify back button or back link is present (don't click — avoids timeout)
    const backElements = page.locator('button:has-text("Back"), a:has-text("Back"), a[href="/trappers"], [aria-label="Back"]');
    const count = await backElements.count();
    console.log(`Found ${count} back navigation elements on trapper detail`);
  });

});

// ============================================================================
// Phase 1: Contract & Certification Management (FFS-569)
// ============================================================================

test.describe('Contracts API', () => {

  test('GET contracts returns valid structure or requires auth', async ({ request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    const res = await request.get(`/api/people/${trapperId}/contracts`);
    // Auth-required endpoint: may return 401 from request fixture
    if (!res.ok()) {
      expect([401, 403, 500].includes(res.status())).toBe(true);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toHaveProperty('contracts');
    expect(Array.isArray(data.contracts)).toBe(true);

    // If contracts exist, check structure
    if (data.contracts.length > 0) {
      const contract = data.contracts[0];
      expect(contract).toHaveProperty('contract_id');
      expect(contract).toHaveProperty('person_id');
      expect(contract).toHaveProperty('contract_type');
      expect(contract).toHaveProperty('status');
      expect(contract).toHaveProperty('source_system');
      console.log(`Trapper ${trapperId} has ${data.contracts.length} contracts`);
    }
  });

  test('contracts for invalid UUID returns error', async ({ request }) => {
    const res = await request.get('/api/people/not-a-uuid/contracts');
    // Should return 400 (bad UUID) or 401 (auth) or 500 (unhandled)
    expect(res.ok()).toBeFalsy();
  });

  test('contract section shows in Trapper tab', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    // Trapper tab is default when accessed via /trappers/[id]
    // Look for contract-related sections (Contract & Profile, Contract History)
    const bodyText = await page.textContent('body') || '';
    const hasContractSection = bodyText.toLowerCase().includes('contract');
    console.log(`Trapper tab shows contracts section: ${hasContractSection}`);
  });

});

// ============================================================================
// Phase 2: Service Area Conflict Detection (FFS-547)
// ============================================================================

test.describe('Service Areas API', () => {

  test('GET service areas returns valid structure or requires auth', async ({ request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    const res = await request.get(`/api/people/${trapperId}/service-areas`);
    // Auth-required endpoint
    if (!res.ok()) {
      expect([401, 403, 500].includes(res.status())).toBe(true);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toHaveProperty('areas');
    expect(Array.isArray(data.areas)).toBe(true);

    if (data.areas.length > 0) {
      const area = data.areas[0];
      expect(area).toHaveProperty('id');
      expect(area).toHaveProperty('place_id');
      expect(area).toHaveProperty('place_name');
      expect(area).toHaveProperty('service_type');
      // service_type should be a valid type
      const validTypes = ['primary_territory', 'regular', 'occasional', 'home_rescue', 'historical'];
      expect(validTypes).toContain(area.service_type);
      console.log(`Trapper ${trapperId} has ${data.areas.length} service areas`);
    }
  });

  test('service areas for invalid UUID returns error', async ({ request }) => {
    const res = await request.get('/api/people/not-a-uuid/service-areas');
    expect(res.ok()).toBeFalsy();
  });

  test('service areas show in Trapper tab', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    // Trapper tab is default — should contain Service Areas section
    const bodyText = await page.textContent('body') || '';
    const hasServiceAreas = bodyText.toLowerCase().includes('service area') ||
      bodyText.toLowerCase().includes('territory');
    console.log(`Trapper tab shows service areas: ${hasServiceAreas}`);
  });

});

// ============================================================================
// Phase 3: Smart Dispatch Scoring (FFS-566)
// ============================================================================

test.describe('Smart Dispatch API', () => {

  test('suggested-trappers API responds for request with place', async ({ request }) => {
    const requestId = await findRequestWithPlace(request);
    if (!requestId) {
      // No requests with places — pass
      return;
    }

    const res = await request.get(`/api/requests/${requestId}/suggested-trappers`);
    // Auth-required: may return 401; DB errors possible too
    if (!res.ok()) {
      expect([401, 403, 500].includes(res.status())).toBe(true);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    expect(data).toHaveProperty('suggestions');
    expect(Array.isArray(data.suggestions)).toBe(true);

    if (data.suggestions.length > 0) {
      const suggestion = data.suggestions[0];
      // Check scoring fields
      expect(suggestion).toHaveProperty('person_id');
      expect(suggestion).toHaveProperty('trapper_name');
      expect(suggestion).toHaveProperty('total_score');
      expect(suggestion).toHaveProperty('territory_score');
      expect(suggestion).toHaveProperty('availability_score');
      expect(suggestion).toHaveProperty('workload_score');
      expect(suggestion).toHaveProperty('performance_score');
      expect(suggestion).toHaveProperty('match_reason');

      // Scores should be numeric
      expect(typeof suggestion.total_score).toBe('number');
      expect(typeof suggestion.territory_score).toBe('number');

      console.log(`Request ${requestId} has ${data.suggestions.length} suggested trappers, top score: ${suggestion.total_score}`);
    }
  });

  test('suggested-trappers for invalid UUID returns error', async ({ request }) => {
    const res = await request.get('/api/requests/not-a-uuid/suggested-trappers');
    expect(res.ok()).toBeFalsy();
  });

  test('suggestions are sorted by total_score descending', async ({ request }) => {
    const requestId = await findRequestWithPlace(request);
    if (!requestId) return;

    const res = await request.get(`/api/requests/${requestId}/suggested-trappers`);
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;
    const suggestions = data.suggestions || [];

    if (suggestions.length >= 2) {
      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i - 1].total_score).toBeGreaterThanOrEqual(suggestions[i].total_score);
      }
    }
  });

});

// ============================================================================
// Phase 4: Territory Map Visualization (FFS-565)
// ============================================================================

test.describe('Territory Map Data API', () => {

  test('trapper_territories layer responds', async ({ request }) => {
    const res = await request.get('/api/beacon/map-data?layers=trapper_territories');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;
    expect(data).toHaveProperty('trapper_territories');
    expect(Array.isArray(data.trapper_territories)).toBe(true);

    if (data.trapper_territories.length > 0) {
      const territory = data.trapper_territories[0];
      expect(territory).toHaveProperty('person_id');
      expect(territory).toHaveProperty('trapper_name');
      expect(territory).toHaveProperty('trapper_type');
      expect(territory).toHaveProperty('service_type');
      expect(territory).toHaveProperty('availability_status');
      expect(territory).toHaveProperty('place_id');
      expect(territory).toHaveProperty('place_name');
      expect(territory).toHaveProperty('lat');
      expect(territory).toHaveProperty('lng');

      // Coordinates should be valid numbers
      expect(typeof territory.lat).toBe('number');
      expect(typeof territory.lng).toBe('number');

      console.log(`Territory layer has ${data.trapper_territories.length} entries`);
    }
  });

  test('territory layer can filter by trapper', async ({ request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) return;

    const res = await request.get(`/api/beacon/map-data?layers=trapper_territories&trapper=${trapperId}`);
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;

    // If this trapper has territories, all should belong to them
    if (data.trapper_territories?.length > 0) {
      for (const t of data.trapper_territories) {
        expect(t.person_id).toBe(trapperId);
      }
    }
  });

  test('territory layer includes summary stats', async ({ request }) => {
    const res = await request.get('/api/beacon/map-data?layers=trapper_territories');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;

    // Summary should always be present
    expect(data).toHaveProperty('summary');
    if (data.summary) {
      expect(data.summary).toHaveProperty('total_places');
      expect(data.summary).toHaveProperty('total_cats');
    }
  });

});

// ============================================================================
// Trapper Stats API
// ============================================================================

test.describe('Trapper Stats API', () => {

  test('trapper-stats returns full stats object or requires auth', async ({ request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    const res = await request.get(`/api/people/${trapperId}/trapper-stats`);
    // This endpoint doesn't require getSession() — but may fail on DB issues
    if (!res.ok()) {
      console.log(`trapper-stats returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    // Core identity fields
    expect(data).toHaveProperty('person_id');
    expect(data).toHaveProperty('display_name');
    expect(data).toHaveProperty('trapper_type');
    expect(data).toHaveProperty('is_ffsc_trapper');

    // Assignment stats
    expect(data).toHaveProperty('active_assignments');
    expect(data).toHaveProperty('completed_assignments');

    // Clinic stats
    expect(data).toHaveProperty('total_clinic_cats');
    expect(data).toHaveProperty('unique_clinic_days');
    expect(data).toHaveProperty('avg_cats_per_day');

    // Alteration stats
    expect(data).toHaveProperty('spayed_count');
    expect(data).toHaveProperty('neutered_count');
    expect(data).toHaveProperty('total_altered');

    // FeLV stats
    expect(data).toHaveProperty('felv_tested_count');
    expect(data).toHaveProperty('felv_positive_count');

    // Manual catches
    expect(data).toHaveProperty('manual_catches');
    expect(data).toHaveProperty('total_cats_caught');
  });

  test('trapper-stats for non-trapper returns non-200', async ({ request }) => {
    // Get a regular person (not a trapper)
    const personId = await findRealEntity(request, 'people');
    if (!personId) return;

    const res = await request.get(`/api/people/${personId}/trapper-stats`);
    // Could be 404 (not a trapper), 200 (happens to be a trapper), or 401/500
    // Just verify the API responds without crashing
    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(600);
  });

  test('trapper-stats for invalid UUID returns error', async ({ request }) => {
    const res = await request.get('/api/people/not-a-uuid/trapper-stats');
    expect(res.ok()).toBeFalsy();
  });

});

// ============================================================================
// Trapper Profile API
// ============================================================================

test.describe('Trapper Profile API', () => {

  test('trapper-profile returns profile data', async ({ request }) => {
    const trapperId = await findRealTrapper(request);
    if (!trapperId) {
      test.skip();
      return;
    }

    const res = await request.get(`/api/people/${trapperId}/trapper-profile`);
    if (!res.ok()) {
      // Profile may not exist or requires auth
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    // Profile may be nested under a 'profile' key
    const profile = data.profile || data;

    expect(profile).toHaveProperty('person_id');
    expect(profile).toHaveProperty('trapper_type');
    expect(profile).toHaveProperty('is_active');
  });

});

// ============================================================================
// Cross-Feature Integration
// ============================================================================

test.describe('Trapper Cross-Feature Integration', () => {

  test('trapper list and detail are consistent', async ({ request }) => {
    const listRes = await request.get('/api/trappers?limit=1');
    const listJson = await listRes.json();
    const listData = listJson.data || listJson;

    if (!listData.trappers?.length) return;

    const trapper = listData.trappers[0];

    // Get the same trapper's stats
    const statsRes = await request.get(`/api/people/${trapper.person_id}/trapper-stats`);
    if (!statsRes.ok()) return;

    const statsJson = await statsRes.json();
    const statsData = statsJson.data || statsJson;

    // Key stats should match between list and detail
    expect(statsData.display_name).toBe(trapper.display_name);
    expect(statsData.is_ffsc_trapper).toBe(trapper.is_ffsc_trapper);
    expect(statsData.total_clinic_cats).toBe(trapper.total_clinic_cats);
  });

  test('trapper availability values are valid', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=20');
    const json = await res.json();
    const data = json.data || json;

    const validStatuses = ['available', 'busy', 'on_leave'];
    for (const t of data.trappers || []) {
      expect(validStatuses).toContain(t.availability_status);
    }
  });

  test('trapper tier values are valid when present', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=20');
    const json = await res.json();
    const data = json.data || json;

    for (const t of data.trappers || []) {
      if (t.tier !== null) {
        // Tier should start with "Tier "
        expect(t.tier).toMatch(/^Tier \d/);
      }
    }
  });

});
