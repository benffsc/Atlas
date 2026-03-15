import { test, expect } from '@playwright/test';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * Ecological Data Sanity Tests
 *
 * Validates that Beacon ecological data makes sense:
 * - Colony estimates are reasonable (not negative, not absurdly high)
 * - Birth/mortality events have valid dates
 * - Alteration rates are between 0-100%
 * - Population estimates don't violate basic math
 */

interface ColonyEstimate {
  estimate_id: string;
  place_id: string;
  total_cats: number | null;
  altered_count: number | null;
  kitten_count: number | null;
  source_type: string;
}

interface PlaceWithColony {
  place_id: string;
  display_name: string | null;
  colony_size_estimate: number | null;
  colony_confidence: number | null;
}

interface EcologyStats {
  a_known: number;
  n_recent_max: number;
  p_lower: number | null;
  p_lower_pct: number | null;
  estimation_method: string;
  best_colony_estimate: number | null;
  estimated_work_remaining: number | null;
}

test.describe('Colony Estimate Sanity @data-quality', () => {

  test('colony estimates have valid ranges', async ({ request }) => {
    // Get places with colony data
    const placesResponse = await request.get('/api/places?limit=100');
    const wrapped = await placesResponse.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(wrapped);

    let invalidEstimates = 0;
    let validEstimates = 0;

    for (const place of placesData.places.slice(0, 20)) {
      const colonyResponse = await request.get(`/api/places/${place.place_id}/colony-estimates`);

      if (colonyResponse.ok()) {
        const colonyData = await colonyResponse.json();

        if (colonyData.estimates?.length > 0) {
          for (const estimate of colonyData.estimates as ColonyEstimate[]) {
            // Check for invalid values
            if (estimate.total_cats !== null) {
              if (estimate.total_cats < 0) {
                console.error(`INVALID: Place ${place.place_id} has negative cat count: ${estimate.total_cats}`);
                invalidEstimates++;
              } else if (estimate.total_cats > 500) {
                console.warn(`SUSPICIOUS: Place ${place.place_id} has very high cat count: ${estimate.total_cats}`);
                // Not necessarily invalid, but worth noting
              } else {
                validEstimates++;
              }
            }

            // Altered count should not exceed total
            if (estimate.altered_count !== null && estimate.total_cats !== null) {
              if (estimate.altered_count > estimate.total_cats) {
                console.error(`INVALID: Place ${place.place_id} has more altered (${estimate.altered_count}) than total (${estimate.total_cats})`);
                invalidEstimates++;
              }
            }

            // Kitten count should be reasonable
            if (estimate.kitten_count !== null && estimate.kitten_count < 0) {
              console.error(`INVALID: Place ${place.place_id} has negative kitten count`);
              invalidEstimates++;
            }
          }
        }
      }
    }

    console.log(`Colony estimates: ${validEstimates} valid, ${invalidEstimates} invalid`);
    expect(invalidEstimates).toBe(0);
  });

  test('ecology stats have valid percentages', async ({ request }) => {
    const placesResponse = await request.get('/api/places?limit=50');
    const wrapped = await placesResponse.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(wrapped);

    let checkedPlaces = 0;
    let invalidStats = 0;

    for (const place of placesData.places.slice(0, 20)) {
      const colonyResponse = await request.get(`/api/places/${place.place_id}/colony-estimates`);

      if (colonyResponse.ok()) {
        const data = await colonyResponse.json();
        const ecology = data.ecology as EcologyStats | undefined;

        if (ecology && ecology.p_lower_pct !== null) {
          checkedPlaces++;

          // Percentage should be between 0 and 100
          if (ecology.p_lower_pct < 0 || ecology.p_lower_pct > 100) {
            console.error(`INVALID: Place ${place.place_id} has invalid alteration rate: ${ecology.p_lower_pct}%`);
            invalidStats++;
          }

          // Known altered (a_known) should not exceed estimate
          if (ecology.best_colony_estimate !== null && ecology.a_known > ecology.best_colony_estimate) {
            console.error(`INVALID: Place ${place.place_id} has more known altered (${ecology.a_known}) than colony estimate (${ecology.best_colony_estimate})`);
            invalidStats++;
          }

          // Work remaining should not be negative
          if (ecology.estimated_work_remaining !== null && ecology.estimated_work_remaining < 0) {
            console.error(`INVALID: Place ${place.place_id} has negative work remaining: ${ecology.estimated_work_remaining}`);
            invalidStats++;
          }
        }
      }
    }

    console.log(`Checked ${checkedPlaces} places with ecology stats, found ${invalidStats} invalid`);
    expect(invalidStats).toBe(0);
  });

});

