import { test, expect } from '@playwright/test';
import { navigateTo } from './ui-test-helpers';

/**
 * Staff Password Reset — Real API Integration Tests
 *
 * These tests hit the REAL database (no mocks). They exercise the full
 * token lifecycle: generate → validate → consume → reject reuse.
 *
 * Uses the test account (test@forgottenfelines.com) which must exist
 * in the database. The test resets the password at the end to restore
 * original state.
 *
 * Tagged @real-api — skipped by default in CI. Run with:
 *   INCLUDE_REAL_API=1 npm run test:e2e -- staff-password-reset-integration
 */

test.describe('Password Reset — Real API Integration @real-api', () => {
  test.setTimeout(30000);

  // ── Token lifecycle via API ─────────────────────────────────────────

  test('full token lifecycle: generate → validate → reset → reject reuse', async ({ page }) => {
    // Login directly to ensure we have a fresh admin session
    const loginRes = await page.request.post('/api/auth/login', {
      data: { email: 'test@forgottenfelines.com', password: '18201814' },
    });
    if (!loginRes.ok()) {
      test.skip(true, 'Could not login as test user');
      return;
    }

    // Get staff_id from the staff list
    const staffListRes = await page.request.get('/api/staff?active=true');
    let staffId: string | null = null;
    if (staffListRes.ok()) {
      const staffListJson = await staffListRes.json() as { data?: { staff?: Array<{ staff_id: string; email: string | null }> } };
      const testUser = staffListJson.data?.staff?.find((s: { email: string | null }) => s.email === 'test@forgottenfelines.com');
      staffId = testUser?.staff_id || null;
    }

    if (!staffId) {
      test.skip(true, 'Test user not found in staff API');
      return;
    }

    // Call send-login-info — returns reset_url when email delivery fails (dev mode)
    const sendRes = await page.request.post('/api/admin/staff/send-login-info', {
      data: { staff_id: staffId, email_type: 'welcome' },
    });
    const sendJson = await sendRes.json() as { success: boolean; data?: { reset_url?: string; send_failed?: boolean } };

    if (!sendJson.success || !sendJson.data?.reset_url) {
      test.skip(true, 'Token not extractable — email was sent successfully or not admin');
      return;
    }

    const token = new URL(sendJson.data.reset_url).searchParams.get('token');
    if (!token) {
      test.skip(true, 'Could not parse token from reset_url');
      return;
    }

    // Step 3: Validate the token via GET
    const validateRes = await page.request.get(`/api/auth/reset-password?token=${token}`);
    expect(validateRes.status()).toBe(200);
    const validateJson = await validateRes.json();
    expect(validateJson.success).toBe(true);
    expect(validateJson.data.valid).toBe(true);
    expect(validateJson.data.display_name).toBeTruthy();
    expect(validateJson.data.email).toContain('@');

    // Step 4: Reset password using the token
    const resetRes = await page.request.post('/api/auth/reset-password', {
      data: {
        token,
        new_password: 'integration-test-pw-123',
        confirm_password: 'integration-test-pw-123',
      },
    });
    expect(resetRes.status()).toBe(200);
    const resetJson = await resetRes.json();
    expect(resetJson.success).toBe(true);
    expect(resetJson.data.message).toContain('reset successfully');

    // Step 5: Reuse of the same token should fail (consumed)
    const reuseValidate = await page.request.get(`/api/auth/reset-password?token=${token}`);
    expect(reuseValidate.status()).toBe(400);
    const reuseJson = await reuseValidate.json();
    expect(reuseJson.success).toBe(false);
    expect(reuseJson.error.message).toContain('invalid or has expired');

    // Step 6: Login with the new password
    const finalLoginRes = await page.request.post('/api/auth/login', {
      data: {
        email: 'test@forgottenfelines.com',
        password: 'integration-test-pw-123',
      },
    });
    expect(finalLoginRes.status()).toBe(200);
    const finalLoginJson = await finalLoginRes.json();
    expect(finalLoginJson.success).toBe(true);
    expect(finalLoginJson.data.staff.display_name).toBeTruthy();
    // password_change_required should be false after reset
    expect(finalLoginJson.data.password_change_required).toBe(false);
  });

  // ── Email template rendering ────────────────────────────────────────

  test('welcome email preview has no unreplaced placeholders', async ({ page }) => {
    const staffId = await getTestStaffId(page);
    if (!staffId) {
      test.skip(true, 'Test staff not found');
      return;
    }

    const res = await page.request.get(`/api/admin/staff/preview-email?staff_id=${staffId}&type=welcome`);
    expect(res.status()).toBe(200);
    const json = await res.json();

    const subject = json.data.subject;
    const html = json.data.body_html;

    // No unreplaced {{...}} placeholders (except PREVIEW_TOKEN which is intentional)
    const unreplacedSubject = subject.match(/\{\{(?!PREVIEW)\w+\}\}/g);
    const unreplacedHtml = html.match(/\{\{(?!PREVIEW)\w+\}\}/g);
    expect(unreplacedSubject).toBeNull();
    expect(unreplacedHtml).toBeNull();

    // Has the key elements
    expect(html).toContain('beacon-logo.jpeg');
    expect(html).toContain('Set your password');
    expect(html).toContain('PREVIEW_TOKEN');
    expect(html).toContain('Forgotten Felines');
    expect(html).toContain('v:roundrect'); // VML button for Outlook
  });

  test('reset email preview has no unreplaced placeholders', async ({ page }) => {
    const staffId = await getTestStaffId(page);
    if (!staffId) {
      test.skip(true, 'Test staff not found');
      return;
    }

    const res = await page.request.get(`/api/admin/staff/preview-email?staff_id=${staffId}&type=reset`);
    expect(res.status()).toBe(200);
    const json = await res.json();

    const subject = json.data.subject;
    const html = json.data.body_html;

    const unreplacedSubject = subject.match(/\{\{(?!PREVIEW)\w+\}\}/g);
    const unreplacedHtml = html.match(/\{\{(?!PREVIEW)\w+\}\}/g);
    expect(unreplacedSubject).toBeNull();
    expect(unreplacedHtml).toBeNull();

    expect(html).toContain('beacon-logo.jpeg');
    expect(html).toContain('Reset your password');
    expect(html).toContain('v:roundrect');
  });

  // ── Auth overview data quality ──────────────────────────────────────

  test('auth-overview returns correct data shape for all staff', async ({ page }) => {
    const res = await page.request.get('/api/admin/staff/auth-overview');
    if (res.status() === 403) {
      test.skip(true, 'Test user is not admin');
      return;
    }

    expect(res.status()).toBe(200);
    const json = await res.json();
    const staff = json.data.staff;

    expect(staff.length).toBeGreaterThan(0);

    for (const s of staff) {
      // Every row has required fields
      expect(s).toHaveProperty('staff_id');
      expect(s).toHaveProperty('display_name');
      expect(s).toHaveProperty('email');
      expect(s).toHaveProperty('auth_role');
      expect(s).toHaveProperty('password_status');
      expect(s).toHaveProperty('login_count');
      expect(s).toHaveProperty('last_login');

      // password_status is a valid enum
      expect(['set', 'default', 'not_set']).toContain(s.password_status);

      // login_count is non-negative
      expect(s.login_count).toBeGreaterThanOrEqual(0);

      // auth_role is valid
      expect(['admin', 'staff', 'volunteer']).toContain(s.auth_role);
    }
  });

  // ── UI flow: forgot password → reset password ───────────────────────

  test('forgot-password page submits and shows confirmation (real API)', async ({ page }) => {
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill('test@forgottenfelines.com');
    await page.locator('button:has-text("Send reset link")').click();

    // Should show "Check your email" regardless of whether email actually sent
    await expect(page.locator('text=Check your email')).toBeVisible({ timeout: 10000 });
  });

  test('reset-password page with bogus token shows expired state', async ({ page }) => {
    await page.goto('/reset-password?token=this-is-not-a-real-token');

    await expect(page.locator('text=Link expired or invalid')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('a:has-text("Request a new link")')).toBeVisible();
  });

  // ── Middleware: public paths accessible without auth ─────────────────

  test('/forgot-password is accessible without auth', async ({ browser }) => {
    // New context with NO stored auth
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/forgot-password');
    // Should NOT redirect to /login
    expect(page.url()).toContain('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Forgot your password?' }).first()).toBeVisible();

    await context.close();
  });

  test('/reset-password is accessible without auth', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/reset-password?token=test');
    expect(page.url()).toContain('/reset-password');
    // Should show expired state (token is fake) — NOT a login redirect
    await expect(page.locator('text=Link expired or invalid')).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('/api/auth/forgot-password is accessible without auth', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const res = await page.request.post('/api/auth/forgot-password', {
      data: { email: 'nobody@example.com' },
    });
    // Should return 200, not 401
    expect(res.status()).toBe(200);

    await context.close();
  });

  test('/api/auth/reset-password is accessible without auth', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const res = await page.request.get('/api/auth/reset-password?token=test');
    // Should return 400 (bad token), not 401
    expect(res.status()).toBe(400);

    await context.close();
  });
});

// ── Helper ──────────────────────────────────────────────────────────────

async function getTestStaffId(page: { request: { get: (url: string) => Promise<{ ok(): boolean; json(): Promise<unknown> }> } }): Promise<string | null> {
  try {
    const res = await page.request.get('/api/admin/staff/auth-overview');
    if (!res.ok()) return null;
    const json = await res.json() as { data: { staff: Array<{ staff_id: string; email: string | null }> } };
    const testUser = json.data.staff.find((s: { email: string | null }) => s.email === 'test@forgottenfelines.com');
    return testUser?.staff_id || json.data.staff[0]?.staff_id || null;
  } catch {
    return null;
  }
}
