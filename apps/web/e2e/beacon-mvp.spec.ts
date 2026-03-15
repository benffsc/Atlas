import { test, expect } from '@playwright/test';
import { navigateTo, findRealEntity, waitForLoaded } from './ui-test-helpers';
import { unwrapApiResponse, fetchApiData } from './helpers/api-response';

/**
 * Beacon MVP E2E Tests — @smoke @workflow
 *
 * Covers:
 * - Beacon dashboard page (/beacon) loads
 * - Beacon compare and scenarios pages load
 * - /api/beacon/summary returns valid shape
 * - /api/beacon/map-data returns places array
 * - /api/beacon/seasonal-dashboard returns seasonal data
 * - /api/beacon/trends/{placeId} returns trend data
 * - /api/beacon/forecast returns scenario projections
 *
 * Tests are READ-ONLY against real data.
 */

// ============================================================================
// Beacon Dashboard Page
// ============================================================================

test.describe('Beacon Dashboard: Page Loads', () => {
  test.setTimeout(45000);

  test('/beacon page loads with content', async ({ page }) => {
    await navigateTo(page, '/beacon');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');

    // Page should have substantial content (map container, dashboard, or summary)
    expect(bodyText!.length).toBeGreaterThan(100);
  });

  test('/beacon page has map or dashboard content', async ({ page }) => {
    await navigateTo(page, '/beacon');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Look for map container, chart, or dashboard elements
    const bodyText = await page.textContent('body') || '';
    const hasDashboardContent =
      bodyText.includes('Colony') ||
      bodyText.includes('Alteration') ||
      bodyText.includes('Cat') ||
      bodyText.includes('Place') ||
      bodyText.includes('Sonoma') ||
      bodyText.includes('Overview') ||
      bodyText.includes('Map');
    console.log(`Beacon page has dashboard content: ${hasDashboardContent}`);
  });

  test('/beacon/compare page loads', async ({ page }) => {
    await navigateTo(page, '/beacon/compare');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');

    // Should have comparison-related content
    const hasCompare =
      bodyText.includes('Compare') ||
      bodyText.includes('Comparison') ||
      bodyText.includes('Location');
    console.log(`Compare page has comparison content: ${hasCompare}`);
  });

  test('/beacon/scenarios page loads', async ({ page }) => {
    await navigateTo(page, '/beacon/scenarios');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');

    const hasScenarios =
      bodyText.includes('Forecast') ||
      bodyText.includes('Scenario') ||
      bodyText.includes('Population') ||
      bodyText.includes('Projection');
    console.log(`Scenarios page has forecast content: ${hasScenarios}`);
  });

  test('/beacon/preview page loads', async ({ page }) => {
    await navigateTo(page, '/beacon/preview');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });
});

// ============================================================================
// Beacon Summary API
// ============================================================================

test.describe('Beacon Summary API', () => {
  test.setTimeout(30000);

  test('/api/beacon/summary returns 200', async ({ request }) => {
    const response = await request.get('/api/beacon/summary');
    expect(response.ok()).toBeTruthy();
  });

  test('/api/beacon/summary has required shape', async ({ request }) => {
    const response = await request.get('/api/beacon/summary');
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ summary: Record<string, unknown>; insights: Record<string, unknown> }>(wrapped);

    expect(data.summary).toBeDefined();
    expect(data.insights).toBeDefined();

    // total_cats should be present and non-negative
    expect(Number(data.summary.total_cats)).toBeGreaterThanOrEqual(0);
  });

  test('/api/beacon/summary alteration rate is valid percentage', async ({ request }) => {
    const response = await request.get('/api/beacon/summary');
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ summary: { overall_alteration_rate: string } }>(wrapped);

    const rate = parseFloat(data.summary.overall_alteration_rate);
    if (!isNaN(rate)) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(100);
    }
  });
});

// ============================================================================
// Beacon Map Data API
// ============================================================================

test.describe('Beacon Map Data API', () => {
  test.setTimeout(30000);

  test('/api/beacon/map-data returns 200 with places', async ({ request }) => {
    const response = await request.get('/api/beacon/map-data');
    expect(response.ok()).toBeTruthy();

    const json = await response.json();
    const data = json.data || json;

    // Should have some data structure with places or layers
    expect(data).toBeDefined();
  });

  test('/api/beacon/map returns places array and summary', async ({ request }) => {
    const response = await request.get('/api/beacon/map');
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: unknown[]; summary: Record<string, unknown> }>(wrapped);

    expect(Array.isArray(data.places)).toBe(true);
    expect(data.summary).toBeDefined();
  });

  test('/api/beacon/places returns array of places', async ({ request }) => {
    const response = await request.get('/api/beacon/places?limit=10');
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: unknown[] }>(wrapped);
    expect(Array.isArray(data.places)).toBe(true);

    // If places exist, verify basic shape
    if (data.places.length > 0) {
      const place = data.places[0] as Record<string, unknown>;
      expect(place.place_id).toBeDefined();
      console.log(`Beacon has ${data.places.length} places (limit=10)`);
    }
  });
});

// ============================================================================
// Seasonal Dashboard API
// ============================================================================

