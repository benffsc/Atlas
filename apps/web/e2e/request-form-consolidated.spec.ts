/**
 * Consolidated Request Form E2E Tests
 *
 * Tests the /requests/new form across all three entry modes (phone, paper, quick complete),
 * facade derivation, intake pre-population, duplicate detection, mode switching, and
 * zero-value edge cases.
 *
 * Uses mockWritesWithCapture to intercept real API writes while reading real data.
 * Created test requests are cleaned up via PATCH to cancelled status.
 *
 * Run with:
 *   npm run test:e2e -- e2e/request-form-consolidated.spec.ts
 */

import { test, expect } from '@playwright/test';
import { authenticate, mockWritesWithCapture } from './ui-test-helpers';
import { unwrapApiResponse } from './helpers/api-response';

// E2E marker embedded in notes fields so test data can be identified and cleaned up
const E2E_TEST_MARKER = 'E2E_TEST_MARKER';

// Track request IDs created via real API (non-mocked paths) for cleanup
const createdRequestIds: string[] = [];

// Realistic Sonoma County test data
const TEST_CALLER = {
  firstName: 'Tessa',
  lastName: 'Weatherby',
  phone: '7075551234',
  email: 'tessa.weatherby.e2e@example.com',
};

const TEST_SUMMARY = 'E2E Test - Cats behind Annadel market';

/**
 * Helper: Fill the minimum Phase 1 fields (caller + summary + cat count).
 * The form has section-based layout. PersonSection renders first/last/phone/email
 * fields with specific placeholders. Summary is under "Request Title" label in
 * the UrgencyNotesSection.
 */
async function fillPhase1Basics(page: import('@playwright/test').Page, options?: {
  summary?: string;
  catCount?: number;
  skipCaller?: boolean;
}) {
  const summary = options?.summary ?? TEST_SUMMARY;
  const catCount = options?.catCount ?? 5;

  // Fill caller info (PersonSection with role="requestor" renders inline fields)
  if (!options?.skipCaller) {
    // PersonSection renders First Name / Last Name / Phone / Email inputs
    // They use placeholder text for identification
    const firstNameInput = page.getByPlaceholder('First name').first();
    await firstNameInput.fill(TEST_CALLER.firstName);

    const lastNameInput = page.getByPlaceholder('Last name').first();
    await lastNameInput.fill(TEST_CALLER.lastName);

    const phoneInput = page.getByPlaceholder('(707) 555-1234').first();
    await phoneInput.fill(TEST_CALLER.phone);
  }

  // Fill cat count — CatDetailsSection label is "How many cats?"
  // The input is a number field within the cats section
  const catCountInput = page.locator('#section-cats input[type="number"]').first();
  if (await catCountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await catCountInput.fill(String(catCount));
  }

  // Fill summary — UrgencyNotesSection label is "Request Title"
  // It's in the "Anything else?" section
  const summaryInput = page.locator('#section-anything-else input[type="text"]').first();
  if (await summaryInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await summaryInput.fill(summary);
  } else {
    // Fallback: look for textarea or input near "Request Title" label
    const titleInput = page.getByLabel('Request Title');
    if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await titleInput.fill(summary);
    }
  }
}

/**
 * Helper: Select an entry mode from EntryModeSelector.
 * Modes are rendered as buttons with text: "Phone Intake", "Paper Entry", "Quick Complete".
 */
async function selectEntryMode(page: import('@playwright/test').Page, mode: 'phone' | 'paper' | 'complete') {
  const labels: Record<string, string> = {
    phone: 'Phone Intake',
    paper: 'Paper Entry',
    complete: 'Quick Complete',
  };
  await page.getByRole('button', { name: labels[mode] }).click();
}

/**
 * Helper: Submit the form by clicking the submit button.
 * Button text is "Create Request" or "Complete & Close Request" for quick complete mode.
 */
async function submitForm(page: import('@playwright/test').Page, mode: 'phone' | 'paper' | 'complete' = 'phone') {
  const buttonText = mode === 'complete' ? 'Complete & Close Request' : 'Create Request';
  const submitBtn = page.getByRole('button', { name: buttonText });
  await submitBtn.click();
}

/**
 * Helper: Handle the gentle gate modal if it appears.
 * The gate shows soft validation warnings with "Submit anyway" button.
 */
