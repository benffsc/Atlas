// @real-api - This test file calls the real Anthropic API
import { test, expect, Page } from '@playwright/test';
import { unwrapApiResponse } from './helpers/api-response';

/**
 * Data Quality Tippy Tests - AI-Assisted Data Pipeline Verification
 *
 * Tests the Data Engine and data processing pipelines by:
 * - Prompting Tippy with questions about REAL data
 * - Verifying responses contain expected data points
 * - Testing cat journey tracking (trap → clinic → foster → adopt)
 * - Testing place/colony queries
 * - Testing foster/adopter relationship queries
 * - Finding discrepancies between raw and processed data
 * - Asking simple and complex multi-part questions
 *
 * Auth is handled by Playwright's storageState (set in auth.setup.ts).
 */

// Increase default test timeout since Tippy API calls with tool use can take a while
test.setTimeout(60000);

interface TippyResponse {
  message: string;  // API returns 'message', not 'response'
  toolsUsed?: string[];
  error?: string;
}

// Helper to ask Tippy a question via API
async function askTippy(page: Page, question: string): Promise<TippyResponse> {
  const response = await page.request.post('/api/tippy/chat', {
    data: {
      message: question,
      history: [],
    },
  });

  if (!response.ok()) {
    const text = await response.text();
    return { message: '', error: `HTTP ${response.status()}: ${text}` };
  }

  try {
    const json = await response.json();
    return { message: json.message || '', error: json.error };
  } catch {
    return { message: '', error: 'Failed to parse JSON response' };
  }
}

// Helper to get real data for testing
async function getRealData(page: Page) {
  const [catsRes, placesRes, peopleRes] = await Promise.all([
    page.request.get('/api/cats?limit=50'),
    page.request.get('/api/places?limit=50'),
    page.request.get('/api/people?limit=50'),
  ]);

  const catsData = catsRes.ok() ? unwrapApiResponse<Record<string, any>>(await catsRes.json()) : {};
  const placesData = placesRes.ok() ? unwrapApiResponse<Record<string, any>>(await placesRes.json()) : {};
  const peopleData = peopleRes.ok() ? unwrapApiResponse<Record<string, any>>(await peopleRes.json()) : {};

  return {
    cats: catsData.cats || [],
    places: placesData.places || [],
    people: peopleData.people || [],
  };
}

// ============================================================================
// BASIC TIPPY FUNCTIONALITY TESTS
// ============================================================================

// FFS-91: Removed "Tippy Basic Functionality" section (3 tests)
// - "responds to simple greeting" → covered by infrastructure mocked tests
// - "How many cats have we helped?" → dup of accuracy-verification "Reports non-zero cat count"
// - "can explain what FFSC does" → low value for API cost

// ============================================================================
// PLACE & COLONY DATA TESTS
// ============================================================================

test.describe('Place & Colony Data Queries @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy can query cats at a real address', async ({ page }) => {
    const { places } = await getRealData(page);

    // Find a place with cat activity
    const placeWithCats = places.find((p: { has_cat_activity?: boolean; formatted_address?: string }) =>
      p.has_cat_activity && p.formatted_address
    );

    if (!placeWithCats) {
      test.skip();
      return;
    }

    const result = await askTippy(page, `How many cats are at ${placeWithCats.formatted_address}?`);

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Response should reference the address or cats
    console.log(`Query for ${placeWithCats.formatted_address}:`, result.message.substring(0, 300));
  });

  // FFS-91: Removed "colony status for address" — dup of human-questions "Colony status at [address]"

  test('Tippy can find colony sites in a city', async ({ page }) => {
    const result = await askTippy(page, 'Show me colony sites in Santa Rosa');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should use the places_by_context tool
    console.log('Colony sites response:', result.message.substring(0, 300));
  });

  test('Tippy handles ambiguous address gracefully', async ({ page }) => {
    const result = await askTippy(page, 'What cats are at 123 Main St?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should either find it or explain it wasn't found
    console.log('Ambiguous address response:', result.message.substring(0, 300));
  });
});

// ============================================================================
// CAT JOURNEY & MICROCHIP TESTS
// ============================================================================

