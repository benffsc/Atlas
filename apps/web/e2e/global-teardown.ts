/**
 * Global Teardown - Runs after ALL tests complete
 *
 * Cleans up test junk data from the database to prevent accumulation.
 */

import { CLEANUP_QUERIES } from './fixtures/test-data';

async function globalTeardown() {
  // Only run cleanup if we have a database connection
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('[Teardown] No DATABASE_URL - skipping cleanup');
    return;
  }

  // Skip cleanup in CI (ephemeral DB) unless explicitly requested
  if (process.env.CI && !process.env.CLEANUP_TEST_DATA) {
    console.log('[Teardown] CI detected - skipping cleanup (set CLEANUP_TEST_DATA=1 to force)');
    return;
  }

  console.log('[Teardown] Cleaning up test data...');

  try {
    // Dynamic import to avoid issues if pg isn't available
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: dbUrl });

    let totalDeleted = 0;

    for (const query of CLEANUP_QUERIES) {
      try {
        const result = await pool.query(query);
        const count = result.rowCount || 0;
        if (count > 0) {
          console.log(`  [Cleanup] Deleted ${count} records: ${query.slice(0, 50)}...`);
          totalDeleted += count;
        }
      } catch (err) {
        // Some queries may fail if tables don't exist - that's OK
        console.log(`  [Cleanup] Query skipped: ${(err as Error).message.slice(0, 50)}`);
      }
    }

    await pool.end();

    if (totalDeleted > 0) {
      console.log(`[Teardown] Cleaned up ${totalDeleted} total test records`);
    } else {
      console.log('[Teardown] No test data to clean up');
    }
  } catch (err) {
    console.error('[Teardown] Cleanup failed:', err);
    // Don't throw - cleanup failures shouldn't fail the test run
  }
}

export default globalTeardown;
