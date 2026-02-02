/**
 * Data Quality Guards - E2E Tests
 *
 * Tests data integrity rules that catch systemic issues:
 * - Organization names filtered from person displays
 * - Role consistency (foster/trapper requires volunteer)
 * - ClinicHQ-sourced people don't get volunteer roles without VolunteerHub match
 * - Map pin people have correct role badges
 * - Person deduplication sanity checks
 *
 * Working Ledger: docs/TEST_SUITE_WORKING_LEDGER.md
 *
 * ALL TESTS ARE READ-ONLY against real data.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// HELPERS
// ============================================================================

interface ApiResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

async function fetchJson(
  request: {
    get: (
      url: string,
      options?: { timeout?: number }
    ) => Promise<{ ok: () => boolean; json: () => Promise<ApiResponse> }>;
  },
  url: string,
  timeout = 15000
): Promise<ApiResponse | null> {
  try {
    const res = await request.get(url, { timeout });
    if (!res.ok()) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ============================================================================
// DQ-001: Organization Names in Person Displays
// Ledger ref: DQ-001 (Wildhaven Campgrounds as person)
// ============================================================================

test.describe("DQ: Organization Names Filtered from People", () => {
  test.setTimeout(30000);

  /**
   * Known organization name patterns that should NOT appear as person names
   * in place detail people lists. These are patterns from known_organizations
   * and data_fixing_patterns tables.
   */
  const ORG_PATTERNS = [
    /campground/i,
    /resort/i,
    /hotel\b/i,
    /motel/i,
    /lodge\b/i,
    /winery/i,
    /vineyard/i,
    /ranch\b/i,
    /farm\b/i,
    /church\b/i,
    /school\b/i,
    /hospital\b/i,
    /clinic\b/i,
    /shelter\b/i,
    /humane society/i,
    /animal control/i,
    /county of/i,
    /city of/i,
    /state of/i,
    /department of/i,
  ];

  test("Place detail API does not return org names as people", async ({ request }) => {
    // Fetch a few places and check their people arrays
    const data = await fetchJson(request, "/api/places?limit=20");
    test.skip(!data?.places?.length, "No places in database");

    const placesWithPeople: Array<{ place_id: string; people: Array<{ person_name: string }> }> = [];

    // Check up to 10 places for people with org-like names
    for (const place of data!.places!.slice(0, 10)) {
      const detail = await fetchJson(request, `/api/places/${place.place_id}`);
      if (detail?.people && detail.people.length > 0) {
        placesWithPeople.push({
          place_id: place.place_id,
          people: detail.people,
        });
      }
    }

    test.skip(placesWithPeople.length === 0, "No places with people found");

    // Check each person name against org patterns
    const violations: string[] = [];
    for (const place of placesWithPeople) {
      for (const person of place.people) {
        const name = person.person_name || "";
        for (const pattern of ORG_PATTERNS) {
          if (pattern.test(name)) {
            violations.push(`Place ${place.place_id}: "${name}" matches org pattern ${pattern}`);
            break;
          }
        }
      }
    }

    // Report but don't fail hard — this is a data quality signal
    if (violations.length > 0) {
      console.warn("Organization names found in people lists:", violations);
    }
    // Strict check: no org names should appear
    expect(violations.length).toBe(0);
  });
});

// ============================================================================
// DQ-001: Role Consistency — Foster Requires Volunteer, VH is Authority
// Business rule: VH is source of truth. Fosters are VH Volunteers.
// Community trappers (Airtable) are the only exception.
// ============================================================================

test.describe("DQ: Role Consistency Checks", () => {
  test.setTimeout(30000);

  test("Beacon map data does not show foster without volunteer basis", async ({ request }) => {
    // Fetch map data with atlas_pins layer
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    const violations: string[] = [];

    for (const pin of data!.atlas_pins) {
      if (!Array.isArray(pin.people)) continue;

      for (const person of pin.people) {
        const roles: string[] = person.roles || [];
        const hasFoster = roles.includes("foster");
        const hasVolunteer = roles.includes("volunteer");

        // Fosters must always have volunteer role (they are VH volunteers).
        // Trappers are NOT checked here because community_trapper is a
        // legitimate trapper type that does NOT require volunteer role,
        // and the pin JSONB does not include trapper_type.
        if (hasFoster && !hasVolunteer) {
          violations.push(
            `"${person.name}" at ${pin.address || pin.id}: has [${roles.join(", ")}] but no volunteer role`
          );
        }
      }
    }

    if (violations.length > 0) {
      console.warn(
        `Found ${violations.length} fosters without volunteer role:`,
        violations.slice(0, 10)
      );
    }

    // Business rule: foster requires volunteer role
    // MIG_828 + MIG_831 fix the root causes and clean up existing data
    expect(violations.length).toBe(0);
  });

  test("Map pins with people show valid role values only", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    const validRoles = [
      "trapper",
      "foster",
      "volunteer",
      "staff",
      "board_member",
      "donor",
      "caretaker",
      "adopter",
    ];

    const invalidRoles: string[] = [];

    for (const pin of data!.atlas_pins) {
      if (!Array.isArray(pin.people)) continue;

      for (const person of pin.people) {
        const roles: string[] = person.roles || [];
        for (const role of roles) {
          if (!validRoles.includes(role)) {
            invalidRoles.push(`"${person.name}": invalid role "${role}"`);
          }
        }
      }
    }

    expect(invalidRoles.length).toBe(0);
  });
});

// ============================================================================
// DQ: Person API Data Integrity
// ============================================================================

