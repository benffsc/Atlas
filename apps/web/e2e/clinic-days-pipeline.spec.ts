import { test, expect } from '@playwright/test';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * Clinic Days Pipeline Tests
 *
 * Verifies fixes from FFS-96 through FFS-123:
 * - Phase 2: Cartesian product fixes (FFS-96, FFS-98, FFS-122, FFS-123)
 * - Phase 3: Booking address display (FFS-97)
 * - Phase 5: Import & structural fixes (FFS-101, FFS-102, FFS-103, FFS-104)
 *
 * All admin endpoints require auth — uses page.request for authenticated context.
 */

// ============================================================================
// Interfaces matching API responses
// ============================================================================

interface ClinicDay {
  clinic_day_id: string;
  clinic_date: string;
  clinic_type: string;
  total_cats: number;
  total_females: number;
  total_males: number;
  clinichq_cats: number;
  chipped_count: number;
  unchipped_count: number;
  unlinked_count: number;
  notes: string | null;
}

interface ClinicDayListResponse {
  clinic_days: ClinicDay[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}

interface ClinicDayDetailResponse {
  clinic_day: {
    clinic_day_id: string;
    clinic_date: string;
    clinic_type: string;
    total_cats: number;
  };
  entries: unknown[];
}

interface ClinicDayCat {
  appointment_id: string;
  cat_id: string | null;
  microchip: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  owner_name: string | null;
  booked_as: string | null;
  place_address: string | null;
  booking_address: string | null;
  weight_lbs: number | null;
  felv_status: string | null;
  fiv_status: string | null;
}

interface CatGalleryResponse {
  date: string;
  total_cats: number;
  chipped_count: number;
  unchipped_count: number;
  unlinked_count: number;
  cats: ClinicDayCat[];
}

interface CompareResponse {
  date: string;
  summary: {
    logged_total: number;
    clinichq_total: number;
    variance: number;
    is_match: boolean;
  };
  clinichq_appointments: Array<{
    appointment_id: string;
    booking_address: string | null;
  }>;
}

interface CatDetailResponse {
  cat: {
    cat_id: string;
    name: string | null;
  };
  enhanced_clinic_history?: Array<{
    appointment_id: string;
    client_address: string | null;
    origin_address: string | null;
  }>;
}

// Helper: normalize date (API may return ISO timestamp, routes expect YYYY-MM-DD)
function toDateStr(d: string): string {
  return d.slice(0, 10);
}

// Helper: fetch clinic days list (used by many tests)
async function getClinicDaysList(request: { get: (url: string) => Promise<{ ok(): boolean; json(): Promise<unknown> }> }, limit = 3) {
  const response = await request.get(`/api/admin/clinic-days?limit=${limit}`);
  expect(response.ok()).toBeTruthy();
  return unwrapApiResponse<ClinicDayListResponse>(await response.json());
}

// ============================================================================
// Phase 2: Cartesian Product Fixes (FFS-96, FFS-122)
// ============================================================================

test.describe('Clinic Days List - No Cartesian Products (FFS-96) @data-quality', () => {

  test('total_cats matches clinichq_cats (no inflated counts)', async ({ page }) => {
    const data = await getClinicDaysList(page.request, 10);
    expect(data.clinic_days).toBeDefined();

    for (const day of data.clinic_days) {
      // FFS-96: total_cats should equal clinichq_cats since both are COUNT(*)
      expect(day.total_cats).toBe(day.clinichq_cats);

      // Basic sanity: counts should be non-negative
      expect(day.total_cats).toBeGreaterThanOrEqual(0);
      expect(day.chipped_count).toBeGreaterThanOrEqual(0);
      expect(day.unchipped_count).toBeGreaterThanOrEqual(0);
      expect(day.unlinked_count).toBeGreaterThanOrEqual(0);
    }
  });

  test('no duplicate clinic dates in list response', async ({ page }) => {
    const data = await getClinicDaysList(page.request, 50);
    const dates = data.clinic_days.map(d => d.clinic_date);
    const uniqueDates = [...new Set(dates)];
    expect(dates.length).toBe(uniqueDates.length);
  });

  test('sex counts do not exceed total cats', async ({ page }) => {
    const data = await getClinicDaysList(page.request, 10);
    for (const day of data.clinic_days) {
      expect(day.total_females + day.total_males).toBeLessThanOrEqual(day.total_cats);
    }
  });
});

// ============================================================================
// Phase 2 & 3: Clinic Day Cats - Booking Address & No Duplicates (FFS-97)
// ============================================================================

test.describe('Clinic Day Cats - Booking Address (FFS-97)', () => {

  test('cats response includes booking_address field', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 1);
    if (listData.clinic_days.length === 0) {
      test.skip();
      return;
    }

    const date = listData.clinic_days[0].clinic_date;
    const catsResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(date)}/cats`);
    expect(catsResponse.ok()).toBeTruthy();

    const catsData = unwrapApiResponse<CatGalleryResponse>(await catsResponse.json());

    for (const cat of catsData.cats) {
      expect(cat).toHaveProperty('booking_address');
    }
  });

  test('no duplicate appointment_ids in cats response', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 3);

    for (const day of listData.clinic_days) {
      const catsResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(day.clinic_date)}/cats`);
      expect(catsResponse.ok()).toBeTruthy();