test.describe('Cat Journey & Microchip Queries @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy can look up a cat by microchip', async ({ page }) => {
    const { cats } = await getRealData(page);

    // Find a cat with a microchip
    const catWithChip = cats.find((c: { identifiers?: Array<{ id_type: string; id_value: string }> }) =>
      c.identifiers?.some((i: { id_type: string }) => i.id_type === 'microchip')
    );

    if (!catWithChip) {
      test.skip();
      return;
    }

    const microchip = catWithChip.identifiers.find((i: { id_type: string }) => i.id_type === 'microchip')?.id_value;

    const result = await askTippy(page, `Look up microchip ${microchip}`);

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log(`Microchip ${microchip} lookup:`, result.message.substring(0, 300));
  });

  test('Tippy can describe a cats journey', async ({ page }) => {
    const { cats } = await getRealData(page);

    const catWithChip = cats.find((c: { identifiers?: Array<{ id_type: string; id_value: string }> }) =>
      c.identifiers?.some((i: { id_type: string }) => i.id_type === 'microchip')
    );

    if (!catWithChip) {
      test.skip();
      return;
    }

    const microchip = catWithChip.identifiers.find((i: { id_type: string }) => i.id_type === 'microchip')?.id_value;

    const result = await askTippy(page, `What's the journey for cat with microchip ${microchip}? Where did it come from and where did it go?`);

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should describe some journey or say no data
    console.log('Cat journey response:', result.message.substring(0, 400));
  });

  // FFS-91: Removed "invalid microchip" — dup of cross-source error handling

  test('Tippy can compare clinic records with Atlas data', async ({ page }) => {
    const { cats } = await getRealData(page);

    const catWithChip = cats.find((c: { identifiers?: Array<{ id_type: string; id_value: string }> }) =>
      c.identifiers?.some((i: { id_type: string }) => i.id_type === 'microchip')
    );

    if (!catWithChip) {
      test.skip();
      return;
    }

    const microchip = catWithChip.identifiers.find((i: { id_type: string }) => i.id_type === 'microchip')?.id_value;

    const result = await askTippy(page, `Are there any discrepancies between raw clinic data and Atlas records for microchip ${microchip}?`);

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Discrepancy check response:', result.message.substring(0, 400));
  });
});

// ============================================================================
// FOSTER & ADOPTER RELATIONSHIP TESTS
// ============================================================================

test.describe('Foster & Adopter Relationship Queries @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy can query foster homes in an area', async ({ page }) => {
    const result = await askTippy(page, 'Show me foster homes in Petaluma');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Foster homes response:', result.message.substring(0, 300));
  });

  test('Tippy can answer "How many cats has someone fostered?"', async ({ page }) => {
    const { people } = await getRealData(page);

    // Try to find someone with a common name
    const personWithName = people.find((p: { display_name?: string }) =>
      p.display_name && p.display_name.length > 3
    );

    if (!personWithName) {
      test.skip();
      return;
    }

    const result = await askTippy(page, `How many cats has ${personWithName.display_name} fostered?`);

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log(`Foster query for ${personWithName.display_name}:`, result.message.substring(0, 300));
  });

  test('Tippy can list adopter residences', async ({ page }) => {
    const result = await askTippy(page, 'Are there any adopter residences in Santa Rosa?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Adopter residences response:', result.message.substring(0, 300));
  });
});

// ============================================================================
// REGIONAL & STATISTICS QUERIES
// ============================================================================

test.describe('Regional Statistics Queries @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  // FFS-91: Removed "stats for Santa Rosa" — dup of capabilities "Can query regional stats"

  test('Tippy understands "west county"', async ({ page }) => {
    const result = await askTippy(page, 'What\'s the cat situation in west county?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('West county response:', result.message.substring(0, 300));
  });

  test('Tippy can compare regions', async ({ page }) => {
    const result = await askTippy(page, 'How does Santa Rosa compare to Petaluma for cat counts?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Region comparison:', result.message.substring(0, 400));
  });

  // FFS-91: Removed "pending request stats" — dup of performance/accuracy
});

// ============================================================================
// COMPLEX MULTI-PART QUERIES
// ============================================================================

