import { test, expect } from '@playwright/test';
import { TEST_PREFIX } from './fixtures/test-data';

test.describe('Journal & Annotation Write Tests', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(30000);

  const createdIds: { annotations: string[]; journals: string[] } = {
    annotations: [],
    journals: [],
  };

  test.afterAll(async ({ request }) => {
    // Clean up journal entries first (FK dependency)
    for (const id of createdIds.journals) {
      try {
        await request.delete(`/api/journal/${id}?archived_by=e2e_test`);
      } catch { /* ignore cleanup errors */ }
    }
    // Clean up annotations
    for (const id of createdIds.annotations) {
      try {
        await request.delete(`/api/annotations/${id}`);
      } catch { /* ignore cleanup errors */ }
    }
  });

  test('create annotation via API', async ({ request }) => {
    const res = await request.post('/api/annotations', {
      data: {
        lat: 38.44,
        lng: -122.72,
        label: `${TEST_PREFIX}annotation-${Date.now()}`,
        note: 'E2E test annotation for journal testing',
        annotation_type: 'colony_sighting',
        created_by: 'e2e_test',
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.annotation_id).toBeTruthy();
    createdIds.annotations.push(data.annotation_id);
  });

  test('get annotation details via API', async ({ request }) => {
    const annotationId = createdIds.annotations[0];
    test.skip(!annotationId, 'No annotation created');

    const res = await request.get(`/api/annotations/${annotationId}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.annotation_id).toBe(annotationId);
    expect(data.label).toContain(TEST_PREFIX);
    expect(data.annotation_type).toBe('colony_sighting');
    expect(data).toHaveProperty('journal_entries');
    expect(data.journal_entries).toHaveLength(0);
  });

  test('create journal entry linked to annotation', async ({ request }) => {
    const annotationId = createdIds.annotations[0];
    test.skip(!annotationId, 'No annotation created');

    const res = await request.post('/api/journal', {
      data: {
        body: `${TEST_PREFIX}journal-annotation-note-${Date.now()}`,
        entry_kind: 'note',
        annotation_id: annotationId,
        created_by: 'e2e_test',
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.id).toBeTruthy();
    createdIds.journals.push(data.id);
  });

  test('journal entries filter by annotation_id', async ({ request }) => {
    const annotationId = createdIds.annotations[0];
    test.skip(!annotationId, 'No annotation created');

    const res = await request.get(`/api/journal?annotation_id=${annotationId}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.entries.length).toBeGreaterThanOrEqual(1);
    expect(data.entries[0].body).toContain(TEST_PREFIX);
  });

  test('annotation details include journal entries', async ({ request }) => {
    const annotationId = createdIds.annotations[0];
    test.skip(!annotationId, 'No annotation created');

    const res = await request.get(`/api/annotations/${annotationId}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.journal_entries.length).toBeGreaterThanOrEqual(1);
    expect(Number(data.journal_count)).toBeGreaterThanOrEqual(1);
  });

  test('create journal entry on a place via API', async ({ request }) => {
    // Get a real place to attach test journal to
    const placesRes = await request.get('/api/places?limit=1');
    const placesData = await placesRes.json();
    test.skip(!placesData.places?.length, 'No places available');

    const placeId = placesData.places[0].place_id;
    const res = await request.post('/api/journal', {
      data: {
        body: `${TEST_PREFIX}journal-place-note-${Date.now()}`,
        entry_kind: 'note',
        place_id: placeId,
        created_by: 'e2e_test',
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.id).toBeTruthy();
    createdIds.journals.push(data.id);
  });

  test('archive journal entry via DELETE', async ({ request }) => {
    const journalId = createdIds.journals[createdIds.journals.length - 1];
    test.skip(!journalId, 'No journal entry created');

    const res = await request.delete(`/api/journal/${journalId}?archived_by=e2e_test`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.archived).toBe(true);
  });
});
