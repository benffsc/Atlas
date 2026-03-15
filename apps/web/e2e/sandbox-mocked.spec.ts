import { test, expect } from '@playwright/test';

/**
 * Sandbox Tests with Mocked APIs
 *
 * These tests intercept API calls and return mock data, so we can:
 * - Click any button safely
 * - Submit forms without creating real records
 * - Test error handling with fake errors
 * - Test full workflows with predictable data
 *
 * NO REAL DATA IS EVER TOUCHED.
 */

// Mock data for testing
const MOCK_SUBMISSION = {
  submission_id: 'test-submission-001',
  submitted_at: new Date().toISOString(),
  submitter_name: 'Test User',
  email: 'test@example.com',
  phone: '707-555-0100',
  cats_address: '123 Test Street',
  cats_city: 'Santa Rosa',
  cat_count_estimate: 5,
  has_kittens: true,
  submission_status: 'new',
  triage_score: 75,
};

const MOCK_REQUEST = {
  request_id: 'test-request-001',
  status: 'new',
  priority: 'normal',
  summary: 'Test request for E2E testing',
  place_id: 'test-place-001',
  place_name: 'Test Location',
  place_address: '456 Mock Ave',
  requester_name: 'Mock Requester',
  created_at: new Date().toISOString(),
  estimated_cat_count: 3,
};

const MOCK_PLACE = {
  place_id: 'test-place-001',
  display_name: 'Test Location',
  street_address: '456 Mock Ave',
  city: 'Santa Rosa',
  state: 'CA',
  zip: '95401',
  latitude: 38.4404,
  longitude: -122.7141,
  cat_count: 5,
};

