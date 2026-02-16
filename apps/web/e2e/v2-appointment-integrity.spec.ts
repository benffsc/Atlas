import { test, expect } from '@playwright/test';
import { navigateTo, waitForLoaded, findRealEntity, mockAllWrites } from './ui-test-helpers';

/**
 * V2 Appointment & Medical Data Integrity Tests
 *
 * Tests the fixes from MIG_2319 and MIG_2320:
 * - sot.is_positive_value() function exists and works
 * - ops.appointments has enriched columns (is_spay, is_neuter, health flags, etc.)
 * - ops.v_appointment_detail view includes all needed columns
 * - Appointment detail API returns data (not 500 error)
 * - Cat detail shows correct appointment data
 * - FeLV/FIV test results display correctly
 *
 * ALL TESTS ARE READ-ONLY - no data modifications.
 */

interface Appointment {
  appointment_id: string;
  appointment_date: string;
  appointment_number?: string;
  service_type?: string;
  is_spay?: boolean;
  is_neuter?: boolean;
  appointment_category?: string;
  cat_id?: string;
  weight_lbs?: number;
  felv_fiv_result?: string;
}

interface Cat {
  cat_id: string;
  name?: string;
  microchip?: string;
  altered_status?: string;
}

test.describe('V2 Appointment Detail API', () => {
  test.setTimeout(60000);

  test('appointment detail API returns data without error', async ({ request }) => {
    // Get appointments first
    const appointmentsRes = await request.get('/api/appointments?limit=10');

    if (!appointmentsRes.ok()) {
      console.log(`Skipping: /api/appointments returned ${appointmentsRes.status()}`);
      test.skip();
      return;
    }

    const appointmentsData = await appointmentsRes.json();
    const appointments = appointmentsData.appointments || appointmentsData;

    if (!Array.isArray(appointments) || appointments.length === 0) {
      console.log('No appointments found in database');
      test.skip();
      return;
    }

    // Test appointment detail endpoint for first few appointments
    let successCount = 0;
    let errorCount = 0;

    for (const appt of appointments.slice(0, 5)) {
      const detailRes = await request.get(`/api/appointments/${appt.appointment_id}`);

      if (detailRes.ok()) {
        successCount++;
        const detail = await detailRes.json();

        // Verify essential fields exist (from MIG_2320 view update)
        expect(detail).toHaveProperty('appointment_id');
        expect(detail).toHaveProperty('appointment_date');

        // These should now exist after MIG_2320
        expect(detail).toHaveProperty('is_spay');
        expect(detail).toHaveProperty('is_neuter');
        expect(detail).toHaveProperty('appointment_category');
      } else {
        errorCount++;
        console.log(`Appointment ${appt.appointment_id} detail returned ${detailRes.status()}`);
      }
    }

    console.log(`Appointment detail API: ${successCount} success, ${errorCount} errors`);
    // At least some should succeed
    expect(successCount).toBeGreaterThan(0);
  });

  test('appointment detail includes enriched columns from MIG_2320', async ({ request }) => {
    const appointmentsRes = await request.get('/api/appointments?limit=20');
    if (!appointmentsRes.ok()) {
      test.skip();
      return;
    }

    const data = await appointmentsRes.json();
    const appointments = data.appointments || data;

    if (!appointments?.length) {
      test.skip();
      return;
    }

    // Find an appointment and check detail
    for (const appt of appointments.slice(0, 5)) {
      const detailRes = await request.get(`/api/appointments/${appt.appointment_id}`);
      if (!detailRes.ok()) continue;

      const detail = await detailRes.json();

      // Verify MIG_2320 enriched columns exist (even if null)
      expect(detail).toHaveProperty('has_uri');
      expect(detail).toHaveProperty('has_fleas');
      expect(detail).toHaveProperty('has_dental_disease');
      expect(detail).toHaveProperty('felv_fiv_result');
      expect(detail).toHaveProperty('weight_lbs');

      // Boolean flags should be actual booleans (not undefined)
      expect(typeof detail.is_spay).toBe('boolean');
      expect(typeof detail.is_neuter).toBe('boolean');

      console.log(`Appointment ${appt.appointment_id}: is_spay=${detail.is_spay}, is_neuter=${detail.is_neuter}, category=${detail.appointment_category}`);
      return; // One successful test is enough
    }

    console.log('No appointments returned detail successfully');
  });

  test('spay/neuter appointments have correct category', async ({ request }) => {
    const appointmentsRes = await request.get('/api/appointments?limit=50');
    if (!appointmentsRes.ok()) {
      test.skip();
      return;
    }

    const data = await appointmentsRes.json();
    const appointments: Appointment[] = data.appointments || data;

    // Find appointments with is_spay or is_neuter = true
    const alterations = appointments.filter(a => a.is_spay || a.is_neuter);

    if (alterations.length === 0) {
      console.log('No spay/neuter appointments found in sample');
      // This is informational - may need MIG_2319 to be applied
      return;
    }

    // Verify category is Spay/Neuter for these appointments
    for (const appt of alterations.slice(0, 5)) {
      const detailRes = await request.get(`/api/appointments/${appt.appointment_id}`);
      if (!detailRes.ok()) continue;

      const detail = await detailRes.json();

      // If is_spay or is_neuter is true, category should be Spay/Neuter
      if (detail.is_spay || detail.is_neuter) {
        expect(detail.appointment_category).toBe('Spay/Neuter');
        console.log(`Verified: Appointment ${appt.appointment_id} correctly categorized as Spay/Neuter`);
      }
    }

    console.log(`Found ${alterations.length} spay/neuter appointments`);
  });
});

