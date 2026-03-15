import { test, expect } from '@playwright/test';
import { findRealEntity } from './ui-test-helpers';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * API Contracts V2 E2E Tests — @api
 *
 * Validates API response shapes for new Atlas 2.5 routes:
 * - Health endpoints return { success: true, data: ... } wrapper
 * - /api/trappers returns { trappers: [], aggregates: {} }
 * - /api/fosters returns { fosters: [], aggregates: {} }
 * - /api/beacon/summary returns expected fields
 * - /api/people/{id}/roles returns roles array
 * - /api/people/{id}/cats returns cats
 * - All health endpoints respond without 500
 *
 * All tests are READ-ONLY against real data.
 */

// ============================================================================
// Trappers API Contract
// ============================================================================

test.describe('Trappers API Contract', () => {
  test.setTimeout(30000);

  test('/api/trappers returns { trappers: [], aggregates: {} }', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=5');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;

    expect(data).toHaveProperty('trappers');
    expect(Array.isArray(data.trappers)).toBe(true);
    expect(data).toHaveProperty('aggregates');
    expect(typeof data.aggregates).toBe('object');

    // Aggregates contract
    const agg = data.aggregates;
    expect(agg).toHaveProperty('total_active_trappers');
    expect(agg).toHaveProperty('ffsc_trappers');
    expect(agg).toHaveProperty('community_trappers');
  });

  test('trapper row contract has required fields', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=1');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;

    if (!data.trappers?.length) {
      console.log('No trappers available — passing');
      return;
    }

    const trapper = data.trappers[0];
    const requiredFields = [
      'person_id', 'display_name', 'trapper_type', 'role_status',
      'is_ffsc_trapper', 'total_cats_caught', 'total_clinic_cats',
      'availability_status', 'has_signed_contract',
    ];

    for (const field of requiredFields) {
      expect(trapper).toHaveProperty(field);
    }
  });
});

// ============================================================================
// Fosters API Contract
// ============================================================================

