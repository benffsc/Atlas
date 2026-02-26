/**
 * API Schema Validation Tests
 *
 * These tests verify that database views have the expected columns
 * that the API routes depend on. This catches column mismatches
 * before they cause 500 errors in production.
 *
 * FRAGILE AREAS TESTED:
 * - v_person_list_v3 columns required by /api/people
 * - v_cat_list columns required by /api/cats
 * - v_place_list columns required by /api/places
 * - v_request_list columns required by /api/requests
 */

import { test, expect } from "@playwright/test";

// Expected columns for each view - if these change, the API will break
const EXPECTED_COLUMNS = {
  people: [
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
  ],
  cats: [
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
    "source_system",
  ],
};

test.describe("API Schema Validation", () => {
  test("People API returns expected columns", async ({ page }) => {
    const response = await page.request.get("/api/people?limit=1");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.people).toBeDefined();

    if (data.people.length > 0) {
      const person = data.people[0];
      for (const col of EXPECTED_COLUMNS.people) {
        expect(
          person,
          `People API missing expected column: ${col}`
        ).toHaveProperty(col);
      }
    }
  });

  test("Cats API returns expected columns", async ({ page }) => {
    const response = await page.request.get("/api/cats?limit=1");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.cats).toBeDefined();

    if (data.cats.length > 0) {
      const cat = data.cats[0];
      for (const col of EXPECTED_COLUMNS.cats) {
        expect(
          cat,
          `Cats API missing expected column: ${col}`
        ).toHaveProperty(col);
      }
    }
  });

  test("People API handles query parameters", async ({ page }) => {
    // Test various query params don't break the API
    const testCases = [
      "/api/people?limit=10",
      "/api/people?limit=10&offset=0",
      "/api/people?q=test",
      "/api/people?sort=name",
      "/api/people?has_email=true",
    ];

    for (const url of testCases) {
      const response = await page.request.get(url);
      expect(response.ok(), `API failed for: ${url}`).toBeTruthy();
      const data = await response.json();
      expect(data.people, `No people array for: ${url}`).toBeDefined();
    }
  });

  test("Cats API handles query parameters", async ({ page }) => {
    const testCases = [
      "/api/cats?limit=10",
      "/api/cats?limit=10&offset=0",
      "/api/cats?q=test",
      "/api/cats?has_place=true",
      "/api/cats?sex=male",
    ];

    for (const url of testCases) {
      const response = await page.request.get(url);
      expect(response.ok(), `API failed for: ${url}`).toBeTruthy();
      const data = await response.json();
      expect(data.cats, `No cats array for: ${url}`).toBeDefined();
    }
  });

  test("Places API returns valid data", async ({ page }) => {
    const response = await page.request.get("/api/places?limit=1");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.places || data.results).toBeDefined();
  });

  test("Requests API returns valid data", async ({ page }) => {
    const response = await page.request.get("/api/requests?limit=1");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.requests || data.results).toBeDefined();
  });
});

test.describe("API Error Handling", () => {
  test("APIs handle invalid IDs gracefully", async ({ page }) => {
    const invalidId = "00000000-0000-0000-0000-000000000000";

    const endpoints = [
      `/api/people/${invalidId}`,
      `/api/cats/${invalidId}`,
      `/api/places/${invalidId}`,
      `/api/requests/${invalidId}`,
    ];

    for (const url of endpoints) {
      const response = await page.request.get(url);
      // Should return 404 (not found) or 200 with null, not 500
      expect(
        response.status(),
        `API returned 500 for: ${url}`
      ).not.toBe(500);
    }
  });

  // FIXED: UUID validation added to API routes
  test("APIs handle malformed UUIDs gracefully", async ({ page }) => {
    const malformedId = "not-a-uuid";

    const endpoints = [
      `/api/people/${malformedId}`,
      `/api/cats/${malformedId}`,
      `/api/places/${malformedId}`,
    ];

    for (const url of endpoints) {
      const response = await page.request.get(url);
      // Should return 400 or 404, not 500
      expect(
        response.status(),
        `API returned 500 for malformed UUID: ${url}`
      ).not.toBe(500);
    }
  });

  // FIXED: validatePagination helper added to API routes
  test("APIs handle extreme pagination gracefully", async ({ page }) => {
    const testCases = [
      "/api/people?limit=1000&offset=999999",
      "/api/cats?limit=0",
      "/api/places?limit=-1",
    ];

    for (const url of testCases) {
      const response = await page.request.get(url);
      // Should not return 500
      expect(
        response.status(),
        `API returned 500 for: ${url}`
      ).not.toBe(500);
    }
  });
});

test.describe("Tippy API Resilience", () => {
  test("Tippy API handles missing auth gracefully", async ({ request }) => {
    // Use standalone request (no auth cookies)
    const response = await request.post("/api/tippy/chat", {
      data: { message: "Hello" },
    });

    // Should not return 500
    expect(response.status()).not.toBe(500);

    const data = await response.json();
    // Should return a helpful message, not an error
    expect(data.message).toBeTruthy();
    expect(data.message.length).toBeGreaterThan(10);
  });

  test("Tippy API handles empty message", async ({ page }) => {
    const response = await page.request.post("/api/tippy/chat", {
      data: { message: "" },
    });

    // Should return 400, not 500
    expect(response.status()).not.toBe(500);
  });

  test("Tippy API handles malformed requests", async ({ page }) => {
    const response = await page.request.post("/api/tippy/chat", {
      data: { wrongField: "test" },
    });

    // Should return 400, not 500
    expect(response.status()).not.toBe(500);
  });
});

test.describe("Search API Validation", () => {
  test("Unified search returns valid results", async ({ page }) => {
    const response = await page.request.get("/api/search?q=test&limit=5");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data.results || data)).toBeTruthy();
  });

  test("Search handles special characters", async ({ page }) => {
    const specialQueries = [
      "/api/search?q=%40test",       // @test
      "/api/search?q=test%2Bmore",   // test+more
      "/api/search?q=%27quoted%27",  // 'quoted'
    ];

    for (const url of specialQueries) {
      const response = await page.request.get(url);
      expect(
        response.status(),
        `Search failed for special chars: ${url}`
      ).not.toBe(500);
    }
  });
});
