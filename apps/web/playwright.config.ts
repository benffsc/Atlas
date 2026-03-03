import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables from .env.local (for STAFF_DEFAULT_PASSWORD, etc.)
dotenv.config({ path: '.env.local' });

/**
 * Playwright E2E Test Configuration for Atlas
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RUN COMMANDS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   npm run test:e2e                    - Run all tests (skips @real-api)
 *   npm run test:e2e:ui                 - Run with UI mode
 *   npm run test:e2e:headed             - Run with browser visible
 *   npm run test:e2e:visual             - Run visual regression tests only
 *   npm run test:e2e:ci                 - CI mode (no Tippy, cleanup enabled)
 *
 * Debug:
 *   npm run test:e2e -- --debug
 *
 * Update visual snapshots:
 *   npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TIPPY/AI TESTS - SKIPPED BY DEFAULT DUE TO API COSTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests tagged with @real-api call the Anthropic API and incur costs.
 * These are SKIPPED by default to prevent accidental API credit burn.
 *
 * To run Tippy tests (when ready to pay for API calls):
 *   INCLUDE_REAL_API=1 npm run test:e2e
 *
 * Tippy test files (13 total):
 *   - tippy-capabilities.spec.ts
 *   - tippy-accuracy-verification.spec.ts
 *   - tippy-complex-queries.spec.ts
 *   - tippy-cross-source-stress.spec.ts
 *   - tippy-cross-source.spec.ts
 *   - tippy-edge-cases.spec.ts
 *   - tippy-expected-gaps.spec.ts
 *   - tippy-human-questions.spec.ts
 *   - tippy-identity-resolution.spec.ts
 *   - tippy-infrastructure.spec.ts
 *   - tippy-performance.spec.ts
 *   - tippy-staff-workflows.spec.ts
 *   - data-quality-tippy.spec.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CLEANUP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Test data cleanup runs automatically after tests via globalTeardown.
 * Manual cleanup: node -e "require('./e2e/global-teardown').default()"
 */

// Skip @real-api tests by default to avoid burning Anthropic API credits
const grepInvert = process.env.INCLUDE_REAL_API ? undefined : /@real-api/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // Clean up test data after all tests complete
  globalTeardown: './e2e/global-teardown.ts',

  // Skip @real-api tests by default (Tippy tests cost money)
  grepInvert,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Auth setup runs once before all tests, saves session state
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Reuse auth state from setup (cookies + localStorage)
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Start dev server before tests (local development)
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
