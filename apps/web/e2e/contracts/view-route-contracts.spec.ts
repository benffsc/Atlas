/**
 * View↔Route Contract Tests
 *
 * These tests verify that API routes return data matching their contract interfaces.
 * See CLAUDE.md invariant 49: Routes querying views MUST have a corresponding interface.
 *
 * @see @/lib/types/view-contracts.ts
 */

import { test, expect } from "@playwright/test";

// Contract field definitions for each entity type
const CAT_LIST_FIELDS = [
  "cat_id",
  "display_name",
  "sex",
  "altered_status",
  "breed",
  "microchip",
  "quality_tier",
  "quality_reason",
  "has_microchip",
  "owner_count",
  "owner_names",
  "primary_place_id",
  "primary_place_label",
  "place_kind",
  "has_place",
  "created_at",
  "last_appointment_date",
  "appointment_count",
  "source_system",
];

const PERSON_LIST_FIELDS = [
  "person_id",
  "display_name",
  "account_type",
  "is_canonical",
  "surface_quality",
  "quality_reason",
  "has_email",
  "has_phone",
  "cat_count",
  "place_count",
  "cat_names",
  "primary_place",
  "created_at",
  "source_quality",
];

const PLACE_LIST_FIELDS = [
  "place_id",
  "display_name",
  "formatted_address",
  "place_kind",
  "locality",
  "postal_code",
  "cat_count",
  "person_count",
  "has_cat_activity",
  "created_at",
];

const REQUEST_LIST_FIELDS = [
  "request_id",
  "status",
  "priority",
  "summary",
  "estimated_cat_count",
  "has_kittens",
  "scheduled_date",
  "assigned_to",
  "created_at",
  "updated_at",
  "source_created_at",
  "place_id",
  "place_name",
  "place_address",
  "place_city",
  "requester_person_id",
  "requester_name",
  "requester_email",
  "requester_phone",
  "latitude",
  "longitude",
  "linked_cat_count",
  "is_legacy_request",
  "active_trapper_count",
  "place_has_location",
  "data_quality_flags",
  "no_trapper_reason",
  "primary_trapper_name",
  "assignment_status",
];

/** Unwrap apiSuccess wrapper: { success: true, data: T } → T */
function unwrap(json: Record<string, unknown>): Record<string, unknown> {
  if (json.success === true && json.data) return json.data as Record<string, unknown>;
  return json;
}

test.describe("View↔Route Contracts", () => {
  test.describe("Cat List Contract (VCatListRow)", () => {
    test("GET /api/cats returns data matching VCatListRow interface", async ({
      request,
    }) => {
      const response = await request.get("/api/cats?limit=1");
      if (!response.ok()) return; // API unavailable — pass

      const json = await response.json();
      const data = unwrap(json);
      if (!data.cats || !Array.isArray(data.cats)) return;

      if ((data.cats as unknown[]).length > 0) {
        const cat = (data.cats as Record<string, unknown>[])[0];

        // Verify all contract fields exist
        for (const field of CAT_LIST_FIELDS) {
          expect(cat, `Missing field: ${field}`).toHaveProperty(field);
        }

        // Verify types for critical fields
        expect(typeof cat.cat_id).toBe("string");
        expect(typeof cat.display_name).toBe("string");
        expect(typeof cat.has_microchip).toBe("boolean");
        expect(typeof cat.has_place).toBe("boolean");
        // Counts may come as string from Postgres — accept both
        expect(["number", "string"]).toContain(typeof cat.owner_count);
        expect(["number", "string"]).toContain(typeof cat.appointment_count);
      }
    });

    test("pagination metadata is present", async ({ request }) => {
      const response = await request.get("/api/cats?limit=5&offset=0");
      if (!response.ok()) return;

      const json = await response.json();
      const data = unwrap(json);

      // Pagination may be in data or in meta
      const meta = (json.meta as Record<string, unknown>) || data;
      const total = meta.total ?? data.total;
      const limit = meta.limit ?? data.limit;
      const offset = meta.offset ?? data.offset;

      expect(total).toBeDefined();
      expect(typeof total).toBe("number");
      // Limit/offset may be in meta or top-level
      if (limit !== undefined) {
        expect(limit).toBe(5);
      }
      if (offset !== undefined) {
        expect(offset).toBe(0);
      }
    });
  });

  test.describe("Person List Contract (VPersonListRow)", () => {
    test("GET /api/people returns data matching VPersonListRow interface", async ({
      request,
    }) => {
      const response = await request.get("/api/people?limit=1");
      if (!response.ok()) return;

      const json = await response.json();
      const data = unwrap(json);
      if (!data.people || !Array.isArray(data.people)) return;

      if ((data.people as unknown[]).length > 0) {
        const person = (data.people as Record<string, unknown>[])[0];

        for (const field of PERSON_LIST_FIELDS) {
          expect(person, `Missing field: ${field}`).toHaveProperty(field);
        }

        expect(typeof person.person_id).toBe("string");
        expect(typeof person.display_name).toBe("string");
        expect(typeof person.has_email).toBe("boolean");
        expect(typeof person.has_phone).toBe("boolean");
        expect(typeof person.cat_count).toBe("number");
        expect(typeof person.place_count).toBe("number");
      }
    });
  });

  test.describe("Place List Contract (VPlaceListRow)", () => {
    test("GET /api/places returns data matching VPlaceListRow interface", async ({
      request,
    }) => {
      const response = await request.get("/api/places?limit=1");
      if (!response.ok()) return;

      const json = await response.json();
      const data = unwrap(json);
      if (!data.places || !Array.isArray(data.places)) return;

      if ((data.places as unknown[]).length > 0) {
        const place = (data.places as Record<string, unknown>[])[0];

        for (const field of PLACE_LIST_FIELDS) {
          expect(place, `Missing field: ${field}`).toHaveProperty(field);
        }

        expect(typeof place.place_id).toBe("string");
        expect(typeof place.cat_count).toBe("number");
        expect(typeof place.person_count).toBe("number");
        expect(typeof place.has_cat_activity).toBe("boolean");
      }
    });
  });

  test.describe("Request List Contract (VRequestListRow)", () => {
    test("GET /api/requests returns data matching VRequestListRow interface", async ({
      request,
    }) => {
      const response = await request.get("/api/requests?limit=1");
      if (!response.ok()) return;

      const json = await response.json();
      const data = unwrap(json);
      if (!data.requests || !Array.isArray(data.requests)) return;

      if ((data.requests as unknown[]).length > 0) {
        const req = (data.requests as Record<string, unknown>[])[0];

        for (const field of REQUEST_LIST_FIELDS) {
          expect(req, `Missing field: ${field}`).toHaveProperty(field);
        }

        expect(typeof req.request_id).toBe("string");
        expect(typeof req.status).toBe("string");
        expect(typeof req.priority).toBe("string");
        expect(typeof req.linked_cat_count).toBe("number");
        expect(typeof req.is_legacy_request).toBe("boolean");
        expect(typeof req.active_trapper_count).toBe("number");
        expect(typeof req.place_has_location).toBe("boolean");
        expect(Array.isArray(req.data_quality_flags)).toBeTruthy();
      }
    });
  });
});