      const catsData = unwrapApiResponse<CatGalleryResponse>(await catsResponse.json());
      const appointmentIds = catsData.cats.map(c => c.appointment_id);
      const uniqueIds = [...new Set(appointmentIds)];

      expect(appointmentIds.length).toBe(uniqueIds.length);
    }
  });

  test('cat count in gallery matches list endpoint total_cats', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 3);

    for (const day of listData.clinic_days) {
      const catsResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(day.clinic_date)}/cats`);
      expect(catsResponse.ok()).toBeTruthy();

      const catsData = unwrapApiResponse<CatGalleryResponse>(await catsResponse.json());
      expect(catsData.total_cats).toBe(day.total_cats);
    }
  });
});

// ============================================================================
// Phase 3: Compare Route - Booking Address (FFS-97)
// ============================================================================

test.describe('Clinic Day Compare - Booking Address (FFS-97)', () => {

  test('compare response includes booking_address on clinichq_appointments', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 1);
    if (listData.clinic_days.length === 0) {
      test.skip();
      return;
    }

    const date = listData.clinic_days[0].clinic_date;
    const compareResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(date)}/compare`);
    expect(compareResponse.ok()).toBeTruthy();

    const compareData = unwrapApiResponse<CompareResponse>(await compareResponse.json());

    for (const appt of compareData.clinichq_appointments) {
      expect(appt).toHaveProperty('booking_address');
    }
  });
});

// ============================================================================
// Phase 2: Cat Detail - No Cartesian Product (FFS-122, FFS-123)
// ============================================================================

test.describe('Cat Detail - Enhanced Clinic History (FFS-122, FFS-123)', () => {

  test('enhanced_clinic_history has no duplicate appointment rows', async ({ page }) => {
    const catsResponse = await page.request.get('/api/cats?limit=20');
    expect(catsResponse.ok()).toBeTruthy();

    const catsData = unwrapApiResponse<{ cats: Array<{ cat_id: string }> }>(await catsResponse.json());
    if (!catsData.cats?.length) {
      test.skip();
      return;
    }

    let testedCats = 0;
    for (const cat of catsData.cats.slice(0, 5)) {
      const detailResponse = await page.request.get(`/api/cats/${cat.cat_id}`);
      if (!detailResponse.ok()) continue;

      const detail = unwrapApiResponse<CatDetailResponse>(await detailResponse.json());
      const history = detail.enhanced_clinic_history;
      if (!history || history.length === 0) continue;

      // FFS-122: No duplicate appointment_ids
      const appointmentIds = history.map(h => h.appointment_id);
      const uniqueIds = [...new Set(appointmentIds)];
      expect(appointmentIds.length).toBe(uniqueIds.length);

      testedCats++;
    }

    console.log(`Tested ${testedCats} cats for clinic history cartesian products`);
  });

  test('client_address uses inferred place, not person home (FFS-123)', async ({ page }) => {
    const catsResponse = await page.request.get('/api/cats?limit=30');
    expect(catsResponse.ok()).toBeTruthy();

    const catsData = unwrapApiResponse<{ cats: Array<{ cat_id: string }> }>(await catsResponse.json());
    if (!catsData.cats?.length) {
      test.skip();
      return;
    }

    for (const cat of catsData.cats.slice(0, 10)) {
      const detailResponse = await page.request.get(`/api/cats/${cat.cat_id}`);
      if (!detailResponse.ok()) continue;

      const detail = unwrapApiResponse<CatDetailResponse>(await detailResponse.json());
      const history = detail.enhanced_clinic_history;
      if (!history || history.length === 0) continue;

      for (const entry of history) {
        // FFS-123: client_address should match origin_address (both from pl2/inferred place)
        if (entry.client_address && entry.origin_address) {
          expect(entry.client_address).toBe(entry.origin_address);
        }
      }
      return;
    }
  });
});

// ============================================================================
// Phase 5: Clinic Day Detail Route (FFS-103)
// ============================================================================

