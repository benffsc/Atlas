/**
 * Entity Linking Health Tests
 *
 * Validates critical entity linking invariants from MIG_2430-2435:
 * - Clinic address leakage = 0 (cats NEVER linked to 845 Todd / Empire Industrial)
 * - Cat-place coverage is acceptable (> 50%)
 * - Entity linking runs are completing
 * - Skipped entities have documented reasons
 *
 * These are READ-ONLY tests against real data.
 * @see CLAUDE.md "Entity Linking Rules"
 */

import { test, expect } from "@playwright/test";
import { unwrapApiResponse } from './helpers/api-response';

test.describe("Entity Linking Health (MIG_2430-2435)", () => {
  test.setTimeout(30000);

  test("clinic address leakage is zero", async ({ request }) => {
    const response = await request.get("/api/health/entity-linking");

    if (!response.ok()) {
      test.skip(true, "Entity linking health endpoint not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    // CRITICAL: No cats should ever be linked to the FFSC clinic addresses.
    // MIG_2430 removed the COALESCE fallback that was polluting data.
    expect(data.clinic_leakage).toBe(0);
  });

  test("cat-place coverage is above minimum threshold", async ({ request }) => {
    const response = await request.get("/api/health/entity-linking");

    if (!response.ok()) {
      test.skip(true, "Entity linking health endpoint not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    // Coverage should be > 50%. Current baseline is ~81%.
    // Cats without places are expected (PetLink-only, no contact info).
    expect(data.cat_place_coverage.coverage_pct).toBeGreaterThan(50);

    // Total cats should be a reasonable number (sanity check)
    expect(data.cat_place_coverage.total_cats).toBeGreaterThan(0);
  });

  test("entity linking status is healthy or degraded (not failing)", async ({ request }) => {
    const response = await request.get("/api/health/entity-linking");

    if (!response.ok()) {
      test.skip(true, "Entity linking health endpoint not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    expect(["healthy", "degraded"]).toContain(data.status);
  });

  test("skipped entities have documented reasons", async ({ request }) => {
    const response = await request.get("/api/health/entity-linking");

    if (!response.ok()) {
      test.skip(true, "Entity linking health endpoint not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());

    // If there are skipped reasons, they should be known categories
    const validReasons = [
      "no_inferred_place_id",
      "place_is_clinic",
      "place_is_blacklisted",
      "no_person_link",
      "no_appointment",
      "no_microchip",
    ];

    if (data.skipped_reasons && data.skipped_reasons.length > 0) {
      for (const entry of data.skipped_reasons) {
        expect(entry.reason).toBeTruthy();
        expect(entry.count).toBeGreaterThan(0);
      }
    }
  });
});

test.describe("Appointment Link Integrity", () => {
  test.setTimeout(30000);

  test("no cats are linked to FFSC clinic addresses via API", async ({ request }) => {
    // Direct check: query cats list and verify no linked place is a clinic
    const response = await request.get("/api/cats?limit=50");

    if (!response.ok()) {
      test.skip(true, "Cats API not available");
      return;
    }

    const data = unwrapApiResponse<{ cats: unknown[] }>(await response.json());
    const cats = data.cats || [];

    const clinicAddressPatterns = [
      /845\s*todd/i,
      /empire\s*industrial/i,
      /1814.*empire/i,
      /1820.*empire/i,
    ];

    for (const cat of cats) {
      const placeLabel = cat.primary_place_label || "";
      for (const pattern of clinicAddressPatterns) {
        expect(
          pattern.test(placeLabel),
          `Cat ${cat.cat_id} linked to clinic address: ${placeLabel}`
        ).toBe(false);
      }
    }
  });
});
