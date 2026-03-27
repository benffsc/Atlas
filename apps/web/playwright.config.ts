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
 * Tippy test files (14 total):
 *   - tippy-reliability.spec.ts          ← STREAMING PATH + curated demo questions
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
 * VISION API TESTS - SKIPPED BY DEFAULT DUE TO API COSTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests tagged with @vision-api use Claude Vision to semantically verify UI.
 * These are SKIPPED by default (~$0.003-0.01 per verification).
 *
 * To run vision tests:
 *   INCLUDE_VISION_API=1 npm run test:e2e -- --grep @vision-api
 *
 * Vision test files:
 *   - vision-verification.spec.ts (page structure, accessibility, business rules)
 *
 * Vision tests verify:
 *   - Correct page structure and layout
 *   - Expected UI elements are present
 *   - Data displays according to business rules
 *   - Known gaps are handled properly (not flagged as errors)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CLEANUP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Test data cleanup runs automatically after tests via globalTeardown.
 * Manual cleanup: node -e "require('./e2e/global-teardown').default()"
 */

// Build grepInvert pattern based on which API tests to include
// By default, skip both @real-api (Tippy) and @vision-api tests to avoid API costs
function buildGrepInvert(): RegExp | undefined {
  const skipPatterns: string[] = [];

  if (!process.env.INCLUDE_REAL_API && process.env.VCR_MODE !== 'replay') {
    skipPatterns.push('@real-api');
  }
  if (!process.env.INCLUDE_VISION_API) {
    skipPatterns.push('@vision-api');
  }

  if (skipPatterns.length === 0) {
    return undefined;
  }

  return new RegExp(skipPatterns.join('|'));
}

const grepInvert = buildGrepInvert();

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

  // Skip @real-api and @vision-api tests by default (API costs)
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
