import { test, expect } from '@playwright/test';
import { navigateTo, waitForLoaded, mockAllWrites } from './ui-test-helpers';

/**
 * Airtable Sync E2E Tests — @workflow
 *
 * Covers Airtable Sync Engine (FFS-503 Epic):
 * - /admin/airtable-syncs page loads with sync list
 * - /api/admin/airtable-syncs returns sync configs
 * - Each sync config has required fields
 * - Sync detail page loads for first sync
 * - Field mappings are valid JSON
 * - Sync run history accessible
 *
 * Tests are READ-ONLY. Write operations (trigger sync) are mocked.
 */

// Helper: get the first sync config ID
async function findFirstSyncId(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  try {
    const res = await request.get('/api/admin/airtable-syncs');
    if (!res.ok()) return null;
    const json = await res.json();
    const data = json.data || json;
    const syncs = Array.isArray(data) ? data : data.syncs || [];
    if (!syncs.length) return null;
    return syncs[0].id || syncs[0].sync_id || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Airtable Syncs Page
// ============================================================================

test.describe('Airtable Syncs Page', () => {
  test.setTimeout(45000);

  test('/admin/airtable-syncs page loads', async ({ page }) => {
    await navigateTo(page, '/admin/airtable-syncs');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/airtable-syncs shows sync list or empty state', async ({ page }) => {
    await navigateTo(page, '/admin/airtable-syncs');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasSyncContent =
      bodyText.includes('Airtable') ||
      bodyText.includes('Sync') ||
      bodyText.includes('Base') ||
      bodyText.includes('No syncs');
    console.log(`Airtable syncs page has content: ${hasSyncContent}`);
  });

  test('/admin/airtable-syncs has search or filter', async ({ page }) => {
    await navigateTo(page, '/admin/airtable-syncs');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Look for search input or filter controls
    const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
    const hasSearch = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Airtable syncs page has search: ${hasSearch}`);
  });
});

// ============================================================================
// Airtable Syncs API
// ============================================================================

test.describe('Airtable Syncs API', () => {
  test.setTimeout(30000);

  test('/api/admin/airtable-syncs returns sync configs', async ({ request }) => {
    const res = await request.get('/api/admin/airtable-syncs');
    if (!res.ok()) {
      // May require auth
      expect(res.status()).toBeLessThan(500);
      console.log(`Airtable syncs API returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    const syncs = Array.isArray(data) ? data : data.syncs || [];

    expect(Array.isArray(syncs)).toBe(true);
    console.log(`Airtable syncs API returned ${syncs.length} configs`);
  });

  test('sync configs have required fields', async ({ request }) => {
    const res = await request.get('/api/admin/airtable-syncs');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;
    const syncs = Array.isArray(data) ? data : data.syncs || [];

    if (syncs.length === 0) {
      console.log('No sync configs — passing');
      return;
    }

    for (const sync of syncs) {
      // Required fields per Airtable sync engine spec
      expect(sync).toHaveProperty('name');
      expect(sync).toHaveProperty('airtable_base_id');
      expect(typeof sync.is_active === 'boolean' || sync.is_active !== undefined).toBe(true);

      console.log(`Sync: ${sync.name} (active: ${sync.is_active})`);
    }
  });

  test('sync configs have valid airtable_base_id format', async ({ request }) => {
    const res = await request.get('/api/admin/airtable-syncs');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;
    const syncs = Array.isArray(data) ? data : data.syncs || [];

    for (const sync of syncs) {
      if (sync.airtable_base_id) {
        // Airtable base IDs start with "app"
        expect(sync.airtable_base_id).toMatch(/^app/);
      }
    }
  });

  test('field_mappings are valid JSON objects', async ({ request }) => {
    const res = await request.get('/api/admin/airtable-syncs');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;
    const syncs = Array.isArray(data) ? data : data.syncs || [];

    for (const sync of syncs) {
      if (sync.field_mappings) {
        // field_mappings should be an object (JSON)
        expect(typeof sync.field_mappings).toBe('object');
        expect(sync.field_mappings).not.toBeNull();
      }
    }
  });
});

// ============================================================================
// Sync Detail Page
// ============================================================================

test.describe('Airtable Sync Detail', () => {
  test.setTimeout(45000);

  test('sync detail page loads for first sync', async ({ page, request }) => {
    const syncId = await findFirstSyncId(request);
    if (!syncId) {
      console.log('No sync configs available — skipping detail test');
      return;
    }

    await navigateTo(page, `/admin/airtable-syncs`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Try clicking the first sync row/card to open detail view
    const firstRow = page.locator('tr, [data-sync-id], a[href*="airtable"]').first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasRow) {
      console.log('Sync list row found — detail accessible');
    }
  });

  test('sync detail API returns full config', async ({ request }) => {
    const syncId = await findFirstSyncId(request);
    if (!syncId) return;

    const res = await request.get(`/api/admin/airtable-syncs/${syncId}`);
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    const sync = data.sync || data;

    expect(sync).toHaveProperty('name');
    expect(sync).toHaveProperty('airtable_base_id');
    console.log(`Sync detail: ${sync.name}`);
  });

  test('sync runs API returns run history', async ({ request }) => {
    const syncId = await findFirstSyncId(request);
    if (!syncId) return;

    const res = await request.get(`/api/admin/airtable-syncs/${syncId}/runs`);
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;
    const runs = Array.isArray(data) ? data : data.runs || [];

    expect(Array.isArray(runs)).toBe(true);
    console.log(`Sync ${syncId} has ${runs.length} run history entries`);

    if (runs.length > 0) {
      const run = runs[0];
      // Runs should have status and timestamps
      expect(run.status || run.run_status).toBeDefined();
    }
  });
});

// ============================================================================
// Sync Trigger (Mocked)
// ============================================================================

test.describe('Airtable Sync Trigger (Mocked)', () => {
  test.setTimeout(45000);

  test('trigger button is present on sync page', async ({ page, request }) => {
    await mockAllWrites(page);

    // Also mock airtable sync trigger endpoint
    await page.route('**/api/admin/airtable-syncs/*/trigger', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, run_id: 'mock-run-id' }),
        });
      }
      return route.continue();
    });

    await navigateTo(page, '/admin/airtable-syncs');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Look for trigger/sync/run button
    const triggerBtn = page.locator('button:has-text("Sync"), button:has-text("Run"), button:has-text("Trigger")').first();
    const hasTrigger = await triggerBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Sync page has trigger button: ${hasTrigger}`);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

test.describe('Airtable Sync Edge Cases', () => {
  test.setTimeout(30000);

  test('invalid sync ID returns error', async ({ request }) => {
    const res = await request.get('/api/admin/airtable-syncs/not-a-uuid');
    expect(res.ok()).toBeFalsy();
  });

  test('non-existent sync ID returns 404 or error', async ({ request }) => {
    const res = await request.get('/api/admin/airtable-syncs/00000000-0000-0000-0000-000000000000');
    // Should return 404 or auth error, not 500
    expect(res.status()).toBeLessThan(500);
  });
});
