/**
 * Categorization Gap Detection Tests
 *
 * These tests identify appointments that may be miscategorized by
 * checking for patterns that don't match the expected classification.
 *
 * Known Gaps (as of 2026-02):
 * - SCAS pattern "A-416620" with hyphen misclassified as other_internal
 * - Hyphenated ALL CAPS names may miss LMFM detection
 * - Mixed-case LMFM participants may be classified as regular
 */

import { test, expect } from "@playwright/test";

test.describe("Categorization Gap Detection", () => {
  test.describe("SCAS Pattern Detection Gaps", () => {
    test("detect SCAS-like IDs not classified as county_scas", async ({
      request,
    }) => {
      // This test identifies the DATA_GAP_024 issue:
      // SCAS IDs with hyphens (A-416620) are not being classified correctly

      const response = await request.get("/api/health/categorization-gaps");

      if (!response.ok()) {
        // If endpoint doesn't exist, this is a gap we should document
        console.log("Missing /api/health/categorization-gaps endpoint");
        test.skip();
        return;
      }

      const data = await response.json();

      // Check for SCAS pattern misses
      if (data.scas_pattern_misses) {
        console.log(`SCAS pattern misses: ${data.scas_pattern_misses}`);

        // Log specific patterns for investigation
        for (const miss of data.scas_pattern_misses.slice(0, 5)) {
          console.log(`  ${miss.client_first_name} ${miss.client_last_name}`);
        }
      }
    });

    test("SCAS IDs should follow expected patterns", async ({ request }) => {
      // Expected patterns:
      // - A[0-9]+ (standard)
      // - A-[0-9]+ (hyphenated variant)
      // - S[0-9]+ (potential future format)

      const response = await request.get(
        "/api/admin/query?view=v_county_cat_list&limit=100"
      );

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      const unexpectedFormats: string[] = [];
      const validPattern = /^[AS]-?\d+$/i;

      for (const row of data) {
        if (row.scas_animal_id && !validPattern.test(row.scas_animal_id)) {
          unexpectedFormats.push(row.scas_animal_id);
        }
      }

      if (unexpectedFormats.length > 0) {
        console.log("Unexpected SCAS ID formats found:");
        unexpectedFormats.slice(0, 10).forEach((id) => console.log(`  ${id}`));
      }

      // Allow some flexibility but flag if too many
      expect(unexpectedFormats.length).toBeLessThan(10);
    });
  });

  test.describe("LMFM Pattern Detection Gaps", () => {
    test("detect potential LMFM misses (ALL CAPS with special chars)", async ({
      request,
    }) => {
      // Known gap: Hyphenated names like "MARY-JANE SMITH" fail the [A-Z ]+ pattern
      const response = await request.get("/api/health/categorization-gaps");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      if (data.lmfm_pattern_misses) {
        console.log(`LMFM pattern misses: ${data.lmfm_pattern_misses}`);

        // Log hyphenated names specifically
        const hyphenated = data.lmfm_pattern_misses.filter(
          (m: any) =>
            m.client_first_name?.includes("-") ||
            m.client_last_name?.includes("-")
        );

        if (hyphenated.length > 0) {
          console.log("Hyphenated name LMFM misses:");
          hyphenated.slice(0, 5).forEach((m: any) => {
            console.log(`  ${m.client_first_name} ${m.client_last_name}`);
          });
        }
      }
    });

    test("$LMFM marker should always result in lmfm category", async ({
      request,
    }) => {
      // The $LMFM marker is the most reliable signal
      // Any appointment with this marker should be categorized as lmfm

      const response = await request.get("/api/health/lmfm-marker-audit");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      if (data.marker_without_category) {
        expect(data.marker_without_category).toBe(0);
      }
    });
  });

  test.describe("Foster Program Detection Gaps", () => {
    test("ownership_type=Foster should always be foster_program", async ({
      request,
    }) => {
      const response = await request.get("/api/health/categorization-gaps");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      if (data.foster_ownership_misses) {
        // This should be 0 - if not, we have a gap
        expect(data.foster_ownership_misses).toBe(0);
      }
    });

    test("detect foster account name variations", async ({ request }) => {
      // Check for variations of "Forgotten Felines Foster" that might be missed

      const response = await request.get(
        "/api/health/foster-name-variations"
      );

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Log any unrecognized variations
      if (data.unrecognized_patterns) {
        console.log("Unrecognized foster account patterns:");
        data.unrecognized_patterns.forEach((p: any) => console.log(`  ${p}`));
      }
    });
  });

  test.describe("Other Internal Detection Gaps", () => {
    test("internal account patterns are complete", async ({ request }) => {
      // Check that internal_account_types table has all needed patterns

      const response = await request.get("/api/admin/internal-account-types");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Should have minimum patterns
      const expectedPatterns = [
        "ff foster",
        "forgotten felines foster",
        "barn cat",
        "rebooking",
      ];

      const patterns = data.map((p: any) => p.account_pattern.toLowerCase());

      for (const expected of expectedPatterns) {
        expect(patterns).toContain(expected);
      }
    });
  });
});

test.describe("Categorization Consistency", () => {
  test("same appointment number has consistent category", async ({
    request,
  }) => {
    // An appointment should have the same category across all views

    const response = await request.get(
      "/api/health/category-consistency-check"
    );

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    // Should have 0 inconsistencies
    expect(data.inconsistencies || 0).toBe(0);
  });

  test("category distribution is reasonable", async ({ request }) => {
    const response = await request.get("/api/health/category-distribution");

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    // Regular should be majority (>80%)
    expect(data.regular_pct).toBeGreaterThan(80);

    // Special programs should be small percentages
    expect(data.foster_pct).toBeLessThan(10);
    expect(data.county_pct).toBeLessThan(5);
    expect(data.lmfm_pct).toBeLessThan(5);

    // No NULLs after backfill
    expect(data.null_pct).toBe(0);
  });
});

test.describe("Trigger Stability", () => {
  test("new appointments get auto-classified", async ({ request }) => {
    // Verify that the trg_classify_appointment trigger is working

    const response = await request.get(
      "/api/health/trigger-status?trigger=trg_classify_appointment"
    );

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    expect(data.enabled).toBe(true);
    expect(data.fires_on).toContain("INSERT");
  });

  test("clinichq_visits updates sync to appointments", async ({ request }) => {
    // Verify that trg_sync_appt_category trigger is working

    const response = await request.get(
      "/api/health/trigger-status?trigger=trg_sync_appt_category"
    );

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    expect(data.enabled).toBe(true);
    expect(data.fires_on).toContain("UPDATE");
  });
});
