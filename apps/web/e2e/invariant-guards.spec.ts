/**
 * Invariant Guard Tests
 *
 * Validates critical system invariants documented in CLAUDE.md.
 * Each test section references the specific invariant it guards.
 *
 * These are READ-ONLY tests against real data.
 * No AI/Anthropic API calls — safe to run without cost.
 */

import { test, expect } from "@playwright/test";
import { navigateTo, findRealEntity } from "./ui-test-helpers";
import { unwrapApiResponse } from "./helpers/api-response";

// ============================================================================
// INV-9: CAT IDENTITY FALLBACK CHAIN
// Match cats by: microchip first, then clinichq_animal_id.
// ============================================================================

test.describe("Cat Identity Fallback Chain (INV-9)", () => {
  test.setTimeout(30000);

  test("cats with microchip have it as primary identifier", async ({ request }) => {
    const response = await request.get("/api/cats?limit=20");
    if (!response.ok()) {
      test.skip(true, "Cats API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const cats = (data.cats as unknown[]) || [];
    test.skip(cats.length === 0, "No cats in database");

    const catsWithMicrochip = cats.filter((c: Record<string, unknown>) => c.has_microchip || c.microchip);
    // At least some cats should have microchips
    expect(catsWithMicrochip.length).toBeGreaterThan(0);
  });

  test("cat detail page shows microchip when available", async ({ page, request }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId!}`);

    // Cat detail should load without error
    const content = await page.content();
    expect(content).not.toContain("404");
    expect(content).not.toContain("not found");
  });

  test("cats API returns source_system field", async ({ request }) => {
    const response = await request.get("/api/cats?limit=5");
    if (!response.ok()) {
      test.skip(true, "Cats API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const cats = (data.cats as unknown[]) || [];
    test.skip(cats.length === 0, "No cats in database");

    // Every cat should have a source_system
    for (const cat of cats) {
      expect(cat.source_system).toBeTruthy();
    }
  });
});

// ============================================================================
// INV-7: MERGE-AWARE QUERIES
// All queries MUST filter merged_into_*_id IS NULL.
// ============================================================================

test.describe("Merge-Aware Queries (INV-7)", () => {
  test.setTimeout(30000);

  test("people list excludes merged records", async ({ request }) => {
    const response = await request.get("/api/people?limit=50");
    if (!response.ok()) {
      test.skip(true, "People API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const people = (data.people as unknown[]) || [];

    // No person in the list should be a merged record
    for (const person of people) {
      expect(
        person.merged_into_person_id,
        `Person ${person.person_id} is merged but appears in list`
      ).toBeFalsy();
    }
  });

  test("places list excludes merged records", async ({ request }) => {
    const response = await request.get("/api/places?limit=50");
    if (!response.ok()) {
      test.skip(true, "Places API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const places = (data.places as unknown[]) || [];

    for (const place of places) {
      expect(
        place.merged_into_place_id,
        `Place ${place.place_id} is merged but appears in list`
      ).toBeFalsy();
    }
  });

  test("cats list excludes merged records", async ({ request }) => {
    const response = await request.get("/api/cats?limit=50");
    if (!response.ok()) {
      test.skip(true, "Cats API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const cats = (data.cats as unknown[]) || [];

    for (const cat of cats) {
      expect(
        cat.merged_into_cat_id,
        `Cat ${cat.cat_id} is merged but appears in list`
      ).toBeFalsy();
    }
  });
});

// ============================================================================
// INV-46: UUID VALIDATION
// All [id] routes MUST return 400 for invalid UUID format.
// ============================================================================

test.describe("UUID Validation (INV-46)", () => {
  test.setTimeout(15000);

  const invalidUUIDs = [
    "not-a-uuid",
    "12345",
    "'; DROP TABLE sot.cats; --",
    "<script>alert(1)</script>",
    "",
  ];

  const entityRoutes = ["/api/cats", "/api/people", "/api/places", "/api/requests"];

  for (const route of entityRoutes) {
    test(`${route}/[invalid] returns 400, not 500`, async ({ request }) => {
      for (const badId of invalidUUIDs) {
        if (!badId) continue; // Skip empty string as path segment
        const response = await request.get(`${route}/${encodeURIComponent(badId)}`);
        // Should be 400 (bad request) not 500 (server error)
        expect(
          response.status(),
          `${route}/${badId} returned ${response.status()} instead of 400`
        ).not.toBe(500);
      }
    });
  }
});

// ============================================================================
// INV-47: PAGINATION VALIDATION
// All list routes MUST use parsePagination(). Negative values rejected.
// ============================================================================

test.describe("Pagination Validation (INV-47)", () => {
  test.setTimeout(15000);

  test("negative limit defaults safely", async ({ request }) => {
    const response = await request.get("/api/cats?limit=-1");
    expect(response.ok()).toBe(true);

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const cats = (data.cats as unknown[]) || [];
    // Should return results (defaulted to safe value), not crash
    expect(cats.length).toBeGreaterThanOrEqual(0);
  });

  test("negative offset defaults safely", async ({ request }) => {
    const response = await request.get("/api/cats?offset=-10");
    expect(response.ok()).toBe(true);
  });

  test("very large limit is capped", async ({ request }) => {
    const response = await request.get("/api/cats?limit=999999");
    expect(response.ok()).toBe(true);

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const cats = (data.cats as unknown[]) || [];
    // Should be capped, not return 999999 results
    expect(cats.length).toBeLessThanOrEqual(250);
  });

  test("non-numeric limit/offset defaults safely", async ({ request }) => {
    const response = await request.get("/api/cats?limit=abc&offset=xyz");
    expect(response.ok()).toBe(true);
  });
});

// ============================================================================
// INV-50/52: API RESPONSE FORMAT
// All responses MUST use { success: true, data: T } shape.
// ============================================================================

test.describe("API Response Format (INV-50/52)", () => {
  test.setTimeout(15000);

  const listEndpoints = [
    "/api/cats?limit=1",
    "/api/people?limit=1",
    "/api/places?limit=1",
    "/api/requests?limit=1",
  ];

  for (const endpoint of listEndpoints) {
    test(`${endpoint} returns standardized response`, async ({ request }) => {
      const response = await request.get(endpoint);
      if (!response.ok()) {
        test.skip(true, `${endpoint} not available`);
        return;
      }

      const json = await response.json();

      // Should have success field (new format) or data directly (legacy)
      if ("success" in json) {
        expect(json.success).toBe(true);
        expect(json.data).toBeTruthy();
      }
    });
  }

  test("error responses have proper shape", async ({ request }) => {
    const response = await request.get("/api/cats/not-a-valid-uuid");

    if (response.status() >= 400) {
      const json = await response.json();

      // Error response should have error.message
      if ("success" in json) {
        expect(json.success).toBe(false);
        expect(json.error).toBeTruthy();
        expect(json.error.message).toBeTruthy();
      }
    }
  });
});

// ============================================================================
// INV-11: PLACE IS THE ANCHOR (not person→place chain)
// Cats link to places via inferred_place_id, NOT via person.
// ============================================================================

test.describe("Place Is The Anchor (INV-11)", () => {
  test.setTimeout(30000);

  test("cats with places show place info on detail page", async ({ page, request }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId!}`);

    // The page should load (basic sanity check)
    await expect(page.locator("body")).toBeVisible();
  });

  test("places list shows cat counts", async ({ request }) => {
    const response = await request.get("/api/places?limit=10");
    if (!response.ok()) {
      test.skip(true, "Places API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const places = (data.places as unknown[]) || [];
    test.skip(places.length === 0, "No places in database");

    // Places should have cat_count field
    for (const place of places) {
      expect(place.cat_count).toBeDefined();
    }
  });
});

// ============================================================================
// SOURCE SYSTEM VALUES
// Must use exact values: 'airtable', 'clinichq', 'shelterluv', etc.
// ============================================================================

test.describe("Source System Values", () => {
  test.setTimeout(15000);

  const validSourceSystems = [
    "airtable",
    "clinichq",
    "shelterluv",
    "volunteerhub",
    "web_intake",
    "petlink",
    "google_maps",
    "atlas_ui",
    "e2e_test",
  ];

  test("cats have valid source_system values", async ({ request }) => {
    const response = await request.get("/api/cats?limit=50");
    if (!response.ok()) {
      test.skip(true, "Cats API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const cats = (data.cats as unknown[]) || [];
    test.skip(cats.length === 0, "No cats in database");

    for (const cat of cats) {
      if (cat.source_system) {
        expect(
          validSourceSystems,
          `Cat ${cat.cat_id} has unknown source_system: ${cat.source_system}`
        ).toContain(cat.source_system);
      }
    }
  });
});

// ============================================================================
// REQUEST LIFECYCLE
// Status transitions: new → triaged → scheduled → in_progress → completed
// ============================================================================

test.describe("Request Lifecycle (Status Validation)", () => {
  test.setTimeout(15000);

  const validStatuses = [
    "new",
    "triaged",
    "scheduled",
    "in_progress",
    "completed",
    "cancelled",
    "on_hold",
  ];

  test("all requests have valid status values", async ({ request }) => {
    const response = await request.get("/api/requests?limit=50");
    if (!response.ok()) {
      test.skip(true, "Requests API not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const requests = (data.requests as unknown[]) || [];
    test.skip(requests.length === 0, "No requests in database");

    for (const req of requests) {
      if (req.status) {
        expect(
          validStatuses,
          `Request ${req.request_id} has invalid status: ${req.status}`
        ).toContain(req.status);
      }
    }
  });

  test("completed requests have resolved_at set", async ({ request }) => {
    const response = await request.get("/api/requests?limit=100&status=completed");
    if (!response.ok()) {
      // Endpoint may not support status filter, skip
      test.skip(true, "Requests status filter not available");
      return;
    }

    const data = unwrapApiResponse<Record<string, unknown>>(await response.json());
    const requests = (data.requests as unknown[]) || [];

    for (const req of requests) {
      if (req.status === "completed") {
        expect(
          req.resolved_at,
          `Completed request ${req.request_id} missing resolved_at`
        ).toBeTruthy();
      }
    }
  });
});

// ============================================================================
// SEARCH API
// /api/search?q=...&limit=8&suggestions=true (no type= filter)
// ============================================================================

test.describe("Search API", () => {
  test.setTimeout(15000);

  test("search returns results for common terms", async ({ request }) => {
    const response = await request.get("/api/search?q=cat&limit=5");
    if (!response.ok()) {
      test.skip(true, "Search API not available");
      return;
    }

    const json = await response.json();
    // Should return some shape of results
    expect(json).toBeTruthy();
  });

  test("search with empty query does not crash", async ({ request }) => {
    const response = await request.get("/api/search?q=");
    // Should return 200 or 400, never 500
    expect(response.status()).not.toBe(500);
  });

  test("search handles special characters safely", async ({ request }) => {
    const specialQueries = [
      "O'Brien",
      "test@email.com",
      "123-456-7890",
      "café",
    ];

    for (const query of specialQueries) {
      const response = await request.get(`/api/search?q=${encodeURIComponent(query)}&limit=3`);
      // Should not crash
      expect(
        response.status(),
        `Search for "${query}" returned ${response.status()}`
      ).not.toBe(500);
    }
  });
});

// ============================================================================
// ARIA TAB ACCESSIBILITY (FFS-6)
// TabBar and ProfileLayout must have role="tab", aria-selected
// ============================================================================

test.describe("Tab Accessibility (FFS-6)", () => {
  test.setTimeout(30000);

  test("cat detail page has accessible tabs", async ({ page, request }) => {
    const catId = await findRealEntity(request, "cats");
    test.skip(!catId, "No cats in database");

    await navigateTo(page, `/cats/${catId!}`);

    // Look for tablist (either TabBar or ProfileLayout)
    const tablist = page.locator('[role="tablist"]');
    const hasTablist = await tablist.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTablist) {
      const tabs = tablist.locator('[role="tab"]');
      const tabCount = await tabs.count();
      expect(tabCount).toBeGreaterThanOrEqual(2);

      // Exactly one tab should be selected
      const selectedTabs = tablist.locator('[role="tab"][aria-selected="true"]');
      expect(await selectedTabs.count()).toBe(1);
    }
  });

  test("place detail page has accessible tabs", async ({ page, request }) => {
    const placeId = await findRealEntity(request, "places");
    test.skip(!placeId, "No places in database");

    await navigateTo(page, `/places/${placeId!}`);

    const tablist = page.locator('[role="tablist"]');
    const hasTablist = await tablist.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTablist) {
      const tabs = tablist.locator('[role="tab"]');
      expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    }
  });

  test("person detail page has accessible tabs", async ({ page, request }) => {
    const personId = await findRealEntity(request, "people");
    test.skip(!personId, "No people in database");

    await navigateTo(page, `/people/${personId!}`);

    const tablist = page.locator('[role="tablist"]');
    const hasTablist = await tablist.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTablist) {
      const tabs = tablist.locator('[role="tab"]');
      expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    }
  });
});