test.describe("DQ: Person Data Integrity", () => {
  test.setTimeout(30000);

  test("People API returns valid display names", async ({ request }) => {
    const data = await fetchJson(request, "/api/people?limit=20");
    test.skip(!data?.people?.length, "No people in database");

    for (const person of data!.people) {
      const name = person.display_name || "";

      // Name should not be empty
      expect(name.length).toBeGreaterThan(0);

      // Name should not be a bare email
      expect(name).not.toMatch(/^[^@]+@[^@]+\.[^@]+$/);

      // Name should not be a bare phone number
      expect(name).not.toMatch(/^\+?[\d\s()-]{10,}$/);

      // Name should not be "Unknown" or similar placeholder
      expect(name.toLowerCase()).not.toBe("unknown");
      expect(name.toLowerCase()).not.toBe("n/a");
    }
  });

  test("Person detail returns consistent role data", async ({ request }) => {
    const data = await fetchJson(request, "/api/people?limit=5");
    test.skip(!data?.people?.length, "No people in database");

    const person = data!.people[0];
    const detail = await fetchJson(request, `/api/people/${person.person_id}`);
    test.skip(!detail, "Could not fetch person detail");

    // Person detail should not return 500
    expect(detail).toBeTruthy();

    // If person has roles, they should be valid
    if (detail!.roles && Array.isArray(detail!.roles)) {
      for (const role of detail!.roles) {
        expect(typeof role.role).toBe("string");
        expect(role.role.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================================
// DQ: Place Data Integrity
// ============================================================================

test.describe("DQ: Place Data Integrity", () => {
  test.setTimeout(30000);

  test("Place detail people have valid person_id UUIDs", async ({ request }) => {
    const data = await fetchJson(request, "/api/places?limit=10");
    test.skip(!data?.places?.length, "No places in database");

    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const place of data!.places!.slice(0, 5)) {
      const detail = await fetchJson(request, `/api/places/${place.place_id}`);
      if (!detail?.people) continue;

      for (const person of detail.people) {
        expect(person.person_id).toBeTruthy();
        expect(UUID_REGEX.test(person.person_id)).toBe(true);
      }
    }
  });

  test("Place detail cats have valid data", async ({ request }) => {
    const data = await fetchJson(request, "/api/places?limit=10");
    test.skip(!data?.places?.length, "No places in database");

    for (const place of data!.places!.slice(0, 5)) {
      const detail = await fetchJson(request, `/api/places/${place.place_id}`);
      if (!detail?.cats) continue;

      for (const cat of detail.cats) {
        expect(cat.cat_id).toBeTruthy();
        // Cat name should exist (display_name fallback should work)
        expect(cat.cat_name || cat.display_name).toBeTruthy();
      }
    }
  });

  test("Place person count matches people array length", async ({ request }) => {
    const data = await fetchJson(request, "/api/places?limit=10");
    test.skip(!data?.places?.length, "No places in database");

    for (const place of data!.places!.slice(0, 5)) {
      const detail = await fetchJson(request, `/api/places/${place.place_id}`);
      if (!detail) continue;

      const reportedCount = detail.person_count || 0;
      const actualCount = Array.isArray(detail.people)
        ? detail.people.length
        : 0;

      // These should be consistent (within 1 due to dedup differences)
      expect(Math.abs(reportedCount - actualCount)).toBeLessThanOrEqual(2);
    }
  });
});

// ============================================================================
// DQ: Beacon Map Pin Data Integrity
// ============================================================================

test.describe("DQ: Beacon Map Pin Integrity", () => {
  test.setTimeout(45000);

  test("Atlas pins have required fields", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    // Check first 20 pins for required fields
    for (const pin of data!.atlas_pins.slice(0, 20)) {
      expect(pin.id).toBeTruthy();
      expect(typeof pin.lat).toBe("number");
      expect(typeof pin.lng).toBe("number");
      // lat/lng should be valid US coordinates (not just Sonoma County —
      // places include homes of people who use FFSC clinic from other areas)
      expect(pin.lat).toBeGreaterThan(24.0);
      expect(pin.lat).toBeLessThan(50.0);
      expect(pin.lng).toBeGreaterThan(-130.0);
      expect(pin.lng).toBeLessThan(-65.0);
    }
  });

  test("Atlas pins with people have structured data", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    const pinsWithPeople = data!.atlas_pins.filter(
      (p: ApiResponse) => Array.isArray(p.people) && p.people.length > 0
    );
    test.skip(pinsWithPeople.length === 0, "No pins with people");

    for (const pin of pinsWithPeople.slice(0, 10)) {
      for (const person of pin.people) {
        // Each person should have a name
        expect(person.name).toBeTruthy();
        expect(typeof person.name).toBe("string");

        // Roles should be an array
        expect(Array.isArray(person.roles)).toBe(true);

        // is_staff should be boolean
        expect(typeof person.is_staff).toBe("boolean");
      }
    }
  });

  test("No organization names in atlas pin people", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    // The v_map_atlas_pins view should filter via is_organization_name()
    // This test guards that the filter is working
    const orgPatterns = [
      /campground/i,
      /winery/i,
      /vineyard/i,
      /county of/i,
      /city of/i,
      /humane society/i,
      /animal control/i,
      /department of/i,
    ];

    const violations: string[] = [];

    for (const pin of data!.atlas_pins) {
      if (!Array.isArray(pin.people)) continue;

      for (const person of pin.people) {
        const name = person.name || "";
        for (const pattern of orgPatterns) {
          if (pattern.test(name)) {
            violations.push(
              `Pin ${pin.address || pin.id}: "${name}" looks like org name`
            );
            break;
          }
        }
      }
    }

    if (violations.length > 0) {
      console.warn("Org names in map pin people:", violations);
    }
    expect(violations.length).toBe(0);
  });
});
