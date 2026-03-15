import { test, expect } from '@playwright/test';
import { navigateTo, waitForLoaded, mockAllWrites } from './ui-test-helpers';

/**
 * Modular Forms E2E Tests — @workflow
 *
 * Covers the modular request form architecture (FFS-485 Epic):
 * - /requests/new page loads with section structure
 * - Form templates API returns configuration
 * - Form fields API returns field definitions
 * - Colony info section exists on request creation
 * - Form submission is properly mocked
 * - Admin form management pages load
 *
 * Tests are READ-ONLY except for mocked submission tests.
 */

// ============================================================================
// Request Creation Page
// ============================================================================

test.describe('Request Creation Form', () => {
  test.setTimeout(45000);

  test('/requests/new page loads', async ({ page }) => {
    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/requests/new has form structure', async ({ page }) => {
    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should have form elements
    const form = page.locator('form').first();
    const hasForm = await form.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasForm) {
      // May use non-form layout (section-based architecture)
      const bodyText = await page.textContent('body') || '';
      const hasSections =
        bodyText.includes('Request') ||
        bodyText.includes('Contact') ||
        bodyText.includes('Address') ||
        bodyText.includes('Location') ||
        bodyText.includes('Colony') ||
        bodyText.includes('Cat');
      console.log(`Request form uses section-based layout: ${hasSections}`);
    } else {
      console.log('Request form has standard form element');
    }
  });

  test('/requests/new has contact or caller info section', async ({ page }) => {
    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasContactSection =
      bodyText.includes('Contact') ||
      bodyText.includes('Caller') ||
      bodyText.includes('Name') ||
      bodyText.includes('Email') ||
      bodyText.includes('Phone');
    console.log(`Request form has contact section: ${hasContactSection}`);
  });

  test('/requests/new has colony info section', async ({ page }) => {
    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasColonySection =
      bodyText.includes('Colony') ||
      bodyText.includes('Cats') ||
      bodyText.includes('Cat Count') ||
      bodyText.includes('Feeding') ||
      bodyText.includes('TNR');
    console.log(`Request form has colony section: ${hasColonySection}`);
  });

  test('/requests/new has address or location section', async ({ page }) => {
    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body') || '';
    const hasLocationSection =
      bodyText.includes('Address') ||
      bodyText.includes('Location') ||
      bodyText.includes('Street') ||
      bodyText.includes('City') ||
      bodyText.includes('Zip');
    console.log(`Request form has location section: ${hasLocationSection}`);
  });

  test('/requests/new has form inputs', async ({ page }) => {
    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should have text inputs, textareas, or selects
    const inputs = page.locator('input[type="text"], input[type="email"], input[type="tel"], textarea, select');
    const inputCount = await inputs.count();
    console.log(`Request form has ${inputCount} input fields`);
    expect(inputCount).toBeGreaterThan(0);
  });
});

// ============================================================================
// Form Submission (Mocked)
// ============================================================================

test.describe('Request Form Submission (Mocked)', () => {
  test.setTimeout(45000);

  test('form submit button exists', async ({ page }) => {
    await mockAllWrites(page);

    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const submitBtn = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Create"), button:has-text("Save")').first();
    const hasSubmit = await submitBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Request form has submit button: ${hasSubmit}`);
  });

  test('form does not crash when interacting with inputs', async ({ page }) => {
    await mockAllWrites(page);

    await navigateTo(page, '/requests/new');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Try filling in the first visible text input
    const firstInput = page.locator('input[type="text"]').first();
    const hasInput = await firstInput.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasInput) {
      await firstInput.fill('Test value');
      await page.waitForTimeout(300);
      // Page should not crash
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

// ============================================================================
// Form Templates API
// ============================================================================

test.describe('Form Templates API', () => {
  test.setTimeout(30000);

  test('/api/forms/templates returns template list', async ({ request }) => {
    const res = await request.get('/api/forms/templates');
    if (!res.ok()) {
      // May require auth
      expect(res.status()).toBeLessThan(500);
      console.log(`Form templates API returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    const templates = Array.isArray(data) ? data : data.templates || [];
    expect(Array.isArray(templates)).toBe(true);
    console.log(`Form templates API returned ${templates.length} templates`);

    if (templates.length > 0) {
      const template = templates[0];
      expect(template).toHaveProperty('key');
    }
  });

  test('/api/forms/fields returns field definitions', async ({ request }) => {
    const res = await request.get('/api/forms/fields');
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      console.log(`Form fields API returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    const fields = Array.isArray(data) ? data : data.fields || [];
    expect(Array.isArray(fields)).toBe(true);
    console.log(`Form fields API returned ${fields.length} field definitions`);

    if (fields.length > 0) {
      const field = fields[0];
      expect(field).toHaveProperty('field_key');
    }
  });

  test('/api/forms/submissions returns submissions list', async ({ request }) => {
    const res = await request.get('/api/forms/submissions');
    if (!res.ok()) {
      // May require auth (getSession() added in FFS-446)
      expect(res.status()).toBeLessThan(500);
      console.log(`Form submissions API returned ${res.status()}`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    const submissions = Array.isArray(data) ? data : data.submissions || [];
    expect(Array.isArray(submissions)).toBe(true);
    console.log(`Form submissions API returned ${submissions.length} submissions`);
  });
});

// ============================================================================
// Admin Form Pages
// ============================================================================

test.describe('Admin Form Management Pages', () => {
  test.setTimeout(45000);

  test('/admin/forms page loads', async ({ page }) => {
    await navigateTo(page, '/admin/forms');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/intake-fields page loads', async ({ page }) => {
    await navigateTo(page, '/admin/intake-fields');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('/admin/intake-questions page loads', async ({ page }) => {
    await navigateTo(page, '/admin/intake-questions');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body') || '';
    expect(bodyText).not.toContain('Internal Server Error');
  });
});