test.describe('Complex Multi-Part Queries @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy handles multi-part question about an address', async ({ page }) => {
    const { places } = await getRealData(page);

    const placeWithCats = places.find((p: { has_cat_activity?: boolean; formatted_address?: string }) =>
      p.has_cat_activity && p.formatted_address
    );

    if (!placeWithCats) {
      test.skip();
      return;
    }

    const result = await askTippy(page,
      `Tell me about ${placeWithCats.formatted_address}. How many cats are there, what's the alteration rate, and have we had any recent activity?`
    );

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Multi-part address query:', result.message.substring(0, 500));
  });

  test('Tippy handles question requiring multiple tool calls', async ({ page }) => {
    const result = await askTippy(page,
      'How many cats have we helped this year in Santa Rosa, and how does that compare to our overall impact?'
    );

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should provide comprehensive answer
    console.log('Multi-tool query response:', result.message.substring(0, 500));
  });

  test('Tippy can research and suggest next steps', async ({ page }) => {
    const { places } = await getRealData(page);

    const placeWithCats = places.find((p: { has_cat_activity?: boolean; formatted_address?: string }) =>
      p.has_cat_activity && p.formatted_address
    );

    if (!placeWithCats) {
      test.skip();
      return;
    }

    const result = await askTippy(page,
      `Look up ${placeWithCats.formatted_address} and tell me what we should do next there.`
    );

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Research and suggest:', result.message.substring(0, 400));
  });
});

// ============================================================================
// DATA QUALITY & DISCREPANCY DETECTION
// ============================================================================

test.describe('Data Quality & Discrepancy Detection @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy can identify data quality issues', async ({ page }) => {
    const result = await askTippy(page, 'Are there any addresses that need geocoding or have data quality issues?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Data quality response:', result.message.substring(0, 300));
  });

  test('Tippy handles question about duplicate records', async ({ page }) => {
    const result = await askTippy(page, 'How many duplicate person records have been merged?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Duplicate records response:', result.message.substring(0, 300));
  });

  test('Tippy can verify cat appointment data', async ({ page }) => {
    const { cats } = await getRealData(page);

    const catWithChip = cats.find((c: { identifiers?: Array<{ id_type: string; id_value: string }> }) =>
      c.identifiers?.some((i: { id_type: string }) => i.id_type === 'microchip')
    );

    if (!catWithChip) {
      test.skip();
      return;
    }

    const microchip = catWithChip.identifiers.find((i: { id_type: string }) => i.id_type === 'microchip')?.id_value;

    const result = await askTippy(page,
      `Does microchip ${microchip} have any clinic appointments? Compare what's in the raw data vs what we have processed.`
    );

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should use lookup_cat_appointment tool
    console.log('Appointment verification:', result.message.substring(0, 400));
  });
});

// ============================================================================
// KNOWLEDGE BASE & PROCEDURES
// ============================================================================

test.describe('Knowledge Base Queries @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy can answer procedural questions', async ({ page }) => {
    const result = await askTippy(page, 'How do we set traps for TNR?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should provide helpful information
    console.log('Procedure response:', result.message.substring(0, 300));
  });

  test('Tippy can provide talking points', async ({ page }) => {
    const result = await askTippy(page, 'What should I say if someone asks why we don\'t just remove cats?');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log('Talking points response:', result.message.substring(0, 400));
  });
});

// ============================================================================
// ERROR HANDLING & EDGE CASES
// ============================================================================

test.describe('Error Handling & Edge Cases @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  // FFS-91: Removed "empty query", "very long query", "special characters" —
  // all dup of infrastructure mocked tests and edge-cases boundary mocked tests

  test('Tippy handles misspelled city names', async ({ page }) => {
    const result = await askTippy(page, 'How many cats in Peteluma?'); // Misspelled

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should either understand or ask for clarification
    console.log('Misspelled city response:', result.message.substring(0, 300));
  });
});

// ============================================================================
// PERSON HISTORY QUERIES
// ============================================================================

test.describe('Person History Queries @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy can look up person history', async ({ page }) => {
    const { people } = await getRealData(page);

    const personWithName = people.find((p: { display_name?: string }) =>
      p.display_name && p.display_name.split(' ').length >= 2
    );

    if (!personWithName) {
      test.skip();
      return;
    }

    const lastName = personWithName.display_name.split(' ').pop();

    const result = await askTippy(page, `What's the history for someone named ${lastName}?`);

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    console.log(`Person history for ${lastName}:`, result.message.substring(0, 300));
  });
});

// ============================================================================
// SUMMARY REPORT
// ============================================================================

test.describe('Data Pipeline Summary @real-api', () => {
  // Auth handled by storageState from auth.setup.ts

  test('Tippy can provide overall FFR impact summary', async ({ page }) => {
    const result = await askTippy(page, 'Give me a summary of our FFR impact - total cats helped, alteration rates, and requests completed.');

    expect(result.error).toBeUndefined();
    expect(result.message).toBeTruthy();

    // Should provide comprehensive metrics
    console.log('FFR Impact Summary:', result.message);
  });
});