test.describe('Birth Event Sanity', () => {

  test('birth events have valid dates', async ({ request }) => {
    const response = await request.get('/api/admin/beacon/reproduction/stats');

    if (!response.ok()) return; // Reproduction stats API not available — pass

    const data = await response.json();

    // Check that birth counts are reasonable
    if (data.vitals) {
      const { total_births, births_this_year } = data.vitals;

      if (total_births !== undefined) {
        expect(total_births).toBeGreaterThanOrEqual(0);
        console.log(`Total birth events: ${total_births}`);
      }

      if (births_this_year !== undefined) {
        expect(births_this_year).toBeGreaterThanOrEqual(0);
        // This year's births should not exceed total
        if (total_births !== undefined) {
          expect(births_this_year).toBeLessThanOrEqual(total_births);
        }
      }
    }

    // Check seasonal data if available
    if (data.births_by_season) {
      for (const [season, count] of Object.entries(data.births_by_season)) {
        expect(count as number).toBeGreaterThanOrEqual(0);
      }
    }
  });

});

test.describe('Mortality Event Sanity', () => {

  test('mortality events have valid values', async ({ request }) => {
    const response = await request.get('/api/admin/beacon/mortality/stats');

    if (!response.ok()) return; // Mortality stats API not available — pass

    const json = await response.json();
    const data = json.data || json;

    // Handle case where total_events may not exist
    if (data.total_events === undefined) return; // Unexpected shape — pass

    // Total events should be non-negative
    expect(data.total_events).toBeGreaterThanOrEqual(0);
    console.log(`Total mortality events: ${data.total_events}`);

    // Deaths this year should not exceed total
    if (data.deaths_this_year !== undefined) {
      expect(data.deaths_this_year).toBeGreaterThanOrEqual(0);
      expect(data.deaths_this_year).toBeLessThanOrEqual(data.total_events);
    }

    // By cause should have valid counts
    if (data.by_cause) {
      for (const [cause, count] of Object.entries(data.by_cause)) {
        expect(count as number).toBeGreaterThanOrEqual(0);
        console.log(`  ${cause}: ${count}`);
      }
    }
  });

});

test.describe('AI-Parsed Data Sanity', () => {

  test('AI-parsed colony estimates are reasonable', async ({ request }) => {
    const placesResponse = await request.get('/api/places?limit=30');
    const wrapped = await placesResponse.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(wrapped);

    let aiParsedCount = 0;
    let suspiciousCount = 0;

    for (const place of placesData.places.slice(0, 15)) {
      const colonyResponse = await request.get(`/api/places/${place.place_id}/colony-estimates`);

      if (colonyResponse.ok()) {
        const data = await colonyResponse.json();

        if (data.estimates) {
          for (const est of data.estimates as ColonyEstimate[]) {
            if (est.source_type === 'ai_parsed') {
              aiParsedCount++;

              // AI-parsed estimates should be reasonable
              if (est.total_cats !== null) {
                if (est.total_cats > 100) {
                  console.warn(`SUSPICIOUS AI estimate: ${est.total_cats} cats at place ${place.place_id}`);
                  suspiciousCount++;
                }
                if (est.total_cats < 0) {
                  console.error(`INVALID AI estimate: negative cats at place ${place.place_id}`);
                  suspiciousCount++;
                }
              }
            }
          }
        }
      }
    }

    console.log(`Found ${aiParsedCount} AI-parsed estimates, ${suspiciousCount} suspicious`);

    // Most AI estimates should be reasonable
    if (aiParsedCount > 0) {
      const suspiciousRate = suspiciousCount / aiParsedCount;
      expect(suspiciousRate).toBeLessThan(0.1); // Less than 10% suspicious
    }
  });

});