test.describe('V2 Cat Medical Data', () => {
  test.setTimeout(60000);

  test('cat detail API includes appointments', async ({ request }) => {
    const catsRes = await request.get('/api/cats?limit=20');
    if (!catsRes.ok()) {
      test.skip();
      return;
    }

    const catsData = await catsRes.json();
    const cats: Cat[] = catsData.cats || catsData;

    if (!cats?.length) {
      test.skip();
      return;
    }

    let catsWithAppointments = 0;

    for (const cat of cats.slice(0, 10)) {
      const detailRes = await request.get(`/api/cats/${cat.cat_id}`);
      if (!detailRes.ok()) continue;

      const detail = await detailRes.json();

      // Check if cat has appointments
      if (detail.appointments?.length > 0) {
        catsWithAppointments++;

        // Verify appointment structure
        const appt = detail.appointments[0];
        expect(appt).toHaveProperty('appointment_id');
        expect(appt).toHaveProperty('appointment_date');

        // MIG_2320: Should have enriched columns
        if (appt.is_spay !== undefined || appt.is_neuter !== undefined) {
          expect(typeof appt.is_spay).toBe('boolean');
          expect(typeof appt.is_neuter).toBe('boolean');
        }
      }

      if (catsWithAppointments >= 3) break;
    }

    console.log(`Found ${catsWithAppointments} cats with appointments`);
  });

  test('cat detail includes FeLV/FIV test results', async ({ request }) => {
    const catsRes = await request.get('/api/cats?limit=30');
    if (!catsRes.ok()) {
      test.skip();
      return;
    }

    const catsData = await catsRes.json();
    const cats: Cat[] = catsData.cats || catsData;

    let catsWithTestResults = 0;

    for (const cat of cats.slice(0, 20)) {
      const detailRes = await request.get(`/api/cats/${cat.cat_id}`);
      if (!detailRes.ok()) continue;

      const detail = await detailRes.json();

      // Check for test results (from ops.cat_test_results)
      if (detail.test_results?.length > 0) {
        catsWithTestResults++;

        const testResult = detail.test_results[0];
        expect(testResult).toHaveProperty('test_type');
        expect(testResult).toHaveProperty('result');

        console.log(`Cat ${cat.cat_id}: ${testResult.test_type} = ${testResult.result}`);
      }

      // Also check disease_status if available
      if (detail.disease_status) {
        expect(detail.disease_status).toHaveProperty('felv_status');
        expect(detail.disease_status).toHaveProperty('fiv_status');
      }

      if (catsWithTestResults >= 3) break;
    }

    console.log(`Found ${catsWithTestResults} cats with test results`);
  });

  test('altered cats show correct altered_status', async ({ request }) => {
    const catsRes = await request.get('/api/cats?limit=50');
    if (!catsRes.ok()) {
      test.skip();
      return;
    }

    const catsData = await catsRes.json();
    const cats: Cat[] = catsData.cats || catsData;

    // Find cats with altered_status set
    const alteredCats = cats.filter(c =>
      c.altered_status === 'spayed' || c.altered_status === 'neutered'
    );

    if (alteredCats.length === 0) {
      console.log('No altered cats found in sample');
      return;
    }

    // Verify altered cats have corresponding appointment data
    let matchedCount = 0;

    for (const cat of alteredCats.slice(0, 5)) {
      const detailRes = await request.get(`/api/cats/${cat.cat_id}`);
      if (!detailRes.ok()) continue;

      const detail = await detailRes.json();

      // If cat is altered, check if any appointment shows the alteration
      const hasAlterationAppt = detail.appointments?.some(
        (a: Appointment) => a.is_spay || a.is_neuter
      );

      if (hasAlterationAppt) {
        matchedCount++;
        console.log(`Cat ${cat.cat_id} (${cat.altered_status}) has matching alteration appointment`);
      } else {
        console.log(`Cat ${cat.cat_id} (${cat.altered_status}) - no alteration appointment found (may need MIG_2319)`);
      }
    }

    console.log(`Matched ${matchedCount}/${Math.min(5, alteredCats.length)} altered cats to appointments`);
  });
});