async function handleGentleGate(page: import('@playwright/test').Page) {
  const submitAnyway = page.getByRole('button', { name: 'Submit anyway' });
  if (await submitAnyway.isVisible({ timeout: 2000 }).catch(() => false)) {
    await submitAnyway.click();
    // After clicking "Submit anyway", the form re-submits automatically
    await page.waitForTimeout(500);
  }
}

/**
 * Helper: Clean up a created request by cancelling it via API.
 */
async function cleanupRequest(
  apiContext: import('@playwright/test').APIRequestContext,
  requestId: string
): Promise<void> {
  try {
    await apiContext.patch(`/api/requests/${requestId}`, {
      data: {
        status: 'cancelled',
        notes: `${E2E_TEST_MARKER} - cleanup at ${new Date().toISOString()}`,
      },
    });
  } catch {
    // Best effort cleanup
  }
}

// ============================================================================
// TESTS
// ============================================================================

test.describe('Consolidated Request Form', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test.afterEach(async ({ request: apiContext }) => {
    // Cancel any requests created during this test
    for (const id of createdRequestIds) {
      await cleanupRequest(apiContext, id);
    }
    createdRequestIds.length = 0;
  });

  // --------------------------------------------------------------------------
  // Test 1: Phone mode — Phase 2 collapsed by default
  // --------------------------------------------------------------------------
  test('phone mode — phase 2 collapsed by default', async ({ page }) => {
    const capture = await mockWritesWithCapture(page);
    await page.goto('/requests/new', { waitUntil: 'domcontentloaded' });

    // Verify "Phone Intake" mode button exists and is visually selected (active)
    const phoneBtn = page.getByRole('button', { name: 'Phone Intake' });
    await expect(phoneBtn).toBeVisible();
    // Phone mode is default — button should have active styling (primary background)

    // Fill Phase 1 basics
    await fillPhase1Basics(page);

    // Verify StaffTriagePanel accordion header is visible but body is collapsed.
    // The panel renders a button with text "Staff Triage (Phase 2)" and a ▼ indicator.
    // When collapsed, the expanded body (with Priority, Triage category, etc.) is not rendered.
    const triageHeader = page.getByRole('button', { name: /Staff Triage/ });
    await expect(triageHeader).toBeVisible();

    // Phase 2 body should NOT be visible (collapsed for phone mode by default)
    // The panel body contains a "Priority" label — check it's not visible
    const priorityLabel = page.locator('text=Triage category').first();
    await expect(priorityLabel).not.toBeVisible();

    // Submit the form
    await submitForm(page, 'phone');
    await handleGentleGate(page);

    // Verify a POST was captured (mocked write)
    await page.waitForTimeout(1000);
    const posts = capture.getByMethod('POST');
    expect(posts.length).toBeGreaterThanOrEqual(1);

    // Verify the POST body includes expected fields
    const requestPost = posts.find((p) => p.url.includes('/api/requests'));
    if (requestPost?.body) {
      expect(requestPost.body.entry_mode).toBe('phone');
      expect(requestPost.body.initial_status).toBe('new');
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: Paper mode — Phase 2 expanded
  // --------------------------------------------------------------------------
  test('paper mode — phase 2 expanded', async ({ page }) => {
    const capture = await mockWritesWithCapture(page);
    await page.goto('/requests/new', { waitUntil: 'domcontentloaded' });

    // Switch to Paper Entry mode
    await selectEntryMode(page, 'paper');

    // Fill Phase 1 basics
    await fillPhase1Basics(page, { summary: 'E2E Test - Paper entry for barn cats off Llano Rd' });

    // In paper mode, StaffTriagePanel should be expanded by default
    // Check that Phase 2 fields are visible
    const triageCategoryLabel = page.locator('text=Triage category').first();
    await expect(triageCategoryLabel).toBeVisible({ timeout: 5000 });

    // Fill Phase 2 fields — priority select and triage category
    const prioritySelect = page.locator('select').filter({ has: page.locator('option[value="high"]') }).first();
    if (await prioritySelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prioritySelect.selectOption('high');
    }

    // Fill cat descriptions textarea in Phase 2
    const catDescTextarea = page.getByPlaceholder('Colors, markings, names');
    if (await catDescTextarea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await catDescTextarea.fill('2 orange tabbies, 1 black, 1 calico');
    }

    // Submit
    await submitForm(page, 'paper');
    await handleGentleGate(page);

    // Verify POST was sent
    await page.waitForTimeout(1000);
    const posts = capture.getByMethod('POST');
    expect(posts.length).toBeGreaterThanOrEqual(1);

    const requestPost = posts.find((p) => p.url.includes('/api/requests'));
    if (requestPost?.body) {
      expect(requestPost.body.entry_mode).toBe('paper');
    }
  });

  // --------------------------------------------------------------------------
  // Test 3: Quick Complete — no Phase 2, completion fields visible
  // --------------------------------------------------------------------------
  test('quick complete — completion fields visible, no phase 2', async ({ page }) => {
    const capture = await mockWritesWithCapture(page);
    await page.goto('/requests/new', { waitUntil: 'domcontentloaded' });

    // Switch to Quick Complete mode
    await selectEntryMode(page, 'complete');

    // Verify the green info banner about Quick Complete mode appears
    await expect(page.locator('text=Quick Complete mode')).toBeVisible();

    // Verify StaffTriagePanel is NOT rendered in complete mode
    const triageHeader = page.getByRole('button', { name: /Staff Triage/ });
    await expect(triageHeader).not.toBeVisible();

    // Verify CompletionSection fields are visible
    // CompletionSection has: "Field Work Completion" header, Final Cat Count, Eartips Observed, Cats Altered Today
    await expect(page.locator('text=Field Work Completion')).toBeVisible();

    const finalCatCountInput = page.getByPlaceholder('Total cats at location');
    await expect(finalCatCountInput).toBeVisible();

    const eartipsInput = page.getByPlaceholder('Already fixed');
    await expect(eartipsInput).toBeVisible();

    const alteredTodayInput = page.getByPlaceholder('Fixed this visit');
    await expect(alteredTodayInput).toBeVisible();

    // Fill caller info + basics
    await fillPhase1Basics(page, {
      summary: 'E2E Test - Quick complete for colony on Todd Rd',
      catCount: 8,
    });

    // Fill completion data
    await finalCatCountInput.fill('8');
    await eartipsInput.fill('3');
    await alteredTodayInput.fill('5');

    const obsNotes = page.getByPlaceholder('Notes from the field visit');
    if (await obsNotes.isVisible({ timeout: 2000 }).catch(() => false)) {
      await obsNotes.fill(`${E2E_TEST_MARKER} - All cats trapped and transported`);
    }

    // Check "Colony work complete" checkbox
    const colonyCompleteCheckbox = page.locator('text=Colony work complete').locator('..').locator('input[type="checkbox"]');
    if (await colonyCompleteCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await colonyCompleteCheckbox.check();
    }

    // Submit with quick complete button
    await submitForm(page, 'complete');
    await handleGentleGate(page);

    // Verify POST was captured with completed status
    await page.waitForTimeout(1000);
    const posts = capture.getByMethod('POST');
    expect(posts.length).toBeGreaterThanOrEqual(1);

    const requestPost = posts.find((p) => p.url.includes('/api/requests'));
    if (requestPost?.body) {
      expect(requestPost.body.entry_mode).toBe('complete');
      expect(requestPost.body.initial_status).toBe('completed');
      expect(requestPost.body.completion_data).toBeDefined();
      const cd = requestPost.body.completion_data as Record<string, unknown>;
      expect(cd.final_cat_count).toBe(8);
      expect(cd.eartips_observed).toBe(3);
      expect(cd.cats_altered_today).toBe(5);
      expect(cd.colony_complete).toBe(true);
    }
  });

  // --------------------------------------------------------------------------
  // Test 4: Facade derivation verification
  // --------------------------------------------------------------------------
  test('facade derives phase 2 fields from phase 1 inputs', async ({ page }) => {
    const capture = await mockWritesWithCapture(page);
    await page.goto('/requests/new', { waitUntil: 'domcontentloaded' });

    // Fill Phase 1 with specific values that trigger facade derivation
    await fillPhase1Basics(page, {
      summary: 'E2E Test - Facade derivation check on Petaluma Blvd',
      catCount: 8,
    });

    // Check "Kittens present" checkbox — this is in the KittenAssessmentSection
    const kittensCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('..', { hasText: 'Kittens present' }) });
    if (await kittensCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await kittensCheckbox.check();
    } else {
      // Alternative: find by nearby text
      const kittenLabel = page.locator('label', { hasText: 'Kittens present' });
      if (await kittenLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await kittenLabel.click();
      }
    }

    // Submit the form
    await submitForm(page, 'phone');
    await handleGentleGate(page);

    // Verify the POST body includes facade-derived fields
    await page.waitForTimeout(1000);
    const posts = capture.getByMethod('POST');
    const requestPost = posts.find((p) => p.url.includes('/api/requests'));

    if (requestPost?.body) {
      // Facade: total_cats_reported defaults to estimated_cat_count
      expect(requestPost.body.estimated_cat_count).toBe(8);
      expect(requestPost.body.total_cats_reported).toBe(8);
      // Facade: peak_count defaults to estimated_cat_count
      expect(requestPost.body.peak_count).toBe(8);
      // has_kittens should be true
      expect(requestPost.body.has_kittens).toBe(true);
      // Facade: count_confidence defaults to 'unknown'
      expect(requestPost.body.count_confidence).toBe('unknown');
    }
  });

  // --------------------------------------------------------------------------
  // Test 5: Intake pre-population
  // --------------------------------------------------------------------------
  test('intake pre-population fills form fields', async ({ page, request: apiContext }) => {
    // Step 1: Create an intake submission via the API
    const intakeData = {
      source: 'phone',
      first_name: 'Marta',
      last_name: 'Gonzalez',
      phone: '7075559876',
      email: 'marta.gonzalez.e2e@example.com',
      cats_address: '123 Bodega Ave, Petaluma, CA 94952',
      cats_city: 'Petaluma',
      county: 'Sonoma',
      cat_count_estimate: 4,
      has_kittens: true,
      situation_description: `${E2E_TEST_MARKER} - Several cats behind restaurant`,
    };

    const intakeResponse = await apiContext.post('/api/intake', { data: intakeData });

    // If intake creation fails, skip the test gracefully
    if (!intakeResponse.ok()) {
      test.skip(true, 'Could not create intake submission via API');
      return;
    }

    const intakeResult = unwrapApiResponse<Record<string, unknown>>(await intakeResponse.json());
    const intakeId = intakeResult.id || intakeResult.intake_id || intakeResult.submission_id;
    if (!intakeId) {
      test.skip(true, 'Intake creation did not return an ID');
      return;
    }

    // Step 2: Navigate to the form with intake_id query param
    const capture = await mockWritesWithCapture(page);
    await page.goto(`/requests/new?intake_id=${intakeId}`, { waitUntil: 'domcontentloaded' });

    // Wait for intake data to load (the useEffect fetches async)
    await page.waitForTimeout(2000);

    // Step 3: Verify pre-filled fields
    // Entry mode should auto-switch to "paper" for intake pre-population
    // PersonSection first name should be pre-filled
    const firstNameInput = page.getByPlaceholder('First name').first();
    await expect(firstNameInput).toHaveValue('Marta', { timeout: 5000 });

    const lastNameInput = page.getByPlaceholder('Last name').first();
    await expect(lastNameInput).toHaveValue('Gonzalez');

    const phoneInput = page.getByPlaceholder('(707) 555-1234').first();
    const phoneValue = await phoneInput.inputValue();
    // Phone may be formatted by formatPhoneAsYouType
    expect(phoneValue).toContain('707');

    // Submit (pre-filled data should be sufficient)
    await submitForm(page, 'paper');
    await handleGentleGate(page);

    await page.waitForTimeout(1000);
    const posts = capture.getByMethod('POST');
    expect(posts.length).toBeGreaterThanOrEqual(1);
  });

  // --------------------------------------------------------------------------
  // Test 6: Duplicate detection — ActiveRequestWarning
  // --------------------------------------------------------------------------
  test.fixme('duplicate detection shows ActiveRequestWarning', async ({ page, request: apiContext }) => {
    // NOTE: test.fixme because duplicate detection requires:
    // 1. A real place_id that has an active request
    // 2. The /api/requests/check-duplicates endpoint to return matches
    // 3. Timing coordination with the debounced duplicate check (600ms)
    //
    // This is hard to trigger reliably in E2E because:
    // - PlaceResolver requires Google Maps interaction to resolve a place
    // - We'd need to create a request at a known place, then start a new request
    //   at the same place, which requires the place_id to match exactly
    // - The duplicate check fires on place_id/phone/email change with a debounce
    //
    // To make this testable, consider adding a data-testid to ActiveRequestWarning
    // or providing a test-only query param that pre-loads a place_id.

    await page.goto('/requests/new', { waitUntil: 'domcontentloaded' });

    // Would need to: create a request at a place, then navigate to /requests/new
    // with that place pre-loaded via ?place_id=... and wait for the duplicate check
    // to fire. The ActiveRequestWarning renders with text "Active Request at This Location".

    // Placeholder assertion — this test needs infrastructure work
    await expect(page.locator('body')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Test 7: Entry mode switching preserves data
  // --------------------------------------------------------------------------
  test('entry mode switching preserves data', async ({ page }) => {
    const capture = await mockWritesWithCapture(page);
    await page.goto('/requests/new', { waitUntil: 'domcontentloaded' });

    // Start in phone mode (default)
    await expect(page.getByRole('button', { name: 'Phone Intake' })).toBeVisible();

    // Fill Phase 1 basics in phone mode
    const firstNameInput = page.getByPlaceholder('First name').first();
    await firstNameInput.fill(TEST_CALLER.firstName);

    const lastNameInput = page.getByPlaceholder('Last name').first();
    await lastNameInput.fill(TEST_CALLER.lastName);

    const phoneInput = page.getByPlaceholder('(707) 555-1234').first();
    await phoneInput.fill(TEST_CALLER.phone);

    // Fill cat count
    const catCountInput = page.locator('#section-cats input[type="number"]').first();
    if (await catCountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await catCountInput.fill('6');
    }

    // Switch to paper mode
    await selectEntryMode(page, 'paper');

    // Verify data persisted across mode switch
    await expect(firstNameInput).toHaveValue(TEST_CALLER.firstName);
    await expect(lastNameInput).toHaveValue(TEST_CALLER.lastName);

    // Phone may be formatted
    const phoneValue = await phoneInput.inputValue();
    expect(phoneValue).toBeTruthy();
    expect(phoneValue.replace(/\D/g, '')).toContain('7075551234');

    // Cat count should persist
    if (await catCountInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(catCountInput).toHaveValue('6');
    }

    // Fill summary in paper mode and submit
    const summaryInput = page.locator('#section-anything-else input[type="text"]').first();
    if (await summaryInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await summaryInput.fill('E2E Test - Mode switch preservation on Stony Point Rd');
    }

    await submitForm(page, 'paper');
    await handleGentleGate(page);

    // Verify POST captured with paper mode
    await page.waitForTimeout(1000);
    const posts = capture.getByMethod('POST');
    const requestPost = posts.find((p) => p.url.includes('/api/requests'));
    if (requestPost?.body) {
      expect(requestPost.body.entry_mode).toBe('paper');
      // Caller data should have persisted
      expect(requestPost.body.raw_requester_phone).toBeTruthy();
    }
  });

  // --------------------------------------------------------------------------
  // Test 8: Zero-value regression
  // --------------------------------------------------------------------------
  test('zero-value regression — estimated_cat_count=0 and has_kittens=false', async ({ page }) => {
    const capture = await mockWritesWithCapture(page);
    await page.goto('/requests/new', { waitUntil: 'domcontentloaded' });

    // Fill caller info
    const firstNameInput = page.getByPlaceholder('First name').first();
    await firstNameInput.fill('Zero');

    const lastNameInput = page.getByPlaceholder('Last name').first();
    await lastNameInput.fill('Tester');

    const phoneInput = page.getByPlaceholder('(707) 555-1234').first();
    await phoneInput.fill('7075550000');

    // Set estimated_cat_count to 0
    const catCountInput = page.locator('#section-cats input[type="number"]').first();
    if (await catCountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await catCountInput.fill('0');
    }

    // Ensure has_kittens is unchecked (default should be false, but verify)
    const kittensCheckbox = page.locator('label', { hasText: 'Kittens present' }).locator('input[type="checkbox"]');
    if (await kittensCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Uncheck if checked
      if (await kittensCheckbox.isChecked()) {
        await kittensCheckbox.uncheck();
      }
    }

    // Fill a summary to avoid gentle gate on missing title
    const summaryInput = page.locator('#section-anything-else input[type="text"]').first();
    if (await summaryInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await summaryInput.fill('E2E Test - Zero cat count regression');
    }

    // Submit
    await submitForm(page, 'phone');
    await handleGentleGate(page);

    // Verify POST was sent with zero values (not null, not omitted)
    await page.waitForTimeout(1000);
    const posts = capture.getByMethod('POST');
    const requestPost = posts.find((p) => p.url.includes('/api/requests'));

    expect(requestPost).toBeDefined();
    if (requestPost?.body) {
      // estimated_cat_count=0 should be sent as 0, not null
      expect(requestPost.body.estimated_cat_count).toBe(0);
      // has_kittens should be explicitly false, not null
      expect(requestPost.body.has_kittens).toBe(false);
      // Facade: total_cats_reported should also be 0
      expect(requestPost.body.total_cats_reported).toBe(0);
    }
  });
});