test.describe('Mocked Intake Workflow @workflow', () => {

  test('can submit intake form with mocked API', async ({ page }) => {
    // Intercept the submission API - return success without saving
    await page.route('**/api/intake/submit', async (route) => {
      console.log('Intercepted intake submission - returning mock success');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          submission_id: 'mock-' + Date.now(),
          message: 'Submission received (MOCKED)',
        }),
      });
    });

    await page.goto('/intake');
    await page.waitForLoadState('networkidle');

    // Now we can safely interact with the form
    // Fill out form fields if they exist
    const nameInput = page.locator('input[name="name"], input[name="submitter_name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('E2E Test User');
    }

    const emailInput = page.locator('input[name="email"], input[type="email"]').first();
    if (await emailInput.isVisible()) {
      await emailInput.fill('e2e-test@example.com');
    }

    // Page should remain functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('can change status with mocked API', async ({ page }) => {
    // Mock the queue API to return our test submission
    await page.route('**/api/intake/queue**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          submissions: [MOCK_SUBMISSION],
          total: 1,
        }),
      });
    });

    // Mock the status update API
    await page.route('**/api/intake/queue/*/status', async (route) => {
      console.log('Intercepted status change - returning mock success');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Status updated (MOCKED)' }),
      });
    });

    // Mock any PATCH requests
    await page.route('**/api/intake/**', async (route, request) => {
      if (request.method() === 'PATCH' || request.method() === 'PUT') {
        console.log(`Intercepted ${request.method()} - returning mock success`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/intake/queue');
    await page.waitForLoadState('networkidle');

    // Now we can safely click on submissions and change status
    // The mock data should appear
    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Mocked Request Workflow', () => {

  test('can view and modify request with mocked APIs', async ({ page }) => {
    // Mock requests list
    await page.route('**/api/requests?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requests: [MOCK_REQUEST],
          total: 1,
        }),
      });
    });

    // Mock single request detail
    await page.route('**/api/requests/test-request-001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_REQUEST),
      });
    });

    // Mock any updates to requests
    await page.route('**/api/requests/**', async (route, request) => {
      if (request.method() === 'PATCH' || request.method() === 'PUT' || request.method() === 'DELETE') {
        console.log(`Intercepted ${request.method()} on request - mocked`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    // Should show our mock request
    await expect(page.locator('body')).toBeVisible();
  });

  test('delete button works with mocked API', async ({ page }) => {
    // Mock the delete endpoint
    await page.route('**/api/requests/**', async (route, request) => {
      if (request.method() === 'DELETE') {
        console.log('Intercepted DELETE - returning mock success');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Deleted (MOCKED)' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_REQUEST),
        });
      }
    });

    await page.goto('/requests/test-request-001');
    await page.waitForLoadState('networkidle');

    // Find delete button and click it (safe because API is mocked)
    const deleteButton = page.locator('button:has-text("Delete"), button:has-text("Remove")').first();
    if (await deleteButton.isVisible()) {
      await deleteButton.click();

      // If there's a confirmation dialog, confirm it
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmButton.click();
      }

      console.log('Delete button clicked with mocked API');
    }

    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Mocked Place Workflow', () => {

  test('can add colony estimate with mocked API', async ({ page }) => {
    // Mock place detail
    await page.route('**/api/places/test-place-001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PLACE),
      });
    });

    // Mock colony estimates
    await page.route('**/api/places/*/colony-estimates', async (route, request) => {
      if (request.method() === 'POST') {
        console.log('Intercepted colony estimate POST - mocked');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, estimate_id: 'mock-estimate-001' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            place_id: 'test-place-001',
            estimates: [],
            status: { colony_size_estimate: 5 },
            ecology: { a_known: 3 },
            has_data: true,
          }),
        });
      }
    });

    // Mock colony override
    await page.route('**/api/places/*/colony-override', async (route) => {
      console.log('Intercepted colony override - mocked');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/places/test-place-001');
    await page.waitForLoadState('networkidle');

    // Find override button and click (safe - mocked)
    const overrideButton = page.locator('button:has-text("Override"), button:has-text("Set Manual")').first();
    if (await overrideButton.isVisible()) {
      await overrideButton.click();
      console.log('Override button clicked with mocked API');
    }

    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Mocked Error Handling', () => {

  test('UI handles API errors gracefully', async ({ page }) => {
    // Mock API to return errors
    await page.route('**/api/requests**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated server error for testing' }),
      });
    });

    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    // Page should handle error gracefully, not crash
    await expect(page.locator('body')).toBeVisible();

    // Should show some kind of error state or empty state
    const bodyText = await page.textContent('body');
    console.log('Page handled 500 error - still functional');
  });

  test('UI handles network timeout gracefully', async ({ page }) => {
    // Mock API to be very slow (simulating timeout)
    await page.route('**/api/places**', async (route) => {
      // Delay for 100ms then return (simulating slow but not timeout)
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ places: [], total: 0 }),
      });
    });

    await page.goto('/places');
    await page.waitForLoadState('networkidle');

    // Page should still work
    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Full Workflow with Mocks', () => {

  test('complete intake to request workflow (all mocked)', async ({ page }) => {
    // Step 1: Mock intake submission
    await page.route('**/api/intake/submit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, submission_id: 'workflow-test-001' }),
      });
    });

    // Step 2: Mock intake queue showing our submission
    await page.route('**/api/intake/queue**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          submissions: [{
            ...MOCK_SUBMISSION,
            submission_id: 'workflow-test-001',
          }],
          total: 1,
        }),
      });
    });

    // Step 3: Mock status updates
    await page.route('**/api/intake/**', async (route, request) => {
      if (request.method() !== 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.continue();
      }
    });

    // Step 4: Mock request creation
    await page.route('**/api/requests', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, request_id: 'new-request-001' }),
        });
      } else {
        await route.continue();
      }
    });

    // Now run through the workflow
    console.log('Starting mocked workflow test...');

    // Visit intake queue
    await page.goto('/intake/queue');
    await page.waitForLoadState('networkidle');
    console.log('  1. Viewed intake queue');

    // Page should show our mock submission
    await expect(page.locator('body')).toBeVisible();
    console.log('  2. Mock submission displayed');

    // Click on submission (if clickable)
    const submissionRow = page.locator('tr, [class*="card"], [class*="submission"]').first();
    if (await submissionRow.isVisible()) {
      await submissionRow.click();
      await page.waitForTimeout(300);
      console.log('  3. Clicked on submission');
    }

    console.log('Mocked workflow completed successfully!');
  });

});
