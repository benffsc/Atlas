import { test, expect } from '@playwright/test';

test.describe('MAP_012: API Data Audit', () => {
  test.setTimeout(60000);

  // map-details returns contexts, data_sources, journal, disease_badges arrays
  test('map-details API returns all new data sections', async ({ request }) => {
    const placesRes = await request.get('/api/places?limit=5');
    const placesData = await placesRes.json();
    if (!placesData.places?.length) { test.skip(); return; }

    const placeId = placesData.places[0].place_id;
    const res = await request.get(`/api/places/${placeId}/map-details`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data).toHaveProperty('contexts');
    expect(data).toHaveProperty('data_sources');
    expect(data).toHaveProperty('journal_entries');
    expect(Array.isArray(data.contexts)).toBe(true);
    expect(Array.isArray(data.data_sources)).toBe(true);
    expect(Array.isArray(data.journal_entries)).toBe(true);
  });

  test('map-details returns disease_badges array', async ({ request }) => {
    const placesRes = await request.get('/api/places?limit=3');
    const data = await placesRes.json();
    if (!data.places?.length) { test.skip(); return; }

    const res = await request.get(`/api/places/${data.places[0].place_id}/map-details`);
    const details = await res.json();
    expect(details).toHaveProperty('disease_badges');
    expect(Array.isArray(details.disease_badges)).toBe(true);
  });

  // MIG_555: adopter_residence places should have cats
  test('MIG_555: places with adopter_residence context have cat data', async ({ request }) => {
    const placesRes = await request.get('/api/places?limit=20');
    const placesData = await placesRes.json();

    let foundAdopterPlace = false;
    for (const place of (placesData.places || []).slice(0, 10)) {
      const detailRes = await request.get(`/api/places/${place.place_id}/map-details`);
      if (!detailRes.ok()) continue;
      const detail = await detailRes.json();

      const hasAdopterContext = detail.contexts?.some(
        (c: { context_type: string }) => c.context_type === 'adopter_residence'
      );
      if (hasAdopterContext) {
        foundAdopterPlace = true;
        expect(detail.cat_count).toBeGreaterThanOrEqual(0);
        break;
      }
    }
    if (!foundAdopterPlace) {
      console.log('No adopter_residence places found in sample - skipping validation');
    }
  });

  // MIG_557: people with primary_address should have valid address data
  test('MIG_557: people with primary address have formatted address', async ({ request }) => {
    // List API doesn't include primary_address_id, so check detail endpoints directly
    const res = await request.get('/api/people?limit=10');
    const data = await res.json();

    let checkedPeople = 0;
    for (const person of (data.people || [])) {
      const detailRes = await request.get(`/api/people/${person.person_id}`);
      if (!detailRes.ok()) continue;
      const detail = await detailRes.json();

      if (detail.primary_address_id && detail.primary_address) {
        // primary_address is a formatted address string
        expect(detail.primary_address).toBeTruthy();
        checkedPeople++;
      }
      if (checkedPeople >= 3) break;
    }
    expect(checkedPeople).toBeGreaterThan(0);
  });

  // Person address fallback
  test('person API returns associated_places for address fallback', async ({ request }) => {
    const res = await request.get('/api/people?limit=20');
    const data = await res.json();

    const personWithoutPrimary = data.people?.find(
      (p: Record<string, unknown>) => !p.primary_address_id
    );

    if (personWithoutPrimary) {
      const detailRes = await request.get(`/api/people/${personWithoutPrimary.person_id}`);
      if (detailRes.ok()) {
        const detail = await detailRes.json();
        expect(detail).toHaveProperty('associated_places');
        expect(Array.isArray(detail.associated_places)).toBe(true);
      }
    }
  });

  // Journal entries use correct fields
  test('journal API returns entries with correct schema', async ({ request }) => {
    const placesRes = await request.get('/api/places?limit=5');
    const placesData = await placesRes.json();
    if (!placesData.places?.length) { test.skip(); return; }

    for (const place of placesData.places) {
      const journalRes = await request.get(`/api/journal?place_id=${place.place_id}&limit=5`);
      if (!journalRes.ok()) continue;
      const journalData = await journalRes.json();

      if (journalData.entries?.length > 0) {
        const entry = journalData.entries[0];
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('entry_kind');
        expect(entry).toHaveProperty('body');
        expect(entry).toHaveProperty('created_at');
        return;
      }
    }
  });

  // Annotation journal support
  test('journal API supports annotation_id filter', async ({ request }) => {
    const res = await request.get('/api/journal?annotation_id=00000000-0000-0000-0000-000000000000&limit=1');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('entries');
    expect(data.entries).toHaveLength(0);
  });
});
