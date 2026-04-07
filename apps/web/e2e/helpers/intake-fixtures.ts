/**
 * FFS-1189 — Intake fixtures for the out-of-service-area workflow tests.
 *
 * Provides typed factory functions for synthetic intake submissions
 * matching the IntakeSubmission interface, with sensible defaults for
 * the three classification states. Used by Playwright route mocks to
 * stub /api/intake/queue without touching the live database.
 */

export interface IntakeFixture {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  cats_zip: string | null;
  county: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  service_area_status: 'in' | 'ambiguous' | 'out' | 'unknown' | null;
  service_area_status_source: 'auto' | 'staff_override' | null;
  out_of_service_area_email_sent_at: string | null;
  out_of_service_area_approved_at: string | null;
  submission_status: string;
  is_test: boolean;
  is_legacy?: boolean;
}

export function makeOutOfServiceFixture(
  overrides: Partial<IntakeFixture> = {}
): IntakeFixture {
  return {
    submission_id: '11111111-1111-1111-1111-111111111111',
    submitted_at: new Date().toISOString(),
    submitter_name: 'Jane Marin',
    first_name: 'Jane',
    last_name: 'Marin',
    email: 'jane@example.com',
    phone: '4155551234',
    cats_address: '123 Main St',
    cats_city: 'San Rafael',
    cats_zip: '94901',
    county: 'Marin',
    geo_latitude: 37.9735,
    geo_longitude: -122.5311,
    service_area_status: 'out',
    service_area_status_source: 'auto',
    out_of_service_area_email_sent_at: null,
    out_of_service_area_approved_at: null,
    submission_status: 'new',
    is_test: true,
    ...overrides,
  };
}

export function makeAmbiguousFixture(
  overrides: Partial<IntakeFixture> = {}
): IntakeFixture {
  return makeOutOfServiceFixture({
    submission_id: '22222222-2222-2222-2222-222222222222',
    submitter_name: 'Carl Cotati',
    first_name: 'Carl',
    cats_city: 'Cotati',
    cats_zip: '94931',
    county: 'Sonoma',
    geo_latitude: 38.3266,
    geo_longitude: -122.7094,
    service_area_status: 'ambiguous',
    ...overrides,
  });
}

export function makeInServiceFixture(
  overrides: Partial<IntakeFixture> = {}
): IntakeFixture {
  return makeOutOfServiceFixture({
    submission_id: '33333333-3333-3333-3333-333333333333',
    submitter_name: 'Sara Santa',
    first_name: 'Sara',
    cats_city: 'Santa Rosa',
    cats_zip: '95404',
    county: 'Sonoma',
    geo_latitude: 38.4404,
    geo_longitude: -122.7141,
    service_area_status: 'in',
    ...overrides,
  });
}
