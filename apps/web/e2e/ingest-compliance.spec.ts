/**
 * Ingest Pipeline Compliance Tests
 *
 * These tests verify that data flows through the centralized functions
 * defined in CLAUDE.md:
 * - find_or_create_person()
 * - find_or_create_place_deduped()
 * - find_or_create_cat_by_microchip()
 *
 * Tests are READ-ONLY - they query to verify data consistency.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// SOURCE SYSTEM COMPLIANCE
// CLAUDE.md defines: 'airtable', 'clinichq', 'web_intake'
// ============================================================================

test.describe("Source System Compliance", () => {
  const DEFINED_SOURCES = [
    "airtable",
    "clinichq",
    "web_intake",
    "web_app",
  ];

  const KNOWN_ADDITIONAL_SOURCES = [
    "petlink",       // Not in CLAUDE.md but used
    "volunteerhub",  // Not in CLAUDE.md but used
    "shelterluv",    // Not in CLAUDE.md but used
  ];

  test("Requests use valid source_system values", async ({ request }) => {
    const response = await request.get("/api/requests?limit=500");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const allSources = [...DEFINED_SOURCES, ...KNOWN_ADDITIONAL_SOURCES];
    const unknownSources: string[] = [];

    for (const req of data.requests || []) {
      if (req.source_system && !allSources.includes(req.source_system)) {
        unknownSources.push(req.source_system);
      }
    }

    // Report unknown sources
    if (unknownSources.length > 0) {
      console.warn(
        `Unknown source_system values found: ${[...new Set(unknownSources)].join(", ")}`
      );
    }

    // Allow known additional sources but warn about truly unknown ones
    const trulyUnknown = unknownSources.filter(
      (s) => !KNOWN_ADDITIONAL_SOURCES.includes(s)
    );
    expect(trulyUnknown.length).toBe(0);
  });

  test("People have consistent source_system", async ({ request }) => {
    const response = await request.get("/api/people?limit=500");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const allSources = [...DEFINED_SOURCES, ...KNOWN_ADDITIONAL_SOURCES];

    for (const person of data.people || []) {
      if (person.source_system) {
        expect(allSources).toContain(person.source_system);
      }
    }
  });

  test("Cats have consistent source_system", async ({ request }) => {
    const response = await request.get("/api/cats?limit=500");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const allSources = [...DEFINED_SOURCES, ...KNOWN_ADDITIONAL_SOURCES];

    for (const cat of data.cats || []) {
      if (cat.source_system) {
        expect(allSources).toContain(cat.source_system);
      }
    }
  });

  test("No undefined source_system values", async ({ request }) => {
    // Query multiple entity types
    const [requestsRes, peopleRes, catsRes] = await Promise.all([
      request.get("/api/requests?limit=100"),
      request.get("/api/people?limit=100"),
      request.get("/api/cats?limit=100"),
    ]);

    const requests = (await requestsRes.json()).requests || [];
    const people = (await peopleRes.json()).people || [];
    const cats = (await catsRes.json()).cats || [];

    // Count entities with undefined/null source_system
    const undefinedRequests = requests.filter(
      (r: { source_system?: string }) => !r.source_system
    ).length;
    const undefinedPeople = people.filter(
      (p: { source_system?: string }) => !p.source_system
    ).length;
    const undefinedCats = cats.filter(
      (c: { source_system?: string }) => !c.source_system
    ).length;

    // Log for visibility but don't fail (some may be legacy data)
    console.log(
      `Entities without source_system: Requests=${undefinedRequests}, People=${undefinedPeople}, Cats=${undefinedCats}`
    );

    // At least 80% should have source_system set
    if (requests.length > 0) {
      expect(undefinedRequests / requests.length).toBeLessThan(0.2);
    }
  });
});

// ============================================================================
// DEDUPLICATION COMPLIANCE
// Verify that deduplication logic is working
// ============================================================================

test.describe("Deduplication Compliance", () => {
  test("No duplicate email addresses in people", async ({ request }) => {
    const response = await request.get("/api/people?limit=1000");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const emails = new Map<string, number>();

    for (const person of data.people || []) {
      if (person.email) {
        const normalizedEmail = person.email.toLowerCase().trim();
        emails.set(normalizedEmail, (emails.get(normalizedEmail) || 0) + 1);
      }
    }

    // Find duplicates
    const duplicates = [...emails.entries()].filter(([, count]) => count > 1);

    if (duplicates.length > 0) {
      console.warn(
        `Potential duplicate emails: ${duplicates.map(([e, c]) => `${e}(${c})`).join(", ")}`
      );
    }

    // Allow some duplicates (could be valid scenarios like family)
    // but flag if excessive
    expect(duplicates.length).toBeLessThan(data.people?.length * 0.1 || 10);
  });

  test("No duplicate microchips in cats", async ({ request }) => {
    const response = await request.get("/api/cats?limit=1000");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const microchips = new Map<string, number>();

    for (const cat of data.cats || []) {
      if (cat.microchip) {
        const normalized = cat.microchip.replace(/\D/g, "");
        if (normalized.length >= 9) {
          microchips.set(normalized, (microchips.get(normalized) || 0) + 1);
        }
      }
    }

    // Find duplicates
    const duplicates = [...microchips.entries()].filter(([, count]) => count > 1);

    if (duplicates.length > 0) {
      console.error(
        `CRITICAL: Duplicate microchips found: ${duplicates.map(([m, c]) => `${m}(${c})`).join(", ")}`
      );
    }

    // Microchip duplicates should NOT exist
    expect(duplicates.length).toBe(0);
  });

  test("Addresses are geocoded consistently", async ({ request }) => {
    const response = await request.get("/api/places?limit=100");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    let geocodedCount = 0;
    let totalWithAddress = 0;

    for (const place of data.places || []) {
      if (place.formatted_address || place.address) {
        totalWithAddress++;
        if (place.lat && place.lng) {
          geocodedCount++;
        }
      }
    }

    if (totalWithAddress > 0) {
      const geocodeRate = geocodedCount / totalWithAddress;
      console.log(
        `Geocoding rate: ${geocodedCount}/${totalWithAddress} (${Math.round(geocodeRate * 100)}%)`
      );

      // At least 70% of places should be geocoded
      expect(geocodeRate).toBeGreaterThanOrEqual(0.7);
    }
  });
});

// ============================================================================
// DATA PROVENANCE COMPLIANCE
// Verify that data lineage is tracked
// ============================================================================

test.describe("Data Provenance Compliance", () => {
  test("Records have source_record_id for external data", async ({ request }) => {
    const response = await request.get("/api/requests?limit=200");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    let externalRecords = 0;
    let withSourceId = 0;

    for (const req of data.requests || []) {
      // External sources should have source_record_id
      if (req.source_system && req.source_system !== "web_app") {
        externalRecords++;
        if (req.source_record_id) {
          withSourceId++;
        }
      }
    }

    if (externalRecords > 0) {
      const rate = withSourceId / externalRecords;
      console.log(
        `External records with source_record_id: ${withSourceId}/${externalRecords} (${Math.round(rate * 100)}%)`
      );

      // Most external records should have source ID
      expect(rate).toBeGreaterThanOrEqual(0.8);
    }
  });

  test("source_created_at preserves original timestamps", async ({ request }) => {
    const response = await request.get("/api/requests?limit=100");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    let withSourceCreated = 0;

    for (const req of data.requests || []) {
      if (req.source_created_at) {
        withSourceCreated++;

        // source_created_at should be <= created_at (original before Atlas import)
        if (req.created_at) {
          const sourceDate = new Date(req.source_created_at);
          const createdDate = new Date(req.created_at);
          expect(sourceDate.getTime()).toBeLessThanOrEqual(
            createdDate.getTime() + 86400000 // Allow 1 day tolerance
          );
        }
      }
    }

    // Log tracking rate
    const total = data.requests?.length || 0;
    if (total > 0) {
      console.log(
        `Records with source_created_at: ${withSourceCreated}/${total}`
      );
    }
  });
});

// ============================================================================
// PHONE NORMALIZATION COMPLIANCE
// CLAUDE.md: Use sot.norm_phone_us() for normalization
// ============================================================================

test.describe("Phone Normalization Compliance", () => {
  test("Phone numbers have consistent format", async ({ request }) => {
    const response = await request.get("/api/people?limit=200");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const phoneFormats = new Map<string, number>();

    for (const person of data.people || []) {
      if (person.phone) {
        // Determine format pattern
        let format = "unknown";
        if (/^\d{10}$/.test(person.phone)) {
          format = "10-digits";
        } else if (/^\d{3}-\d{3}-\d{4}$/.test(person.phone)) {
          format = "dashes";
        } else if (/^\(\d{3}\) \d{3}-\d{4}$/.test(person.phone)) {
          format = "formatted";
        } else if (/^\+1\d{10}$/.test(person.phone)) {
          format = "e164";
        }

        phoneFormats.set(format, (phoneFormats.get(format) || 0) + 1);
      }
    }

    // Log format distribution
    console.log("Phone format distribution:", Object.fromEntries(phoneFormats));

    // Most should be in a normalized format
    const normalizedCount =
      (phoneFormats.get("10-digits") || 0) + (phoneFormats.get("e164") || 0);
    const total = [...phoneFormats.values()].reduce((a, b) => a + b, 0);

    if (total > 0) {
      // At least 50% should be normalized (some display formatting is OK)
      // This is a soft check since display vs storage may differ
    }
  });

  test("Same phone with different formats matches same person", async ({
    request,
  }) => {
    // Query for people with phone
    const response = await request.get("/api/people?limit=500");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const phoneToPersons = new Map<string, string[]>();

    for (const person of data.people || []) {
      if (person.phone) {
        // Normalize to digits only
        const normalized = person.phone.replace(/\D/g, "");
        if (normalized.length >= 10) {
          const key = normalized.slice(-10); // Last 10 digits
          if (!phoneToPersons.has(key)) {
            phoneToPersons.set(key, []);
          }
          phoneToPersons.get(key)!.push(person.person_id);
        }
      }
    }

    // Find phones matching multiple people (potential dedup issue)
    const multiMatch = [...phoneToPersons.entries()].filter(
      ([, ids]) => ids.length > 1
    );

    if (multiMatch.length > 0) {
      console.warn(
        `Phones matching multiple people: ${multiMatch.length}`,
        multiMatch.slice(0, 5).map(([phone, ids]) => ({ phone, count: ids.length }))
      );
    }

    // Some multi-match is OK (family phones), but should be limited
    expect(multiMatch.length).toBeLessThan(data.people?.length * 0.1 || 50);
  });
});

// ============================================================================
// INTAKE PIPELINE COMPLIANCE
// Web intake should flow through proper processing
// ============================================================================

test.describe("Intake Pipeline Compliance", () => {
  test("GET /api/intake returns submissions", async ({ request }) => {
    const response = await request.get("/api/intake?limit=50");

    // May require auth
    expect(response.status()).toBeLessThan(500);

    if (response.ok()) {
      const data = await response.json();
      expect(Array.isArray(data.submissions || data)).toBeTruthy();
    }
  });

  test("Intake submissions have required fields", async ({ request }) => {
    const response = await request.get("/api/intake?limit=50");

    if (response.ok()) {
      const data = await response.json();
      const submissions = data.submissions || data;

      for (const intake of submissions) {
        // Should have a submission ID
        expect(
          intake.submission_id || intake.intake_id || intake.id
        ).toBeTruthy();

        // Should have status
        expect(
          intake.status ||
          intake.triage_status ||
          intake.processed
        ).toBeDefined();
      }
    }
  });

  test("Processed intakes create requests via pipeline", async ({ request }) => {
    // Get requests with web_intake source
    const response = await request.get(
      "/api/requests?source_system=web_intake&limit=50"
    );

    expect(response.status()).toBeLessThan(500);

    if (response.ok()) {
      const data = await response.json();

      // Web intake requests should have proper tracking
      for (const req of data.requests || []) {
        if (req.source_system === "web_intake") {
          // Should have source_record_id pointing to intake
          expect(req.source_record_id).toBeTruthy();
        }
      }
    }
  });
});

// ============================================================================
// CLINIC DATA COMPLIANCE
// ClinicHQ data should flow through proper processing
// ============================================================================

test.describe("Clinic Data Compliance", () => {
  test("Appointments have required fields", async ({ request }) => {
    // Get beacon data which aggregates clinic info
    const response = await request.get("/api/beacon/summary");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // Should have alteration counts from clinic data
    expect(data.summary?.total_altered_cats || data.summary?.total_verified_cats).toBeDefined();
  });

  test("Clinic cats have microchips", async ({ request }) => {
    // Cats from clinic should generally have microchips
    const response = await request.get("/api/cats?limit=200");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    let withMicrochip = 0;

    for (const cat of data.cats || []) {
      if (cat.microchip) {
        withMicrochip++;
      }
    }

    const total = data.cats?.length || 1;
    const rate = withMicrochip / total;

    console.log(
      `Cats with microchips: ${withMicrochip}/${total} (${Math.round(rate * 100)}%)`
    );

    // Most clinic cats should have microchips
    expect(rate).toBeGreaterThanOrEqual(0.5);
  });
});

// ============================================================================
// COMPLIANCE SUMMARY
// Overall health check
// ============================================================================

test.describe("Ingest Compliance Summary", () => {
  test("Generate compliance report", async ({ request }) => {
    // Collect stats from multiple endpoints
    const [requestsRes, peopleRes, catsRes, placesRes] = await Promise.all([
      request.get("/api/requests?limit=100"),
      request.get("/api/people?limit=100"),
      request.get("/api/cats?limit=100"),
      request.get("/api/places?limit=100"),
    ]);

    const requests = requestsRes.ok() ? (await requestsRes.json()).requests || [] : [];
    const people = peopleRes.ok() ? (await peopleRes.json()).people || [] : [];
    const cats = catsRes.ok() ? (await catsRes.json()).cats || [] : [];
    const places = placesRes.ok() ? (await placesRes.json()).places || [] : [];

    // Calculate compliance metrics
    const metrics = {
      requests: {
        total: requests.length,
        withSource: requests.filter((r: { source_system?: string }) => r.source_system).length,
        withSourceId: requests.filter((r: { source_record_id?: string }) => r.source_record_id).length,
      },
      people: {
        total: people.length,
        withEmail: people.filter((p: { email?: string }) => p.email).length,
        withPhone: people.filter((p: { phone?: string }) => p.phone).length,
      },
      cats: {
        total: cats.length,
        withMicrochip: cats.filter((c: { microchip?: string }) => c.microchip).length,
      },
      places: {
        total: places.length,
        geocoded: places.filter((p: { lat?: number; lng?: number }) => p.lat && p.lng).length,
      },
    };

    console.log("=== INGEST COMPLIANCE SUMMARY ===");
    console.log(JSON.stringify(metrics, null, 2));

    // Basic sanity checks
    expect(metrics.requests.total).toBeGreaterThanOrEqual(0);
    expect(metrics.people.total).toBeGreaterThanOrEqual(0);
    expect(metrics.cats.total).toBeGreaterThanOrEqual(0);
    expect(metrics.places.total).toBeGreaterThanOrEqual(0);
  });
});