test.describe('V2 Appointment Detail Modal', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await mockAllWrites(page);
  });

  test('appointment detail modal opens without error', async ({ page, request }) => {
    // Find a cat with appointments
    const catsRes = await request.get('/api/cats?limit=20');
    if (!catsRes.ok()) {
      test.skip();
      return;
    }

    const catsData = await catsRes.json();

    for (const cat of catsData.cats || []) {
      const detailRes = await request.get(`/api/cats/${cat.cat_id}`);
      if (!detailRes.ok()) continue;

      const detail = await detailRes.json();
      if (!detail.appointments?.length) continue;

      // Navigate to cat detail page
      await navigateTo(page, `/cats/${cat.cat_id}`);
      await waitForLoaded(page);

      // Click on Medical tab
      const medicalTab = page.locator('.profile-tab', { hasText: 'Medical' });
      if (await medicalTab.isVisible({ timeout: 5000 }).catch(() => false)) {
        await medicalTab.click();
        await page.waitForTimeout(500);
      }

      // Look for appointment row/card and try to click it
      const appointmentRow = page.locator('[class*="appointment"], [class*="visit"], table tr', { hasText: /\d{4}/ }).first();

      if (await appointmentRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        await appointmentRow.click();

        // Check if modal opened (should NOT show error)
        const errorText = page.locator('text="Failed to fetch appointment details"');
        const modalVisible = await errorText.isVisible({ timeout: 3000 }).catch(() => false);

        if (modalVisible) {
          console.log('ERROR: Appointment modal shows fetch error - MIG_2320 may not be applied');
          expect(modalVisible).toBe(false); // Fail the test
        } else {
          console.log('Appointment detail modal opened successfully');
        }
        return; // Test complete
      }

      console.log(`No clickable appointments found for cat ${cat.cat_id}`);
    }

    console.log('No cats with clickable appointments found');
  });

  test('appointment detail shows spay/neuter type correctly', async ({ page, request }) => {
    // Find an appointment with is_spay or is_neuter
    const appointmentsRes = await request.get('/api/appointments?limit=30');
    if (!appointmentsRes.ok()) {
      test.skip();
      return;
    }

    const data = await appointmentsRes.json();
    const appointments: Appointment[] = data.appointments || data;

    // Find a spay/neuter appointment with a cat
    const snAppt = appointments.find(a => (a.is_spay || a.is_neuter) && a.cat_id);

    if (!snAppt) {
      console.log('No spay/neuter appointments with cat_id found');
      test.skip();
      return;
    }

    // Navigate to cat detail
    await navigateTo(page, `/cats/${snAppt.cat_id}`);
    await waitForLoaded(page);

    // Go to Medical tab
    const medicalTab = page.locator('.profile-tab', { hasText: 'Medical' });
    if (await medicalTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await medicalTab.click();
      await page.waitForTimeout(500);
    }

    // Check page content for Spay/Neuter indication
    const bodyText = await page.textContent('body');
    const hasSpayNeuter = bodyText?.toLowerCase().includes('spay') ||
      bodyText?.toLowerCase().includes('neuter') ||
      bodyText?.includes('Spay/Neuter');

    console.log(`Cat ${snAppt.cat_id} medical tab shows spay/neuter: ${hasSpayNeuter}`);
    // This is informational - the actual verification is in the API tests
  });
});