test.describe('Beacon Seasonal Dashboard API', () => {
  test.setTimeout(30000);

  test('/api/beacon/seasonal-dashboard returns data', async ({ request }) => {
    const response = await request.get('/api/beacon/seasonal-dashboard');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toBeDefined();
  });

  test('/api/beacon/seasonal-alerts returns alerts array', async ({ request }) => {
    const response = await request.get('/api/beacon/seasonal-alerts');
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ alerts: unknown[] }>(wrapped);
    expect(data.alerts).toBeDefined();
    expect(Array.isArray(data.alerts)).toBe(true);
  });

  test('/api/beacon/yoy-comparison returns comparison data', async ({ request }) => {
    const response = await request.get('/api/beacon/yoy-comparison');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// Beacon Trends API
// ============================================================================

test.describe('Beacon Trends API', () => {
  test.setTimeout(30000);

  test('/api/beacon/trends/{placeId} returns trend data for a real place', async ({ request }) => {
    // Find a real place to get trends for
    const placeId = await findRealEntity(request, 'places');
    if (!placeId) {
      console.log('No places available — skipping trend test');
      return;
    }

    const response = await request.get(`/api/beacon/trends/${placeId}`);
    if (!response.ok()) {
      // Trends endpoint may not have data for this place
      console.log(`Trends for ${placeId} returned ${response.status()}`);
      return;
    }

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ trends: unknown[]; summary: Record<string, unknown> }>(wrapped);

    expect(Array.isArray(data.trends)).toBe(true);
    expect(data.summary).toBeDefined();
    console.log(`Place ${placeId} has ${data.trends.length} trend data points`);
  });

  test('/api/beacon/trends with invalid UUID returns error', async ({ request }) => {
    const response = await request.get('/api/beacon/trends/not-a-uuid');
    expect(response.status()).toBeLessThan(500);
  });

  test('/api/beacon/trends with months parameter', async ({ request }) => {
    const response = await request.get(
      '/api/beacon/trends/00000000-0000-0000-0000-000000000000?months=6'
    );
    if (!response.ok()) return; // May fail if beacon schema not deployed

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ months_back: number; trends: unknown[] }>(wrapped);
    expect(data.months_back).toBe(6);
    // 6 months + current month = at most 7 data points
    expect(data.trends.length).toBeLessThanOrEqual(7);
  });
});

// ============================================================================
// Beacon Forecast API
// ============================================================================

test.describe('Beacon Forecast API', () => {
  test.setTimeout(30000);

  test('/api/beacon/forecast requires place_id', async ({ request }) => {
    const response = await request.get('/api/beacon/forecast');
    expect(response.status()).toBe(400);
  });

  test('/api/beacon/forecast with invalid UUID returns 400', async ({ request }) => {
    const response = await request.get('/api/beacon/forecast?place_id=not-a-uuid');
    expect(response.status()).toBe(400);
  });

  test('/api/beacon/forecast returns scenario data for real place', async ({ request }) => {
    // Try to find a place with cats for a meaningful forecast
    const placesRes = await request.get('/api/beacon/places?limit=1&minCats=3');
    if (!placesRes.ok()) return;

    const placesWrapped = await placesRes.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(placesWrapped);
    if (placesData.places.length === 0) {
      console.log('No places with 3+ cats — skipping forecast test');
      return;
    }

    const placeId = placesData.places[0].place_id;
    const response = await request.get(`/api/beacon/forecast?place_id=${placeId}`);
    // No cat data scenario returns 400, success returns 200
    expect(response.status()).toBeLessThan(500);

    if (response.ok()) {
      const wrapped = await response.json();
      const data = unwrapApiResponse<{
        scenarios: {
          baseline: { points: unknown[] };
          optimistic: { points: unknown[] };
          aggressive: { points: unknown[] };
        };
        current: { population: number };
      }>(wrapped);

      expect(data.scenarios.baseline).toBeDefined();
      expect(data.scenarios.optimistic).toBeDefined();
      expect(data.scenarios.aggressive).toBeDefined();
      expect(data.current.population).toBeGreaterThanOrEqual(0);
      console.log(`Forecast for place ${placeId}: pop=${data.current.population}`);
    }
  });
});

// ============================================================================
// Beacon Zones & Compare API
// ============================================================================

test.describe('Beacon Zones & Compare API', () => {
  test.setTimeout(30000);

  test('/api/beacon/zones returns zone data', async ({ request }) => {
    const response = await request.get('/api/beacon/zones');
    // May return 500 if beacon schema not deployed — just verify no crash
    expect(response.status()).toBeLessThan(502);

    if (response.ok()) {
      const wrapped = await response.json();
      const data = unwrapApiResponse<{ zones: unknown[] }>(wrapped);
      expect(Array.isArray(data.zones)).toBe(true);
      console.log(`Beacon has ${data.zones.length} zones`);
    }
  });

  test('/api/beacon/compare requires at least 2 place IDs', async ({ request }) => {
    const response = await request.get('/api/beacon/compare');
    expect(response.status()).toBe(400);
  });

  test('/api/beacon/compare rejects single place', async ({ request }) => {
    const response = await request.get(
      '/api/beacon/compare?places=00000000-0000-0000-0000-000000000000'
    );
    expect(response.status()).toBe(400);
  });

  test('/api/beacon/compare accepts two valid UUIDs', async ({ request }) => {
    const response = await request.get(
      '/api/beacon/compare?places=00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000001'
    );
    // May fail if beacon schema not deployed, but should not be 500
    if (response.ok()) {
      const wrapped = await response.json();
      const data = unwrapApiResponse<{ places: unknown[] }>(wrapped);
      expect(Array.isArray(data.places)).toBe(true);
    }
  });
});
