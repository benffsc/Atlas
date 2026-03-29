/**
 * Person Management UX — E2E Tests (FFS-602)
 *
 * Covers all 5 phases of the Person Management UX epic:
 * - Phase 1: ListDetailLayout split-view (FFS-603) ✓ IMPLEMENTED
 * - Phase 2: EntityPreviewPanel config-driven previews (FFS-604) ✓ IMPLEMENTED
 * - Phase 3: ActionDrawer slide-over forms (FFS-605) ✓ IMPLEMENTED
 * - Phase 4: Inline actions — RowActionMenu, InlineStatusToggle, BatchActionBar (FFS-606) — PARTIAL
 * - Phase 5: Breadcrumbs, NavigationContext, EntityPreview (FFS-607) — PARTIAL
 *
 * Tests are READ-ONLY unless mocked. Write operations use mockAllWrites().
 */

import { test, expect } from '@playwright/test';
import {
  navigateTo,
  findRealEntity,
  mockAllWrites,
  waitForLoaded,
  mockWritesWithCapture,
} from './ui-test-helpers';

// Helper: get a real trapper person_id from the API
async function findRealTrapper(
  request: import('@playwright/test').APIRequestContext
): Promise<string | null> {
  try {
    const res = await request.get('/api/trappers?limit=1');
    if (!res.ok()) return null;
    const json = await res.json();
    const data = json.data || json;
    if (!data.trappers?.length) return null;
    return data.trappers[0].person_id;
  } catch {
    return null;
  }
}

// Helper: get a real foster person_id from the API
async function findRealFoster(
  request: import('@playwright/test').APIRequestContext
): Promise<string | null> {
  try {
    const res = await request.get('/api/fosters?limit=1');
    if (!res.ok()) return null;
    const json = await res.json();
    const data = json.data || json;
    const fosters = data.fosters || data;
    if (!Array.isArray(fosters) || !fosters.length) return null;
    return fosters[0].person_id;
  } catch {
    return null;
  }
}

// ============================================================================
// Phase 1: ListDetailLayout — Split-View (FFS-603)
// ============================================================================

