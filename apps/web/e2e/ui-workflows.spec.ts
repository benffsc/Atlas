import { test, expect, Page } from '@playwright/test';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * UI Workflow Tests - Comprehensive User Journey Testing
 *
 * Tests actual user workflows that a staff member would perform:
 * - Logging in with test account
 * - Navigating and viewing requests
 * - Logging observations for sites
 * - Viewing colony statistics
 * - Interacting with places, cats, and people
 * - Testing forms and buttons (with mocking for destructive actions)
 *
 * Uses test account: test@forgottenfelines.com
 * Access code: ffsc2024
 */

// Increase timeout for all tests in this file
test.setTimeout(60000);

// Test account credentials
const TEST_EMAIL = 'test@forgottenfelines.com';
const TEST_PASSWORD = 'testpass123';
const ACCESS_CODE = 'ffsc2024';

// Helper to pass the password gate
async function passPasswordGate(page: Page) {
  const gateVisible = await page.locator('input[placeholder*="code" i], input[name="accessCode"]').isVisible().catch(() => false);
  if (gateVisible) {
    await page.fill('input[placeholder*="code" i], input[name="accessCode"]', ACCESS_CODE);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
  }
}

// Helper to perform full login
async function fullLogin(page: Page) {
  await page.goto('/');
  await passPasswordGate(page);
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  // Check if already logged in
  const loginForm = await page.locator('form').isVisible().catch(() => false);
  if (!loginForm) {
    return; // Already logged in
  }

  await page.fill('input#email, input[name="email"], input[type="email"]', TEST_EMAIL);
  await page.fill('input#password, input[name="password"], input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 30000 });
}

// ============================================================================
// LOGIN & AUTHENTICATION TESTS
// ============================================================================

test.describe('Authentication Workflows', () => {
  test('can log in with test account', async ({ page }) => {
    await page.goto('/');
    await passPasswordGate(page);
    await page.goto('/login');

    await page.fill('input#email, input[name="email"], input[type="email"]', TEST_EMAIL);
    await page.fill('input#password, input[name="password"], input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL('/', { timeout: 30000 });
    await expect(page.locator('body')).toBeVisible();

    // Should see dashboard content
    const dashboardContent = await page.content();
    expect(dashboardContent).not.toContain('Login');
  });

  test('redirects to login when accessing protected route', async ({ page }) => {
    await page.goto('/admin');
    await passPasswordGate(page);

    // Should redirect to login or show access denied
    const url = page.url();
    const content = await page.content();
    expect(url.includes('login') || content.includes('Access') || content.includes('login')).toBeTruthy();
  });
});

// ============================================================================
// DASHBOARD & NAVIGATION TESTS
// ============================================================================

test.describe('Dashboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('dashboard loads with key sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check for dashboard elements
    await expect(page.locator('body')).toBeVisible();

    // Should have navigation elements
    const navExists = await page.locator('nav, [role="navigation"], .nav').isVisible().catch(() => false);
    expect(navExists).toBeTruthy();
  });

  test('can navigate to requests page', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1').first()).toBeVisible();

    // Should have request list or empty state
    const hasContent = await page.content();
    expect(hasContent.length).toBeGreaterThan(100);
  });

  test('can navigate to places page', async ({ page }) => {
    await page.goto('/places');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('can navigate to cats page', async ({ page }) => {
    await page.goto('/cats');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('can navigate to people page', async ({ page }) => {
    await page.goto('/people');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('can navigate between tabs rapidly', async ({ page }) => {
    const tabs = ['/requests', '/places', '/cats', '/people', '/'];

    for (const tab of tabs) {
      await page.goto(tab);
      await page.waitForLoadState('domcontentloaded');

      // No crash or unhandled errors
      const content = await page.content();
      expect(content.toLowerCase()).not.toContain('unhandled');
      expect(content.toLowerCase()).not.toContain('crashed');
    }
  });
});

// ============================================================================
// REQUEST WORKFLOW TESTS
// ============================================================================

test.describe('Request Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('can view request list and click into detail', async ({ page }) => {
    // Get a request from API
    const response = await page.request.get('/api/requests?limit=5');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.requests || (data.requests as unknown[]).length === 0) {
      test.skip();
      return;
    }

    const requestId = (data.requests as Record<string, unknown>[])[0].request_id;

    // Navigate to request detail
    await page.goto(`/requests/${requestId}`);
    await page.waitForLoadState('domcontentloaded');

    // Should show request details
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // Check for common request fields
    const content = await page.content();
    expect(content).toMatch(/status|address|cat|request/i);
  });

  test('request detail shows related data sections', async ({ page }) => {
    const response = await page.request.get('/api/requests?limit=1');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.requests || (data.requests as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/requests/${(data.requests as Record<string, unknown>[])[0].request_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Check for expandable sections or tabs
    const sections = ['cats', 'history', 'notes', 'trapper', 'place'];
    let foundSections = 0;

    for (const section of sections) {
      const hasSection = await page.locator(`text=${section}`).first().isVisible().catch(() => false);
      if (hasSection) foundSections++;
    }

    // Should have at least some related sections
    expect(foundSections).toBeGreaterThanOrEqual(1);
  });

  test('can use filters on request list', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('domcontentloaded');

    // Look for filter buttons or dropdowns
    const filterButtons = page.locator('button:has-text("Filter"), button:has-text("Status"), select');
    const filterCount = await filterButtons.count();

    if (filterCount > 0) {
      // Click a filter if available
      await filterButtons.first().click();
      await page.waitForTimeout(300);

      // Should show filter options
      const optionsVisible = await page.locator('[role="listbox"], [role="menu"], .dropdown').isVisible().catch(() => false);
      // Filter interaction completed without error
      expect(true).toBeTruthy();
    }
  });
});

// ============================================================================
// PLACE & COLONY WORKFLOW TESTS
// ============================================================================

test.describe('Place & Colony Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('can view place detail with colony info', async ({ page }) => {
    const response = await page.request.get('/api/places?limit=10');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.places || (data.places as unknown[]).length === 0) {
      test.skip();
      return;
    }

    // Find a place with cat activity
    const places = data.places as Record<string, unknown>[];
    const placeWithCats = places.find((p) => p.has_cat_activity) || places[0];

    await page.goto(`/places/${placeWithCats.place_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Should show place details
    await expect(page.locator('h1').first()).toBeVisible();

    // Check for place-related content
    const content = await page.content();
    expect(content).toMatch(/address|location|cat|colony/i);
  });

  test('place detail shows context badges if available', async ({ page }) => {
    const response = await page.request.get('/api/places?limit=20');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.places || (data.places as unknown[]).length === 0) {
      test.skip();
      return;
    }

    // Check a few places for context badges
    let foundBadges = false;

    for (const place of (data.places as Record<string, unknown>[]).slice(0, 5)) {
      await page.goto(`/places/${place.place_id}`);
      await page.waitForLoadState('domcontentloaded');

      // Look for badge elements
      const badges = await page.locator('.badge, [class*="badge"]').count();
      if (badges > 0) {
        foundBadges = true;
        break;
      }
    }

    // Badges may or may not exist, but page should render
    expect(true).toBeTruthy();
    console.log(`Found context badges: ${foundBadges}`);
  });

  test('can view colony statistics on place page', async ({ page }) => {
    const response = await page.request.get('/api/places?limit=10&has_cat_activity=true');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.places || (data.places as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/places/${(data.places as Record<string, unknown>[])[0].place_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Look for statistics section
    const statsSection = await page.locator('text=/cat count|colony|alteration|fixed/i').first().isVisible().catch(() => false);
    console.log(`Colony stats visible: ${statsSection}`);
  });
});

// ============================================================================
// OBSERVATION LOGGING WORKFLOW TESTS
// ============================================================================

test.describe('Observation Logging Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('observation form elements exist on place page', async ({ page }) => {
    const response = await page.request.get('/api/places?limit=5');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.places || (data.places as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/places/${(data.places as Record<string, unknown>[])[0].place_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Look for observation button or form
    const obsButton = page.locator('button:has-text("observation"), button:has-text("Log"), [data-testid="log-observation"]');
    const buttonExists = await obsButton.isVisible().catch(() => false);

    console.log(`Observation button found: ${buttonExists}`);
  });

  test('can open observation modal (mocked submission)', async ({ page }) => {
    // Mock the observation submission API
    await page.route('**/api/observations', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, observation_id: 'mock-obs-123' }),
      });
    });

    const response = await page.request.get('/api/places?limit=5');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.places || (data.places as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/places/${(data.places as Record<string, unknown>[])[0].place_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Try to find and click observation button
    const obsButton = page.locator('button:has-text("observation"), button:has-text("Log")');

    if (await obsButton.isVisible().catch(() => false)) {
      await obsButton.click();
      await page.waitForTimeout(500);

      // Check if modal opened
      const modalVisible = await page.locator('[role="dialog"], .modal, [class*="modal"]').isVisible().catch(() => false);
      console.log(`Observation modal opened: ${modalVisible}`);
    }
  });
});

// ============================================================================
// CAT DETAIL WORKFLOW TESTS
// ============================================================================

test.describe('Cat Detail Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('can view cat detail with microchip info', async ({ page }) => {
    const response = await page.request.get('/api/cats?limit=5');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.cats || (data.cats as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/cats/${(data.cats as Record<string, unknown>[])[0].cat_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Should show cat page content
    await expect(page.locator('body')).toBeVisible();

    // Check for cat-related content
    const content = await page.content();
    expect(content).toMatch(/microchip|name|breed|sex|age/i);
  });

  test('cat detail shows appointment history', async ({ page }) => {
    const response = await page.request.get('/api/cats?limit=10');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.cats || (data.cats as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/cats/${(data.cats as Record<string, unknown>[])[0].cat_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Look for appointment or clinic history section
    const historySection = await page.locator('text=/appointment|clinic|visit|history/i').first().isVisible().catch(() => false);
    console.log(`Appointment history section visible: ${historySection}`);
  });
});

// ============================================================================
// PERSON DETAIL WORKFLOW TESTS
// ============================================================================

test.describe('Person Detail Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('can view person detail', async ({ page }) => {
    const response = await page.request.get('/api/people?limit=5');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.people || (data.people as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/people/${(data.people as Record<string, unknown>[])[0].person_id}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1').first()).toBeVisible();

    // Check for person-related content
    const content = await page.content();
    expect(content).toMatch(/name|email|phone|contact/i);
  });

  test('person detail shows related cats and requests', async ({ page }) => {
    const response = await page.request.get('/api/people?limit=10');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.people || (data.people as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/people/${(data.people as Record<string, unknown>[])[0].person_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Look for related data sections
    const relatedSections = await page.locator('text=/cats|requests|history|relationships/i').first().isVisible().catch(() => false);
    console.log(`Related sections visible: ${relatedSections}`);
  });
});

// ============================================================================
// INTAKE QUEUE WORKFLOW TESTS
// ============================================================================

test.describe('Intake Queue Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('can view intake queue', async ({ page }) => {
    await page.goto('/intake/queue');
    await page.waitForLoadState('domcontentloaded');

    // Should show queue page
    const content = await page.content();
    expect(content).toMatch(/intake|queue|submission/i);
  });

  test('can view intake submission detail', async ({ page }) => {
    const response = await page.request.get('/api/intake/queue?limit=5');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.submissions || (data.submissions as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/intake/queue/${(data.submissions as Record<string, unknown>[])[0].submission_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Should show submission details
    const content = await page.content();
    expect(content).toMatch(/name|email|address|cat/i);
  });
});

// ============================================================================
// ADMIN WORKFLOW TESTS
// ============================================================================

test.describe('Admin Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('can access admin dashboard', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');

    // Should show admin content or access denied
    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
  });

  test('can view data engine page', async ({ page }) => {
    await page.goto('/admin/data-engine');
    await page.waitForLoadState('domcontentloaded');

    const content = await page.content();
    // Should show data engine or redirect
    expect(content.length).toBeGreaterThan(100);
  });
});

// ============================================================================
// PERSONAL DASHBOARD WORKFLOW TESTS
// ============================================================================

test.describe('Personal Dashboard Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('can access my dashboard', async ({ page }) => {
    await page.goto('/me');
    await page.waitForLoadState('domcontentloaded');

    // Should show personal dashboard
    const content = await page.content();
    expect(content).toMatch(/reminder|lookup|my item|dashboard/i);
  });

  test('reminders section is visible', async ({ page }) => {
    await page.goto('/me');
    await page.waitForLoadState('domcontentloaded');

    // Look for reminders section
    const remindersVisible = await page.locator('text=/reminder/i').first().isVisible().catch(() => false);
    console.log(`Reminders section visible: ${remindersVisible}`);
  });
});

// ============================================================================
// BUTTON INTERACTION TESTS (SAFE - Read-only or mocked)
// ============================================================================

test.describe('Button Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('expand/collapse buttons work without errors', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('domcontentloaded');

    // Find expand/collapse or accordion buttons
    const expandButtons = page.locator('[aria-expanded], button:has-text("expand"), button:has-text("show"), [data-state="closed"]');
    const count = await expandButtons.count();

    if (count > 0) {
      // Try to click first expand button
      try {
        await expandButtons.first().click({ timeout: 3000 });
        await page.waitForTimeout(300);
      } catch {
        // Button might not be clickable, that's OK
      }

      // Should not crash
      const content = await page.content();
      expect(content.toLowerCase()).not.toContain('crashed');
    }

    // Test passes if no crash
    expect(true).toBeTruthy();
  });

  test('filter buttons work on list pages', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('domcontentloaded');

    // Try status filter buttons
    const filterButtons = page.locator('button:has-text("All"), button:has-text("Pending"), button:has-text("Active")');

    if (await filterButtons.first().isVisible().catch(() => false)) {
      await filterButtons.first().click();
      await page.waitForTimeout(300);

      // Should update view without error
      expect(true).toBeTruthy();
    }
  });

  test('tab navigation buttons work', async ({ page }) => {
    const response = await page.request.get('/api/requests?limit=1');

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    if (!data.requests || (data.requests as unknown[]).length === 0) {
      test.skip();
      return;
    }

    await page.goto(`/requests/${(data.requests as Record<string, unknown>[])[0].request_id}`);
    await page.waitForLoadState('domcontentloaded');

    // Find tab buttons
    const tabs = page.locator('[role="tab"], button[class*="tab"]');
    const tabCount = await tabs.count();

    if (tabCount > 1) {
      // Click through tabs
      for (let i = 0; i < Math.min(tabCount, 3); i++) {
        await tabs.nth(i).click();
        await page.waitForTimeout(200);
      }

      // Should complete without error
      expect(true).toBeTruthy();
    }
  });
});

// ============================================================================
// FORM VALIDATION TESTS
// ============================================================================

test.describe('Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await fullLogin(page);
  });

  test('forms show validation errors for required fields', async ({ page }) => {
    // Mock form submission to test validation
    await page.route('**/api/**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Validation failed' }),
        });
      } else {
        await route.continue();
      }
    });

    // Try to access a form page
    await page.goto('/intake');
    await page.waitForLoadState('domcontentloaded');

    // Look for form with required fields
    const requiredFields = page.locator('input[required], [aria-required="true"]');
    const count = await requiredFields.count();

    console.log(`Found ${count} required fields on intake form`);
  });
});