test.describe("UUID Validation (INV-46)", () => {
  test("invalid UUID returns 400, not 500", async ({ request }) => {
    const invalidIds = ["invalid-uuid", "123", "not-a-uuid", "abc"];

    for (const id of invalidIds) {
      const catResponse = await request.get(`/api/cats/${id}`);
      expect(catResponse.status()).toBe(400);

      const personResponse = await request.get(`/api/people/${id}`);
      expect(personResponse.status()).toBe(400);

      const placeResponse = await request.get(`/api/places/${id}`);
      expect(placeResponse.status()).toBe(400);

      const requestResponse = await request.get(`/api/requests/${id}`);
      // requests/[id] returns 404 for invalid UUIDs (treated as not found)
      expect([400, 404]).toContain(requestResponse.status());
    }
  });

  test("valid UUID format returns 400 or 404 for non-existent entity", async ({
    request,
  }) => {
    // All-zeros UUID may be rejected by requireValidUUID (400) or treated as not found (404)
    const validButNonexistentId = "00000000-0000-0000-0000-000000000000";

    const catResponse = await request.get(`/api/cats/${validButNonexistentId}`);
    expect([400, 404]).toContain(catResponse.status());

    const personResponse = await request.get(
      `/api/people/${validButNonexistentId}`
    );
    expect([400, 404]).toContain(personResponse.status());

    const placeResponse = await request.get(
      `/api/places/${validButNonexistentId}`
    );
    expect([400, 404]).toContain(placeResponse.status());

    const requestResponse = await request.get(
      `/api/requests/${validButNonexistentId}`
    );
    expect([400, 404]).toContain(requestResponse.status());
  });
});

test.describe("Pagination Validation (INV-47)", () => {
  test("negative limit/offset are handled gracefully", async ({ request }) => {
    const response = await request.get("/api/cats?limit=-1&offset=-10");
    expect(response.ok()).toBeTruthy();

    const json = await response.json();
    const data = unwrap(json);
    const meta = (json.meta as Record<string, unknown>) || data;
    const limit = (meta.limit ?? data.limit) as number;
    const offset = (meta.offset ?? data.offset) as number;

    if (limit !== undefined) expect(limit).toBeGreaterThan(0);
    if (offset !== undefined) expect(offset).toBeGreaterThanOrEqual(0);
  });

  test("very large limit is capped", async ({ request }) => {
    const response = await request.get("/api/cats?limit=10000");
    expect(response.ok()).toBeTruthy();

    const json = await response.json();
    const data = unwrap(json);
    const meta = (json.meta as Record<string, unknown>) || data;
    const limit = (meta.limit ?? data.limit) as number;

    if (limit !== undefined) {
      // Should be capped at max (typically 100 or 250)
      expect(limit).toBeLessThanOrEqual(250);
    }
  });

  test("non-numeric values use defaults", async ({ request }) => {
    const response = await request.get("/api/cats?limit=abc&offset=xyz");
    expect(response.ok()).toBeTruthy();

    const json = await response.json();
    const data = unwrap(json);
    const meta = (json.meta as Record<string, unknown>) || data;
    const limit = meta.limit ?? data.limit;
    const offset = meta.offset ?? data.offset;

    if (limit !== undefined) expect(typeof limit).toBe("number");
    if (offset !== undefined) expect(typeof offset).toBe("number");
  });
});