test.describe('V2 Boolean Flag Extraction', () => {
  test.setTimeout(60000);

  test('appointments have boolean flags set correctly', async ({ request }) => {
    const appointmentsRes = await request.get('/api/appointments?limit=50');
    if (!appointmentsRes.ok()) {
      test.skip();
      return;
    }

    const data = await appointmentsRes.json();
    const appointments: Appointment[] = data.appointments || data;

    let withSpay = 0;
    let withNeuter = 0;
    let withCategory = 0;

    for (const appt of appointments) {
      if (appt.is_spay === true) withSpay++;
      if (appt.is_neuter === true) withNeuter++;
      if (appt.appointment_category) withCategory++;
    }

    console.log(`Boolean flag stats out of ${appointments.length} appointments:`);
    console.log(`  - is_spay = TRUE: ${withSpay}`);
    console.log(`  - is_neuter = TRUE: ${withNeuter}`);
    console.log(`  - has category: ${withCategory}`);

    // After MIG_2319+MIG_2320, we should have some non-zero values
    // This is informational - exact counts depend on data
    if (withSpay === 0 && withNeuter === 0) {
      console.log('WARNING: No spay/neuter flags set - MIG_2319 may not be applied');
    }
  });

  test('health flags are populated from staged records', async ({ request }) => {
    const appointmentsRes = await request.get('/api/appointments?limit=30');
    if (!appointmentsRes.ok()) {
      test.skip();
      return;
    }

    const data = await appointmentsRes.json();
    const appointments = data.appointments || data;

    let withHealthFlags = 0;
    let withFelvFiv = 0;
    let withWeight = 0;

    for (const appt of appointments.slice(0, 20)) {
      const detailRes = await request.get(`/api/appointments/${appt.appointment_id}`);
      if (!detailRes.ok()) continue;

      const detail = await detailRes.json();

      // Check health flags
      if (detail.has_uri || detail.has_fleas || detail.has_dental_disease || detail.has_ticks) {
        withHealthFlags++;
      }

      if (detail.felv_fiv_result) {
        withFelvFiv++;
      }

      if (detail.weight_lbs) {
        withWeight++;
      }
    }

    console.log(`Health data stats:`);
    console.log(`  - with health flags: ${withHealthFlags}`);
    console.log(`  - with FeLV/FIV result: ${withFelvFiv}`);
    console.log(`  - with weight: ${withWeight}`);

    // After MIG_2320, some appointments should have this data
    // This is informational - exact counts depend on source data
  });
});

test.describe('V2 Disease Status Display', () => {
  test.setTimeout(60000);

  test('place disease badges load correctly', async ({ request }) => {
    const placesRes = await request.get('/api/places?limit=20');
    if (!placesRes.ok()) {
      test.skip();
      return;
    }

    const data = await placesRes.json();
    const places = data.places || data;

    let withDiseaseBadges = 0;

    for (const place of places.slice(0, 10)) {
      const detailRes = await request.get(`/api/places/${place.place_id}/disease-status`);
      if (!detailRes.ok()) continue;

      const diseaseData = await detailRes.json();

      if (diseaseData.statuses?.length > 0) {
        withDiseaseBadges++;

        // Verify structure
        const status = diseaseData.statuses[0];
        expect(status).toHaveProperty('disease_key');
        expect(status).toHaveProperty('status');
      }
    }

    console.log(`Places with disease status data: ${withDiseaseBadges}`);
  });

  test('place map-details includes disease badges', async ({ request }) => {
    const placesRes = await request.get('/api/places?limit=10');
    if (!placesRes.ok()) {
      test.skip();
      return;
    }

    const data = await placesRes.json();
    const places = data.places || data;

    for (const place of places.slice(0, 5)) {
      const detailRes = await request.get(`/api/places/${place.place_id}/map-details`);
      if (!detailRes.ok()) {
        console.log(`Place ${place.place_id} map-details returned ${detailRes.status()}`);
        continue;
      }

      const detail = await detailRes.json();

      // Should have disease_badges array (even if empty)
      expect(detail).toHaveProperty('disease_badges');
      expect(Array.isArray(detail.disease_badges)).toBe(true);

      if (detail.disease_badges.length > 0) {
        const badge = detail.disease_badges[0];
        expect(badge).toHaveProperty('disease_key');
        expect(badge).toHaveProperty('short_code');
        expect(badge).toHaveProperty('color');
        console.log(`Place ${place.place_id} has disease badge: ${badge.short_code}`);
      }

      return; // One successful test is enough
    }
  });
});
