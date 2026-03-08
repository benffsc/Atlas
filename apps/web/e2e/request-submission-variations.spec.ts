/**
 * Request Submission Variations (FFS-175 Regression Tests)
 *
 * Tests all field variations for POST /api/requests to prevent regressions
 * from the three FFS-175 bugs:
 *   1. Missing DB columns: best_trapping_time, ownership_status, important_notes
 *   2. peak_count input min="1" blocking 0 values
 *   3. Numeric fields using || null silently converting 0 to null
 *
 * All tests tagged @real-api — skipped by default, run with INCLUDE_REAL_API=1.
 * Cleanup uses POST /api/requests/[id]/archive with reason: "test_data".
 */
import { test, expect, APIRequestContext } from '@playwright/test';
import { findRealEntity } from './ui-test-helpers';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Archive a request for cleanup. Logs but doesn't throw on failure. */
async function archiveRequest(request: APIRequestContext, id: string): Promise<boolean> {
  try {
    const res = await request.post(`/api/requests/${id}/archive`, {
      data: { reason: 'test_data', notes: 'E2E test cleanup' },
    });
    if (res.ok()) return true;

    // Already archived is fine
    const body = await res.json().catch(() => null);
    if (res.status() === 400 && body?.error?.message?.includes('already archived')) return true;

    console.warn(`Archive failed for ${id}: ${res.status()} ${JSON.stringify(body)}`);
    return false;
  } catch (err) {
    console.warn(`Archive error for ${id}:`, err);
    return false;
  }
}

/** Create a request and return its ID. Throws on failure. */
async function createRequest(
  request: APIRequestContext,
  data: Record<string, unknown>
): Promise<{ id: string; response: Record<string, unknown> }> {
  const res = await request.post('/api/requests', { data });
  if (!res.ok()) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`POST /api/requests failed ${res.status()}: ${JSON.stringify(body)}`);
  }
  const json = await res.json();
  expect(json.success).toBe(true);
  // apiSuccess wraps response: { success, data: { request_id, ... } }
  const requestId = json.data?.request_id ?? json.request_id;
  expect(requestId, `No request_id in response: ${JSON.stringify(json)}`).toBeDefined();
  return { id: requestId, response: json.data ?? json };
}

/** Fetch a request by ID and return its data. */
async function fetchRequest(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const res = await request.get(`/api/requests/${id}`);
  expect(res.ok(), `GET /api/requests/${id} failed: ${res.status()}`).toBeTruthy();
  const json = await res.json();
  // Handle both wrapped { data: {...} } and unwrapped formats
  return json.data || json;
}

// --------------------------------------------------------------------------
// Test Suite
// --------------------------------------------------------------------------