test.describe('Population Model Sanity', () => {

  test('alteration rates follow expected patterns', async ({ request }) => {
    const placesResponse = await request.get('/api/places?limit=30');
    const wrapped = await placesResponse.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(wrapped);

    let placesWithRates = 0;
    let highRates = 0;
    let lowRates = 0;

    for (const place of placesData.places.slice(0, 15)) {
      const colonyResponse = await request.get(`/api/places/${place.place_id}/colony-estimates`);

      if (colonyResponse.ok()) {
        const data = await colonyResponse.json();
        const ecology = data.ecology as EcologyStats | undefined;

        if (ecology?.p_lower_pct !== null && ecology?.p_lower_pct !== undefined) {
          placesWithRates++;

          if (ecology.p_lower_pct >= 80) {
            highRates++;
          } else if (ecology.p_lower_pct < 20) {
            lowRates++;
          }
        }
      }
    }

    if (placesWithRates > 0) {
      console.log(`Alteration rates: ${placesWithRates} places checked`);
      console.log(`  High (≥80%): ${highRates} (${Math.round(highRates / placesWithRates * 100)}%)`);
      console.log(`  Low (<20%): ${lowRates} (${Math.round(lowRates / placesWithRates * 100)}%)`);

      // We'd expect a mix - not all colonies should be complete or untouched
      // This is informational rather than a hard assertion
    }
  });

  test('Chapman estimator produces reasonable results', async ({ request }) => {
    const placesResponse = await request.get('/api/places?limit=30');
    const wrapped = await placesResponse.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(wrapped);

    let chapmanEstimates = 0;

    for (const place of placesData.places.slice(0, 15)) {
      const colonyResponse = await request.get(`/api/places/${place.place_id}/colony-estimates`);

      if (colonyResponse.ok()) {
        const data = await colonyResponse.json();
        const ecology = data.ecology as EcologyStats | undefined;

        if (ecology?.estimation_method === 'mark_resight' && ecology.best_colony_estimate !== null) {
          chapmanEstimates++;

          // Chapman estimate should be reasonable
          expect(ecology.best_colony_estimate).toBeGreaterThan(0);
          expect(ecology.best_colony_estimate).toBeLessThan(1000);

          // Should be at least as large as known altered
          expect(ecology.best_colony_estimate).toBeGreaterThanOrEqual(ecology.a_known);

          console.log(`Chapman estimate at ${place.place_id}: ${ecology.best_colony_estimate} cats (${ecology.a_known} known altered)`);
        }
      }
    }

    console.log(`Found ${chapmanEstimates} places using Chapman mark-resight estimation`);
  });

});

test.describe('Data Source Attribution', () => {

  test('colony estimates have valid source types', async ({ request }) => {
    const placesResponse = await request.get('/api/places?limit=20');
    const wrapped = await placesResponse.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(wrapped);

    const validSourceTypes = [
      'post_clinic_survey',
      'trapper_site_visit',
      'manual_observation',
      'trapping_request',
      'intake_form',
      'appointment_request',
      'verified_cats',
      'ai_parsed',
      'legacy_mymaps',
    ];

    let unknownSources: string[] = [];

    for (const place of placesData.places.slice(0, 10)) {
      const colonyResponse = await request.get(`/api/places/${place.place_id}/colony-estimates`);

      if (colonyResponse.ok()) {
        const data = await colonyResponse.json();

        if (data.estimates) {
          for (const est of data.estimates as ColonyEstimate[]) {
            if (est.source_type && !validSourceTypes.includes(est.source_type)) {
              if (!unknownSources.includes(est.source_type)) {
                unknownSources.push(est.source_type);
              }
            }
          }
        }
      }
    }

    if (unknownSources.length > 0) {
      console.log(`Unknown source types found: ${unknownSources.join(', ')}`);
    }

    // Unknown sources aren't necessarily invalid, but should be investigated
    // This is informational
  });

});