test.describe('Clinic Day Detail - Stable IDs (FFS-103)', () => {

  test('detail returns valid UUID and clinic_type', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 3);
    if (listData.clinic_days.length === 0) {
      test.skip();
      return;
    }

    for (const day of listData.clinic_days) {
      const detailResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(day.clinic_date)}`);
      expect(detailResponse.ok()).toBeTruthy();

      const detail = unwrapApiResponse<ClinicDayDetailResponse>(await detailResponse.json());

      // Should return valid UUID format
      expect(detail.clinic_day.clinic_day_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);

      // clinic_type should be a valid type (defaults to 'regular')
      expect(['regular', 'tame_only', 'mass_trapping', 'emergency', 'mobile']).toContain(
        detail.clinic_day.clinic_type
      );

      // Log whether using stable ID or fallback
      if (day.clinic_day_id === detail.clinic_day.clinic_day_id) {
        console.log(`${day.clinic_date}: Stable clinic_day_id from ops.clinic_days`);
      } else {
        console.log(`${day.clinic_date}: Random UUID fallback (no ops.clinic_days record)`);
      }
    }
  });
});

// ============================================================================
// Phase 5: Import - Date Validation (FFS-104)
// ============================================================================

test.describe('Clinic Days API - Input Validation', () => {

  test('cats endpoint rejects invalid date format', async ({ page }) => {
    const response = await page.request.get('/api/admin/clinic-days/not-a-date/cats');
    expect(response.status()).toBe(400);
  });
});

// ============================================================================
// API Response Format
// ============================================================================

test.describe('Clinic Days API - Response Format', () => {

  test('list endpoint wraps response in apiSuccess format', async ({ page }) => {
    const response = await page.request.get('/api/admin/clinic-days?limit=1');
    expect(response.ok()).toBeTruthy();

    const raw = await response.json() as Record<string, unknown>;
    expect(raw.success).toBe(true);
    expect(raw.data).toBeDefined();
    const data = raw.data as Record<string, unknown>;
    expect(data.clinic_days).toBeDefined();
    expect(data.pagination).toBeDefined();
  });

  test('cats endpoint wraps response in apiSuccess format', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 1);
    if (listData.clinic_days.length === 0) {
      test.skip();
      return;
    }

    const date = listData.clinic_days[0].clinic_date;
    const response = await page.request.get(`/api/admin/clinic-days/${toDateStr(date)}/cats`);
    expect(response.ok()).toBeTruthy();

    const raw = await response.json() as Record<string, unknown>;
    expect(raw.success).toBe(true);
    expect(raw.data).toBeDefined();
    const data = raw.data as Record<string, unknown>;
    expect(data.cats).toBeDefined();
    expect(data.total_cats).toBeDefined();
  });

  test('compare endpoint wraps response in apiSuccess format', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 1);
    if (listData.clinic_days.length === 0) {
      test.skip();
      return;
    }

    const date = listData.clinic_days[0].clinic_date;
    const response = await page.request.get(`/api/admin/clinic-days/${toDateStr(date)}/compare`);
    expect(response.ok()).toBeTruthy();

    const raw = await response.json() as Record<string, unknown>;
    expect(raw.success).toBe(true);
    expect(raw.data).toBeDefined();
    const data = raw.data as Record<string, unknown>;
    expect(data.summary).toBeDefined();
  });
});

// ============================================================================
// Cross-Endpoint Consistency
// ============================================================================

test.describe('Clinic Days - Cross-Endpoint Consistency', () => {

  test('list total_cats matches cats endpoint count', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 3);

    for (const day of listData.clinic_days) {
      const catsResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(day.clinic_date)}/cats`);
      expect(catsResponse.ok()).toBeTruthy();

      const catsData = unwrapApiResponse<CatGalleryResponse>(await catsResponse.json());
      expect(catsData.cats.length).toBe(day.total_cats);
    }
  });

  test('compare clinichq_total matches list total_cats', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 3);

    for (const day of listData.clinic_days) {
      const compareResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(day.clinic_date)}/compare`);
      expect(compareResponse.ok()).toBeTruthy();

      const compareData = unwrapApiResponse<CompareResponse>(await compareResponse.json());
      expect(compareData.summary.clinichq_total).toBe(day.total_cats);
    }
  });

  test('cat gallery chip counts are reasonable', async ({ page }) => {
    const listData = await getClinicDaysList(page.request, 3);

    for (const day of listData.clinic_days) {
      const catsResponse = await page.request.get(`/api/admin/clinic-days/${toDateStr(day.clinic_date)}/cats`);
      expect(catsResponse.ok()).toBeTruthy();

      const catsData = unwrapApiResponse<CatGalleryResponse>(await catsResponse.json());

      expect(catsData.chipped_count + catsData.unlinked_count).toBeLessThanOrEqual(catsData.total_cats);
      expect(catsData.chipped_count).toBeGreaterThanOrEqual(0);
      expect(catsData.unchipped_count).toBeGreaterThanOrEqual(0);
      expect(catsData.unlinked_count).toBeGreaterThanOrEqual(0);
    }
  });
});
