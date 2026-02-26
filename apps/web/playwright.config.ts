import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables from .env.local (for STAFF_DEFAULT_PASSWORD, etc.)
dotenv.config({ path: '.env.local' });

/**
 * Playwright E2E Test Configuration for Atlas
 *
 * Run tests:
 *   npm run test:e2e                    - Run all tests (skips @real-api)
 *   npm run test:e2e:ui                 - Run with UI mode
 *   npm run test:e2e:headed             - Run with browser visible
 *   INCLUDE_REAL_API=1 npm run test:e2e - Run ALL tests including @real-api
 *
 * Debug:
 *   npm run test:e2e -- --debug
 *
 * Cost control:
 *   Tests tagged with @real-api call the actual Anthropic API and cost money.
 *   By default, these are SKIPPED to prevent accidental API credit burn.
 *   Set INCLUDE_REAL_API=1 to run them (e.g., for weekly capability checks).
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

  // Skip @real-api tests by default
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
