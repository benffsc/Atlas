/**
 * Data Gaps Analysis Tests
 *
 * These tests identify:
 * 1. DATA GAPS - Missing or incomplete data that should be filled
 * 2. UI IMPROVEMENT OPPORTUNITIES - Fields hidden or hard to access
 * 3. AI EXTRACTION EASY WINS - Structured data buried in notes that can be safely extracted
 *
 * Focus on LOW-RISK extractions with high confidence patterns.
 *
 * ALL TESTS ARE READ-ONLY and produce analysis reports.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// HELPERS
// ============================================================================

interface AnalysisResult {
  category: string;
  count: number;
  samples: string[];
  recommendation: string;
  priority: "high" | "medium" | "low";
  extractionRisk: "low" | "medium" | "high";
}

async function fetchJson(
  request: { get: (url: string, options?: { timeout?: number }) => Promise<{ ok: () => boolean; json: () => Promise<unknown> }> },
  url: string
): Promise<unknown> {
  try {
    const res = await request.get(url, { timeout: 30000 });
    if (!res.ok()) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ============================================================================
// ATLAS-SPECIFIC PATTERNS
// ============================================================================
// Based on actual Atlas data structures (see CLAUDE.md, formatters.ts, guards.ts)

// Phone: US 10-digit with valid area code (2-9 first digit)
// Uses same logic as extractPhone() in lib/formatters.ts
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g;

// Email: Standard format
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

// Cat count: Atlas uses estimated_cat_count (int) with cat_count_semantic
const CAT_COUNT_PATTERN = /\b(\d{1,3})\s*(?:cats?|kitties?|felines?|kittens?)\b/gi;

// Address: Matches Atlas place.normalized_address patterns
const ADDRESS_PATTERN = /\b(\d{1,5})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Blvd|Boulevard)\b/gi;

// Microchip: Standard 15-digit format (matches isValidMicrochip() in guards.ts)
// Atlas field is 'microchip' (not 'microchip_id')
const MICROCHIP_PATTERN = /\b(\d{15})\b/g;
const MICROCHIP_LABELED_PATTERN = /(?:chip|microchip)[:\s#]+(\d{15})/gi;

// Ear tip: In Atlas, has_ear_tip is on ops.appointments, detected from service lines
// This pattern is for finding mentions in notes to cross-reference
const EAR_TIP_PATTERN = /\b(?:ear\s*tip(?:ped)?|tipped|left\s*ear|right\s*ear|notch(?:ed)?)\b/gi;

// TNR date: Atlas uses altered_status as "Yes"/"No" string (not boolean)
const TNR_DATE_PATTERN = /\b(?:TNR|spayed|neutered|fixed|altered)(?:\s+on)?\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi;

// Colony size: Stored in ops.place_colony_estimates table
const COLONY_SIZE_PATTERN = /\b(?:colony|group|population)\s+(?:of\s+)?(?:about\s+)?(\d{1,3})\b/gi;

// ClinicHQ Animal ID: Format "YY-NNNN" (stored in clinichq_animal_id)
const CLINICHQ_ID_PATTERN = /\b(\d{2})-(\d{2,5})\b/g;

// ============================================================================
// DATA GAP DETECTION TESTS
// ============================================================================

test.describe("Data Gap Detection @data-quality", () => {
  test.setTimeout(120000);

  test("Cats missing microchip data", async ({ request }) => {
    // NOTE: Cat list API uses 'microchip' and 'has_microchip' fields
    const data = await fetchJson(request, "/api/cats?limit=500") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
        microchip: string | null;
        has_microchip: boolean;
        quality_tier?: string;
      }>;
      total?: number;
    } | null;

    if (!data?.cats) return; // API unavailable — pass

    // has_microchip is computed from microchip field
    const missingMicrochip = data.cats.filter((c) => !c.has_microchip);
    const byQuality: Record<string, number> = {};

    for (const cat of missingMicrochip) {
      const quality = cat.quality_tier || "unknown";
      byQuality[quality] = (byQuality[quality] || 0) + 1;
    }

    console.log("\n=== CATS MISSING MICROCHIP ===");
    console.log(`Total: ${missingMicrochip.length} / ${data.cats.length} (${Math.round(missingMicrochip.length / data.cats.length * 100)}%)`);
    console.log(`Database total: ${data.total || 'unknown'}`);
    console.log("By quality tier:", byQuality);
    console.log("Sample:", missingMicrochip.slice(0, 5).map((c) => `${c.display_name} (${c.cat_id.slice(0,8)})`));

    // This is informational, not a failure
    expect(true).toBeTruthy();
  });

  test("Cats missing place links", async ({ request }) => {
    // NOTE: Cat list API doesn't support include_* params
    // We check the cat detail endpoint for place relationships
    const data = await fetchJson(request, "/api/cats?limit=100") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
        source_system?: string;
      }>;
    } | null;
    if (!data?.cats) return; // API unavailable — pass

    // Spot-check a sample of cats for place links
    let missingPlace = 0;
    let checkedCount = 0;
    const sampleSize = Math.min(20, data.cats.length);

    for (let i = 0; i < sampleSize; i++) {
      const cat = data.cats[i];
      const detail = await fetchJson(request, `/api/cats/${cat.cat_id}`) as {
        places?: unknown[];
      } | null;
      checkedCount++;
      if (!detail?.places || detail.places.length === 0) {
        missingPlace++;
      }
    }

    console.log("\n=== CATS MISSING PLACE LINKS ===");
    console.log(`Sample: ${missingPlace} / ${checkedCount} checked (${Math.round(missingPlace / checkedCount * 100)}%)`);
    console.log(`Total cats in DB: ${data.cats.length}`);

    expect(true).toBeTruthy();
  });

  test("People missing contact info", async ({ request }) => {
    const data = await fetchJson(request, "/api/people?limit=500") as { people?: Array<{ person_id: string; display_name: string; email?: string; phone?: string; source_system?: string }> } | null;
    if (!data?.people) return; // API unavailable — pass

    const missingEmail = data.people.filter((p) => !p.email);
    const missingPhone = data.people.filter((p) => !p.phone);
    const missingBoth = data.people.filter((p) => !p.email && !p.phone);

    console.log("\n=== PEOPLE MISSING CONTACT INFO ===");
    console.log(`Missing email: ${missingEmail.length} (${Math.round(missingEmail.length / data.people.length * 100)}%)`);
    console.log(`Missing phone: ${missingPhone.length} (${Math.round(missingPhone.length / data.people.length * 100)}%)`);
    console.log(`Missing both: ${missingBoth.length} (${Math.round(missingBoth.length / data.people.length * 100)}%)`);

    expect(true).toBeTruthy();
  });

  test("Places missing coordinates", async ({ request }) => {
    const data = await fetchJson(request, "/api/places?limit=500") as { places?: Array<{ place_id: string; display_name: string; lat?: number; lng?: number; latitude?: number; longitude?: number }> } | null;
    if (!data?.places) return; // API unavailable — pass

    const missingCoords = data.places.filter((p) =>
      (!p.lat && !p.latitude) || (!p.lng && !p.longitude)
    );

    console.log("\n=== PLACES MISSING COORDINATES ===");
    console.log(`Total: ${missingCoords.length} / ${data.places.length} (${Math.round(missingCoords.length / data.places.length * 100)}%)`);
    console.log("Sample:", missingCoords.slice(0, 5).map((p) => p.display_name));

    expect(true).toBeTruthy();
  });

  test("Requests missing trapper assignment", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=500") as { requests?: Array<{ request_id: string; request_number?: string; status?: string; trapper_id?: string; trapper_assignments?: unknown[] }> } | null;
    if (!data?.requests) return; // API unavailable — pass

    const activeStatuses = ["new", "triaged", "scheduled", "in_progress"];
    const activeRequests = data.requests.filter((r) => activeStatuses.includes(r.status || ""));
    const missingTrapper = activeRequests.filter((r) =>
      !r.trapper_id && (!r.trapper_assignments || r.trapper_assignments.length === 0)
    );

    console.log("\n=== ACTIVE REQUESTS MISSING TRAPPER ===");
    console.log(`Total active: ${activeRequests.length}`);
    console.log(`Missing trapper: ${missingTrapper.length} (${Math.round(missingTrapper.length / (activeRequests.length || 1) * 100)}%)`);

    expect(true).toBeTruthy();
  });

  test("Requests missing colony size estimate", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=500") as { requests?: Array<{ request_id: string; request_number?: string; estimated_cat_count?: number; total_cats_reported?: number }> } | null;
    if (!data?.requests) return; // API unavailable — pass

    const missingCount = data.requests.filter((r) =>
      !r.estimated_cat_count && !r.total_cats_reported
    );

    console.log("\n=== REQUESTS MISSING CAT COUNT ===");
    console.log(`Total: ${missingCount.length} / ${data.requests.length} (${Math.round(missingCount.length / data.requests.length * 100)}%)`);

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// AI EXTRACTION EASY WINS - NOTES ANALYSIS
// ============================================================================

test.describe("AI Extraction Opportunities - Notes Analysis", () => {
  test.setTimeout(120000);

  test("Phone numbers in request notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=200") as { requests?: Array<{ request_id: string; notes?: string; description?: string; situation_description?: string }> } | null;
    if (!data?.requests) return; // API unavailable — pass

    const findings: Array<{ id: string; phones: string[]; source: string }> = [];

    for (const req of data.requests) {
      const textFields = [req.notes, req.description, req.situation_description].filter(Boolean).join(" ");
      const phones = textFields.match(PHONE_PATTERN);

      if (phones && phones.length > 0) {
        findings.push({
          id: req.request_id,
          phones: [...new Set(phones)],
          source: "request_notes",
        });
      }
    }

    console.log("\n=== PHONE NUMBERS IN REQUEST NOTES ===");
    console.log(`Found ${findings.length} requests with extractable phone numbers`);
    console.log("Samples:", findings.slice(0, 5));
    console.log("\nRECOMMENDATION: These can be safely extracted and linked to people");
    console.log("RISK: Low - Phone pattern is highly specific");

    expect(true).toBeTruthy();
  });

  test("Email addresses in notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=200") as { requests?: Array<{ request_id: string; notes?: string; description?: string }> } | null;
    if (!data?.requests) return; // API unavailable — pass

    const findings: Array<{ id: string; emails: string[] }> = [];

    for (const req of data.requests) {
      const textFields = [req.notes, req.description].filter(Boolean).join(" ");
      const emails = textFields.match(EMAIL_PATTERN);

      if (emails && emails.length > 0) {
        // Filter out known org emails (soft blacklist)
        const validEmails = emails.filter((e) =>
          !e.includes("forgottenfelines") &&
          !e.includes("marinferals") &&
          !e.includes("@test.")
        );

        if (validEmails.length > 0) {
          findings.push({
            id: req.request_id,
            emails: [...new Set(validEmails)],
          });
        }
      }
    }

    console.log("\n=== EMAIL ADDRESSES IN REQUEST NOTES ===");
    console.log(`Found ${findings.length} requests with extractable emails`);
    console.log("Samples:", findings.slice(0, 5));
    console.log("\nRECOMMENDATION: Extract and link to people (check soft blacklist first)");
    console.log("RISK: Low - Email pattern is highly specific");

    expect(true).toBeTruthy();
  });

  test("Cat counts in descriptions", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=200") as { requests?: Array<{ request_id: string; estimated_cat_count?: number; notes?: string; description?: string; situation_description?: string }> } | null;
    if (!data?.requests) return; // API unavailable — pass

    const findings: Array<{ id: string; extracted: number; current: number | undefined }> = [];

    for (const req of data.requests) {
      const textFields = [req.notes, req.description, req.situation_description].filter(Boolean).join(" ");
      const matches = textFields.matchAll(CAT_COUNT_PATTERN);

      for (const match of matches) {
        const count = parseInt(match[1], 10);
        if (count > 0 && count < 100) { // Reasonable range
          if (!req.estimated_cat_count || req.estimated_cat_count === 0) {
            findings.push({
              id: req.request_id,
              extracted: count,
              current: req.estimated_cat_count,
            });
          }
        }
      }
    }

    console.log("\n=== CAT COUNTS EXTRACTABLE FROM NOTES ===");
    console.log(`Found ${findings.length} requests where cat count can be extracted`);
    console.log("Samples:", findings.slice(0, 10));
    console.log("\nRECOMMENDATION: Auto-populate estimated_cat_count from notes");
    console.log("RISK: Low - Pattern is specific, values are reasonable range");

    expect(true).toBeTruthy();
  });

  test("Addresses in request descriptions", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=200") as { requests?: Array<{ request_id: string; notes?: string; description?: string; situation_description?: string }> } | null;
    if (!data?.requests) return; // API unavailable — pass

    const findings: Array<{ id: string; addresses: string[] }> = [];

    for (const req of data.requests) {
      const textFields = [req.notes, req.description, req.situation_description].filter(Boolean).join(" ");
      const matches = textFields.matchAll(ADDRESS_PATTERN);

      const addresses: string[] = [];
      for (const match of matches) {
        addresses.push(match[0]);
      }

      if (addresses.length > 0) {
        findings.push({
          id: req.request_id,
          addresses: [...new Set(addresses)],
        });
      }
    }

    console.log("\n=== ADDRESSES IN REQUEST NOTES ===");
    console.log(`Found ${findings.length} requests with extractable addresses`);
    console.log("Samples:", findings.slice(0, 5));
    console.log("\nRECOMMENDATION: Extract and geocode to create/link places");
    console.log("RISK: Medium - May need validation, could be references not actual locations");

    expect(true).toBeTruthy();
  });

  test("Microchip numbers in cat notes", async ({ request }) => {
    // NOTE: Cat list API doesn't include notes - need to fetch detail for sampling
    // Cat list uses 'microchip' field (not 'microchip_id')
    const listData = await fetchJson(request, "/api/cats?limit=100") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
        microchip: string | null;  // Correct field name
        has_microchip: boolean;
      }>;
    } | null;

    if (!listData?.cats) return; // API unavailable — pass

    const findings: Array<{ id: string; name: string; extracted: string; hasMicrochip: boolean }> = [];
    const catsToCheck = listData.cats.filter((c) => !c.has_microchip).slice(0, 30);

    for (const cat of catsToCheck) {
      const detail = await fetchJson(request, `/api/cats/${cat.cat_id}`) as {
        notes?: string;
        description?: string;
        microchip: string | null;
      } | null;

      if (!detail?.notes && !detail?.description) continue;

      const textFields = [detail.notes, detail.description].filter(Boolean).join(" ");
      const matches = textFields.matchAll(MICROCHIP_PATTERN);

      for (const match of matches) {
        findings.push({
          id: cat.cat_id,
          name: cat.display_name,
          extracted: match[1],
          hasMicrochip: !!detail.microchip,
        });
      }
    }

    console.log("\n=== MICROCHIP NUMBERS IN CAT NOTES ===");
    console.log(`Checked ${catsToCheck.length} cats without microchip`);
    console.log(`Found ${findings.length} cats with microchip in notes`);
    console.log("NEW extractions possible:", findings.filter((f) => !f.hasMicrochip).length);
    console.log("\nRECOMMENDATION: Extract and populate microchip field");
    console.log("RISK: Low - 15-digit microchip format is very specific");

    expect(true).toBeTruthy();
  });

  test("Ear tip status in notes", async ({ request }) => {
    // NOTE: In Atlas, has_ear_tip is on ops.appointments table (detected from service lines)
    // This test looks for mentions in cat notes that COULD indicate ear tip status
    // Cat list API doesn't include notes - need to sample detail pages
    const listData = await fetchJson(request, "/api/cats?limit=100") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
      }>;
    } | null;

    if (!listData?.cats) return; // API unavailable — pass

    const findings: Array<{ id: string; name: string; mention: string }> = [];
    const sampleSize = Math.min(50, listData.cats.length);

    for (let i = 0; i < sampleSize; i++) {
      const cat = listData.cats[i];
      const detail = await fetchJson(request, `/api/cats/${cat.cat_id}`) as {
        notes?: string;
        description?: string;
      } | null;

      if (!detail?.notes && !detail?.description) continue;

      const textFields = [detail.notes, detail.description].filter(Boolean).join(" ");
      const matches = textFields.matchAll(EAR_TIP_PATTERN);

      for (const match of matches) {
        findings.push({
          id: cat.cat_id,
          name: cat.display_name,
          mention: match[0],
        });
        break; // One mention per cat is enough
      }
    }

    console.log("\n=== EAR TIP MENTIONS IN CAT NOTES ===");
    console.log(`Checked ${sampleSize} cats`);
    console.log(`Found ${findings.length} cats with ear tip mentioned in notes`);
    console.log("Samples:", findings.slice(0, 10));
    console.log("\nNOTE: has_ear_tip is on appointments table in Atlas (from service lines)");
    console.log("RECOMMENDATION: Cross-reference with appointment data");
    console.log("RISK: Low - Ear tip terminology is unambiguous");

    expect(true).toBeTruthy();
  });

  test("Colony size estimates in place notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/places?limit=200") as { places?: Array<{ place_id: string; display_name: string; notes?: string; description?: string }> } | null;
    if (!data?.places) return; // API unavailable — pass

    const findings: Array<{ id: string; name: string; extractedSize: number }> = [];

    for (const place of data.places) {
      const textFields = [place.notes, place.description].filter(Boolean).join(" ");
      const matches = textFields.matchAll(COLONY_SIZE_PATTERN);

      for (const match of matches) {
        const size = parseInt(match[1], 10);
        if (size > 0 && size < 200) { // Reasonable colony size
          findings.push({
            id: place.place_id,
            name: place.display_name,
            extractedSize: size,
          });
        }
      }
    }

    console.log("\n=== COLONY SIZE IN PLACE NOTES ===");
    console.log(`Found ${findings.length} places with colony size in notes`);
    console.log("Samples:", findings.slice(0, 10));
    console.log("\nRECOMMENDATION: Create place_colony_estimates records");
    console.log("RISK: Low - Colony/population terminology is specific");

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// JOURNAL ENTRIES ANALYSIS
// ============================================================================

test.describe("Journal Entries - Extraction Opportunities", () => {
  test.setTimeout(120000);

  test("Structured data in journal entries", async ({ request }) => {
    // Fetch recent journal entries
    const data = await fetchJson(request, "/api/journal?limit=200") as { entries?: Array<{ entry_id: string; body?: string; entity_type?: string; entity_id?: string }> } | null;
    if (!data?.entries) return; // API unavailable — pass

    const phoneFindings: string[] = [];
    const emailFindings: string[] = [];
    const addressFindings: string[] = [];
    const catCountFindings: string[] = [];

    for (const entry of data.entries) {
      const text = entry.body || "";

      if (PHONE_PATTERN.test(text)) phoneFindings.push(entry.entry_id);
      if (EMAIL_PATTERN.test(text)) emailFindings.push(entry.entry_id);
      if (ADDRESS_PATTERN.test(text)) addressFindings.push(entry.entry_id);
      if (CAT_COUNT_PATTERN.test(text)) catCountFindings.push(entry.entry_id);

      // Reset regex lastIndex
      PHONE_PATTERN.lastIndex = 0;
      EMAIL_PATTERN.lastIndex = 0;
      ADDRESS_PATTERN.lastIndex = 0;
      CAT_COUNT_PATTERN.lastIndex = 0;
    }

    console.log("\n=== STRUCTURED DATA IN JOURNAL ENTRIES ===");
    console.log(`Entries with phone numbers: ${phoneFindings.length}`);
    console.log(`Entries with emails: ${emailFindings.length}`);
    console.log(`Entries with addresses: ${addressFindings.length}`);
    console.log(`Entries with cat counts: ${catCountFindings.length}`);
    console.log("\nRECOMMENDATION: Extract and link to associated entities");

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// UI IMPROVEMENT OPPORTUNITIES
// ============================================================================

test.describe("UI Improvement Opportunities", () => {
  test.setTimeout(60000);

  test("Fields often in notes but not in structured fields", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=100") as { requests?: Array<{ request_id: string; notes?: string; description?: string; estimated_cat_count?: number; email?: string; phone?: string }> } | null;
    if (!data?.requests) return; // API unavailable — pass

    let catCountInNotesButNotField = 0;
    let phoneInNotesButNotField = 0;
    let emailInNotesButNotField = 0;

    for (const req of data.requests) {
      const text = [req.notes, req.description].filter(Boolean).join(" ");

      if (!req.estimated_cat_count && CAT_COUNT_PATTERN.test(text)) {
        catCountInNotesButNotField++;
      }
      if (!req.phone && PHONE_PATTERN.test(text)) {
        phoneInNotesButNotField++;
      }
      if (!req.email && EMAIL_PATTERN.test(text)) {
        emailInNotesButNotField++;
      }

      // Reset lastIndex
      CAT_COUNT_PATTERN.lastIndex = 0;
      PHONE_PATTERN.lastIndex = 0;
      EMAIL_PATTERN.lastIndex = 0;
    }

    console.log("\n=== UI FIELD IMPROVEMENT OPPORTUNITIES ===");
    console.log(`Cat count in notes but field empty: ${catCountInNotesButNotField}`);
    console.log(`Phone in notes but field empty: ${phoneInNotesButNotField}`);
    console.log(`Email in notes but field empty: ${emailInNotesButNotField}`);
    console.log("\nRECOMMENDATION: Add smart field suggestions in UI");
    console.log("- Show 'We found a phone number in notes: XXX. Add it?' prompt");
    console.log("- Auto-populate suggestions when creating/editing");

    expect(true).toBeTruthy();
  });

  test("Data hidden in collapsed sections", async ({ page, request }) => {
    // Check which data is currently in collapsed sections
    const analyses: Array<{ page: string; collapsed: string[]; recommendation: string }> = [];

    // This would need actual page inspection
    // For now, document expected improvements

    console.log("\n=== DATA VISIBILITY RECOMMENDATIONS ===");
    console.log("1. Colony estimates: Should be in sidebar (DONE with TwoColumnLayout)");
    console.log("2. Disease status: Should be always visible for places");
    console.log("3. Contact info: Should be in person sidebar");
    console.log("4. Microchip: Should be prominent on cat cards");
    console.log("5. Trapper assignment: Should be visible on request list");

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// CROSS-REFERENCE OPPORTUNITIES
// ============================================================================

test.describe("Cross-Reference Opportunities", () => {
  test.setTimeout(120000);

  test("Cats at same address but not linked", async ({ request }) => {
    // NOTE: Place list API doesn't support include_cats param
    // We need to check cat detail pages for place links
    const catsData = await fetchJson(request, "/api/cats?limit=100") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
      }>;
    } | null;

    if (!catsData?.cats) return; // API unavailable — pass

    // Sample cats to check for place links
    let catsWithNoPlace = 0;
    const sampleSize = Math.min(30, catsData.cats.length);

    for (let i = 0; i < sampleSize; i++) {
      const cat = catsData.cats[i];
      const detail = await fetchJson(request, `/api/cats/${cat.cat_id}`) as {
        places?: Array<{ place_id: string }>;
      } | null;

      if (!detail?.places || detail.places.length === 0) {
        catsWithNoPlace++;
      }
    }

    console.log("\n=== CATS POTENTIALLY MISSING PLACE LINKS ===");
    console.log(`Sample: ${catsWithNoPlace} / ${sampleSize} cats have no place link`);
    console.log(`Estimated total: ~${Math.round(catsWithNoPlace / sampleSize * catsData.cats.length)} cats`);
    console.log("\nRECOMMENDATION: Link cats to places via:");
    console.log("1. Person's primary address");
    console.log("2. Appointment location (inferred_place_id)");
    console.log("3. Request location");

    expect(true).toBeTruthy();
  });

  test("People at same address not linked", async ({ request }) => {
    // NOTE: Place list API doesn't support include_people param
    // We sample place detail pages for people relationships
    const placesData = await fetchJson(request, "/api/places?limit=50") as {
      places?: Array<{
        place_id: string;
        display_name: string;
      }>;
    } | null;

    if (!placesData?.places) return; // API unavailable — pass

    const multiPersonPlaces: Array<{ place: string; peopleCount: number; people: string[] }> = [];
    const sampleSize = Math.min(30, placesData.places.length);

    for (let i = 0; i < sampleSize; i++) {
      const place = placesData.places[i];
      const detail = await fetchJson(request, `/api/places/${place.place_id}`) as {
        people?: Array<{ person_id: string; display_name: string }>;
      } | null;

      if (detail?.people && detail.people.length > 1) {
        multiPersonPlaces.push({
          place: place.display_name,
          peopleCount: detail.people.length,
          people: detail.people.map((p) => p.display_name),
        });
      }
    }

    console.log("\n=== PLACES WITH MULTIPLE PEOPLE ===");
    console.log(`Found ${multiPersonPlaces.length} places with 2+ people (from ${sampleSize} sampled)`);
    console.log("Samples:", multiPersonPlaces.slice(0, 5));
    console.log("\nRECOMMENDATION: Consider household linking for these");

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// SUMMARY REPORT
// ============================================================================

test.describe("Summary Report", () => {
  test.setTimeout(180000);

  test("Generate extraction opportunity summary", async ({ request }) => {
    const results: AnalysisResult[] = [];

    // Fetch all data
    const requests = await fetchJson(request, "/api/requests?limit=500") as { requests?: Array<{ notes?: string; description?: string; situation_description?: string; estimated_cat_count?: number; phone?: string; email?: string }> } | null;
    const cats = await fetchJson(request, "/api/cats?limit=500") as { cats?: Array<{ notes?: string; description?: string; microchip_id?: string; has_ear_tip?: boolean }> } | null;
    const places = await fetchJson(request, "/api/places?limit=500") as { places?: Array<{ notes?: string; description?: string }> } | null;

    // Analyze requests
    if (requests?.requests) {
      let phonesExtractable = 0;
      let emailsExtractable = 0;
      let catCountsExtractable = 0;

      for (const req of requests.requests) {
        const text = [req.notes, req.description, req.situation_description].filter(Boolean).join(" ");

        if (!req.phone && PHONE_PATTERN.test(text)) phonesExtractable++;
        if (!req.email && EMAIL_PATTERN.test(text)) emailsExtractable++;
        if (!req.estimated_cat_count && CAT_COUNT_PATTERN.test(text)) catCountsExtractable++;

        PHONE_PATTERN.lastIndex = 0;
        EMAIL_PATTERN.lastIndex = 0;
        CAT_COUNT_PATTERN.lastIndex = 0;
      }

      if (phonesExtractable > 0) {
        results.push({
          category: "Phone numbers in request notes",
          count: phonesExtractable,
          samples: [],
          recommendation: "Auto-extract and link to requester",
          priority: "high",
          extractionRisk: "low",
        });
      }

      if (catCountsExtractable > 0) {
        results.push({
          category: "Cat counts in request notes",
          count: catCountsExtractable,
          samples: [],
          recommendation: "Auto-populate estimated_cat_count",
          priority: "medium",
          extractionRisk: "low",
        });
      }
    }

    // NOTE: Cat analysis requires fetching detail pages since list doesn't include notes
    // This summary provides a high-level estimate based on patterns
    // The detailed tests above do proper sampling

    // Add placeholders for cat extraction opportunities
    results.push({
      category: "Ear tip status in cat notes",
      count: 0, // Determined by detailed test
      samples: [],
      recommendation: "Cross-reference with appointment service lines",
      priority: "medium",
      extractionRisk: "low",
    });

    results.push({
      category: "Microchip IDs in cat notes",
      count: 0, // Determined by detailed test
      samples: [],
      recommendation: "Extract 15-digit microchips and set microchip field",
      priority: "high",
      extractionRisk: "low",
    });

    // Sort by priority and risk
    results.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const riskOrder = { low: 0, medium: 1, high: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority] ||
             riskOrder[a.extractionRisk] - riskOrder[b.extractionRisk];
    });

    console.log("\n========================================");
    console.log("   AI EXTRACTION OPPORTUNITY SUMMARY   ");
    console.log("========================================\n");

    for (const result of results) {
      console.log(`${result.priority.toUpperCase()} PRIORITY | ${result.extractionRisk.toUpperCase()} RISK`);
      console.log(`Category: ${result.category}`);
      console.log(`Count: ${result.count}`);
      console.log(`Recommendation: ${result.recommendation}`);
      console.log("---");
    }

    console.log("\n========================================");
    console.log("   RECOMMENDED NEXT STEPS              ");
    console.log("========================================\n");
    console.log("1. Create migration to extract ear tip status from notes");
    console.log("2. Create migration to extract phone numbers from request notes");
    console.log("3. Create migration to extract cat counts from descriptions");
    console.log("4. Add UI suggestions for structured field population");
    console.log("5. Consider real-time extraction on note save");

    expect(true).toBeTruthy();
  });
});
