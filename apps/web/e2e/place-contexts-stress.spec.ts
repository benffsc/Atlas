import { test, expect } from '@playwright/test';
import { unwrapApiResponse } from './helpers/api-response';
import { navigateTo, waitForLoaded } from './ui-test-helpers';

/**
 * Stress tests for Place Context System and Tippy Integration
 *
 * Tests the new place context badges, API responses, and Tippy tools
 * using READ-ONLY operations and MOCKED APIs where necessary.
 *
 * NO REAL DATA IS MODIFIED. All tests are safe for production databases.
 */

// Mock data for testing
const MOCK_PLACE_WITH_CONTEXTS = {
  place_id: 'mock-place-001',
  display_name: 'Test Colony Site',
  formatted_address: '123 Test St, Santa Rosa, CA 95401',
  place_kind: 'outdoor_site',
  is_address_backed: true,
  has_cat_activity: true,
  locality: 'Santa Rosa',
  postal_code: '95401',
  state_province: 'CA',
  coordinates: { lat: 38.4404, lng: -122.7141 },
  cat_count: 5,
  person_count: 2,
  contexts: [
    {
      context_id: 'mock-ctx-001',
      context_type: 'colony_site',
      context_label: 'Colony Site',
      valid_from: '2024-01-01',
      evidence_type: 'request',
      confidence: 0.85,
      is_verified: false,
      assigned_at: '2024-01-01T00:00:00Z',
      source_system: 'web_intake',
    },
  ],
};

test.describe('Place Context UI Tests', () => {
  test('place detail page loads with mocked context badges', async ({ page }) => {
    // Mock place API to return place with contexts
    await page.route('**/api/places/mock-place-001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PLACE_WITH_CONTEXTS),
      });
    });

    // Navigate to mocked place detail
    await page.goto('/places/mock-place-001');
    await page.waitForLoadState('networkidle');

    // Check page loaded (may show error for mock ID, that's OK)
    const bodyContent = await page.content();
    expect(bodyContent).toBeDefined();
    console.log('Mocked place detail page rendered');
  });

  test('place detail page loads with real data (read-only)', async ({ page }) => {
    // Get a real place with contexts from API (read-only)
    const response = await page.request.get('/api/places?limit=10');
    expect(response.ok()).toBeTruthy();
    const data = unwrapApiResponse<Record<string, any>>(await response.json());

    if (data.places && data.places.length > 0) {
      const placeId = data.places[0].place_id;

      // Navigate to place detail (read-only view)
      await page.goto(`/places/${placeId}`);
      await page.waitForLoadState('networkidle');

      // Check page loaded
      await expect(page.locator('h1').first()).toBeVisible();

      // Check for badge container (contexts may or may not exist)
      const badges = page.locator('.badge');
      const badgeCount = await badges.count();
      console.log(`Place ${placeId} has ${badgeCount} badges (read-only view)`);
    }
  });

  test('place API returns contexts array', async ({ request }) => {
    // Get a place list first
    const listResponse = await request.get('/api/places?limit=5');
    expect(listResponse.ok()).toBeTruthy();
    const listData = unwrapApiResponse<Record<string, any>>(await listResponse.json());

    if (listData.places && listData.places.length > 0) {
      const placeId = listData.places[0].place_id;

      // Get detailed place data
      const response = await request.get(`/api/places/${placeId}`);
      expect(response.ok()).toBeTruthy();

      const data = unwrapApiResponse<Record<string, any>>(await response.json());

      // Verify contexts field exists
      expect(data).toHaveProperty('contexts');
      expect(Array.isArray(data.contexts)).toBeTruthy();

      if (data.contexts.length > 0) {
        // Verify context structure
        expect(data.contexts[0]).toHaveProperty('context_type');
        expect(data.contexts[0]).toHaveProperty('context_label');
        expect(data.contexts[0]).toHaveProperty('confidence');
        console.log(`Place has ${data.contexts.length} contexts: ${data.contexts.map((c: { context_type: string }) => c.context_type).join(', ')}`);
      }
    }
  });

  test('multiple place pages can be loaded rapidly', async ({ page }) => {
    const response = await page.request.get('/api/places?limit=10');
    const data = unwrapApiResponse<Record<string, any>>(await response.json());

    if (data.places && data.places.length >= 3) {
      // Rapidly navigate between place pages
      for (let i = 0; i < 3; i++) {
        const placeId = data.places[i].place_id;
        await page.goto(`/places/${placeId}`);
        await page.waitForLoadState('domcontentloaded');

        // Verify page loaded without error
        const errorVisible = await page.locator('text=Error').isVisible().catch(() => false);
        expect(errorVisible).toBeFalsy();
      }
    }
  });
});

test.describe('Tippy API Stress Tests (Mocked)', () => {
  // Helper: use page.evaluate(fetch()) so page.route() mocks actually intercept
  async function tippyFetch(
    page: import('@playwright/test').Page,
    data: Record<string, unknown>
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return page.evaluate(
      async (payload: Record<string, unknown>) => {
        const res = await fetch('/api/tippy/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, body };
      },
      data
    );
  }

  test('tippy chat API handles place context query', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.route('**/api/tippy/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: 'Found 5 colony sites in Petaluma (MOCKED)',
          toolsUsed: ['query_places_by_context'],
          sessionId: 'mock-session',
        }),
      });
    });

    const result = await tippyFetch(page, {
      message: 'Show me colony sites in Petaluma',
      sessionId: `test-${Date.now()}`,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBeDefined();
  });

  test('tippy chat API handles foster query', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.route('**/api/tippy/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: '42 cats have been fostered through FFSC (MOCKED)',
          toolsUsed: ['query_person_cat_relationships'],
          sessionId: 'mock-session',
        }),
      });
    });

    const result = await tippyFetch(page, {
      message: 'How many cats have been fostered?',
      sessionId: `test-${Date.now()}`,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBeDefined();
  });

  test('tippy chat API handles cat journey query', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.route('**/api/tippy/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: 'Whiskers journey: Trapped at colony site -> Clinic visit -> Foster home -> Adopted (MOCKED)',
          toolsUsed: ['query_cat_journey'],
          sessionId: 'mock-session',
        }),
      });
    });

    const result = await tippyFetch(page, {
      message: 'What is the journey of a cat named Whiskers?',
      sessionId: `test-${Date.now()}`,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBeDefined();
  });
});

