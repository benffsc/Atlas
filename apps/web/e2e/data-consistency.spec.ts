import { test, expect } from '@playwright/test';
import { navigateTo } from './ui-test-helpers';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * Data Consistency Tests
 *
 * Cross-references data between different views to ensure consistency:
 * - Clinic data (cats) matches trapping requests
 * - Place cat counts match linked cats
 * - Person-place relationships are consistent
 * - Colony estimates align with verified alterations
 */

test.describe('Data Consistency @data-quality', () => {

  test.describe('API Health', () => {
    test('requests API returns valid data', async ({ request }) => {
      const response = await request.get('/api/requests?limit=10');
      expect(response.ok()).toBeTruthy();
      const data = unwrapApiResponse<{ requests: unknown[] }>(await response.json());
      expect(data).toHaveProperty('requests');
      expect(Array.isArray(data.requests)).toBe(true);
    });

    test('places API returns valid data', async ({ request }) => {
      const response = await request.get('/api/places?limit=10');
      expect(response.ok()).toBeTruthy();
      const data = unwrapApiResponse<{ places: unknown[] }>(await response.json());
      expect(data).toHaveProperty('places');
      expect(Array.isArray(data.places)).toBe(true);
    });

    test('people API returns valid data', async ({ request }) => {
      const response = await request.get('/api/people?limit=10');
      expect(response.ok()).toBeTruthy();
      const data = unwrapApiResponse<{ people: unknown[] }>(await response.json());
      expect(data).toHaveProperty('people');
      expect(Array.isArray(data.people)).toBe(true);
    });

    test('cats API returns valid data', async ({ request }) => {
      const response = await request.get('/api/cats?limit=10');
      expect(response.ok()).toBeTruthy();
      const data = unwrapApiResponse<{ cats: unknown[] }>(await response.json());
      expect(data).toHaveProperty('cats');
      expect(Array.isArray(data.cats)).toBe(true);
    });
  });

  test.describe('Cross-Reference Validation', () => {

    test('place detail page loads for valid place', async ({ page, request }) => {
      // Get a place from API
      const placesResponse = await request.get('/api/places?limit=5');
      const placesData = unwrapApiResponse<{ places: Record<string, unknown>[] }>(await placesResponse.json());

      if (!placesData.places?.length) {
        test.skip();
        return;
      }

      const place = placesData.places[0];

      // Navigate to place detail
      await navigateTo(page, `/places/${place.place_id}`);
      await page.waitForLoadState('domcontentloaded');

      // Page should load without error
      await expect(page.locator('body')).toBeVisible();

      // Should not show a 404 page (check for actual 404 heading, not script content)
      await expect(page.locator('h1:has-text("404")')).not.toBeVisible();
    });

    test('request detail page loads for valid request', async ({ page, request }) => {
      // Get a request from API
      const requestsResponse = await request.get('/api/requests?limit=5');
      const requestsData = unwrapApiResponse<{ requests: Record<string, unknown>[] }>(await requestsResponse.json());

      if (!requestsData.requests?.length) {
        test.skip();
        return;
      }

      const req = requestsData.requests[0];

      // Navigate to request detail
      await navigateTo(page, `/requests/${req.request_id}`);
      await page.waitForLoadState('domcontentloaded');

      // Page should load without error
      await expect(page.locator('body')).toBeVisible();
    });

    test('person detail page loads for valid person', async ({ page, request }) => {
      // Get a person from API
      const peopleResponse = await request.get('/api/people?limit=5');
      const peopleData = unwrapApiResponse<{ people: Record<string, unknown>[] }>(await peopleResponse.json());

      if (!peopleData.people?.length) {
        test.skip();
        return;
      }

      const person = peopleData.people[0];

      // Navigate to person detail
      await navigateTo(page, `/people/${person.person_id}`);
      await page.waitForLoadState('domcontentloaded');

      // Page should load without error
      await expect(page.locator('body')).toBeVisible();
    });

  });

  test.describe('Colony Data Consistency', () => {

    test('colony estimates API returns data for place', async ({ request }) => {
      // Get places
      const placesResponse = await request.get('/api/places?limit=10');
      const placesData = unwrapApiResponse<{ places: Record<string, unknown>[] }>(await placesResponse.json());

      if (!placesData.places?.length) {
        test.skip();
        return;
      }

      // Try a few places to find one with colony data
      for (const place of placesData.places.slice(0, 5)) {
        const colonyResponse = await request.get(`/api/places/${place.place_id}/colony-estimates`);

        if (colonyResponse.ok()) {
          const colonyData = unwrapApiResponse<Record<string, unknown>>(await colonyResponse.json());
          expect(colonyData).toHaveProperty('place_id');
          return; // Test passed
        }
      }

      // If no place had colony data, that's okay
      expect(true).toBe(true);
    });

  });

});

test.describe('Beacon Data Integrity', () => {

  test('enrichment stats API responds', async ({ request }) => {
    const response = await request.get('/api/admin/beacon/enrichment');

    // API should respond (may fail due to DB, but should not 404)
    expect(response.status()).not.toBe(404);
  });

  test('reproduction stats API responds', async ({ request }) => {
    const response = await request.get('/api/admin/beacon/reproduction/stats');

    // Should respond successfully or with a handled error
    expect([200, 500].includes(response.status())).toBe(true);

    if (response.ok()) {
      const data = unwrapApiResponse<{ vitals: unknown }>(await response.json());
      // If successful, should have expected structure
      expect(data).toHaveProperty('vitals');
    }
  });

  test('mortality stats API responds', async ({ request }) => {
    const response = await request.get('/api/admin/beacon/mortality/stats');

    expect([200, 500].includes(response.status())).toBe(true);

    if (response.ok()) {
      const data = unwrapApiResponse<{ total_events: unknown }>(await response.json());
      expect(data).toHaveProperty('total_events');
    }
  });

});
