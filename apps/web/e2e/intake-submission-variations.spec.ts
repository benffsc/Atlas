/**
 * Intake Submission Variations (E2E Tests)
 *
 * Tests all field variations for POST /api/intake (creation) and
 * POST /api/intake/convert (intake-to-request conversion) to prevent
 * regressions from bugs discovered during audit:
 *   1. Numeric fields using || null silently converting 0 to null
 *   2. Missing UUID validation on convert endpoint
 *
 * All tests tagged @real-api — skipped by default, run with INCLUDE_REAL_API=1.
 * Cleanup uses POST /api/intake/decline with reason_code: "spam".
 */
import { test, expect, APIRequestContext } from '@playwright/test';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Create an intake and return its submission_id. Throws on failure. */
async function createIntake(
  request: APIRequestContext,
  data: Record<string, unknown>
): Promise<{ id: string; response: Record<string, unknown> }> {
  const res = await request.post('/api/intake', { data });
  if (!res.ok()) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`POST /api/intake failed ${res.status()}: ${JSON.stringify(body)}`);
  }
  const json = await res.json();
  expect(json.success).toBe(true);
  const submissionId = json.data?.submission_id ?? json.submission_id;
  expect(submissionId, `No submission_id in response: ${JSON.stringify(json)}`).toBeDefined();
  return { id: submissionId, response: json.data ?? json };
}

/** Fetch an intake by ID and return the submission data. */
async function fetchIntake(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const res = await request.get(`/api/intake/queue/${id}`);
  expect(res.ok(), `GET /api/intake/queue/${id} failed: ${res.status()}`).toBeTruthy();
  const json = await res.json();
  // apiSuccess wraps as { success, data: { submission, matchedPerson } }
  const wrapper = json.data || json;
  return wrapper.submission || wrapper;
}

/** Convert an intake to a request. Returns request_id. */
async function convertIntake(
  request: APIRequestContext,
  submissionId: string,
  convertedBy = 'e2e_test'
): Promise<string> {
  const res = await request.post('/api/intake/convert', {
    data: { submission_id: submissionId, converted_by: convertedBy },
  });
  if (!res.ok()) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`POST /api/intake/convert failed ${res.status()}: ${JSON.stringify(body)}`);
  }
  const json = await res.json();
  expect(json.success).toBe(true);
  const requestId = json.data?.request_id ?? json.request_id;
  expect(requestId, `No request_id in convert response: ${JSON.stringify(json)}`).toBeDefined();
  return requestId;
}

/** Decline an intake for cleanup. Logs but doesn't throw on failure. */
async function declineIntake(request: APIRequestContext, id: string): Promise<boolean> {
  try {
    const res = await request.post('/api/intake/decline', {
      data: { submission_id: id, reason_code: 'spam', reason_notes: 'E2E test cleanup' },
    });
    if (res.ok()) return true;
    const body = await res.json().catch(() => null);
    console.warn(`Decline failed for ${id}: ${res.status()} ${JSON.stringify(body)}`);
    return false;
  } catch (err) {
    console.warn(`Decline error for ${id}:`, err);
    return false;
  }
}

/** Archive a request for cleanup. Logs but doesn't throw on failure. */
async function archiveRequest(request: APIRequestContext, id: string): Promise<boolean> {
  try {
    const res = await request.post(`/api/requests/${id}/archive`, {
      data: { reason: 'test_data', notes: 'E2E test cleanup' },
    });
    if (res.ok()) return true;
    const body = await res.json().catch(() => null);
    if (res.status() === 400 && body?.error?.message?.includes('already archived')) return true;
    console.warn(`Archive failed for ${id}: ${res.status()} ${JSON.stringify(body)}`);
    return false;
  } catch (err) {
    console.warn(`Archive error for ${id}:`, err);
    return false;
  }
}

/** Fetch a request by ID. */
async function fetchRequest(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const res = await request.get(`/api/requests/${id}`);
  expect(res.ok(), `GET /api/requests/${id} failed: ${res.status()}`).toBeTruthy();
  const json = await res.json();
  return json.data || json;
}

// --------------------------------------------------------------------------
// Base payload
// --------------------------------------------------------------------------

