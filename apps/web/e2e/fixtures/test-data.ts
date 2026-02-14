/**
 * Test Data Fixtures
 *
 * This module provides test data that can be:
 * 1. Used for mocked tests (no DB)
 * 2. Inserted into a test database
 * 3. Cleaned up after tests
 *
 * All test records are marked with a special flag for easy cleanup.
 */

// Prefix for all test record IDs - makes cleanup easy
export const TEST_PREFIX = 'e2e-test-';

// Generate unique test IDs
export const generateTestId = (type: string) =>
  `${TEST_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Test submission data
export const createTestSubmission = (overrides = {}) => ({
  submission_id: generateTestId('submission'),
  submitted_at: new Date().toISOString(),
  submitter_name: 'E2E Test User',
  email: `e2e-${Date.now()}@test.example.com`,
  phone: '707-555-0199',
  cats_address: '999 Test Street',
  cats_city: 'Test City',
  cats_zip: '99999',
  cat_count_estimate: 3,
  has_kittens: false,
  situation_description: 'E2E test submission - auto cleanup',
  submission_status: 'new',
  is_test: true, // Flag for cleanup
  ...overrides,
});

// Test request data
export const createTestRequest = (overrides = {}) => ({
  request_id: generateTestId('request'),
  status: 'new',
  priority: 'normal',
  summary: 'E2E Test Request - auto cleanup',
  source_system: 'e2e_test',
  source_record_id: generateTestId('source'),
  created_at: new Date().toISOString(),
  estimated_cat_count: 2,
  has_kittens: false,
  is_test: true,
  ...overrides,
});

// Test place data
export const createTestPlace = (overrides = {}) => ({
  place_id: generateTestId('place'),
  display_name: 'E2E Test Location',
  street_address: '999 Test Avenue',
  city: 'Test City',
  state: 'CA',
  zip: '99999',
  latitude: 38.0,
  longitude: -122.0,
  source_system: 'e2e_test',
  is_test: true,
  ...overrides,
});

// Test person data
export const createTestPerson = (overrides = {}) => ({
  person_id: generateTestId('person'),
  display_name: 'E2E Test Person',
  first_name: 'Test',
  last_name: 'User',
  email: `e2e-${Date.now()}@test.example.com`,
  phone: '707-555-0199',
  source_system: 'e2e_test',
  is_test: true,
  ...overrides,
});

// Test cat data
export const createTestCat = (overrides = {}) => ({
  cat_id: generateTestId('cat'),
  name: 'Test Cat',
  sex: 'unknown',
  microchip_id: `TEST${Date.now()}`,
  source_system: 'e2e_test',
  is_test: true,
  ...overrides,
});

// Test annotation data
export const createTestAnnotation = (overrides = {}) => ({
  lat: 38.44,
  lng: -122.72,
  label: `${TEST_PREFIX}annotation-${Date.now()}`,
  note: 'E2E test annotation - auto cleanup',
  annotation_type: 'general',
  created_by: 'e2e_test',
  ...overrides,
});

// Test journal entry data
export const createTestJournalEntry = (overrides = {}) => ({
  body: `${TEST_PREFIX}journal-${Date.now()} - auto cleanup`,
  entry_kind: 'note',
  created_by: 'e2e_test',
  ...overrides,
});

// Cleanup query - removes all test records
export const CLEANUP_QUERIES = [
  `DELETE FROM ops.journal_entries WHERE created_by = 'e2e_test' OR body LIKE 'e2e-test-%'`,
  `DELETE FROM ops.map_annotations WHERE created_by = 'e2e_test' OR label LIKE 'e2e-test-%'`,
  `DELETE FROM ops.web_intake_submissions WHERE submission_id LIKE 'e2e-test-%' OR email LIKE 'e2e-%@test.example.com'`,
  `DELETE FROM ops.requests WHERE source_system = 'e2e_test' OR request_id LIKE 'e2e-test-%'`,
  `DELETE FROM sot.places WHERE source_system = 'e2e_test' OR place_id LIKE 'e2e-test-%'`,
  `DELETE FROM sot.people WHERE source_system = 'e2e_test' OR person_id LIKE 'e2e-test-%'`,
  `DELETE FROM sot.cats WHERE source_system = 'e2e_test' OR cat_id LIKE 'e2e-test-%'`,
];

// SQL to identify test records (for verification)
export const COUNT_TEST_RECORDS = `
  SELECT
    (SELECT COUNT(*) FROM ops.web_intake_submissions WHERE submission_id LIKE 'e2e-test-%') as test_submissions,
    (SELECT COUNT(*) FROM ops.requests WHERE source_system = 'e2e_test') as test_requests,
    (SELECT COUNT(*) FROM sot.places WHERE source_system = 'e2e_test') as test_places
`;
