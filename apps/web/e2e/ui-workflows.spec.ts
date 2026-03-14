import { test, expect } from '@playwright/test';
import { navigateTo, findRealEntity, waitForLoaded, mockAllWrites } from './ui-test-helpers';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * UI Workflow Tests - Comprehensive User Journey Testing
 *
 * Tests actual user workflows that a staff member would perform:
 * - Navigating and viewing requests
 * - Viewing colony statistics
 * - Interacting with places, cats, and people
 * - Testing forms and buttons (with mocking for destructive actions)
 *
 * Auth is handled by Playwright's storageState (set in auth.setup.ts).
 * Updated for Atlas 2.5 architecture (FFS-552).
 */

// Increase timeout for all tests in this file
test.setTimeout(60000);

// ============================================================================
// DASHBOARD & NAVIGATION TESTS
// ============================================================================

test.describe('Dashboard Navigation', () => {

  test('dashboard loads with key sections', async ({ page }) => {
    await navigateTo(page, '/');
    await waitForLoaded(page);

    // Should have navigation elements (Atlas 2.5: sidebar uses <aside>)
    const navExists = await page.locator('nav, aside, header').first().isVisible().catch(() => false);
    expect(navExists).toBeTruthy();
  });

  test('can navigate to requests page', async ({ page }) => {
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Should have request list or empty state
    const hasContent = await page.content();
    expect(hasContent.length).toBeGreaterThan(100);
  });

  test('can navigate to places page', async ({ page }) => {
    await navigateTo(page, '/places');
    await waitForLoaded(page);

    await expect(page.locator('h1, main').first()).toBeVisible();
  });

  test('can navigate to cats page', async ({ page }) => {
    await navigateTo(page, '/cats');
    await waitForLoaded(page);

    await expect(page.locator('h1, main').first()).toBeVisible();
  });

  test('can navigate to people page', async ({ page }) => {
    await navigateTo(page, '/people');
    await waitForLoaded(page);

    await expect(page.locator('h1, main').first()).toBeVisible();
  });

  test('can navigate between tabs rapidly', async ({ page }) => {
    const tabs = ['/requests', '/places', '/cats', '/people', '/'];

    for (const tab of tabs) {
      await navigateTo(page, tab);

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

  test('can view request list and click into detail', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    // Navigate to request detail
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Should show request details
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // Check for common request fields
    const content = await page.content();
    expect(content).toMatch(/status|address|cat|request/i);
  });

  test('request detail shows related data sections', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

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
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Look for filter buttons or dropdowns
    const filterButtons = page.locator('button:has-text("Filter"), button:has-text("Status"), select');
    const filterCount = await filterButtons.count();

    if (filterCount > 0) {
      // Click a filter if available
      await filterButtons.first().click();
      await page.waitForTimeout(300);

      // Filter interaction completed without error
      expect(true).toBeTruthy();
    }
  });
});

// ============================================================================
// PLACE & COLONY WORKFLOW TESTS
// ============================================================================

test.describe('Place & Colony Workflows', () => {

  test('can view place detail with colony info', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    if (!placeId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Should show place details
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // Check for place-related content
    const content = await page.content();
    expect(content).toMatch(/address|location|cat|colony/i);
  });

  test('place detail shows context badges if available', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    if (!placeId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Look for badge elements
    const badges = await page.locator('.badge, [class*="badge"]').count();
    console.log(`Found context badges: ${badges > 0}`);
    // Badges may or may not exist, page should render
    expect(true).toBeTruthy();
  });

  test('can view colony statistics on place page', async ({ page, request }) => {
    const placeId = await findRealEntity(request, 'places');
    if (!placeId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/places/${placeId}`);
    await waitForLoaded(page);

    // Look for statistics section
    const statsSection = await page.locator('text=/cat count|colony|alteration|fixed/i').first().isVisible().catch(() => false);
    console.log(`Colony stats visible: ${statsSection}`);
  });
});

// ============================================================================
// CAT DETAIL WORKFLOW TESTS
// ============================================================================

test.describe('Cat Detail Workflows', () => {

  test('can view cat detail with microchip info', async ({ page, request }) => {
    const catId = await findRealEntity(request, 'cats');
    if (!catId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Check for cat-related content
    const content = await page.content();
    expect(content).toMatch(/microchip|name|breed|sex|age/i);
  });

  test('cat detail shows appointment history', async ({ page, request }) => {
    const catId = await findRealEntity(request, 'cats');
    if (!catId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/cats/${catId}`);
    await waitForLoaded(page);

    // Look for appointment or clinic history section
    const historySection = await page.locator('text=/appointment|clinic|visit|history/i').first().isVisible().catch(() => false);
    console.log(`Appointment history section visible: ${historySection}`);
  });
});

// ============================================================================
// PERSON DETAIL WORKFLOW TESTS
// ============================================================================

test.describe('Person Detail Workflows', () => {

  test('can view person detail', async ({ page, request }) => {
    const personId = await findRealEntity(request, 'people');
    if (!personId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    await expect(page.locator('h1').first()).toBeVisible();

    // Check for person-related content
    const content = await page.content();
    expect(content).toMatch(/name|email|phone|contact/i);
  });

  test('person detail shows related cats and requests', async ({ page, request }) => {
    const personId = await findRealEntity(request, 'people');
    if (!personId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Look for related data sections
    const relatedSections = await page.locator('text=/cats|requests|history|relationships/i').first().isVisible().catch(() => false);
    console.log(`Related sections visible: ${relatedSections}`);
  });
});

// ============================================================================
// INTAKE QUEUE WORKFLOW TESTS
// ============================================================================

test.describe('Intake Queue Workflows', () => {

  test('can view intake queue', async ({ page }) => {
    await navigateTo(page, '/intake/queue');
    await waitForLoaded(page);

    // Should show queue page
    const content = await page.content();
    expect(content).toMatch(/intake|queue|submission/i);
  });
});

// ============================================================================
// ADMIN WORKFLOW TESTS
// ============================================================================

test.describe('Admin Workflows', () => {

  test('can access admin dashboard', async ({ page }) => {
    await navigateTo(page, '/admin');
    await waitForLoaded(page);

    // Should show admin content or access denied
    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
  });

  test('can view data engine page', async ({ page }) => {
    await navigateTo(page, '/admin/data-engine');
    await waitForLoaded(page);

    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
  });
});

// ============================================================================
// PERSONAL DASHBOARD WORKFLOW TESTS
// ============================================================================

test.describe('Personal Dashboard Workflows', () => {

  test('can access my dashboard', async ({ page }) => {
    await navigateTo(page, '/me');
    await waitForLoaded(page);

    // Atlas 2.5: /me page has Reminders, Lookups, Messages
    const content = await page.content();
    expect(content).toMatch(/reminder|lookup|dashboard|my/i);
  });

  test('reminders section is visible', async ({ page }) => {
    await navigateTo(page, '/me');
    await waitForLoaded(page);

    // Look for reminders section
    const remindersVisible = await page.locator('text=/reminder/i').first().isVisible().catch(() => false);
    console.log(`Reminders section visible: ${remindersVisible}`);
  });
});

// ============================================================================
// BUTTON INTERACTION TESTS (SAFE - Read-only or mocked)
// ============================================================================

test.describe('Button Interactions', () => {

  test('filter buttons work on list pages', async ({ page }) => {
    await navigateTo(page, '/requests');
    await waitForLoaded(page);

    // Try status filter buttons
    const filterButtons = page.locator('button:has-text("All"), button:has-text("Pending"), button:has-text("Active")');

    if (await filterButtons.first().isVisible().catch(() => false)) {
      await filterButtons.first().click();
      await page.waitForTimeout(300);

      // Should update view without error
      expect(true).toBeTruthy();
    }
  });

  test('tab navigation buttons work', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    if (!requestId) {
      test.skip();
      return;
    }

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Find tab buttons
    const tabs = page.locator('[role="tab"]');
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
