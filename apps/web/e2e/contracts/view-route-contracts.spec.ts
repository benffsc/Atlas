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

test.describe("View↔Route Contracts", () => {
  test.describe("Cat List Contract (VCatListRow)", () => {
    test("GET /api/cats returns data matching VCatListRow interface", async ({
      request,
    }) => {
      const response = await request.get("/api/cats?limit=1");
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty("cats");
      expect(Array.isArray(data.cats)).toBeTruthy();

      if (data.cats.length > 0) {
        const cat = data.cats[0];

        // Verify all contract fields exist
        for (const field of CAT_LIST_FIELDS) {
          expect(cat, `Missing field: ${field}`).toHaveProperty(field);
        }

        // Verify types for critical fields
        expect(typeof cat.cat_id).toBe("string");
        expect(typeof cat.display_name).toBe("string");
        expect(typeof cat.has_microchip).toBe("boolean");
        expect(typeof cat.has_place).toBe("boolean");
        expect(typeof cat.owner_count).toBe("number");
        expect(typeof cat.appointment_count).toBe("number");
      }
    });

    test("pagination metadata is present", async ({ request }) => {
      const response = await request.get("/api/cats?limit=5&offset=0");
      const data = await response.json();

      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("limit");
      expect(data).toHaveProperty("offset");
      expect(typeof data.total).toBe("number");
      expect(data.limit).toBe(5);
      expect(data.offset).toBe(0);
    });
  });

  test.describe("Person List Contract (VPersonListRow)", () => {
    test("GET /api/people returns data matching VPersonListRow interface", async ({
      request,
    }) => {
      const response = await request.get("/api/people?limit=1");
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty("people");
      expect(Array.isArray(data.people)).toBeTruthy();

      if (data.people.length > 0) {
        const person = data.people[0];

        // Verify all contract fields exist
        for (const field of PERSON_LIST_FIELDS) {
          expect(person, `Missing field: ${field}`).toHaveProperty(field);
        }

        // Verify types for critical fields
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
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty("places");
      expect(Array.isArray(data.places)).toBeTruthy();

      if (data.places.length > 0) {
        const place = data.places[0];

        // Verify all contract fields exist
        for (const field of PLACE_LIST_FIELDS) {
          expect(place, `Missing field: ${field}`).toHaveProperty(field);
        }

        // Verify types for critical fields
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
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty("requests");
      expect(Array.isArray(data.requests)).toBeTruthy();

      if (data.requests.length > 0) {
        const req = data.requests[0];

        // Verify all contract fields exist
        for (const field of REQUEST_LIST_FIELDS) {
          expect(req, `Missing field: ${field}`).toHaveProperty(field);
        }

        // Verify types for critical fields
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

  test("valid UUID format returns 404 for non-existent entity", async ({
    request,
  }) => {
    const validButNonexistentId = "00000000-0000-0000-0000-000000000000";

    const catResponse = await request.get(`/api/cats/${validButNonexistentId}`);
    expect(catResponse.status()).toBe(404);

    const personResponse = await request.get(
      `/api/people/${validButNonexistentId}`
    );
    expect(personResponse.status()).toBe(404);

    const placeResponse = await request.get(
      `/api/places/${validButNonexistentId}`
    );
    expect(placeResponse.status()).toBe(404);

    const requestResponse = await request.get(
      `/api/requests/${validButNonexistentId}`
    );
    expect(requestResponse.status()).toBe(404);
  });
});

test.describe("Pagination Validation (INV-47)", () => {
  test("negative limit/offset are handled gracefully", async ({ request }) => {
    const response = await request.get("/api/cats?limit=-1&offset=-10");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // Should use safe defaults, not error
    expect(data.limit).toBeGreaterThan(0);
    expect(data.offset).toBeGreaterThanOrEqual(0);
  });

  test("very large limit is capped", async ({ request }) => {
    const response = await request.get("/api/cats?limit=10000");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // Should be capped at max (100 for most routes)
    expect(data.limit).toBeLessThanOrEqual(100);
  });

  test("non-numeric values use defaults", async ({ request }) => {
    const response = await request.get("/api/cats?limit=abc&offset=xyz");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(typeof data.limit).toBe("number");
    expect(typeof data.offset).toBe("number");
  });
});