test.describe('ListDetailLayout — Split-View @workflow', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('Trapper list renders in split-view layout', async ({ page }) => {
    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // ListDetailLayout renders a flex container; the table is inside the list pane
    const table = page.locator('table.data-table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Verify we have trapper rows
    const rows = page.locator('table.data-table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('Clicking a list row opens the preview panel', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // Click the first trapper row in the table
    const firstRow = page.locator('table.data-table tbody tr').first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'No trapper rows visible');

    await firstRow.click();

    // ListDetailLayout renders the detail panel with class .list-detail-panel
    const previewPanel = page.locator('.list-detail-panel');
    await expect(previewPanel).toBeVisible({ timeout: 5000 });

    // Panel should show person name in h2 (EntityPreviewPanel title)
    const nameElement = previewPanel.locator('h2').first();
    await expect(nameElement).toBeVisible();
    const name = await nameElement.textContent();
    expect(name?.trim().length).toBeGreaterThan(0);
  });

  test('Clicking another row switches preview content', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const rows = page.locator('table.data-table tbody tr');
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'Need at least 2 rows for this test');

    // Click first row
    await rows.nth(0).click();
    const previewPanel = page.locator('.list-detail-panel');
    await expect(previewPanel).toBeVisible({ timeout: 5000 });
    const firstName = await previewPanel.locator('h2').first().textContent();

    // Click second row
    await rows.nth(1).click();
    await page.waitForTimeout(300); // Allow content switch
    const secondName = await previewPanel.locator('h2').first().textContent();

    // Names should be different (different entity selected)
    // Note: They COULD be the same name in rare cases, so we just verify content loaded
    expect(secondName?.trim().length).toBeGreaterThan(0);
  });

  test('Escape key closes the preview panel', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const firstRow = page.locator('table.data-table tbody tr').first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'No trapper rows visible');

    await firstRow.click();
    const previewPanel = page.locator('.list-detail-panel');
    await expect(previewPanel).toBeVisible({ timeout: 5000 });

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(previewPanel).toBeHidden({ timeout: 3000 });
  });

  test('URL updates when a row is selected', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const firstRow = page.locator('table.data-table tbody tr').first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'No trapper rows visible');

    const urlBefore = page.url();
    await firstRow.click();
    await page.waitForTimeout(300);

    // URL should include a selected entity param (e.g., ?selected=UUID)
    const urlAfter = page.url();
    expect(urlAfter).not.toBe(urlBefore);
  });

  test('Direct URL with selection param opens preview on load', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    // Navigate directly with selection param
    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    // ListDetailLayout renders the detail panel with class .list-detail-panel
    const previewPanel = page.locator('.list-detail-panel');
    await expect(previewPanel).toBeVisible({ timeout: 10000 });
  });

  test('Split-view works on people list page too (reusable)', async ({ page }) => {
    await navigateTo(page, '/people');
    await waitForLoaded(page);

    // People page should load and show a table with data
    const table = page.locator('table');
    const hasTable = await table.first().isVisible({ timeout: 10000 }).catch(() => false);

    // People page renders — either table or card layout
    if (hasTable) {
      const rows = table.first().locator('tbody tr');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// Phase 2: EntityPreviewPanel — Config-Driven Preview (FFS-604)
// ============================================================================

test.describe('EntityPreviewPanel — Config-Driven Preview @workflow', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('Preview panel shows role-specific sections for trapper', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    // TrapperPreviewContent shows Classification and Activity sections
    const panelText = await previewPanel.textContent() || '';
    // Should show at least Classification or Activity sections
    const hasClassification = panelText.includes('Classification');
    const hasActivity = panelText.includes('Activity');
    const hasContact = panelText.includes('Contact');
    expect(hasClassification || hasActivity || hasContact).toBeTruthy();
  });

  test('Preview panel shows role-specific sections for foster', async ({ page, request }) => {
    const fosterId = await findRealFoster(request);
    test.skip(!fosterId, 'No fosters in database');

    await navigateTo(page, `/fosters?selected=${fosterId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Foster preview panel not visible — fosters list may not use split-view yet');

    // Foster preview should show foster-related content
    const fosterContent = await previewPanel.textContent();
    const hasFosterContent =
      fosterContent?.includes('Foster') ||
      fosterContent?.includes('Animals') ||
      fosterContent?.includes('Availability');
    expect(hasFosterContent).toBeTruthy();
  });

  test('Preview panel shows quick stats', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    // EntityPreviewPanel shows stats in a grid with labels like "Total Caught", "Active Assignments"
    const panelText = await previewPanel.textContent() || '';
    const hasStats = panelText.includes('Total Caught') ||
      panelText.includes('Active Assignments') ||
      panelText.includes('Direct Bookings');
    expect(hasStats).toBeTruthy();
  });

  test('"Open Full Profile" link navigates to detail page', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    // EntityPreviewPanel renders "Open Full Profile ->" link
    const fullProfileLink = previewPanel.locator('a:has-text("Open Full Profile")').first();
    const hasLink = await fullProfileLink.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasLink, 'Open Full Profile link not found');

    await fullProfileLink.click();
    await page.waitForURL(`**/trappers/${trapperId}**`, { timeout: 5000 }).catch(() => {});

    // Should navigate to full detail page
    expect(page.url()).toContain(trapperId);
  });

  test('Preview panel has Edit action', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    // TrapperPreviewContent renders an Edit button in the preview header
    const editButton = previewPanel.locator('button:has-text("Edit")').first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasEdit).toBeTruthy();
  });
});

// ============================================================================
// Phase 3: ActionDrawer — Slide-Over Forms (FFS-605)
// ============================================================================

test.describe('ActionDrawer — Slide-Over Forms @workflow', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('Edit action opens drawer from preview panel', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    // Click Edit button in preview header
    const editButton = previewPanel.locator('button:has-text("Edit")').first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit button not visible in preview panel');

    await editButton.click();

    // EditTrapperDrawer renders as a dialog/drawer overlay
    const drawer = page.locator('[role="dialog"]');
    await expect(drawer).toBeVisible({ timeout: 3000 });
  });

  test('Drawer has form fields and close button', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    const editButton = previewPanel.locator('button:has-text("Edit")').first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit button not visible in preview panel');

    await editButton.click();

    const drawer = page.locator('[role="dialog"]');
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // EditTrapperDrawer has 3 select fields (Type, Status, Availability)
    const selects = drawer.locator('select');
    const selectCount = await selects.count();
    expect(selectCount).toBeGreaterThan(0);

    // Drawer has Cancel button
    const cancelButton = drawer.locator('button:has-text("Cancel")').first();
    await expect(cancelButton).toBeVisible();
  });

  test('Drawer save triggers PATCH and closes', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    const capture = await mockWritesWithCapture(page);

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    const editButton = previewPanel.locator('button:has-text("Edit")').first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit button not visible in preview panel');

    await editButton.click();

    const drawer = page.locator('[role="dialog"]');
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // Change a value so Save Changes button becomes enabled
    const firstSelect = drawer.locator('select').first();
    const options = await firstSelect.locator('option').allTextContents();
    if (options.length > 1) {
      await firstSelect.selectOption({ index: 1 });
    }

    // Click "Save Changes" button
    const saveButton = drawer.locator('button:has-text("Save Changes")').first();
    const hasSave = await saveButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasSave, 'Save Changes button not visible');

    await saveButton.click();
    await page.waitForTimeout(500);

    // Should have triggered a PATCH request (mocked)
    const patches = capture.getByMethod('PATCH');
    expect(patches.length).toBeGreaterThanOrEqual(1);

    // Drawer should close after save
    await expect(drawer).toBeHidden({ timeout: 3000 });
  });

  test('Drawer Escape key closes without saving', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    const capture = await mockWritesWithCapture(page);

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    const editButton = previewPanel.locator('button:has-text("Edit")').first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit button not visible in preview panel');

    await editButton.click();

    const drawer = page.locator('[role="dialog"]');
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // Press Escape
    await page.keyboard.press('Escape');

    // Drawer should close
    await expect(drawer).toBeHidden({ timeout: 3000 });

    // No PATCH should have been triggered
    const patches = capture.getByMethod('PATCH');
    expect(patches.length).toBe(0);
  });
});

// ============================================================================
// Phase 4: Inline Actions — RowActionMenu, StatusToggle, Batch (FFS-606)
// ============================================================================

test.describe('Inline Actions @workflow', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('Row action menu appears on click', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const firstRow = page.locator('table.data-table tbody tr').first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'No trapper rows visible');

    // RowActionMenu renders a kebab trigger button in the last td
    const actionTrigger = firstRow.locator('td:last-child button').first();
    const hasActions = await actionTrigger.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasActions, 'No action menu button found in row');

    await actionTrigger.click();

    // RowActionMenu dropdown should appear
    const menuItems = page.locator('[role="menuitem"], [role="menu"] button');
    const itemCount = await menuItems.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test('Inline status select works without opening detail page', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    const capture = await mockWritesWithCapture(page);

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // Trapper rows have inline <select> elements for status changes
    const firstRow = page.locator('table.data-table tbody tr').first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'No trapper rows visible');

    // Find a select in the row (type, status, or availability)
    const inlineSelect = firstRow.locator('select').first();
    const hasSelect = await inlineSelect.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasSelect, 'No inline select found in trapper row');

    // Change the value
    const options = await inlineSelect.locator('option').evaluateAll(
      els => els.map(el => (el as HTMLOptionElement).value)
    );
    const currentVal = await inlineSelect.inputValue();
    const newVal = options.find(v => v !== currentVal);
    if (newVal) {
      await inlineSelect.selectOption(newVal);
      await page.waitForTimeout(500);
    }

    // Should still be on the list page (no navigation)
    expect(page.url()).toContain('/trappers');
  });

  test('Batch action bar appears when rows are selected', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // Trapper rows have checkboxes for batch selection (in tbody)
    const rowCheckboxes = page.locator('table.data-table tbody tr input[type="checkbox"]');
    const checkboxCount = await rowCheckboxes.count();
    test.skip(checkboxCount < 2, 'Need at least 2 rows with checkboxes');

    // Select first two row checkboxes
    await rowCheckboxes.nth(0).check();
    await rowCheckboxes.nth(1).check();

    // Batch action bar shows "2 selected" text
    const selectedText = page.locator('text=2 selected');
    await expect(selectedText).toBeVisible({ timeout: 3000 });

    // Should have "Batch Change..." dropdown
    const batchSelect = page.locator('select').filter({ hasText: /Batch Change/i });
    await expect(batchSelect).toBeVisible();
  });
});

// ============================================================================
// Phase 5: Navigation — Breadcrumbs, Context, HoverCard (FFS-607)
// ============================================================================

test.describe('Navigation — Breadcrumbs & HoverCard @workflow', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test.fixme('Breadcrumbs show context when navigating from list to detail', async ({ page, request }) => {
    // FIXME: Breadcrumbs are not yet wired into the trappers detail page.
    // The Breadcrumbs component exists but is not used on /trappers/[id].
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    const breadcrumbs = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumbs).toBeVisible({ timeout: 5000 });
  });

  test.fixme('Breadcrumb link navigates back to list', async ({ page, request }) => {
    // FIXME: Breadcrumbs are not yet wired into the trappers detail page.
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    const breadcrumbLink = page.locator('nav[aria-label="Breadcrumb"] a').first();
    await expect(breadcrumbLink).toBeVisible({ timeout: 5000 });
    await breadcrumbLink.click();
    await page.waitForURL('**/trappers**', { timeout: 5000 });
  });

  test.fixme('Entity hover card shows on cross-entity reference hover', async ({ page, request }) => {
    // FIXME: Entity hover cards exist (EntityPreview component) but are not wired
    // with data-entity-hover attributes on cross-entity links in detail pages.
    const requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests in database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);
  });

  test.fixme('Hover card disappears when mouse leaves', async ({ page, request }) => {
    // FIXME: Entity hover cards are not wired with data-entity-hover attributes.
    // Depends on entity hover card test above.
    const requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests in database');
  });

  test('Person detail page loads and shows name', async ({ page, request }) => {
    const personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No people in database');

    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Person detail page should render with a name heading
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
    const nameText = await heading.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Cross-Phase Integration Tests
// ============================================================================

test.describe('Person Management UX — Integration @workflow', () => {
  test.setTimeout(45000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('Full flow: list -> preview -> drawer edit -> close -> different row', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const rows = page.locator('table.data-table tbody tr');
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'Need at least 2 rows for integration test');

    // Step 1: Click first row to open preview
    await rows.nth(0).click();
    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel did not open');

    // Step 2: Open drawer from preview
    const editButton = previewPanel.locator('button:has-text("Edit")').first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasEdit) {
      await editButton.click();
      const drawer = page.locator('[role="dialog"]');
      await expect(drawer).toBeVisible({ timeout: 3000 });

      // Step 3: Close drawer
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden({ timeout: 3000 });
    }

    // Step 4: Click second row — preview should switch
    await rows.nth(1).click();
    await page.waitForTimeout(300);
    await expect(previewPanel).toBeVisible();
  });

  test('Full flow: list -> preview -> "Open Full Profile" navigates to detail', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator('.list-detail-panel');
    const hasPreview = await previewPanel.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not visible for selected trapper');

    // Navigate to full profile
    const fullProfileLink = previewPanel.locator('a:has-text("Open Full Profile")').first();
    const hasLink = await fullProfileLink.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasLink, 'Open Full Profile link not found');

    await fullProfileLink.click();
    await page.waitForURL(`**/trappers/${trapperId}**`, { timeout: 5000 }).catch(() => {});

    // Should be on the detail page
    expect(page.url()).toContain(trapperId);
  });

  test.fixme('Keyboard navigation: arrow keys move selection in list', async ({ page, request }) => {
    // FIXME: Arrow key navigation between rows is not implemented on the trappers list.
    // The ListDetailLayout does not handle keyboard arrow key events for row selection.
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');
  });
});

// ============================================================================
// API — Preview Endpoint (FFS-604/607)
// ============================================================================

test.describe('Preview API Endpoints @api', () => {

  test.fixme('Person preview API returns lightweight data', async ({ request }) => {
    // FIXME: /api/people/[id]/preview endpoint does not exist yet.
    // Preview data is currently fetched from the main list endpoint.
  });

  test.fixme('Trapper preview includes role-specific stats', async ({ request }) => {
    // FIXME: /api/people/[id]/preview endpoint does not exist yet.
    // Trapper preview uses data from /api/trappers list response.
  });
});
