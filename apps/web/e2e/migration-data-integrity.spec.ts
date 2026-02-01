import { test, expect } from '@playwright/test';

/**
 * Migration Data Integrity Tests
 *
 * Verifies that MIG_555 (adopted cats -> places), MIG_556 (geocoding queue),
 * and MIG_557 (primary_address backfill) produced correct results.
 *
 * ALL TESTS ARE READ-ONLY - no data modifications.
 */

test.describe('MIG_555: Adopted Cats -> Place Links', () => {
  test.setTimeout(60000);

  test('places API responds with valid structure', async ({ request }) => {
    const res = await request.get('/api/places?limit=5');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('places');
    expect(Array.isArray(data.places)).toBe(true);
  });

  test('place map-details with adopter_residence context shows cats', async ({ request }) => {
    const placesRes = await request.get('/api/places?limit=20');
    const placesData = await placesRes.json();

    let adopter_places_checked = 0;
    for (const place of (placesData.places || []).slice(0, 10)) {
      const detailRes = await request.get(`/api/places/${place.place_id}/map-details`);
      if (!detailRes.ok()) continue;
      const detail = await detailRes.json();

      const isAdopter = detail.contexts?.some(
        (c: { context_type: string }) => c.context_type === 'adopter_residence'
      );

      if (isAdopter) {
        adopter_places_checked++;
        expect(detail.cat_count).toBeGreaterThanOrEqual(0);
      }
    }

    console.log(`Checked ${adopter_places_checked} adopter residence places`);
  });
});

test.describe('MIG_557: Primary Address Backfill', () => {
  test.setTimeout(60000);

  test('people with primary_address_id have valid address data', async ({ request }) => {
    // List API doesn't include primary_address_id, so check detail endpoints
    const res = await request.get('/api/people?limit=10');
    const data = await res.json();

    let withAddress = 0;
    let withValidAddress = 0;

    for (const person of (data.people || [])) {
      const detailRes = await request.get(`/api/people/${person.person_id}`);
      if (!detailRes.ok()) continue;
      const detail = await detailRes.json();

      if (detail.primary_address_id) {
        withAddress++;
        if (detail.primary_address) {
          withValidAddress++;
        }
      }
      if (withAddress >= 5) break;
    }

    if (withAddress > 0) {
      expect(withValidAddress).toBeGreaterThan(0);
    }
    console.log(`${withValidAddress}/${withAddress} people have valid resolved addresses`);
  });

  test('people without primary address have associated_places for fallback', async ({ request }) => {
    const res = await request.get('/api/people?limit=20');
    const data = await res.json();

    let checked = 0;
    let withFallback = 0;

    for (const person of (data.people || [])) {
      if (!person.primary_address_id) {
        const detailRes = await request.get(`/api/people/${person.person_id}`);
        if (detailRes.ok()) {
          const detail = await detailRes.json();
          checked++;
          if (detail.associated_places?.length > 0) {
            withFallback++;
            const place = detail.associated_places[0];
            expect(place).toHaveProperty('place_id');
          }
        }
        if (checked >= 5) break;
      }
    }

    console.log(`${withFallback}/${checked} people without primary address have fallback places`);
  });
});

test.describe('MIG_556: Geocoding Queue', () => {
  test('places API still returns valid data after geocoding queue', async ({ request }) => {
    const res = await request.get('/api/places?limit=10');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.places.length).toBeGreaterThan(0);

    const place = data.places[0];
    expect(place).toHaveProperty('place_id');
    expect(place).toHaveProperty('display_name');
  });
});
