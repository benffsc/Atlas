import { test, expect, type Page, type Route } from '@playwright/test';
import { navigateTo, mockAllWrites } from './ui-test-helpers';

/**
 * Staff Password Reset & Management E2E Tests
 *
 * Tests the full password reset flow:
 * - Forgot password page → sends reset link
 * - Reset password page → validates token → set new password
 * - Login page → "Forgot password?" link
 * - Staff accounts table → welcome/reset email actions
 * - Admin email preview drawer
 */

// ============================================================================
// Helpers
// ============================================================================

/** Mock the forgot-password API to always succeed */
async function mockForgotPassword(page: Page) {
  await page.route('**/api/auth/forgot-password', (route: Route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { message: 'If that email is registered, a reset link has been sent.' },
        }),
      });
    } else {
      route.continue();
    }
  });
}

/** Mock the reset-password token validation (GET) */
async function mockResetTokenValidation(page: Page, valid: boolean, staffName = 'Test User') {
  await page.route('**/api/auth/reset-password?token=*', (route: Route) => {
    if (route.request().method() === 'GET') {
      if (valid) {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { valid: true, display_name: staffName, email: 'test@forgottenfelines.com' },
          }),
        });
      } else {
        route.fulfill({
          contentType: 'application/json',
          status: 400,
          body: JSON.stringify({
            success: false,
            error: { message: 'This reset link is invalid or has expired', code: 400 },
          }),
        });
      }
    } else {
      route.continue();
    }
  });
}

/** Mock the reset-password submission (POST) */
async function mockResetPasswordSubmit(page: Page, success = true) {
  await page.route('**/api/auth/reset-password', (route: Route) => {
    if (route.request().method() === 'POST') {
      if (success) {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { message: 'Password has been reset successfully' },
          }),
        });
      } else {
        route.fulfill({
          contentType: 'application/json',
          status: 400,
          body: JSON.stringify({
            success: false,
            error: { message: 'Invalid or expired reset link', code: 400 },
          }),
        });
      }
    } else {
      route.continue();
    }
  });
}

/** Mock the staff auth-overview API */
async function mockAuthOverview(page: Page) {
  await page.route('**/api/admin/staff/auth-overview', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          staff: [
            {
              staff_id: '00000000-0000-0000-0000-000000000001',
              display_name: 'Jami Knuthson',
              email: 'jami@forgottenfelines.com',
              auth_role: 'staff',
              is_active: true,
              password_status: 'default',
              password_set_at: null,
              last_login: null,
              login_count: 0,
            },
            {
              staff_id: '00000000-0000-0000-0000-000000000002',
              display_name: 'Ben Mis',
              email: 'ben@forgottenfelines.com',
              auth_role: 'admin',
              is_active: true,
              password_status: 'set',
              password_set_at: '2026-04-01T00:00:00Z',
              last_login: '2026-04-15T10:00:00Z',
              login_count: 42,
            },
          ],
        },
      }),
    });
  });
}

/** Mock the email preview API */
async function mockStaffEmailPreview(page: Page) {
  await page.route('**/api/admin/staff/preview-email*', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          staff_id: '00000000-0000-0000-0000-000000000001',
          template_key: 'staff_welcome_login',
          email_type: 'welcome',
          recipient: { email: 'jami@forgottenfelines.com', name: 'Jami Knuthson' },
          subject: 'Welcome to FFSC Beacon — set your password',
          body_html: '<div style="font-family: Arial;"><p>Hi Jami,</p><p>Your account is ready.</p><a href="https://atlas.forgottenfelines.com/reset-password?token=PREVIEW_TOKEN">Set your password</a></div>',
        },
      }),
    });
  });
}

/** Mock the send-login-info API */
async function mockSendLoginInfo(page: Page) {
  await page.route('**/api/admin/staff/send-login-info', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { message: 'Email sent to jami@forgottenfelines.com', staff_name: 'Jami Knuthson', email_type: 'welcome' },
      }),
    });
  });
}

// ============================================================================
// Tests: Forgot Password Page
// ============================================================================

test.describe('Forgot Password Page @workflow', () => {
  test('renders email form with branding', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('domcontentloaded');

    if (page.url().includes('/forgot-password')) {
      await expect(page.getByRole('heading', { name: 'Forgot your password?' }).first()).toBeVisible();
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
      await expect(page.getByText('Back to sign in')).toBeVisible();
    }
  });

  test('submits email and shows confirmation', async ({ page }) => {
    await mockForgotPassword(page);
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill('jami@forgottenfelines.com');
    await page.locator('button:has-text("Send reset link")').click();

    await expect(page.locator('text=Check your email')).toBeVisible();
    await expect(page.locator('text=jami@forgottenfelines.com')).toBeVisible();
    await expect(page.locator('text=link expires in 1 hour')).toBeVisible();
  });

  test('try different email resets the form', async ({ page }) => {
    await mockForgotPassword(page);
    await page.goto('/forgot-password');

    await page.getByLabel('Email').fill('jami@forgottenfelines.com');
    await page.locator('button:has-text("Send reset link")').click();
    await expect(page.locator('text=Check your email')).toBeVisible();

    await page.locator('button:has-text("Try a different email")').click();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue('');
  });
});

