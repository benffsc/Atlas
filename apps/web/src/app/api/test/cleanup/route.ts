import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * Test Cleanup API
 *
 * POST /api/test/cleanup
 *
 * Removes all E2E test records from the database.
 * Only works in development/test environments.
 *
 * SAFETY: Only deletes records with 'e2e-test-' prefix or 'e2e_test' source_system
 */

const ALLOWED_ENVIRONMENTS = ['development', 'test'];

export async function POST(request: Request) {
  // Safety check: Only allow in dev/test
  const env = process.env.NODE_ENV || 'development';
  if (!ALLOWED_ENVIRONMENTS.includes(env)) {
    return NextResponse.json(
      { error: 'Test cleanup only allowed in development/test environments' },
      { status: 403 }
    );
  }

  // Verify authorization header
  const authHeader = request.headers.get('Authorization');
  const expectedToken = process.env.E2E_TEST_TOKEN || 'e2e-test-token-dev';

  if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { error: 'Invalid test authorization token' },
      { status: 401 }
    );
  }

  try {
    const results: Record<string, number> = {};

    // Clean up test submissions
    const submissionsResult = await query(`
      DELETE FROM ops.intake_submissions
      WHERE submission_id LIKE 'e2e-test-%'
         OR email LIKE 'e2e-%@test.example.com'
      RETURNING submission_id
    `);
    results.submissions_deleted = submissionsResult.rowCount || 0;

    // Clean up test requests
    const requestsResult = await query(`
      DELETE FROM ops.requests
      WHERE source_system = 'e2e_test'
         OR request_id LIKE 'e2e-test-%'
      RETURNING request_id
    `);
    results.requests_deleted = requestsResult.rowCount || 0;

    // Clean up test places
    const placesResult = await query(`
      DELETE FROM sot.places
      WHERE source_system = 'e2e_test'
         OR place_id LIKE 'e2e-test-%'
      RETURNING place_id
    `);
    results.places_deleted = placesResult.rowCount || 0;

    // Clean up test people
    const peopleResult = await query(`
      DELETE FROM sot.people
      WHERE source_system = 'e2e_test'
         OR person_id LIKE 'e2e-test-%'
      RETURNING person_id
    `);
    results.people_deleted = peopleResult.rowCount || 0;

    // Clean up test cats
    const catsResult = await query(`
      DELETE FROM sot.cats
      WHERE source_system = 'e2e_test'
         OR cat_id LIKE 'e2e-test-%'
      RETURNING cat_id
    `);
    results.cats_deleted = catsResult.rowCount || 0;

    return NextResponse.json({
      success: true,
      message: 'Test data cleaned up',
      results,
      environment: env,
    });

  } catch (error) {
    console.error('Test cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to clean up test data' },
      { status: 500 }
    );
  }
}

// GET: Check how many test records exist
export async function GET(request: Request) {
  const env = process.env.NODE_ENV || 'development';
  if (!ALLOWED_ENVIRONMENTS.includes(env)) {
    return NextResponse.json(
      { error: 'Test API only allowed in development/test environments' },
      { status: 403 }
    );
  }

  try {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM ops.intake_submissions WHERE submission_id LIKE 'e2e-test-%' OR email LIKE 'e2e-%@test.example.com') as test_submissions,
        (SELECT COUNT(*) FROM ops.requests WHERE source_system = 'e2e_test' OR request_id LIKE 'e2e-test-%') as test_requests,
        (SELECT COUNT(*) FROM sot.places WHERE source_system = 'e2e_test' OR place_id LIKE 'e2e-test-%') as test_places,
        (SELECT COUNT(*) FROM sot.people WHERE source_system = 'e2e_test' OR person_id LIKE 'e2e-test-%') as test_people,
        (SELECT COUNT(*) FROM sot.cats WHERE source_system = 'e2e_test' OR cat_id LIKE 'e2e-test-%') as test_cats
    `);

    return NextResponse.json({
      success: true,
      test_records: result.rows[0],
      environment: env,
    });

  } catch (error) {
    console.error('Test count error:', error);
    return NextResponse.json(
      { error: 'Failed to count test data' },
      { status: 500 }
    );
  }
}
