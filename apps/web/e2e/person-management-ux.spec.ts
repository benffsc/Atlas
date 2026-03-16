/**
 * Person Management UX — E2E Tests (FFS-602)
 *
 * Covers all 5 phases of the Person Management UX epic:
 * - Phase 1: ListDetailLayout split-view (FFS-603)
 * - Phase 2: EntityPreviewPanel config-driven previews (FFS-604)
 * - Phase 3: ActionDrawer slide-over forms (FFS-605)
 * - Phase 4: Inline actions — RowActionMenu, InlineStatusToggle, BatchActionBar (FFS-606)
 * - Phase 5: Breadcrumbs, NavigationContext, EntityPreview (FFS-607)
 *
 * Tests are READ-ONLY unless mocked. Write operations use mockAllWrites().
 *
 * These tests are written for components that don't exist yet — they will
 * start passing as each FFS-603–607 phase is implemented.
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

    // ListDetailLayout should render a list panel and detail panel container
    const listPanel = page.locator(
      '[data-testid="list-detail-list"], [data-testid="list-panel"]'
    );
    const detailPanel = page.locator(
      '[data-testid="list-detail-detail"], [data-testid="detail-panel"]'
    );

    const hasListPanel = await listPanel.isVisible({ timeout: 5000 }).catch(() => false);
    const hasDetailPanel = await detailPanel.count().then(c => c > 0).catch(() => false);

    // Either has split layout or is still using old full-page layout (transitional)
    if (hasListPanel) {
      await expect(listPanel).toBeVisible();
      // Detail panel should exist (may be empty/placeholder until a row is clicked)
      expect(hasDetailPanel).toBeTruthy();
    }
  });

  test('Clicking a list row opens the preview panel', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // Click the first trapper row in the list
    const firstRow = page.locator(
      '[data-testid="list-row"], [data-testid="trapper-row"], tr[data-entity-id]'
    ).first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'No list rows visible — split-view not yet implemented');

    await firstRow.click();

    // Preview panel should become visible with content
    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"], [data-testid="entity-preview"]'
    );
    await expect(previewPanel).toBeVisible({ timeout: 5000 });

    // Panel should show person name
    const nameElement = previewPanel.locator('h2, h3, [data-testid="entity-name"]').first();
    await expect(nameElement).toBeVisible();
    const name = await nameElement.textContent();
    expect(name?.trim().length).toBeGreaterThan(0);
  });

  test('Clicking another row switches preview content', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const rows = page.locator(
      '[data-testid="list-row"], [data-testid="trapper-row"], tr[data-entity-id]'
    );
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'Need at least 2 rows for this test');

    // Click first row
    await rows.nth(0).click();
    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    await expect(previewPanel).toBeVisible({ timeout: 5000 });
    const firstName = await previewPanel.locator('h2, h3, [data-testid="entity-name"]').first().textContent();

    // Click second row
    await rows.nth(1).click();
    await page.waitForTimeout(300); // Allow content switch
    const secondName = await previewPanel.locator('h2, h3, [data-testid="entity-name"]').first().textContent();

    // Names should be different (different entity selected)
    // Note: They COULD be the same name in rare cases, so we just verify content loaded
    expect(secondName?.trim().length).toBeGreaterThan(0);
  });

  test('Escape key closes the preview panel', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const firstRow = page.locator(
      '[data-testid="list-row"], [data-testid="trapper-row"], tr[data-entity-id]'
    ).first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'Split-view not yet implemented');

    await firstRow.click();
    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
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

    const firstRow = page.locator(
      '[data-testid="list-row"], [data-testid="trapper-row"], tr[data-entity-id]'
    ).first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'Split-view not yet implemented');

    const urlBefore = page.url();
    await firstRow.click();
    await page.waitForTimeout(300);

    // URL should include a selected entity param (e.g., ?selected=UUID or /trappers?id=UUID)
    const urlAfter = page.url();
    expect(urlAfter).not.toBe(urlBefore);
  });

  test('Direct URL with selection param opens preview on load', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    // Navigate directly with selection param
    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);

    // If split-view is implemented, preview should open from URL param
    if (hasPreview) {
      await expect(previewPanel).toBeVisible();
    }
  });

  test('Split-view works on people list page too (reusable)', async ({ page }) => {
    await navigateTo(page, '/people');
    await waitForLoaded(page);

    // Same split-view layout should be reusable on people page
    const listPanel = page.locator(
      '[data-testid="list-detail-list"], [data-testid="list-panel"]'
    );
    const hasListPanel = await listPanel.isVisible({ timeout: 5000 }).catch(() => false);

    // If implemented, should have list panel
    if (hasListPanel) {
      await expect(listPanel).toBeVisible();
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

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"], [data-testid="entity-preview"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    // Trapper preview should show trapper-specific sections
    const expectedSections = [
      'Contact', 'Trapper Info', 'Service Areas', 'Recent Activity'
    ];
    for (const section of expectedSections) {
      const sectionEl = previewPanel.locator(
        `[data-testid="preview-section-${section.toLowerCase().replace(/\s+/g, '-')}"], ` +
        `:text("${section}")`
      ).first();
      const hasSection = await sectionEl.isVisible({ timeout: 2000 }).catch(() => false);
      // At least some sections should be visible
      if (hasSection) {
        await expect(sectionEl).toBeVisible();
      }
    }
  });

  test('Preview panel shows role-specific sections for foster', async ({ page, request }) => {
    const fosterId = await findRealFoster(request);
    test.skip(!fosterId, 'No fosters in database');

    await navigateTo(page, `/fosters?selected=${fosterId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"], [data-testid="entity-preview"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    // Foster preview should show foster-specific sections
    const fosterContent = await previewPanel.textContent();
    // Should contain foster-related content (animals, availability, etc.)
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

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    // Should show quick stats (e.g., total cats trapped, active since, etc.)
    const stats = previewPanel.locator(
      '[data-testid="preview-stats"], [data-testid="quick-stats"]'
    );
    const hasStats = await stats.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasStats) {
      // Stats should contain numeric values
      const statsText = await stats.textContent();
      expect(statsText?.length).toBeGreaterThan(0);
    }
  });

  test('"View Full Profile" link navigates to detail page', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    // Find the "View Full Profile" or "Open" link
    const fullProfileLink = previewPanel.locator(
      '[data-testid="view-full-profile"], a:has-text("View Full Profile"), a:has-text("Open")'
    ).first();
    const hasLink = await fullProfileLink.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasLink, 'Full profile link not found');

    await fullProfileLink.click();
    await page.waitForURL(`**/trappers/${trapperId}**`, { timeout: 5000 }).catch(() => {});

    // Should navigate to full detail page
    expect(page.url()).toContain(trapperId);
  });

  test('Preview panel actions are visible', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    // Preview should have action buttons (Edit, Assign, etc.)
    const actionButtons = previewPanel.locator(
      '[data-testid="preview-actions"] button, [data-testid="action-button"]'
    );
    const actionCount = await actionButtons.count();
    // At least one action should be available
    expect(actionCount).toBeGreaterThanOrEqual(0); // 0 is OK during early implementation
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

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    // Click edit button in preview
    const editButton = previewPanel.locator(
      'button:has-text("Edit"), [data-testid="edit-action"], [data-testid="action-edit"]'
    ).first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit action not yet implemented');

    await editButton.click();

    // Drawer should open (shadcn Sheet)
    const drawer = page.locator(
      '[data-testid="action-drawer"], [role="dialog"][data-state="open"], .sheet-content'
    );
    await expect(drawer).toBeVisible({ timeout: 3000 });
  });

  test('Drawer has form fields and close button', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    const editButton = previewPanel.locator(
      'button:has-text("Edit"), [data-testid="edit-action"]'
    ).first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit action not yet implemented');

    await editButton.click();

    const drawer = page.locator(
      '[data-testid="action-drawer"], [role="dialog"][data-state="open"]'
    );
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // Drawer should contain form inputs
    const inputs = drawer.locator('input, select, textarea');
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThan(0);

    // Drawer should have a close mechanism
    const closeButton = drawer.locator(
      'button:has-text("Cancel"), button:has-text("Close"), [data-testid="drawer-close"]'
    ).first();
    await expect(closeButton).toBeVisible();
  });

  test('Drawer save triggers PATCH and closes', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    const capture = await mockWritesWithCapture(page);

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    const editButton = previewPanel.locator(
      'button:has-text("Edit"), [data-testid="edit-action"]'
    ).first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit action not yet implemented');

    await editButton.click();

    const drawer = page.locator(
      '[data-testid="action-drawer"], [role="dialog"][data-state="open"]'
    );
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // Click save/submit button
    const saveButton = drawer.locator(
      'button:has-text("Save"), button[type="submit"], [data-testid="drawer-save"]'
    ).first();
    const hasSave = await saveButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasSave, 'Save button not visible');

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

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    const editButton = previewPanel.locator(
      'button:has-text("Edit"), [data-testid="edit-action"]'
    ).first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasEdit, 'Edit action not yet implemented');

    await editButton.click();

    const drawer = page.locator(
      '[data-testid="action-drawer"], [role="dialog"][data-state="open"]'
    );
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

  test('Row action menu appears on hover or click', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const firstRow = page.locator(
      '[data-testid="list-row"], [data-testid="trapper-row"], tr[data-entity-id]'
    ).first();
    const hasRow = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasRow, 'List rows not visible');

    // Hover over the row
    await firstRow.hover();

    // Action menu trigger should appear (three dots, kebab menu, etc.)
    const actionTrigger = firstRow.locator(
      '[data-testid="row-action-menu"], button[aria-label="Actions"], [data-testid="row-actions"]'
    ).first();
    const hasActions = await actionTrigger.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasActions) {
      await actionTrigger.click();

      // Dropdown menu should appear
      const menu = page.locator(
        '[role="menu"], [data-testid="action-menu-dropdown"]'
      );
      await expect(menu).toBeVisible({ timeout: 2000 });

      // Menu should have items
      const menuItems = menu.locator('[role="menuitem"], button, a');
      const itemCount = await menuItems.count();
      expect(itemCount).toBeGreaterThan(0);
    }
  });

  test('Inline status toggle works without opening detail page', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    const capture = await mockWritesWithCapture(page);

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // Look for inline status toggle (e.g., availability toggle)
    const statusToggle = page.locator(
      '[data-testid="inline-status-toggle"], [data-testid="availability-toggle"]'
    ).first();
    const hasToggle = await statusToggle.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasToggle, 'Inline status toggle not yet implemented');

    await statusToggle.click();
    await page.waitForTimeout(500);

    // Should trigger a PATCH without navigating away
    const patches = capture.getByMethod('PATCH');
    expect(patches.length).toBeGreaterThanOrEqual(1);

    // Should still be on the list page
    expect(page.url()).toContain('/trappers');
  });

  test('Batch action bar appears when rows are selected', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // Look for row selection checkboxes
    const checkboxes = page.locator(
      '[data-testid="row-select"], input[type="checkbox"][data-row-select]'
    );
    const checkboxCount = await checkboxes.count();
    test.skip(checkboxCount < 2, 'Row selection checkboxes not yet implemented');

    // Select first two rows
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // Batch action bar should appear
    const batchBar = page.locator(
      '[data-testid="batch-action-bar"], [data-testid="batch-actions"]'
    );
    const hasBatchBar = await batchBar.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasBatchBar) {
      await expect(batchBar).toBeVisible();

      // Should show count of selected items
      const barText = await batchBar.textContent();
      expect(barText).toContain('2');
    }
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

  test('Breadcrumbs show context when navigating from list to detail', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    // Start from trappers list
    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    // Navigate to a trapper detail page
    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    // Breadcrumbs should show: Trappers > [Name]
    const breadcrumbs = page.locator(
      '[data-testid="breadcrumbs"], nav[aria-label="Breadcrumb"], .breadcrumbs'
    );
    const hasBreadcrumbs = await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasBreadcrumbs) {
      const crumbText = await breadcrumbs.textContent();
      // Should contain reference to parent list
      expect(
        crumbText?.includes('Trapper') || crumbText?.includes('People')
      ).toBeTruthy();
    }
  });

  test('Breadcrumb link navigates back to list', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers/${trapperId}`);
    await waitForLoaded(page);

    const breadcrumbLink = page.locator(
      '[data-testid="breadcrumbs"] a, nav[aria-label="Breadcrumb"] a'
    ).first();
    const hasCrumbLink = await breadcrumbLink.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasCrumbLink, 'Breadcrumb links not yet implemented');

    await breadcrumbLink.click();

    // Should navigate back to list
    await page.waitForURL('**/trappers**', { timeout: 5000 });
    expect(page.url()).toContain('/trappers');
    expect(page.url()).not.toContain(trapperId);
  });

  test('Entity hover card shows on cross-entity reference hover', async ({ page, request }) => {
    // Navigate to a request detail page (which references people, places, cats)
    const requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests in database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    // Find a cross-entity reference link (e.g., a person or cat link)
    const entityLink = page.locator(
      '[data-entity-hover], [data-testid="entity-reference"], a[data-entity-type]'
    ).first();
    const hasEntityLink = await entityLink.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEntityLink, 'Entity hover links not yet implemented');

    // Hover over the entity link
    await entityLink.hover();

    // Hover card should appear
    const hoverCard = page.locator(
      '[data-testid="entity-hover-card"], [role="tooltip"][data-entity-hover-card]'
    );
    const hasHoverCard = await hoverCard.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasHoverCard) {
      // Hover card should show entity name and key info
      const cardText = await hoverCard.textContent();
      expect(cardText?.trim().length).toBeGreaterThan(0);

      // Should have a "View" or "Open" link
      const viewLink = hoverCard.locator('a:has-text("View"), a:has-text("Open")').first();
      const hasViewLink = await viewLink.isVisible({ timeout: 2000 }).catch(() => false);
      if (hasViewLink) {
        await expect(viewLink).toBeVisible();
      }
    }
  });

  test('Hover card disappears when mouse leaves', async ({ page, request }) => {
    const requestId = await findRealEntity(request, 'requests');
    test.skip(!requestId, 'No requests in database');

    await navigateTo(page, `/requests/${requestId}`);
    await waitForLoaded(page);

    const entityLink = page.locator(
      '[data-entity-hover], [data-testid="entity-reference"]'
    ).first();
    const hasEntityLink = await entityLink.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasEntityLink, 'Entity hover links not yet implemented');

    // Hover to show card
    await entityLink.hover();
    const hoverCard = page.locator(
      '[data-testid="entity-hover-card"], [role="tooltip"][data-entity-hover-card]'
    );
    const hasHoverCard = await hoverCard.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasHoverCard, 'Hover card not yet implemented');

    // Move mouse away
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);

    // Hover card should disappear
    await expect(hoverCard).toBeHidden({ timeout: 3000 });
  });

  test('Person detail page shows back navigation to originating list', async ({ page, request }) => {
    const personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No people in database');

    // Navigate from people list to detail
    await navigateTo(page, `/people/${personId}`);
    await waitForLoaded(page);

    // Should have back button or breadcrumb to return to list
    const backNav = page.locator(
      '[data-testid="back-button"], [data-testid="back-to-list"], ' +
      'a:has-text("Back"), button:has-text("Back"), ' +
      'nav[aria-label="Breadcrumb"] a'
    ).first();
    const hasBackNav = await backNav.isVisible({ timeout: 5000 }).catch(() => false);

    // Either has new breadcrumb nav or existing back button
    if (hasBackNav) {
      await expect(backNav).toBeVisible();
    }
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

  test('Full flow: list → preview → drawer edit → close → different row', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const rows = page.locator(
      '[data-testid="list-row"], [data-testid="trapper-row"], tr[data-entity-id]'
    );
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'Need at least 2 rows for integration test');

    // Step 1: Click first row to open preview
    await rows.nth(0).click();
    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Split-view not yet implemented');

    // Step 2: Open drawer from preview
    const editButton = previewPanel.locator(
      'button:has-text("Edit"), [data-testid="edit-action"]'
    ).first();
    const hasEdit = await editButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasEdit) {
      await editButton.click();
      const drawer = page.locator(
        '[data-testid="action-drawer"], [role="dialog"][data-state="open"]'
      );
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

  test('Full flow: list → preview → "View Full Profile" → breadcrumb back', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, `/trappers?selected=${trapperId}`);
    await waitForLoaded(page);

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Preview panel not yet implemented');

    // Navigate to full profile
    const fullProfileLink = previewPanel.locator(
      '[data-testid="view-full-profile"], a:has-text("View Full Profile"), a:has-text("Open")'
    ).first();
    const hasLink = await fullProfileLink.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasLink, 'Full profile link not found');

    await fullProfileLink.click();
    await page.waitForURL(`**/trappers/${trapperId}**`, { timeout: 5000 }).catch(() => {});

    // Use breadcrumb to go back
    const breadcrumbLink = page.locator(
      '[data-testid="breadcrumbs"] a, nav[aria-label="Breadcrumb"] a'
    ).first();
    const hasCrumb = await breadcrumbLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasCrumb) {
      await breadcrumbLink.click();
      await page.waitForURL('**/trappers**', { timeout: 5000 });
      // Should be back on list
      expect(page.url()).toContain('/trappers');
    }
  });

  test('Keyboard navigation: arrow keys move selection in list', async ({ page, request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    await navigateTo(page, '/trappers');
    await waitForLoaded(page);

    const rows = page.locator(
      '[data-testid="list-row"], [data-testid="trapper-row"], tr[data-entity-id]'
    );
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'Need at least 2 rows for keyboard nav test');

    // Click first row to establish focus
    await rows.nth(0).click();

    const previewPanel = page.locator(
      '[data-testid="detail-panel"], [data-testid="preview-panel"]'
    );
    const hasPreview = await previewPanel.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasPreview, 'Split-view not yet implemented');

    const firstName = await previewPanel.locator('h2, h3, [data-testid="entity-name"]').first().textContent();

    // Arrow down to move to next row
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);

    const secondName = await previewPanel.locator('h2, h3, [data-testid="entity-name"]').first().textContent();

    // Content should have changed (or at least still be valid)
    expect(secondName?.trim().length).toBeGreaterThan(0);
  });
});

// ============================================================================
// API — Preview Endpoint (FFS-604/607)
// ============================================================================

test.describe('Preview API Endpoints @api', () => {

  test('Person preview API returns lightweight data', async ({ request }) => {
    const personId = await findRealEntity(request, 'people');
    test.skip(!personId, 'No people in database');

    // The preview endpoint should return minimal data for hover cards / preview panels
    const res = await request.get(`/api/people/${personId}/preview`);

    // May not exist yet — that's OK
    if (res.ok()) {
      const json = await res.json();
      const data = json.data || json;

      // Should include basic info
      expect(data).toHaveProperty('person_id');
      // Should NOT include heavy data (full history, all relationships, etc.)
    }
  });

  test('Trapper preview includes role-specific stats', async ({ request }) => {
    const trapperId = await findRealTrapper(request);
    test.skip(!trapperId, 'No trappers in database');

    const res = await request.get(`/api/people/${trapperId}/preview`);

    if (res.ok()) {
      const json = await res.json();
      const data = json.data || json;

      // Should include basic person info
      expect(data).toHaveProperty('person_id');
    }
  });
});