// ============================================================================
// Tests: Reset Password Page
// ============================================================================

test.describe('Reset Password Page @workflow', () => {
  test('valid token shows password form with staff name', async ({ page }) => {
    await mockResetTokenValidation(page, true, 'Jami Knuthson');
    await page.goto('/reset-password?token=valid-test-token');

    await expect(page.locator('text=Set your password')).toBeVisible();
    await expect(page.locator('text=Welcome, Jami Knuthson')).toBeVisible();
    await expect(page.locator('#new-password')).toBeVisible();
    await expect(page.locator('#confirm-password')).toBeVisible();
    await expect(page.locator('button:has-text("Set password")')).toBeVisible();
  });

  test('invalid/expired token shows error with "Request new link"', async ({ page }) => {
    await mockResetTokenValidation(page, false);
    await page.goto('/reset-password?token=expired-token');

    await expect(page.locator('text=Link expired or invalid')).toBeVisible();
    await expect(page.locator('text=Links expire after 1 hour')).toBeVisible();
    await expect(page.locator('a:has-text("Request a new link")')).toBeVisible();
  });

  test('no token shows expired state', async ({ page }) => {
    await page.goto('/reset-password');

    await expect(page.locator('text=Link expired or invalid')).toBeVisible();
  });

  test('password mismatch shows error', async ({ page }) => {
    await mockResetTokenValidation(page, true);
    await mockResetPasswordSubmit(page);
    await page.goto('/reset-password?token=valid-test-token');

    await page.locator('#new-password').fill('newpassword1');
    await page.locator('#confirm-password').fill('different');
    await page.locator('button:has-text("Set password")').click();

    await expect(page.locator('text=Passwords do not match')).toBeVisible();
  });

  test('password too short shows error', async ({ page }) => {
    await mockResetTokenValidation(page, true);
    await mockResetPasswordSubmit(page);
    await page.goto('/reset-password?token=valid-test-token');

    await page.locator('#new-password').fill('short');
    await page.locator('#confirm-password').fill('short');
    await page.locator('button:has-text("Set password")').click();

    await expect(page.locator('text=at least 8 characters')).toBeVisible();
  });

  test('successful reset shows confirmation and redirects', async ({ page }) => {
    await mockResetTokenValidation(page, true);
    await mockResetPasswordSubmit(page, true);
    await page.goto('/reset-password?token=valid-test-token');

    await page.locator('#new-password').fill('newpassword123');
    await page.locator('#confirm-password').fill('newpassword123');
    await page.locator('button:has-text("Set password")').click();

    await expect(page.locator('text=Password Updated!')).toBeVisible();
  });
});

// ============================================================================
// Tests: Login Page — Forgot Password Link
// ============================================================================

test.describe('Login Page @smoke', () => {
  test('shows "Forgot password?" link', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const forgotLink = page.locator('a[href="/forgot-password"]');
    await expect(forgotLink).toBeVisible();
    await expect(forgotLink).toHaveText('Forgot password?');
  });

  test('forgot password link navigates to /forgot-password', async ({ page }) => {
    await page.goto('/login');
    await page.locator('a[href="/forgot-password"]').click();

    await page.waitForURL('**/forgot-password');
    await expect(page.locator('text=Forgot your password?')).toBeVisible();
  });
});

// ============================================================================
// Tests: Staff Accounts Table
// ============================================================================