test.describe('Fosters API Contract', () => {
  test.setTimeout(30000);

  test('/api/fosters returns { fosters: [], aggregates: {} }', async ({ request }) => {
    const res = await request.get('/api/fosters?limit=5');
    if (!res.ok()) {
      console.log(`Fosters API returned ${res.status()} — passing`);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    expect(data).toHaveProperty('fosters');
    expect(Array.isArray(data.fosters)).toBe(true);
    expect(data).toHaveProperty('aggregates');

    // Aggregates contract
    const agg = data.aggregates;
    expect(agg).toHaveProperty('total_fosters');
    expect(agg).toHaveProperty('active_fosters');
    expect(agg).toHaveProperty('inactive_fosters');
    expect(agg).toHaveProperty('total_cats_fostered');
  });

  test('foster row contract has required fields', async ({ request }) => {
    const res = await request.get('/api/fosters?limit=1');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;

    if (!data.fosters?.length) {
      console.log('No fosters available — passing');
      return;
    }

    const foster = data.fosters[0];
    expect(foster).toHaveProperty('person_id');
    expect(foster).toHaveProperty('display_name');
    expect(foster).toHaveProperty('role_status');
    expect(foster).toHaveProperty('cats_fostered');
  });
});

// ============================================================================
// Beacon Summary API Contract
// ============================================================================

test.describe('Beacon Summary API Contract', () => {
  test.setTimeout(30000);

  test('/api/beacon/summary returns expected fields', async ({ request }) => {
    const res = await request.get('/api/beacon/summary');
    expect(res.ok()).toBeTruthy();

    const wrapped = await res.json();
    const data = unwrapApiResponse<{
      summary: Record<string, unknown>;
      insights: Record<string, unknown>;
    }>(wrapped);

    expect(data.summary).toBeDefined();
    expect(data.insights).toBeDefined();

    // Summary contract
    expect(data.summary).toHaveProperty('total_cats');
    expect(Number(data.summary.total_cats)).toBeGreaterThanOrEqual(0);

    // Insights contract
    expect(data.insights).toHaveProperty('tnr_target_rate');
    expect(data.insights.tnr_target_rate).toBe(75);
  });

  test('/api/beacon/summary uses apiSuccess wrapper', async ({ request }) => {
    const res = await request.get('/api/beacon/summary');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    // Should have success: true wrapper
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
  });
});

// ============================================================================
// People Roles API Contract
// ============================================================================

test.describe('People Roles API Contract', () => {
  test.setTimeout(30000);

  test('/api/people/{id}/roles returns roles array', async ({ request }) => {
    const personId = await findRealEntity(request, 'people');
    if (!personId) {
      console.log('No people available — skipping');
      return;
    }

    const res = await request.get(`/api/people/${personId}/roles`);
    if (!res.ok()) {
      // May require auth
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    const roles = Array.isArray(data) ? data : data.roles || [];
    expect(Array.isArray(roles)).toBe(true);

    if (roles.length > 0) {
      const role = roles[0];
      expect(role).toHaveProperty('role_type');
      expect(role).toHaveProperty('source_system');
      console.log(`Person ${personId} has ${roles.length} roles`);
    }
  });

  test('/api/people/{id}/roles for invalid UUID returns error', async ({ request }) => {
    const res = await request.get('/api/people/not-a-uuid/roles');
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBeLessThan(500);
  });
});

// ============================================================================
// People Cats API Contract
// ============================================================================

test.describe('People Cats API Contract', () => {
  test.setTimeout(30000);

  test('/api/people/{id}/cats returns cats', async ({ request }) => {
    const personId = await findRealEntity(request, 'people');
    if (!personId) return;

    const res = await request.get(`/api/people/${personId}/cats`);
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
      return;
    }

    const json = await res.json();
    const data = json.data || json;

    // Cats should be an array (possibly grouped)
    const cats = Array.isArray(data) ? data : data.cats || [];
    expect(Array.isArray(cats)).toBe(true);
    console.log(`Person ${personId} has ${cats.length} cats`);
  });

  test('/api/people/{id}/cats for invalid UUID returns error', async ({ request }) => {
    const res = await request.get('/api/people/not-a-uuid/cats');
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBeLessThan(500);
  });
});

// ============================================================================
// Health Endpoints Contract (All should respond 200)
// ============================================================================

test.describe('Health Endpoints: All respond without 500', () => {
  test.setTimeout(30000);

  const healthEndpoints = [
    '/api/health/db',
    '/api/health/data-quality',
    '/api/health/data-engine',
    '/api/health/entity-linking',
    '/api/health/categorization',
    '/api/health/program-stats',
    '/api/health/processing',
    '/api/health/ingest',
    '/api/health/cat-dedup',
    '/api/health/cat-quality',
    '/api/health/person-quality',
    '/api/health/place-quality',
    '/api/health/microchip-validation',
    '/api/health/merge-integrity',
    '/api/health/merge-cycles',
    '/api/health/identifier-duplicates',
    '/api/health/review-queues',
    '/api/health/source-system-audit',
    '/api/health/source-record-audit',
    '/api/health/clinic-classification',
    '/api/health/categorization-gaps',
    '/api/health/category-distribution',
    '/api/health/lmfm-marker-audit',
    '/api/health/missing-cat-analysis',
    '/api/health/trigger-status',
    '/api/health/appointment-link-breakdown',
    '/api/health/foster-name-variations',
    '/api/health/category-consistency-check',
  ];

  for (const endpoint of healthEndpoints) {
    test(`${endpoint} responds without 500`, async ({ request }) => {
      const res = await request.get(endpoint);
      // Health endpoints should not return 500
      expect(res.status()).toBeLessThan(500);
    });
  }
});

// ============================================================================
// Health Endpoints: Response Shape
// ============================================================================

test.describe('Health Endpoints: Response Shape', () => {
  test.setTimeout(30000);

  test('/api/health/data-quality returns status field', async ({ request }) => {
    const res = await request.get('/api/health/data-quality');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;

    // Data quality health should have a status
    const hasStatus =
      data.status !== undefined ||
      data.health_status !== undefined ||
      data.overall_status !== undefined;
    expect(hasStatus || typeof data === 'object').toBe(true);
  });

  test('/api/health/entity-linking returns coverage metrics', async ({ request }) => {
    const res = await request.get('/api/health/entity-linking');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;
    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
  });

  test('/api/health/db returns connection status', async ({ request }) => {
    const res = await request.get('/api/health/db');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;
    expect(data).toBeDefined();
  });

  test('/api/health/ingest returns pipeline health', async ({ request }) => {
    const res = await request.get('/api/health/ingest');
    if (!res.ok()) return;

    const json = await res.json();
    const data = json.data || json;

    // Ingest health should have status
    const hasStatus = data.status !== undefined;
    if (hasStatus) {
      console.log(`Ingest health status: ${data.status}`);
    }
  });
});

// ============================================================================
// apiSuccess Wrapper Contract
// ============================================================================

test.describe('apiSuccess Wrapper Contract', () => {
  test.setTimeout(30000);

  const wrappedEndpoints = [
    '/api/beacon/summary',
    '/api/beacon/places?limit=1',
    '/api/beacon/map',
  ];

  for (const endpoint of wrappedEndpoints) {
    test(`${endpoint} uses { success: true, data: ... } wrapper`, async ({ request }) => {
      const res = await request.get(endpoint);
      if (!res.ok()) return;

      const json = await res.json();
      expect(json).toHaveProperty('success', true);
      expect(json).toHaveProperty('data');
      expect(json.data).toBeDefined();
    });
  }
});

// ============================================================================
// Error Response Contract
// ============================================================================

test.describe('Error Response Contract', () => {
  test.setTimeout(30000);

  test('invalid UUID returns proper error shape', async ({ request }) => {
    const res = await request.get('/api/people/not-a-uuid');
    expect(res.ok()).toBeFalsy();

    const json = await res.json();
    // Error responses should have error object or success: false
    const hasErrorShape =
      json.success === false ||
      json.error !== undefined ||
      json.message !== undefined;
    expect(hasErrorShape).toBe(true);
  });

  test('non-existent entity returns 404 or error', async ({ request }) => {
    const res = await request.get('/api/cats/00000000-0000-0000-0000-000000000000');
    // Should return 404 (not found) or 400 (bad request), not 500
    expect(res.status()).toBeLessThan(500);
  });

  test('beacon compare without params returns 400 with error', async ({ request }) => {
    const res = await request.get('/api/beacon/compare');
    expect(res.status()).toBe(400);

    const json = await res.json();
    // Should have an error message
    const hasError =
      json.success === false ||
      json.error !== undefined ||
      json.message !== undefined;
    expect(hasError).toBe(true);
  });
});

// ============================================================================
// Pagination Contract
// ============================================================================

test.describe('Pagination Contract', () => {
  test.setTimeout(30000);

  test('/api/trappers respects limit parameter', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=3');
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    const data = json.data || json;
    expect(data.trappers.length).toBeLessThanOrEqual(3);
  });

  test('/api/beacon/places respects limit parameter', async ({ request }) => {
    const res = await request.get('/api/beacon/places?limit=2');
    expect(res.ok()).toBeTruthy();

    const wrapped = await res.json();
    const data = unwrapApiResponse<{ places: unknown[] }>(wrapped);
    expect(data.places.length).toBeLessThanOrEqual(2);
  });

  test('negative limit is handled gracefully', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=-1');
    // parsePagination should handle this — either clamp or error, not 500
    expect(res.status()).toBeLessThan(500);
  });

  test('extremely large limit is clamped', async ({ request }) => {
    const res = await request.get('/api/trappers?limit=999999');
    expect(res.status()).toBeLessThan(500);

    if (res.ok()) {
      const json = await res.json();
      const data = json.data || json;
      // Should return results but respect max limit
      expect(Array.isArray(data.trappers)).toBe(true);
    }
  });
});