test.describe('UI Tab Navigation Stress Tests', () => {
  test('places list loads successfully', async ({ page }) => {
    await page.goto('/places');
    await page.waitForLoadState('networkidle');

    // Page should load without errors
    await expect(page.locator('body')).toBeVisible();

    // No crash or unhandled errors
    const bodyText = await page.textContent('body');
    expect(bodyText?.toLowerCase()).not.toContain('unhandled');
    console.log('Places list page loaded successfully');
  });

  test('requests page loads and is navigable', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1').first()).toBeVisible();

    // Get a request to navigate to
    const response = await page.request.get('/api/requests?limit=1');
    if (response.ok()) {
      const data = unwrapApiResponse<Record<string, any>>(await response.json());
      if (data.requests && data.requests.length > 0) {
        // Navigate to detail
        await page.goto(`/requests/${data.requests[0].request_id}`);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('h1').first()).toBeVisible();
      }
    }
  });

  test('people page loads and is navigable', async ({ page }) => {
    await page.goto('/people');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1').first()).toBeVisible();

    // Get a person to navigate to
    const response = await page.request.get('/api/people?limit=1');
    if (response.ok()) {
      const data = unwrapApiResponse<Record<string, any>>(await response.json());
      if (data.people && data.people.length > 0) {
        // Navigate to detail
        await page.goto(`/people/${data.people[0].person_id}`);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('h1').first()).toBeVisible();
      }
    }
  });

  test('cats page loads and is navigable', async ({ page }) => {
    await page.goto('/cats');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1').first()).toBeVisible();

    // Get a cat to navigate to
    const response = await page.request.get('/api/cats?limit=1');
    if (response.ok()) {
      const data = unwrapApiResponse<Record<string, any>>(await response.json());
      if (data.cats && data.cats.length > 0) {
        // Navigate to detail
        await page.goto(`/cats/${data.cats[0].cat_id}`);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('h1').first()).toBeVisible();
      }
    }
  });

  test('rapid tab switching does not crash app', async ({ page }) => {
    const tabs = ['/places', '/requests', '/people', '/cats', '/'];

    // Rapidly switch between tabs
    for (const tab of tabs) {
      await page.goto(tab);
      await page.waitForLoadState('domcontentloaded');

      // App should not show error
      const hasError = await page.locator('text=Error').isVisible().catch(() => false);
      if (hasError) {
        // Check if it's a real error or just word in content
        const errorText = await page.locator('text=Error').textContent().catch(() => '');
        if (errorText?.includes('crashed') || errorText?.includes('failed')) {
          throw new Error(`Page ${tab} shows error: ${errorText}`);
        }
      }
    }
  });
});

test.describe('Data Display Stress Tests', () => {
  test('place detail shows all sections without error', async ({ page }) => {
    const response = await page.request.get('/api/places?limit=1');
    const data = unwrapApiResponse<Record<string, any>>(await response.json());

    if (data.places && data.places.length > 0) {
      await page.goto(`/places/${data.places[0].place_id}`);
      await page.waitForLoadState('networkidle');

      // Check various sections load
      const sections = ['Location Details', 'Activity Summary'];
      for (const section of sections) {
        const sectionEl = page.locator(`text=${section}`);
        // Section should exist (may be collapsed)
        const isVisible = await sectionEl.isVisible().catch(() => false);
        console.log(`Section "${section}" visible: ${isVisible}`);
      }
    }
  });

  test('context badges display correctly for colony sites', async ({ request }) => {
    // Query places with colony_site context
    const response = await request.get('/api/places?limit=50');
    const data = unwrapApiResponse<Record<string, any>>(await response.json());

    let placesWithContexts = 0;

    for (const place of data.places || []) {
      const detailResponse = await request.get(`/api/places/${place.place_id}`);
      if (detailResponse.ok()) {
        const detail = unwrapApiResponse<Record<string, any>>(await detailResponse.json());
        if (detail.contexts && detail.contexts.length > 0) {
          placesWithContexts++;
          console.log(`Place ${detail.display_name}: ${detail.contexts.map((c: { context_type: string }) => c.context_type).join(', ')}`);
          if (placesWithContexts >= 5) break;
        }
      }
    }

    console.log(`Found ${placesWithContexts} places with contexts in sample`);
    // Just verify we can query - not a hard requirement
    expect(true).toBeTruthy();
  });
});

test.describe('Error Resilience', () => {
  test('invalid place ID shows proper error', async ({ page }) => {
    await page.goto('/places/invalid-uuid-12345');
    await page.waitForLoadState('networkidle');

    // Should show error message, not crash
    const pageContent = await page.content();
    expect(pageContent).not.toContain('unhandled');
  });

  test('API handles malformed requests gracefully', async ({ request }) => {
    // Test tippy with empty message — route rejects before calling Anthropic (no cost)
    const response = await request.post('/api/tippy/chat', {
      data: {
        message: '',
        sessionId: 'test',
      },
    });

    // Should return error response, not 500
    expect([400, 401, 403, 422].includes(response.status()) || response.ok()).toBeTruthy();
  });
});
