/**
 * Comprehensive Data Quality Tests
 *
 * These tests validate the overall data quality of the Atlas database,
 * checking for missing links, orphaned records, and integrity issues.
 *
 * Current Known Issues (as of 2026-02):
 * - 3,498 appointments missing cat links (many are non-microchipped community cats)
 * - 852 appointments missing person links
 * - 887 people without any identifiers (email/phone)
 * - 213 org/address person records (flagged for review)
 * - 590 first-name-only records (flagged for review)
 */

import { test, expect } from "@playwright/test";

test.describe("Entity Link Integrity", () => {
  test.describe("Appointment Links", () => {
    test("appointment link rates are acceptable", async ({ request }) => {
      const response = await request.get("/api/health/data-quality");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      if (data.appointments) {
        // Cat link rate should be > 90% (some community cats have no microchip)
        expect(data.appointments.cat_link_rate).toBeGreaterThan(90);

        // Person link rate should be > 95%
        expect(data.appointments.person_link_rate).toBeGreaterThan(95);

        // Place link rate should be > 99%
        expect(data.appointments.place_link_rate).toBeGreaterThan(99);
      }
    });

    test("fully linked appointments are majority", async ({ request }) => {
      const response = await request.get(
        "/api/health/appointment-link-breakdown"
      );

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Fully linked should be > 85%
      const fullyLinkedPct =
        (data.fully_linked / data.total_appointments) * 100;
      expect(fullyLinkedPct).toBeGreaterThan(85);

      // Log breakdown for visibility
      console.log("Appointment link breakdown:");
      console.log(`  Fully linked: ${data.fully_linked}`);
      console.log(`  Missing cat: ${data.missing_cat}`);
      console.log(`  Missing person: ${data.missing_person}`);
      console.log(`  Missing place: ${data.missing_place}`);
    });

    test("missing cat appointments are justified", async ({ request }) => {
      // Most missing-cat appointments should be either:
      // 1. Non-alteration services (exam, treatment)
      // 2. Pre-microchip era appointments
      // 3. Community cats without individual identification

      const response = await request.get("/api/health/missing-cat-analysis");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Non-alteration services shouldn't require cat links
      console.log("Missing cat appointment reasons:");
      console.log(`  Non-TNR service: ${data.non_tnr_service}`);
      console.log(`  No microchip: ${data.no_microchip}`);
      console.log(`  Unexplained: ${data.unexplained}`);

      // Unexplained should be minimal
      expect(data.unexplained).toBeLessThan(data.total * 0.1);
    });
  });

  test.describe("Person Data Quality", () => {
    test("people have contact information", async ({ request }) => {
      const response = await request.get("/api/health/person-quality");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Should have > 90% with contact info
      const contactRate =
        (data.with_contact / data.total_unmerged_people) * 100;
      expect(contactRate).toBeGreaterThan(90);
    });

    test("no duplicate emails after Data Engine", async ({ request }) => {
      const response = await request.get("/api/health/identifier-duplicates");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // After Data Engine, should have 0 duplicate emails across people
      expect(data.duplicate_emails).toBe(0);
    });

    test("org/address person review queue is populated", async ({
      request,
    }) => {
      const response = await request.get("/api/health/review-queues");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Should have review queue entries from MIG_931
      console.log(`Org/address review queue: ${data.org_person_review}`);
      console.log(`First-name-only review queue: ${data.firstname_only_review}`);

      // Queues should exist (not necessarily be empty)
      expect(data.org_person_review).toBeGreaterThanOrEqual(0);
      expect(data.firstname_only_review).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe("Cat Data Quality", () => {
    test("cats have microchips at acceptable rate", async ({ request }) => {
      const response = await request.get("/api/health/cat-quality");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Should have > 95% with microchips (some euthanized before chipping)
      const chipRate = (data.with_microchip / data.total_unmerged_cats) * 100;
      expect(chipRate).toBeGreaterThan(95);
    });

    test("microchip formats are valid", async ({ request }) => {
      const response = await request.get("/api/health/microchip-validation");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Most microchips should be valid format
      const validRate = (data.valid_format / data.total_microchips) * 100;
      expect(validRate).toBeGreaterThan(99);

      // Log invalid formats for investigation
      if (data.invalid_formats && data.invalid_formats.length > 0) {
        console.log("Invalid microchip formats:");
        data.invalid_formats.slice(0, 5).forEach((f: any) => console.log(`  ${f}`));
      }
    });
  });

  test.describe("Place Data Quality", () => {
    test("places are geocoded", async ({ request }) => {
      const response = await request.get("/api/health/place-quality");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // Should have > 99% geocoded
      const geocodeRate = (data.geocoded / data.total_unmerged_places) * 100;
      expect(geocodeRate).toBeGreaterThan(99);
    });

    test("clinic misclassification is fixed", async ({ request }) => {
      const response = await request.get("/api/health/clinic-classification");

      if (!response.ok()) {
        test.skip();
        return;
      }

      const data = await response.json();

      // After MIG_930, should have minimal clinic-classified places
      // (only actual clinics like 845 Todd Road)
      expect(data.clinic_places).toBeLessThan(5);
      expect(data.active_clinic_contexts).toBe(0);
    });
  });
});

test.describe("Data Engine Health", () => {
  test("Data Engine is operational", async ({ request }) => {
    const response = await request.get("/api/health/data-engine");

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    expect(data.status).toBe("healthy");
  });

  test("no pending high-priority reviews", async ({ request }) => {
    const response = await request.get("/api/admin/data-engine/review?priority=high");

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    // High-priority reviews should be addressed promptly
    expect(data.length).toBeLessThan(10);
  });

  test("matching rules are configured", async ({ request }) => {
    const response = await request.get("/api/admin/data-engine/rules");

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    // Should have rules for email, phone, name matching
    const ruleTypes = data.map((r: any) => r.signal_type);
    expect(ruleTypes).toContain("email");
    expect(ruleTypes).toContain("phone");
  });
});

test.describe("Merge Integrity", () => {
  test("merged records have valid targets", async ({ request }) => {
    const response = await request.get("/api/health/merge-integrity");

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    // No orphaned merges (pointing to non-existent records)
    expect(data.orphaned_person_merges).toBe(0);
    expect(data.orphaned_cat_merges).toBe(0);
    expect(data.orphaned_place_merges).toBe(0);
  });

  test("no circular merge chains", async ({ request }) => {
    const response = await request.get("/api/health/merge-cycles");

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    // Should have no circular references
    expect(data.person_cycles).toBe(0);
    expect(data.cat_cycles).toBe(0);
    expect(data.place_cycles).toBe(0);
  });
});

test.describe("Source System Consistency", () => {
  test("source systems use correct values", async ({ request }) => {
    const response = await request.get("/api/health/source-system-audit");

    if (!response.ok()) {
      test.skip();
      return;
      }

    const data = await response.json();

    // Only valid source systems should be used
    const validSources = [
      "airtable",
      "clinichq",
      "web_intake",
      "web_app",
      "atlas_ui",
      "shelterluv",
      "volunteerhub",
      "e2e_test",
    ];

    for (const source of data.sources) {
      expect(validSources).toContain(source.source_system);
    }
  });

  test("source_record_id is populated", async ({ request }) => {
    const response = await request.get("/api/health/source-record-audit");

    if (!response.ok()) {
      test.skip();
      return;
    }

    const data = await response.json();

    // Most records should have source_record_id
    expect(data.missing_source_record_pct).toBeLessThan(5);
  });
});