test.describe('Staff Accounts Table @workflow', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
    await mockAuthOverview(page);
  });

  test('Accounts tab renders table with auth data', async ({ page }) => {
    await navigateTo(page, '/admin/staff');

    // Click Accounts tab
    await page.locator('button:has-text("Accounts")').click();

    // Verify table headers
    await expect(page.locator('th:has-text("Name")')).toBeVisible();
    await expect(page.locator('th:has-text("Password")')).toBeVisible();
    await expect(page.locator('th:has-text("Last Login")')).toBeVisible();

    // Verify staff data renders
    await expect(page.locator('text=Jami Knuthson')).toBeVisible();
    await expect(page.locator('text=Ben Mis')).toBeVisible();
  });

  test('shows password status badges', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.locator('button:has-text("Accounts")').click();

    // Jami has "Default" password badge
    const jamiRow = page.locator('tr', { has: page.locator('text=Jami Knuthson') });
    await expect(jamiRow.locator('text=Default')).toBeVisible();

    // Ben has "Set" password badge (exact match to avoid matching "Password Reset" etc.)
    const benRow = page.locator('tr', { has: page.locator('text=Ben Mis') });
    await expect(benRow.locator('span', { hasText: /^Set$/ })).toBeVisible();
  });

  test('shows both Welcome Email and Reset Password buttons for all staff', async ({ page }) => {
    await navigateTo(page, '/admin/staff');
    await page.locator('button:has-text("Accounts")').click();

    // Jami (never logged in) has both buttons
    const jamiRow = page.locator('tr', { has: page.locator('text=Jami Knuthson') });
    await expect(jamiRow.locator('button:has-text("Welcome Email")')).toBeVisible();
    await expect(jamiRow.locator('button:has-text("Reset Password")')).toBeVisible();

    // Ben (has logged in) also has both buttons
    const benRow = page.locator('tr', { has: page.locator('text=Ben Mis') });
    await expect(benRow.locator('button:has-text("Welcome Email")')).toBeVisible();
    await expect(benRow.locator('button:has-text("Reset Password")')).toBeVisible();
  });

  test('welcome email button opens preview drawer', async ({ page }) => {
    await mockStaffEmailPreview(page);
    await navigateTo(page, '/admin/staff');
    await page.locator('button:has-text("Accounts")').click();

    const jamiRow = page.locator('tr', { has: page.locator('text=Jami Knuthson') });
    await jamiRow.locator('button:has-text("Welcome Email")').click();

    // Drawer opens with editable fields
    await expect(page.locator('text=Email Jami Knuthson')).toBeVisible();
    await expect(page.locator('input[type="email"]').last()).toHaveValue('jami@forgottenfelines.com');
    await expect(page.locator('input[type="text"]').last()).toHaveValue(/Welcome to FFSC/);
    await expect(page.locator('button:has-text("Send Email")')).toBeVisible();
  });

  test('send email from preview drawer succeeds', async ({ page }) => {
    await mockStaffEmailPreview(page);
    await mockSendLoginInfo(page);
    await navigateTo(page, '/admin/staff');
    await page.locator('button:has-text("Accounts")').click();

    const jamiRow = page.locator('tr', { has: page.locator('text=Jami Knuthson') });
    await jamiRow.locator('button:has-text("Welcome Email")').click();

    await expect(page.locator('text=Email Jami Knuthson')).toBeVisible();
    await page.locator('button:has-text("Send Email")').click();

    // Toast should appear
    await expect(page.locator('text=Email sent to')).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// Tests: API Contract Validation
// ============================================================================

test.describe('Password Reset API Contracts @smoke', () => {
  test('POST /api/auth/forgot-password returns success shape', async ({ page }) => {
    const response = await page.request.post('/api/auth/forgot-password', {
      data: { email: 'nonexistent@example.com' },
    });

    // Always returns 200 (no email enumeration)
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.message).toContain('reset link');
  });

  test('POST /api/auth/forgot-password requires email', async ({ page }) => {
    const response = await page.request.post('/api/auth/forgot-password', {
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test('POST /api/auth/reset-password rejects missing token', async ({ page }) => {
    const response = await page.request.post('/api/auth/reset-password', {
      data: { new_password: 'test1234', confirm_password: 'test1234' },
    });
    expect(response.status()).toBe(400);
  });

  test('POST /api/auth/reset-password rejects short password', async ({ page }) => {
    const response = await page.request.post('/api/auth/reset-password', {
      data: { token: 'fake', new_password: 'short', confirm_password: 'short' },
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error.message).toContain('8 characters');
  });

  test('POST /api/auth/reset-password rejects mismatched passwords', async ({ page }) => {
    const response = await page.request.post('/api/auth/reset-password', {
      data: { token: 'fake', new_password: 'password1', confirm_password: 'password2' },
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error.message).toContain('do not match');
  });

  test('POST /api/auth/reset-password rejects invalid token', async ({ page }) => {
    const response = await page.request.post('/api/auth/reset-password', {
      data: { token: 'invalid-token-that-does-not-exist', new_password: 'password123', confirm_password: 'password123' },
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error.message).toContain('Invalid or expired');
  });

  test('GET /api/auth/reset-password rejects missing token', async ({ page }) => {
    const response = await page.request.get('/api/auth/reset-password');
    expect(response.status()).toBe(400);
  });

  test('GET /api/auth/reset-password rejects invalid token', async ({ page }) => {
    const response = await page.request.get('/api/auth/reset-password?token=bogus');
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error.message).toContain('invalid or has expired');
  });

  test('GET /api/admin/staff/auth-overview returns 200 or 403', async ({ page }) => {
    // Test user may or may not be admin — just verify the endpoint responds correctly
    const response = await page.request.get('/api/admin/staff/auth-overview');
    const status = response.status();
    expect([200, 403]).toContain(status);

    if (status === 200) {
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.staff)).toBe(true);

      if (json.data.staff.length > 0) {
        const row = json.data.staff[0];
        expect(row).toHaveProperty('staff_id');
        expect(row).toHaveProperty('display_name');
        expect(row).toHaveProperty('password_status');
        expect(row).toHaveProperty('last_login');
        expect(row).toHaveProperty('login_count');
        expect(['set', 'default', 'not_set']).toContain(row.password_status);
      }
    } else {
      // 403 = not admin, which is correct behavior
      const json = await response.json();
      expect(json.success).toBe(false);
    }
  });
});
