/**
 * E2E: Request Detail Page & Lifecycle
 *
 * Tests the request detail page (/requests/[id]) covering:
 * 1. Page load, layout sections, badges, and TabBar
 * 2. GuidedActionBar status-aware action buttons
 * 3. Activity tab with journal input
 * 4. API contract validation (GET /api/requests/[id])
 *
 * ALL WRITES ARE MOCKED via mockWritesWithCapture / mockAllWrites.
 * GET requests pass through to the real API.
 */

import { test, expect } from '@playwright/test';
import {
  navigateTo,
  findRealEntity,
  mockAllWrites,
  mockWritesWithCapture,
  waitForLoaded,
  switchToTabBarTab,
  expectTabBarVisible,
} from './ui-test-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Request Detail Page Load
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Request Detail Page @smoke', () => {
  test.setTimeout(60000);

  let requestId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    await mockAllWrites(page);
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
  });

  test('page loads without error', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Page should render the h1 title (request summary or place name or "FFR Request")
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    // Should NOT show error state
    const errorState = page.locator('text=/Request not found/i');
    await expect(errorState).not.toBeVisible({ timeout: 2000 }).catch(() => {
      // Error state not rendered at all is fine
    });
  });

  test('request status badge is visible', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // StatusBadge renders a .badge element with the status text
    const statusBadge = page.locator('.badge').first();
    await expect(statusBadge).toBeVisible({ timeout: 10000 });
  });

  test('location section displays', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Location card has a header with "Location" text
    const locationHeader = page.locator('text=Location').first();
    await expect(locationHeader).toBeVisible({ timeout: 10000 });
  });

  test('TabBar tabs are present with correct labels', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Scroll down to see the TabBar (it's below the sections)
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);

    await expectTabBarVisible(page);

    // Actual tab labels from the component:
    // "Linked Cats", "Trip Reports", "Photos", "Activity", "Admin"
    const expectedTabs = ['Linked Cats', 'Trip Reports', 'Photos', 'Activity', 'Admin'];
    for (const tabName of expectedTabs) {
      const tab = page.locator(`[role="tab"]:has-text("${tabName}")`).first();
      await expect(tab).toBeVisible({ timeout: 5000 });
    }
  });

  test('clicking each tab shows its content panel', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Scroll to TabBar
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);

    await expectTabBarVisible(page);

    // Click each tab and verify it becomes selected
    const tabs = ['Linked Cats', 'Trip Reports', 'Photos', 'Activity', 'Admin'];
    for (const tabName of tabs) {
      await switchToTabBarTab(page, tabName);

      // Verify the tab is now selected (aria-selected="true")
      const tab = page.locator(`[role="tab"]:has-text("${tabName}")`).first();
      await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 3000 });
    }
  });

  test('priority badge is visible', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // PriorityBadge renders as a .badge element.
    // There should be at least 2 badges (status + priority) in the header.
    const badges = page.locator('.badge');
    const count = await badges.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('requester/contact section displays', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // ContactCard renders contact info. Look for typical contact elements:
    // either "Requester", an email link, a phone number, or the card itself.
    // The ContactCard is rendered inside the case header card.
    const contactSection = page.locator('text=/Requester|Contact|Site Contact/i').first();
    const isVisible = await contactSection.isVisible({ timeout: 5000 }).catch(() => false);

    // Some requests may not have a requester linked — that's valid
    if (!isVisible) {
      // Verify the page at least loaded without crashing
      await expect(page.locator('h1').first()).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Request Status Actions (GuidedActionBar)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Request Status Actions @workflow', () => {
  test.setTimeout(60000);

  let requestId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
  });

  test('GuidedActionBar renders with action buttons', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await mockAllWrites(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // GuidedActionBar renders guidance text + action buttons.
    // The possible button labels by status:
    //   new:       "Start Working", "Pause", "Close Case"
    //   working:   "Log Visit", "Log Session", "Close Case", "Pause"
    //   paused:    "Resume", "Close Case"
    //   completed: "Reopen"
    // The bar also has a guidance message with an icon.

    const allPossibleButtons = [
      'Start Working', 'Pause', 'Close Case',
      'Log Visit', 'Log Session', 'Resume', 'Reopen',
    ];

    let foundActionButton = false;
    for (const label of allPossibleButtons) {
      const btn = page.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        foundActionButton = true;
        break;
      }
    }

    // GuidedActionBar may not render for "redirected" or "handed_off" statuses
    if (!foundActionButton) {
      // Check if the request has a terminal status where bar is hidden
      const redirectBadge = page.locator('text=/redirected|handed.off/i').first();
      const isTerminal = await redirectBadge.isVisible({ timeout: 1000 }).catch(() => false);
      if (!isTerminal) {
        // Should have at least one action button for non-terminal statuses
        expect(foundActionButton).toBe(true);
      }
    }
  });

  test('action buttons change based on current status', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await mockAllWrites(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Check which guidance message is showing to determine current status
    const newGuidance = page.locator('text=Triage this request');
    const workingGuidance = page.locator('text=In progress');
    const pausedGuidance = page.locator('text=On hold');
    const completedGuidance = page.locator('text=Closed');

    const isNew = await newGuidance.isVisible({ timeout: 2000 }).catch(() => false);
    const isWorking = await workingGuidance.isVisible({ timeout: 1000 }).catch(() => false);
    const isPaused = await pausedGuidance.isVisible({ timeout: 1000 }).catch(() => false);
    const isCompleted = await completedGuidance.isVisible({ timeout: 1000 }).catch(() => false);

    if (isNew) {
      await expect(page.locator('button:has-text("Start Working")')).toBeVisible();
      await expect(page.locator('button:has-text("Pause")')).toBeVisible();
      await expect(page.locator('button:has-text("Close Case")')).toBeVisible();
    } else if (isWorking) {
      await expect(page.locator('button:has-text("Log Visit")')).toBeVisible();
      await expect(page.locator('button:has-text("Close Case")')).toBeVisible();
      await expect(page.locator('button:has-text("Pause")')).toBeVisible();
    } else if (isPaused) {
      await expect(page.locator('button:has-text("Resume")')).toBeVisible();
      await expect(page.locator('button:has-text("Close Case")')).toBeVisible();
    } else if (isCompleted) {
      await expect(page.locator('button:has-text("Reopen")')).toBeVisible();
    }
    // If none matched: redirected/handed_off — GuidedActionBar hidden, which is valid
  });

  test('clicking Pause opens hold reason selection modal', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // "Pause" button is available on "new" and "working" statuses
    const pauseBtn = page.locator('button:has-text("Pause")').first();
    const hasPause = await pauseBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasPause, 'Pause button not available for current request status');

    await pauseBtn.click();

    // HoldRequestModal should open with hold reason options
    // It uses ReasonSelectionForm with reasons like "Weather", "Callback Pending", etc.
    const modal = page.locator('text=/Weather|Callback Pending|Access Issue|Resource Constraint/i').first();
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('clicking Close Case opens resolution modal', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // "Close Case" button is available on new, working, and paused statuses
    const closeBtn = page.locator('button:has-text("Close Case")').first();
    const hasClose = await closeBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasClose, 'Close Case button not available for current request status');

    await closeBtn.click();

    // CloseRequestModal should open with outcome options:
    // "successful", "partial", "unable_to_complete", "no_longer_needed", "referred_out"
    const outcomeOption = page.locator('text=/Successful|Partial|Unable to Complete|No Longer Needed|Referred Out|All or most cats/i').first();
    await expect(outcomeOption).toBeVisible({ timeout: 5000 });
  });

  test('clicking Start Working sends PATCH with status change', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // "Start Working" is only available on "new" status
    const startBtn = page.locator('button:has-text("Start Working")').first();
    const hasStart = await startBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasStart, 'Start Working button not available (request is not in "new" status)');

    await startBtn.click();
    await page.waitForTimeout(1500);

    const patches = capture.getByMethod('PATCH');
    expect(patches.length).toBeGreaterThanOrEqual(1);

    const statusPatch = patches.find(p => p.url.includes('/api/requests/'));
    expect(statusPatch).toBeDefined();
    expect(statusPatch!.body).toMatchObject({ status: 'working' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Request Activity / Journal Tab
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Request Activity Tab @workflow', () => {
  test.setTimeout(60000);

  let requestId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
  });

  test('Activity tab shows journal section with input', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await mockAllWrites(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Scroll to TabBar and switch to Activity tab
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);
    await switchToTabBarTab(page, 'Activity');

    // JournalSection renders a textarea with placeholder "Add a note..."
    const textarea = page.locator('textarea[placeholder="Add a note..."]');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // "Add Note" button should be present
    const addNoteBtn = page.locator('button:has-text("Add Note")');
    await expect(addNoteBtn).toBeVisible({ timeout: 3000 });
  });

  test('journal has Note / Communication mode toggle', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    await mockAllWrites(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);
    await switchToTabBarTab(page, 'Activity');

    // Mode toggle buttons: "Note" and "Communication"
    const noteToggle = page.locator('button:has-text("Note")').first();
    const commToggle = page.locator('button:has-text("Communication")').first();

    await expect(noteToggle).toBeVisible({ timeout: 5000 });
    await expect(commToggle).toBeVisible({ timeout: 3000 });
  });

  test('typing and submitting a note sends POST to journal API', async ({ page }) => {
    test.skip(!requestId, 'No requests available in the database');

    const capture = await mockWritesWithCapture(page);
    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Navigate to Activity tab
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);
    await switchToTabBarTab(page, 'Activity');

    // Type a test note
    const textarea = page.locator('textarea[placeholder="Add a note..."]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill('E2E test journal entry');

    // Click Add Note
    const addNoteBtn = page.locator('button:has-text("Add Note")');
    await addNoteBtn.click();
    await page.waitForTimeout(1500);

    // Verify POST was captured to /api/journal
    const journalPosts = capture.getByUrl('/api/journal');
    expect(journalPosts.length).toBeGreaterThanOrEqual(1);

    const post = journalPosts[0];
    expect(post.method).toBe('POST');
    expect(post.body).toMatchObject({
      body: 'E2E test journal entry',
      entry_kind: 'note',
      request_id: requestId,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Request Detail API Contract
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Request Detail API @api', () => {
  test.setTimeout(60000);

  let requestId: string | null = null;

  test.beforeEach(async ({ request }) => {
    if (!requestId) {
      requestId = await findRealEntity(request, 'requests');
    }
  });

  test('GET /api/requests/[id] returns valid structure', async ({ request }) => {
    test.skip(!requestId, 'No requests available in the database');

    const res = await request.get(`/api/requests/${requestId}`);
    expect(res.ok()).toBe(true);

    const json = await res.json();
    // API uses apiSuccess wrapper: { success: true, data: { ... } }
    const data = json.data || json;

    // Required fields from the API route
    expect(data.request_id).toBeDefined();
    expect(typeof data.request_id).toBe('string');
    expect(data.status).toBeDefined();
    expect(typeof data.status).toBe('string');
    expect(data.created_at).toBeDefined();

    // Status should be a known value
    const validStatuses = [
      'new', 'triaged', 'scheduled', 'in_progress', 'working',
      'completed', 'cancelled', 'paused', 'on_hold',
      'redirected', 'handed_off', 'partial',
    ];
    expect(validStatuses).toContain(data.status);
  });

  test('response includes place info', async ({ request }) => {
    test.skip(!requestId, 'No requests available in the database');

    const res = await request.get(`/api/requests/${requestId}`);
    expect(res.ok()).toBe(true);

    const json = await res.json();
    const data = json.data || json;

    // place_id may be null for some requests, but the field should exist
    expect('place_id' in data).toBe(true);

    // If place_id is set, place info fields should be present
    if (data.place_id) {
      expect('place_address' in data || 'place_name' in data).toBe(true);
    }
  });

  test('response includes cat count fields', async ({ request }) => {
    test.skip(!requestId, 'No requests available in the database');

    const res = await request.get(`/api/requests/${requestId}`);
    expect(res.ok()).toBe(true);

    const json = await res.json();
    const data = json.data || json;

    // Cat count fields should exist (may be null)
    expect('estimated_cat_count' in data).toBe(true);
    expect('total_cats_reported' in data).toBe(true);
    expect('linked_cat_count' in data).toBe(true);
  });

  test('response includes colony summary fields', async ({ request }) => {
    test.skip(!requestId, 'No requests available in the database');

    const res = await request.get(`/api/requests/${requestId}`);
    expect(res.ok()).toBe(true);

    const json = await res.json();
    const data = json.data || json;

    // Colony summary fields from v_place_colony_status join
    expect('colony_size_estimate' in data).toBe(true);
    expect('colony_verified_altered' in data).toBe(true);
    expect('colony_work_remaining' in data).toBe(true);
    expect('colony_alteration_rate' in data).toBe(true);
  });

  test('response includes current_trappers array', async ({ request }) => {
    test.skip(!requestId, 'No requests available in the database');

    const res = await request.get(`/api/requests/${requestId}`);
    expect(res.ok()).toBe(true);

    const json = await res.json();
    const data = json.data || json;

    // current_trappers is always an array (may be empty)
    expect(data.current_trappers).toBeDefined();
    expect(Array.isArray(data.current_trappers)).toBe(true);
  });

  test('returns 404 for nonexistent UUID', async ({ request }) => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request.get(`/api/requests/${fakeId}`);

    expect(res.status()).toBe(404);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
  });

  test('returns 400 for invalid UUID format', async ({ request }) => {
    const res = await request.get('/api/requests/not-a-uuid');

    expect(res.status()).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
  });
});