const BASE_INTAKE = {
  first_name: 'E2E',
  last_name: 'TestIntake',
  email: `e2e-intake-${Date.now()}@test.example.com`,
  cats_address: '999 Test Street',
  cats_city: 'Test City',
  cats_zip: '99999',
  situation_description: 'E2E_TEST_MARKER - intake test',
  is_test: true,
};

// --------------------------------------------------------------------------
// Test Suite
// --------------------------------------------------------------------------

test.describe('Intake Submission Variations @real-api', () => {
  const createdIntakeIds: string[] = [];
  const createdRequestIds: string[] = [];

  test.afterEach(async ({ request }) => {
    // Decline all tracked intake IDs
    while (createdIntakeIds.length > 0) {
      const id = createdIntakeIds.pop()!;
      await declineIntake(request, id);
    }
    // Archive all created request IDs
    while (createdRequestIds.length > 0) {
      const id = createdRequestIds.pop()!;
      await archiveRequest(request, id);
    }
  });

  // --------------------------------------------------------------------------
  // 1. Minimal intake
  // --------------------------------------------------------------------------
  test('Minimal intake — only required fields', async ({ request }) => {
    const { id } = await createIntake(request, {
      first_name: 'E2E',
      last_name: 'Minimal',
      email: `e2e-intake-minimal-${Date.now()}@test.example.com`,
      cats_address: '999 Test Street',
      situation_description: 'E2E_TEST_MARKER - minimal intake',
      is_test: true,
    });
    createdIntakeIds.push(id);

    const data = await fetchIntake(request, id);
    expect(data.submission_id).toBe(id);
    expect(data.first_name).toBe('E2E');
    expect(data.last_name).toBe('Minimal');
  });

  // --------------------------------------------------------------------------
  // 2. Phone-only contact
  // --------------------------------------------------------------------------
  test('Phone-only contact — no email', async ({ request }) => {
    const { id } = await createIntake(request, {
      first_name: 'E2E',
      last_name: 'PhoneOnly',
      phone: '707-555-0199',
      cats_address: '999 Test Street',
      situation_description: 'E2E_TEST_MARKER - phone only intake',
      is_test: true,
    });
    createdIntakeIds.push(id);

    const data = await fetchIntake(request, id);
    expect(data.submission_id).toBe(id);
    expect(data.phone).toBe('707-555-0199');
    expect(data.email).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 3. Zero-value numerics (same bug pattern as FFS-175)
  // --------------------------------------------------------------------------
  test('Zero-value numerics persist as 0, not null', async ({ request }) => {
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-zeros-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - zero numerics',
      cat_count_estimate: 0,
      cats_needing_tnr: 0,
      peak_count: 0,
      eartip_count_observed: 0,
      kitten_count: 0,
    });
    createdIntakeIds.push(id);

    const data = await fetchIntake(request, id);
    expect(data.cat_count_estimate).toBe(0);
    expect(data.cats_needing_tnr).toBe(0);
    expect(data.peak_count).toBe(0);
    expect(data.eartip_count_observed).toBe(0);
    expect(data.kitten_count).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4. Full intake field coverage
  // --------------------------------------------------------------------------
  test('Full intake field coverage — all major columns populated', async ({ request }) => {
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-full-${Date.now()}@test.example.com`,
      phone: '707-555-0198',
      situation_description: 'E2E_TEST_MARKER - full field coverage',
      // Address
      requester_address: '100 Main St',
      requester_city: 'Santa Rosa',
      requester_zip: '95401',
      cats_at_requester_address: false,
      county: 'Sonoma',
      // Cat details
      ownership_status: 'community_colony',
      cat_count_estimate: 8,
      cat_count_text: 'about 8 cats',
      cats_needing_tnr: 6,
      peak_count: 12,
      count_confidence: 'good_estimate',
      colony_duration: '1_to_6_months',
      eartip_count_observed: 2,
      fixed_status: 'some_fixed',
      handleability: 'unhandleable_trap',
      observation_time_of_day: 'morning',
      is_at_feeding_station: true,
      reporter_confidence: 'high',
      awareness_duration: '1_to_6_months',
      // Kittens
      has_kittens: true,
      kitten_count: 3,
      kitten_age_estimate: '4-8 weeks',
      kitten_behavior: 'shy',
      mom_present: 'yes',
      mom_fixed: 'no',
      can_bring_in: 'no',
      kitten_contained: 'no',
      kitten_notes: 'spotted under porch',
      // Feeding
      feeds_cat: true,
      feeding_frequency: 'daily',
      feeding_duration: 'few_months',
      cat_comes_inside: 'never',
      feeding_location: 'backyard',
      feeding_time: 'evening',
      cats_being_fed: true,
      feeder_info: 'Jane Smith',
      // Medical
      has_medical_concerns: false,
      is_emergency: false,
      // Property
      has_property_access: true,
      access_notes: 'Gate code 1234',
      is_property_owner: true,
      // Trapping logistics
      dogs_on_site: 'no',
      trap_savvy: 'unknown',
      previous_tnr: 'no',
      best_trapping_time: 'weekday evenings',
      important_notes: ['withhold_food'],
      // Referral
      referral_source: 'neighbor',
    });
    createdIntakeIds.push(id);

    const data = await fetchIntake(request, id);
    expect(data.cat_count_estimate).toBe(8);
    expect(data.cats_needing_tnr).toBe(6);
    expect(data.peak_count).toBe(12);
    expect(data.eartip_count_observed).toBe(2);
    expect(data.has_kittens).toBe(true);
    expect(data.kitten_count).toBe(3);
    expect(data.feeds_cat).toBe(true);
    expect(data.is_property_owner).toBe(true);
    expect(data.county).toBe('Sonoma');
    expect(data.ownership_status).toBe('community_colony');
    expect(data.colony_duration).toBe('1_to_6_months');
    expect(data.count_confidence).toBe('good_estimate');
    expect(data.handleability).toBe('unhandleable_trap');
    expect(data.dogs_on_site).toBe('no');
  });

  // --------------------------------------------------------------------------
  // 5. Kittens scenario
  // --------------------------------------------------------------------------
  test('Kittens scenario — all kitten fields', async ({ request }) => {
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-kittens-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - kittens scenario',
      has_kittens: true,
      kitten_count: 3,
      kitten_age_estimate: '4-8 weeks',
      kitten_mixed_ages_description: 'Two older, one younger',
      kitten_behavior: 'shy',
      mom_present: 'yes',
      mom_fixed: 'no',
      can_bring_in: 'no',
      kitten_contained: 'no',
      kitten_notes: 'Under the back porch',
    });
    createdIntakeIds.push(id);

    const data = await fetchIntake(request, id);
    expect(data.has_kittens).toBe(true);
    expect(data.kitten_count).toBe(3);
    expect(data.kitten_age_estimate).toBe('4-8 weeks');
    expect(data.kitten_behavior).toBe('shy');
    expect(data.mom_present).toBe('yes');
    expect(data.mom_fixed).toBe('no');
    expect(data.can_bring_in).toBe('no');
    expect(data.kitten_contained).toBe('no');
  });

  // --------------------------------------------------------------------------
  // 6. Third-party report
  // --------------------------------------------------------------------------
  test('Third-party report with property owner info', async ({ request }) => {
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-3p-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - third party report',
      is_third_party_report: true,
      third_party_relationship: 'neighbor',
      property_owner_name: 'John Property',
      property_owner_phone: '707-555-0100',
      property_owner_email: 'owner@test.example.com',
    });
    createdIntakeIds.push(id);

    const data = await fetchIntake(request, id);
    expect(data.is_third_party_report).toBe(true);
    expect(data.third_party_relationship).toBe('neighbor');
    expect(data.property_owner_name).toBe('John Property');
    expect(data.property_owner_phone).toBe('707-555-0100');
    expect(data.property_owner_email).toBe('owner@test.example.com');
  });

  // --------------------------------------------------------------------------
  // 7. Medical/emergency
  // --------------------------------------------------------------------------
  test('Medical concerns with emergency flag', async ({ request }) => {
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-medical-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - medical emergency',
      has_medical_concerns: true,
      medical_description: 'Injured cat with limp',
      is_emergency: true,
      emergency_acknowledged: true,
    });
    createdIntakeIds.push(id);

    const data = await fetchIntake(request, id);
    expect(data.has_medical_concerns).toBe(true);
    expect(data.medical_description).toBe('Injured cat with limp');
    expect(data.is_emergency).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 8. Staff-entry intake with direct request creation
  // --------------------------------------------------------------------------
  test('Staff-entry intake — create_request_directly', async ({ request }) => {
    const { id, response } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-staff-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - staff entry',
      source: 'phone',
      reviewed_by: 'e2e_test',
      create_request_directly: true,
      cat_count_estimate: 5,
      cats_needing_tnr: 3,
    });
    createdIntakeIds.push(id);

    // The response should include a request_id from auto-conversion
    const requestId = response.request_id as string | undefined;
    if (requestId) {
      createdRequestIds.push(requestId);

      // Verify the request was created
      const reqData = await fetchRequest(request, requestId);
      expect(reqData.request_id).toBe(requestId);
      expect(reqData.source_system).toBe('web_intake');
    }

    // Verify the intake itself was saved
    const data = await fetchIntake(request, id);
    expect(data.submission_status).toBe('in_progress');
  });

  // --------------------------------------------------------------------------
  // 9. Intake-to-request conversion — minimal
  // --------------------------------------------------------------------------
  test('Intake-to-request conversion — minimal', async ({ request }) => {
    // Create intake
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-convert-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - conversion test',
      cat_count_estimate: 4,
    });
    createdIntakeIds.push(id);

    // Convert to request
    const requestId = await convertIntake(request, id);
    createdRequestIds.push(requestId);

    // Verify request exists
    const reqData = await fetchRequest(request, requestId);
    expect(reqData.request_id).toBe(requestId);
    expect(reqData.source_system).toBe('web_intake');
  });

  // --------------------------------------------------------------------------
  // 10. Conversion — field mapping verification
  // --------------------------------------------------------------------------
  test('Conversion — field mapping from intake to request', async ({ request }) => {
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-fieldmap-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - field mapping test',
      cat_count_estimate: 10,
      cats_needing_tnr: 7,
      has_kittens: true,
      kitten_count: 2,
      colony_duration: 'over_2_years',
      fixed_status: 'some_fixed',
      feeds_cat: true,
      feeder_info: 'Colony Caretaker',
    });
    createdIntakeIds.push(id);

    const requestId = await convertIntake(request, id);
    createdRequestIds.push(requestId);

    const reqData = await fetchRequest(request, requestId);
    // cat_count_estimate → total_cats_reported
    expect(reqData.total_cats_reported).toBe(10);
    // cats_needing_tnr → estimated_cat_count
    expect(reqData.estimated_cat_count).toBe(7);
    // These fields should pass through
    expect(reqData.has_kittens).toBe(true);
    expect(reqData.kitten_count).toBe(2);
    // feeds_cat → is_being_fed
    expect(reqData.is_being_fed).toBe(true);
    // feeder_info → feeder_name
    expect(reqData.feeder_name).toBe('Colony Caretaker');
    // situation_description → notes
    expect(reqData.notes).toContain('E2E_TEST_MARKER');
  });

  // --------------------------------------------------------------------------
  // 11. Conversion — duplicate prevention
  // --------------------------------------------------------------------------
  test('Conversion — second convert returns conflict', async ({ request }) => {
    const { id } = await createIntake(request, {
      ...BASE_INTAKE,
      email: `e2e-intake-dup-${Date.now()}@test.example.com`,
      situation_description: 'E2E_TEST_MARKER - duplicate prevention',
    });
    createdIntakeIds.push(id);

    // First conversion should succeed
    const requestId = await convertIntake(request, id);
    createdRequestIds.push(requestId);

    // Second conversion should fail with conflict
    const res = await request.post('/api/intake/convert', {
      data: { submission_id: id, converted_by: 'e2e_test' },
    });
    expect(res.status()).toBe(409);
  });

  // --------------------------------------------------------------------------
  // 12. Convert endpoint — UUID validation
  // --------------------------------------------------------------------------
  test('Convert endpoint rejects invalid UUID', async ({ request }) => {
    const res = await request.post('/api/intake/convert', {
      data: { submission_id: 'not-a-uuid', converted_by: 'e2e_test' },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 13. Validation — email or phone required
  // --------------------------------------------------------------------------
  test('Validation — rejects intake without email or phone', async ({ request }) => {
    const res = await request.post('/api/intake', {
      data: {
        first_name: 'E2E',
        last_name: 'NoContact',
        cats_address: '999 Test Street',
        situation_description: 'E2E_TEST_MARKER - no contact',
        is_test: true,
      },
    });
    expect(res.status()).toBe(400);
  });
});
