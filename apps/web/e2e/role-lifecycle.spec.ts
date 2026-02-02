/**
 * Role Lifecycle - E2E Tests
 *
 * Tests role integrity rules that ensure map pin badges are accurate:
 * - Active VH roles have current group membership
 * - Foster/trapper people also have volunteer role
 * - Deactivated roles don't appear on map pins
 * - Role audit API returns valid data
 * - No ShelterLuv name-only matches in active roles
 * - Org names don't appear in map pin people
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
// DQ-004: Map Badge Accuracy — No Stale Roles on Pins
// ============================================================================

test.describe("DQ: Map Badge Accuracy", () => {
  test.setTimeout(45000);

  test("Map pin people with foster also have volunteer role", async ({ request }) => {
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
        // legitimate type that does NOT require volunteer role, and the
        // pin JSONB does not include trapper_type to distinguish.
        if (hasFoster && !hasVolunteer) {
          violations.push(
            `"${person.name}" at ${pin.address || pin.id}: [${roles.join(", ")}] without volunteer`
          );
        }
      }
    }

    if (violations.length > 0) {
      console.warn(
        `${violations.length} fosters without volunteer:`,
        violations.slice(0, 5)
      );
    }

    // After MIG_831 cleanup, this should be 0
    expect(violations.length).toBe(0);
  });

  test("Map pin role badges are all from valid enum", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    const validRoles = [
      "trapper", "foster", "volunteer", "staff",
      "board_member", "donor", "caretaker", "adopter",
    ];
    const invalidRoles: string[] = [];

    for (const pin of data!.atlas_pins) {
      if (!Array.isArray(pin.people)) continue;

      for (const person of pin.people) {
        for (const role of (person.roles || [])) {
          if (!validRoles.includes(role)) {
            invalidRoles.push(`"${person.name}": "${role}"`);
          }
        }
      }
    }

    expect(invalidRoles.length).toBe(0);
  });

  test("No organization names in map pin people", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    const orgPatterns = [
      /campground/i, /winery/i, /vineyard/i, /county of/i,
      /city of/i, /humane society/i, /animal control/i,
      /department of/i, /rv park/i, /koa\b/i, /mobile home/i,
      /trailer park/i, /retreat center/i,
    ];

    const violations: string[] = [];
    for (const pin of data!.atlas_pins) {
      if (!Array.isArray(pin.people)) continue;
      for (const person of pin.people) {
        const name = person.name || "";
        for (const pattern of orgPatterns) {
          if (pattern.test(name)) {
            violations.push(`Pin ${pin.address || pin.id}: "${name}"`);
            break;
          }
        }
      }
    }

    expect(violations.length).toBe(0);
  });
});

// ============================================================================
// DQ-005: Role Audit API
// ============================================================================

test.describe("DQ: Role Audit API", () => {
  test.setTimeout(30000);

  test("Role audit endpoint returns valid structure", async ({ request }) => {
    const data = await fetchJson(request, "/api/admin/role-audit");
    test.skip(!data, "Role audit API not available");

    // Should have summary object
    expect(data!.summary).toBeTruthy();
    expect(typeof data!.summary.stale_roles).toBe("number");
    expect(typeof data!.summary.missing_volunteer).toBe("number");
    expect(typeof data!.summary.source_conflicts).toBe("number");
    expect(typeof data!.summary.unmatched_fosters).toBe("number");

    // Should have arrays
    expect(Array.isArray(data!.stale_roles)).toBe(true);
    expect(Array.isArray(data!.missing_volunteer)).toBe(true);
    expect(Array.isArray(data!.source_conflicts)).toBe(true);
    expect(Array.isArray(data!.unmatched_fosters)).toBe(true);
    expect(Array.isArray(data!.recent_reconciliations)).toBe(true);
  });

  test("Stale roles count matches array length", async ({ request }) => {
    const data = await fetchJson(request, "/api/admin/role-audit");
    test.skip(!data, "Role audit API not available");

    expect(data!.summary.stale_roles).toBe(data!.stale_roles.length);
    expect(data!.summary.missing_volunteer).toBe(data!.missing_volunteer.length);
    expect(data!.summary.source_conflicts).toBe(data!.source_conflicts.length);
    expect(data!.summary.unmatched_fosters).toBe(data!.unmatched_fosters.length);
  });

  test("VH authority: zero stale roles and zero source conflicts", async ({ request }) => {
    // After enforce_vh_role_authority() runs, there should be no roles
    // that aren't backed by current VH group membership
    const data = await fetchJson(request, "/api/admin/role-audit");
    test.skip(!data, "Role audit API not available");

    if (data!.summary.stale_roles > 0) {
      console.warn(
        "Stale roles found:",
        data!.stale_roles.slice(0, 5).map(
          (r: { display_name: string; role: string }) => `${r.display_name}: ${r.role}`
        )
      );
    }
    if (data!.summary.source_conflicts > 0) {
      console.warn(
        "Source conflicts found:",
        data!.source_conflicts.slice(0, 5).map(
          (r: { display_name: string; role: string }) => `${r.display_name}: ${r.role}`
        )
      );
    }

    // VH is the single source of truth — no stale roles should exist
    expect(data!.summary.stale_roles).toBe(0);
    expect(data!.summary.source_conflicts).toBe(0);
  });
});

// ============================================================================
// DQ-006: Person Role Data Integrity
// ============================================================================

test.describe("DQ: Person Role Data Integrity", () => {
  test.setTimeout(30000);

  test("Person roles API returns valid data", async ({ request }) => {
    const people = await fetchJson(request, "/api/people?limit=5");
    test.skip(!people?.people?.length, "No people in database");

    const person = people!.people[0];
    const roleData = await fetchJson(request, `/api/people/${person.person_id}/roles`);
    test.skip(!roleData, "Could not fetch person roles");

    // Roles should be an array
    expect(Array.isArray(roleData!.roles)).toBe(true);

    // Each role should have required fields
    for (const role of roleData!.roles) {
      expect(typeof role.role).toBe("string");
      expect(role.role.length).toBeGreaterThan(0);
      expect(typeof role.role_status).toBe("string");
    }

    // Volunteer groups should have expected structure
    expect(roleData!.volunteer_groups).toBeTruthy();
    expect(Array.isArray(roleData!.volunteer_groups.active)).toBe(true);
    expect(Array.isArray(roleData!.volunteer_groups.history)).toBe(true);
  });

  test("Active roles on map pins match person_roles data", async ({ request }) => {
    // Get a few map pins with people who have roles
    const mapData = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!mapData?.atlas_pins?.length, "No atlas pins available");

    const pinsWithRoledPeople = mapData!.atlas_pins.filter(
      (p: ApiResponse) =>
        Array.isArray(p.people) &&
        p.people.some((per: { roles: string[] }) => per.roles?.length > 0)
    );
    test.skip(pinsWithRoledPeople.length === 0, "No pins with roled people");

    // Use place detail API (which has person_id) to cross-reference
    let checked = 0;
    for (const pin of pinsWithRoledPeople.slice(0, 5)) {
      const placeDetail = await fetchJson(request, `/api/places/${pin.id}`);
      if (!placeDetail?.people) continue;

      // Find people in place detail who have roles on the pin
      for (const pinPerson of pin.people) {
        if (!pinPerson.roles?.length) continue;

        // Match by name between pin and place detail
        const placePerson = placeDetail.people.find(
          (pp: { person_name: string }) =>
            pp.person_name === pinPerson.name
        );
        if (!placePerson?.person_id) continue;

        const roleData = await fetchJson(
          request,
          `/api/people/${placePerson.person_id}/roles`
        );
        if (!roleData?.roles) continue;

        // Active roles from the person roles API
        const activeApiRoles = roleData.roles
          .filter((r: { role_status: string }) => r.role_status === "active")
          .map((r: { role: string }) => r.role)
          .sort();

        // Roles shown on the pin
        const pinRoles = [...(pinPerson.roles || [])].sort();

        // Pin roles should be a subset of active API roles
        for (const pinRole of pinRoles) {
          expect(activeApiRoles).toContain(pinRole);
        }

        checked++;
        if (checked >= 3) break;
      }
      if (checked >= 3) break;
    }

    expect(checked).toBeGreaterThan(0);
  });
});

// ============================================================================
// DQ-007: Holiday Duncan Regression Guard
// ============================================================================

test.describe("DQ: Holiday Duncan Regression", () => {
  test.setTimeout(30000);

  test("Holiday Duncan does not have foster or trapper badges on map", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    // Find the pin for 2411 Alexander Valley Rd
    const alexanderValleyPin = data!.atlas_pins.find(
      (pin: ApiResponse) =>
        (pin.address || "").toLowerCase().includes("alexander valley") ||
        (pin.address || "").toLowerCase().includes("2411")
    );

    if (!alexanderValleyPin || !Array.isArray(alexanderValleyPin.people)) {
      test.skip(true, "Alexander Valley Rd pin not found");
      return;
    }

    // Find Holiday Duncan in the people list
    const holidayDuncan = alexanderValleyPin.people.find(
      (p: { name: string }) =>
        p.name && p.name.toLowerCase().includes("holiday")
    );

    if (!holidayDuncan) {
      // Not showing at all is also acceptable
      return;
    }

    // She should NOT have foster or trapper roles
    const roles: string[] = holidayDuncan.roles || [];
    expect(roles).not.toContain("foster");
    expect(roles).not.toContain("trapper");
  });

  test("Ellen Johnson is separate from Holiday Duncan", async ({ request }) => {
    // Ellen Johnson and Holiday Duncan share winelady87@hotmail.com
    // but are different people. Ellen is a VH trapper, Holiday is a clinic client.
    // MIG_833 unmerged them and blacklisted the shared email.
    const ellen = await fetchJson(request, "/api/people/609118b0-0771-4a6e-ad7a-b9dc249726cb");
    const holiday = await fetchJson(request, "/api/people/ca6faf77-06cf-4422-a3eb-a0f341c17441");

    // Both should exist as separate records
    if (!ellen || !holiday) {
      test.skip(true, "Ellen Johnson or Holiday Duncan not found");
      return;
    }

    // Ellen should have active trapper role (she IS a VH trapper)
    if (ellen.roles && Array.isArray(ellen.roles)) {
      const activeRoles = ellen.roles
        .filter((r: { role_status: string }) => r.role_status === "active")
        .map((r: { role: string }) => r.role);
      expect(activeRoles).toContain("trapper");
      expect(activeRoles).toContain("volunteer");
    }

    // Holiday should NOT have active trapper or foster roles
    if (holiday.roles && Array.isArray(holiday.roles)) {
      const activeRoles = holiday.roles
        .filter((r: { role_status: string }) => r.role_status === "active")
        .map((r: { role: string }) => r.role);
      expect(activeRoles).not.toContain("trapper");
      expect(activeRoles).not.toContain("foster");
    }
  });

  test("Wildhaven Campgrounds does not appear as person on map", async ({ request }) => {
    const data = await fetchJson(
      request,
      "/api/beacon/map-data?layers=atlas_pins"
    );
    test.skip(!data?.atlas_pins?.length, "No atlas pins available");

    for (const pin of data!.atlas_pins) {
      if (!Array.isArray(pin.people)) continue;

      for (const person of pin.people) {
        const name = (person.name || "").toLowerCase();
        expect(name).not.toContain("wildhaven");
      }
    }
  });
});
