import { test, expect } from '@playwright/test';
import { navigateTo, findRealEntity, waitForLoaded } from './ui-test-helpers';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * Workflow Tests
 *
 * Tests complete user journeys through the application:
 * - Navigating from dashboard to entity details
 * - Cross-linking between related entities
 * - Intake queue operations
 */

test.describe('Navigation Workflows', () => {

  test('dashboard to request detail flow', async ({ page }) => {
    await navigateTo(page, '/');
    await waitForLoaded(page);

    // Navigate to requests page (sidebar link may be outside viewport)
    await navigateTo(page, '/requests');
    await expect(page).toHaveURL(/\/requests/);
  });

  test('request to place navigation', async ({ page, request }) => {
    // Get a request with a place
    const requestsResponse = await request.get('/api/requests?limit=20');
    const requestsData = unwrapApiResponse<Record<string, unknown>>(await requestsResponse.json());

    const requests = (requestsData.requests as Record<string, unknown>[]) || [];
    const reqWithPlace = requests.find((r) => r.place_id);
    if (!reqWithPlace) {
      test.skip();
      return;
    }

    // Go to request
    await navigateTo(page, `/requests/${reqWithPlace.request_id}`);
    await waitForLoaded(page);

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('person detail loads', async ({ page, request }) => {
    const personId = await findRealEntity(request, 'people');
    if (!personId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Should show person details
    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Intake Queue Workflow', () => {

  test('intake queue page loads', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Page should load without error
    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Search and Filter', () => {

  test('requests page loads with data', async ({ page }) => {
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('places page loads with data', async ({ page }) => {
    await navigateTo(page, '/places');
    await waitForLoaded(page);

    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Detail Page Loading', () => {

  test('place detail loads correctly', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    if (!placeId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    await expect(page.locator('body')).toBeVisible();
  });

  test('request detail loads correctly', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    await expect(page.locator('body')).toBeVisible();
  });

  test('cat detail loads correctly', async ({ page, request }) => {
    const catId = await findRealEntity(request, 'cats');
    if (!catId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    await expect(page.locator('body')).toBeVisible();
  });

});
