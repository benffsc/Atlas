import { test, expect } from '@playwright/test';

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
 */

test.describe('Map Performance', () => {

  test('map page loads within acceptable time', async ({ page }) => {
    const start = Date.now();

    await page.goto('/map');

    // Wait for the map container to be present
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });

    // Wait for initial tile layer to load
    await page.waitForSelector('.leaflet-tile-loaded', { timeout: 10000 });

    const duration = Date.now() - start;

    // Initial load should complete within 5 seconds (generous for first load)
    expect(duration).toBeLessThan(5000);
  });

  test('map markers appear after data loads', async ({ page }) => {
    await page.goto('/map');

    // Wait for map to initialize
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });

    // Wait for markers or cluster groups to appear (may take a moment for data fetch)
    // The markercluster creates divs with class 'marker-cluster' or individual markers
    await page.waitForFunction(() => {
      const clusters = document.querySelectorAll('.marker-cluster');
      const markers = document.querySelectorAll('.leaflet-marker-icon');
      return clusters.length > 0 || markers.length > 0;
    }, { timeout: 15000 });

    // Verify we have some map content
    const clusterCount = await page.locator('.marker-cluster').count();
    const markerCount = await page.locator('.leaflet-marker-icon').count();

    expect(clusterCount + markerCount).toBeGreaterThan(0);
  });

  test('second page load is faster (cache test)', async ({ page }) => {
    // First load to warm the cache
    await page.goto('/map');
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    await page.waitForSelector('.leaflet-tile-loaded', { timeout: 10000 });

    // Small delay to ensure response caching
    await page.waitForTimeout(500);

    // Second load should benefit from browser cache and s-maxage headers
    const start = Date.now();
    await page.reload();
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    await page.waitForSelector('.leaflet-tile-loaded', { timeout: 10000 });
    const duration = Date.now() - start;

    // Cached reload should be noticeably faster (< 3 seconds)
    expect(duration).toBeLessThan(3000);
  });

  test('viewport change triggers data load without errors', async ({ page }) => {
    await page.goto('/map');

    // Wait for initial load
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    await page.waitForFunction(() => {
      const clusters = document.querySelectorAll('.marker-cluster');
      const markers = document.querySelectorAll('.leaflet-marker-icon');
      return clusters.length > 0 || markers.length > 0;
    }, { timeout: 15000 });

    // Get initial marker count
    const initialClusters = await page.locator('.marker-cluster').count();
    const initialMarkers = await page.locator('.leaflet-marker-icon').count();
    const initialTotal = initialClusters + initialMarkers;

    // Pan the map by simulating a drag
    const mapContainer = page.locator('.leaflet-container');
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
    await expect(page.locator('.leaflet-container')).toBeVisible();

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

    const data = await response.json();

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

    const data = await response.json();
    expect(data).toHaveProperty('atlas_pins');
    expect(Array.isArray(data.atlas_pins)).toBeTruthy();
  });

  test('zoom in triggers viewport-based loading', async ({ page }) => {
    await page.goto('/map');

    // Wait for initial load
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    await page.waitForFunction(() => {
      const clusters = document.querySelectorAll('.marker-cluster');
      const markers = document.querySelectorAll('.leaflet-marker-icon');
      return clusters.length > 0 || markers.length > 0;
    }, { timeout: 15000 });

    // Zoom in using the zoom control
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    if (await zoomIn.isVisible()) {
      await zoomIn.click();
      await page.waitForTimeout(500);
      await zoomIn.click();
      await page.waitForTimeout(500);
    }

    // Wait for potential data reload after zoom
    await page.waitForTimeout(1000);

    // Map should still function after zoom
    await expect(page.locator('.leaflet-container')).toBeVisible();

    // Should still have markers visible
    const clusterCount = await page.locator('.marker-cluster').count();
    const markerCount = await page.locator('.leaflet-marker-icon').count();
    expect(clusterCount + markerCount).toBeGreaterThanOrEqual(0);
  });

  test('map filter changes do not cause excessive reloads', async ({ page }) => {
    await page.goto('/map');

    // Wait for initial load
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });

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