test.describe('Request Submission Variations @real-api', () => {
  let testPlaceId: string;
  const createdIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    const placeId = await findRealEntity(request, 'places');
    test.skip(!placeId, 'No real place available for testing');
    testPlaceId = placeId!;
  });

  test.afterEach(async ({ request }) => {
    // Archive all requests created during this test
    while (createdIds.length > 0) {
      const id = createdIds.pop()!;
      await archiveRequest(request, id);
    }
  });

  // --------------------------------------------------------------------------
  // 1. Minimal request
  // --------------------------------------------------------------------------
  test('Minimal request — only place_id + summary + internal_notes', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Minimal Request - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - minimal test',
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.request_id).toBe(id);
    expect(data.status).toBe('new');
  });

  // --------------------------------------------------------------------------
  // 2. Zero-value numerics (FFS-175 regression)
  // --------------------------------------------------------------------------
  test('Zero-value numerics persist as 0, not null (FFS-175)', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Zero Numerics - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - zero numerics',
      estimated_cat_count: 0,
      peak_count: 0,
      total_cats_reported: 0,
      eartip_count: 0,
      kitten_count: 0,
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.estimated_cat_count).toBe(0);
    expect(data.peak_count).toBe(0);
    expect(data.total_cats_reported).toBe(0);
    // eartip_count is returned as eartip_count by the GET endpoint
    expect(data.eartip_count).toBe(0);
    expect(data.kitten_count).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 3. Trapping logistics columns (FFS-175 regression)
  // --------------------------------------------------------------------------
  test('Trapping logistics columns save without error (FFS-175)', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Trapping Logistics - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - trapping logistics',
      best_trapping_time: 'mornings',
      ownership_status: 'stray',
      important_notes: ['withhold_food', 'urgent'],
    });
    createdIds.push(id);

    // Verify the request was created successfully — the POST didn't crash
    const data = await fetchRequest(request, id);
    expect(data.request_id).toBe(id);
    // Note: GET endpoint currently returns NULL for ownership_status and
    // important_notes (hardcoded NULL aliases in SELECT). The key test is that
    // the POST succeeded without a "column does not exist" error.
  });

  // --------------------------------------------------------------------------
  // 4. Full field coverage
  // --------------------------------------------------------------------------
  test('Full field coverage — all major columns populated', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      // Status & Priority
      status: 'new',
      priority: 'normal',
      // Location
      property_type: 'private_home',
      location_description: 'E2E test location description',
      // Cat Info
      estimated_cat_count: 5,
      total_cats_reported: 7,
      peak_count: 10,
      count_confidence: 'good_estimate',
      colony_duration: 'over_2_years',
      awareness_duration: 'months',
      eartip_count: 2,
      eartip_estimate: 'some',
      cats_are_friendly: false,
      fixed_status: 'unknown',
      cat_name: 'Test Colony',
      cat_description: 'Mix of colors',
      handleability: 'unhandleable_trap',
      // Kittens
      has_kittens: true,
      kitten_count: 3,
      kitten_age_estimate: '4-8 weeks',
      kitten_behavior: 'shy',
      mom_present: 'yes',
      kitten_contained: 'no',
      mom_fixed: 'no',
      can_bring_in: 'no',
      // Feeding
      is_being_fed: true,
      feeder_name: 'Test Feeder',
      feeding_frequency: 'daily',
      feeding_location: 'backyard',
      feeding_time: 'evening',
      best_times_seen: 'dusk',
      // Medical
      has_medical_concerns: false,
      // Property & Access
      is_property_owner: true,
      has_property_access: true,
      access_notes: 'Gate code 1234',
      permission_status: 'granted',
      dogs_on_site: 'no',
      trap_savvy: 'no',
      previous_tnr: 'no',
      traps_overnight_safe: true,
      access_without_contact: false,
      // Third Party
      is_third_party_report: false,
      // Location Meta
      county: 'Sonoma',
      is_emergency: false,
      // Triage
      triage_category: 'standard',
      received_by: 'E2E Test',
      // Trapping logistics (FFS-151 / FFS-175)
      best_trapping_time: 'evenings',
      ownership_status: 'community',
      important_notes: ['withhold_food'],
      // Notes
      summary: `E2E Full Field Test - ${Date.now()}`,
      notes: 'Testing all fields',
      internal_notes: 'E2E_TEST_MARKER - full field test',
      // Provenance
      created_by: 'e2e_test',
    });
    createdIds.push(id);

    // Verify key fields persisted
    const data = await fetchRequest(request, id);
    expect(data.estimated_cat_count).toBe(5);
    expect(data.total_cats_reported).toBe(7);
    expect(data.peak_count).toBe(10);
    expect(data.has_kittens).toBe(true);
    expect(data.kitten_count).toBe(3);
    expect(data.is_being_fed).toBe(true);
    expect(data.is_property_owner).toBe(true);
    expect(data.county).toBe('Sonoma');
    expect(data.priority).toBe('normal');
    expect(data.cats_are_friendly).toBe(false);
    expect(data.dogs_on_site).toBe('no');
  });

  // --------------------------------------------------------------------------
  // 5. Kittens scenario
  // --------------------------------------------------------------------------
  test('Kittens scenario — all kitten fields', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Kittens Scenario - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - kittens',
      has_kittens: true,
      kitten_count: 4,
      kitten_age_estimate: '4-8 weeks',
      kitten_behavior: 'shy',
      mom_present: 'yes',
      mom_fixed: 'no',
      can_bring_in: 'no',
      kitten_contained: 'no',
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.has_kittens).toBe(true);
    expect(data.kitten_count).toBe(4);
    expect(data.kitten_age_estimate).toBe('4-8 weeks');
    expect(data.kitten_behavior).toBe('shy');
    expect(data.mom_present).toBe('yes');
    expect(data.mom_fixed).toBe('no');
    expect(data.can_bring_in).toBe('no');
    expect(data.kitten_contained).toBe('no');
  });

  // --------------------------------------------------------------------------
  // 6. Feeding details
  // --------------------------------------------------------------------------
  test('Feeding details — all feeding fields', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Feeding Details - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - feeding',
      is_being_fed: true,
      feeder_name: 'Jane Doe',
      feeding_frequency: 'twice_daily',
      feeding_location: 'front porch',
      feeding_time: 'morning and evening',
      best_times_seen: 'early morning',
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.is_being_fed).toBe(true);
    expect(data.feeder_name).toBe('Jane Doe');
    expect(data.feeding_frequency).toBe('twice_daily');
    expect(data.best_times_seen).toBe('early morning');
  });

  // --------------------------------------------------------------------------
  // 7. Medical concerns
  // --------------------------------------------------------------------------
  test('Medical concerns with emergency flag', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Medical Concerns - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - medical',
      has_medical_concerns: true,
      medical_description: 'Injured cat with limp, possible broken leg',
      is_emergency: true,
      priority: 'urgent',
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.has_medical_concerns).toBe(true);
    expect(data.medical_description).toBe('Injured cat with limp, possible broken leg');
    expect(data.is_emergency).toBe(true);
    expect(data.priority).toBe('urgent');
  });

  // --------------------------------------------------------------------------
  // 8. Quick Complete mode with zero numerics in completion_data
  // --------------------------------------------------------------------------
  test('Quick Complete mode — completion_data with zero numerics', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Quick Complete - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - quick complete',
      entry_mode: 'complete',
      status: 'completed',
      completion_data: {
        resolution_outcome: 'cats_altered',
        completion_notes: 'All cats already altered',
        final_cat_count: 0,
        eartips_observed: 0,
        cats_altered_today: 0,
        completion_date: new Date().toISOString().split('T')[0],
        completed_by: 'E2E Test',
      },
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.entry_mode).toBe('complete');
    // completion_data should preserve zero values (the ?? null fix)
    if (data.completion_data) {
      const cd =
        typeof data.completion_data === 'string'
          ? JSON.parse(data.completion_data as string)
          : data.completion_data;
      expect(cd.final_cat_count).toBe(0);
      expect(cd.eartips_observed).toBe(0);
      expect(cd.cats_altered_today).toBe(0);
    }
  });

  // --------------------------------------------------------------------------
  // 9. Third party report
  // --------------------------------------------------------------------------
  test('Third party report with different requester vs location', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Third Party Report - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - third party',
      is_third_party_report: true,
      third_party_relationship: 'neighbor',
      requester_is_site_contact: false,
      raw_requester_name: 'E2E Reporter',
      raw_requester_phone: '707-555-0100',
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.is_third_party_report).toBe(true);
    expect(data.third_party_relationship).toBe('neighbor');
    expect(data.requester_is_site_contact).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 10. Property authority variations
  // --------------------------------------------------------------------------
  test('Permission status variations', async ({ request }) => {
    const permissionValues = ['granted', 'pending', 'denied', 'unknown'] as const;

    for (const permission of permissionValues) {
      const { id } = await createRequest(request, {
        place_id: testPlaceId,
        summary: `E2E Permission ${permission} - ${Date.now()}`,
        internal_notes: 'E2E_TEST_MARKER - permission',
        permission_status: permission,
      });
      createdIds.push(id);

      const data = await fetchRequest(request, id);
      expect(data.permission_status).toBe(permission);
    }
  });

  test('Property type variations', async ({ request }) => {
    const propertyTypes = [
      'private_home',
      'apartment_complex',
      'business',
      'public_park',
      'mobile_home_park',
    ] as const;

    for (const propType of propertyTypes) {
      const { id } = await createRequest(request, {
        place_id: testPlaceId,
        summary: `E2E PropType ${propType} - ${Date.now()}`,
        internal_notes: 'E2E_TEST_MARKER - property type',
        property_type: propType,
      });
      createdIds.push(id);

      const data = await fetchRequest(request, id);
      expect(data.property_type).toBe(propType);
    }
  });

  // --------------------------------------------------------------------------
  // 11. Colony & cat detail fields
  // --------------------------------------------------------------------------
  test('Colony and cat detail fields', async ({ request }) => {
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Colony Details - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - colony details',
      colony_duration: 'under_1_month',
      awareness_duration: 'weeks',
      count_confidence: 'exact',
      cats_are_friendly: true,
      fixed_status: 'none_fixed',
      handleability: 'friendly_carrier',
      trap_savvy: 'yes',
      dogs_on_site: 'yes',
      previous_tnr: 'yes',
      estimated_cat_count: 12,
      eartip_count: 3,
    });
    createdIds.push(id);

    const data = await fetchRequest(request, id);
    expect(data.colony_duration).toBe('under_1_month');
    expect(data.count_confidence).toBe('exact');
    expect(data.cats_are_friendly).toBe(true);
    expect(data.handleability).toBe('friendly_carrier');
    expect(data.trap_savvy).toBe('yes');
    expect(data.dogs_on_site).toBe('yes');
    expect(data.previous_tnr).toBe('yes');
    expect(data.estimated_cat_count).toBe(12);
    expect(data.eartip_count).toBe(3);
  });

  // --------------------------------------------------------------------------
  // 12. Request purpose and case info
  // --------------------------------------------------------------------------
  test('Request purpose variations', async ({ request }) => {
    const purposes = ['tnr', 'wellness', 'rescue', 'other'] as const;

    for (const purpose of purposes) {
      const { id } = await createRequest(request, {
        place_id: testPlaceId,
        summary: `E2E Purpose ${purpose} - ${Date.now()}`,
        internal_notes: 'E2E_TEST_MARKER - purpose',
        request_purpose: purpose,
        notes: `Case notes for ${purpose} purpose testing`,
      });
      createdIds.push(id);

      const data = await fetchRequest(request, id);
      expect(data.request_purpose).toBe(purpose);
    }
  });

  // --------------------------------------------------------------------------
  // 13. Archive endpoint verification
  // --------------------------------------------------------------------------
  test('Archive endpoint works for test_data cleanup', async ({ request }) => {
    // Create a request
    const { id } = await createRequest(request, {
      place_id: testPlaceId,
      summary: `E2E Archive Test - ${Date.now()}`,
      internal_notes: 'E2E_TEST_MARKER - archive test',
    });
    // Don't push to createdIds — we'll archive manually in this test

    // Archive it
    const archiveRes = await request.post(`/api/requests/${id}/archive`, {
      data: { reason: 'test_data', notes: 'E2E archive verification' },
    });
    expect(archiveRes.ok()).toBeTruthy();
    const archiveData = await archiveRes.json();
    expect(archiveData.success).toBe(true);
    expect(archiveData.data?.archived || archiveData.archived).toBe(true);

    // Verify it's archived
    const fetched = await fetchRequest(request, id);
    expect(fetched.is_archived).toBe(true);
    expect(fetched.archive_reason).toBe('test_data');

    // Re-archive should return 400
    const reArchiveRes = await request.post(`/api/requests/${id}/archive`, {
      data: { reason: 'test_data' },
    });
    expect(reArchiveRes.status()).toBe(400);
  });
});
