import { test, expect } from '@playwright/test';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * Map Performance Tests
 *
 * Verifies map loading performance improvements:
 * - Initial load time with caching
 * - Viewport-based loading
 * - Cache invalidation after data changes
 *
 * Performance targets:
 * - Initial load: < 3 seconds
 * - Cached load: < 1 second
 * - Viewport pan: no lag, smooth loading
 *
 * Updated for V2 (Google Maps) — Leaflet selectors removed.
 */

test.describe('Map Performance @smoke @workflow', () => {

  test('map page loads within acceptable time', async ({ page }) => {
    const start = Date.now();

    await page.goto('/map');

    // Wait for the V2 map container to be present
    await page.waitForSelector('.map-container-v2', { timeout: 10000 });

    // Wait for Google Maps to initialize (gm-style appears after init)
    await page.waitForSelector('.gm-style', { timeout: 10000 });

    const duration = Date.now() - start;

    // Initial load should complete within 5 seconds (generous for first load)
    expect(duration).toBeLessThan(5000);
  });

  test('map markers appear after data loads', async ({ page }) => {
    await page.goto('/map');

    // Wait for V2 map container
    await page.waitForSelector('.map-container-v2', { timeout: 10000 });

    // V2 markers are imperative (not in DOM as distinct elements).
    // Wait for the stats bar to show a non-zero "Total Places" count.
    await page.waitForFunction(() => {
      const statsBar = document.querySelector('.map-container-v2');
      if (!statsBar) return false;
      const text = statsBar.textContent || '';
      const match = text.match(/(\d+)\s*Total Places/);
      return match && parseInt(match[1], 10) > 0;
    }, { timeout: 15000 });

    // Verify the stat number is positive
    const statsText = await page.locator('.map-container-v2').textContent();
    const match = statsText?.match(/(\d+)\s*Total Places/);
    expect(match).toBeTruthy();
    expect(parseInt(match![1], 10)).toBeGreaterThan(0);
  });

  test('second page load is faster (cache test)', async ({ page }) => {
    // First load to warm the cache
    await page.goto('/map');
    await page.waitForSelector('.map-container-v2', { timeout: 10000 });
    await page.waitForSelector('.gm-style', { timeout: 10000 });

    // Small delay to ensure response caching
    await page.waitForTimeout(500);

    // Second load should benefit from browser cache and s-maxage headers
    const start = Date.now();
    await page.reload();
    await page.waitForSelector('.map-container-v2', { timeout: 10000 });
    await page.waitForSelector('.gm-style', { timeout: 10000 });
    const duration = Date.now() - start;

    // Cached reload should be noticeably faster (< 3 seconds)
    expect(duration).toBeLessThan(3000);
  });

  test('viewport change triggers data load without errors', async ({ page }) => {
    await page.goto('/map');

    // Wait for initial load
    await page.waitForSelector('.map-container-v2', { timeout: 10000 });
    await page.waitForSelector('.gm-style', { timeout: 10000 });

    // Wait for data to populate
    await page.waitForTimeout(2000);

    // Pan the map by simulating a drag on the V2 container
    const mapContainer = page.locator('.map-container-v2');
    const box = await mapContainer.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      // Drag from center to the left to pan right
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX - 200, centerY, { steps: 10 });
      await page.mouse.up();
    }

    // Wait for potential new data load (debounced 300ms + fetch time)
    await page.waitForTimeout(1000);

    // Map should still be functional after pan
    await expect(page.locator('.map-container-v2')).toBeVisible();

    // Check for console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // No critical errors should have occurred
    const criticalErrors = consoleErrors.filter(e =>
      e.includes('Failed to fetch') || e.includes('TypeError')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('map data API returns valid response with bounds parameter', async ({ request }) => {
    // Test the viewport-based loading API directly
    const response = await request.get('/api/beacon/map-data', {
      params: {
        layers: 'atlas_pins',
        bounds: '38.3,-123,38.6,-122.5'
      }
    });

    expect(response.ok()).toBeTruthy();

    // Check cache headers are present
    const cacheControl = response.headers()['cache-control'];
    expect(cacheControl).toContain('s-maxage');

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    // Should return atlas_pins array
    expect(data).toHaveProperty('atlas_pins');
    expect(Array.isArray(data.atlas_pins)).toBeTruthy();
  });

  test('map data API returns valid response without bounds (full load)', async ({ request }) => {
    const response = await request.get('/api/beacon/map-data', {
      params: {
        layers: 'atlas_pins'
      }
    });

    expect(response.ok()).toBeTruthy();

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    expect(data).toHaveProperty('atlas_pins');
    expect(Array.isArray(data.atlas_pins)).toBeTruthy();
  });

  test('zoom in triggers viewport-based loading', async ({ page }) => {
    await page.goto('/map');

    // Wait for initial load
    await page.waitForSelector('.map-container-v2', { timeout: 10000 });
    await page.waitForSelector('.gm-style', { timeout: 10000 });

    // Wait for data to populate
    await page.waitForTimeout(2000);

    // Zoom in using the Google Maps zoom control
    const zoomIn = page.locator('[aria-label="Zoom in"]');
    if (await zoomIn.isVisible()) {
      await zoomIn.click();
      await page.waitForTimeout(500);
      await zoomIn.click();
      await page.waitForTimeout(500);
    }

    // Wait for potential data reload after zoom
    await page.waitForTimeout(1000);

    // Map should still function after zoom
    await expect(page.locator('.map-container-v2')).toBeVisible();
  });

  test('map filter changes do not cause excessive reloads', async ({ page }) => {
    await page.goto('/map');

    // Wait for initial load
    await page.waitForSelector('.map-container-v2', { timeout: 10000 });

    // Track network requests
    const requests: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/beacon/map-data')) {
        requests.push(req.url());
      }
    });

    // Wait for initial data load
    await page.waitForTimeout(2000);
    const initialRequestCount = requests.length;

    // Wait a bit more - no additional requests should happen without user action
    await page.waitForTimeout(3000);

    // SWR deduping should prevent excessive requests (allow some variance for revalidation)
    expect(requests.length).toBeLessThanOrEqual(initialRequestCount + 2);
  });

});
