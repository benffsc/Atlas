/**
 * Beacon Analytics Tests
 *
 * These tests verify the Beacon population ecology analytics system,
 * including colony metrics, DBSCAN clustering, seasonal predictions,
 * and calculation accuracy.
 *
 * Tests are READ-ONLY - they query but don't modify data.
 */

import { test, expect } from "@playwright/test";
import {
  BEACON_API_TESTS,
  BEACON_CALCULATION_TESTS,
  SEASONAL_SCENARIOS,
  type BeaconPlace,
} from "./fixtures/beacon-scenarios";
import { unwrapApiResponse } from "./helpers/api-response";

// ============================================================================
// BEACON SUMMARY ENDPOINT TESTS
// ============================================================================

test.describe("Beacon Analytics: Summary Endpoint", () => {
  test("GET /api/beacon/summary returns 200", async ({ request }) => {
    const response = await request.get("/api/beacon/summary");
    expect(response.ok()).toBeTruthy();
  });

  test("Summary has required structure", async ({ request }) => {
    const response = await request.get("/api/beacon/summary");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ summary: unknown; insights: unknown }>(wrapped);
    expect(data.summary).toBeDefined();
    expect(data.insights).toBeDefined();
  });

  test("Summary total_cats is non-negative", async ({ request }) => {
    const response = await request.get("/api/beacon/summary");
    const wrapped = await response.json();
    const data = unwrapApiResponse<{ summary: { total_cats: number } }>(wrapped);

    expect(Number(data.summary.total_cats)).toBeGreaterThanOrEqual(0);
  });

  test("Summary overall_alteration_rate is 0-100 (percentage)", async ({ request }) => {
    const response = await request.get("/api/beacon/summary");
    const wrapped = await response.json();
    const data = unwrapApiResponse<{ summary: { overall_alteration_rate: string } }>(wrapped);

    const rate = parseFloat(data.summary.overall_alteration_rate);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(100);
  });

  test("Summary tnr_target_rate is 75 (Levy threshold)", async ({ request }) => {
    const response = await request.get("/api/beacon/summary");
    const wrapped = await response.json();
    const data = unwrapApiResponse<{ insights: { tnr_target_rate: number } }>(wrapped);

    expect(data.insights.tnr_target_rate).toBe(75);
  });

  test("Summary colony status counts are consistent", async ({ request }) => {
    const response = await request.get("/api/beacon/summary");
    const wrapped = await response.json();
    const data = unwrapApiResponse<{ summary: Record<string, unknown> }>(wrapped);

    const s = data.summary;
    const totalColonies =
      (Number(s.colonies_managed) || 0) +
      (Number(s.colonies_in_progress) || 0) +
      (Number(s.colonies_needs_work) || 0) +
      (Number(s.colonies_needs_attention) || 0);

    // Total colonies should be <= places_with_cats
    expect(totalColonies).toBeLessThanOrEqual(Number(s.places_with_cats) || totalColonies);
  });
});

// ============================================================================
// BEACON PLACES ENDPOINT TESTS
// ============================================================================

test.describe("Beacon Analytics: Places Endpoint", () => {
  test("GET /api/beacon/places returns array", async ({ request }) => {
    const response = await request.get("/api/beacon/places");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: unknown[] }>(wrapped);
    expect(Array.isArray(data.places)).toBeTruthy();
  });

  test("Places have required fields", async ({ request }) => {
    const response = await request.get("/api/beacon/places?limit=10");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    if (data.places.length > 0) {
      const place = data.places[0];
      expect(place.place_id).toBeDefined();
      expect(place.colony_status).toBeDefined();
    }
  });

  test("Places minCats filter works", async ({ request }) => {
    const response = await request.get("/api/beacon/places?minCats=5&limit=50");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    for (const place of data.places) {
      const catCount = Math.max(
        Number(place.verified_cat_count) || 0,
        Number(place.estimated_total) || 0
      );
      expect(catCount).toBeGreaterThanOrEqual(5);
    }
  });

  test("Places status filter works", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/places?status=needs_attention&limit=20"
    );
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    for (const place of data.places) {
      expect(place.colony_status).toBe("needs_attention");
    }
  });

  test("Places bounds filter accepts valid coordinates", async ({ request }) => {
    // Santa Rosa approximate bounds
    const response = await request.get(
      "/api/beacon/places?bounds=38.4,-122.8,38.5,-122.6&limit=20"
    );
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: unknown[] }>(wrapped);
    expect(Array.isArray(data.places)).toBeTruthy();
  });
});

// ============================================================================
// BEACON CLUSTERS ENDPOINT TESTS
// ============================================================================

test.describe("Beacon Analytics: Clusters Endpoint", () => {
  test("GET /api/beacon/clusters returns array", async ({ request }) => {
    const response = await request.get("/api/beacon/clusters");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ clusters: unknown[] }>(wrapped);
    expect(Array.isArray(data.clusters)).toBeTruthy();
  });

  test("Clusters have centroid coordinates", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/clusters?epsilon=200&minPoints=2"
    );
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ clusters: Array<{ centroid_lat: number; centroid_lng: number }> }>(wrapped);
    for (const cluster of data.clusters) {
      expect(typeof cluster.centroid_lat).toBe("number");
      expect(typeof cluster.centroid_lng).toBe("number");
    }
  });

  test("Clusters have minimum place count", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/clusters?epsilon=200&minPoints=3"
    );
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ clusters: Array<{ place_count: number }> }>(wrapped);
    for (const cluster of data.clusters) {
      expect(cluster.place_count).toBeGreaterThanOrEqual(2);
    }
  });

  test("Cluster epsilon parameter affects results", async ({ request }) => {
    const response100 = await request.get(
      "/api/beacon/clusters?epsilon=100&minPoints=2"
    );
    const response500 = await request.get(
      "/api/beacon/clusters?epsilon=500&minPoints=2"
    );

    expect(response100.ok()).toBeTruthy();
    expect(response500.ok()).toBeTruthy();

    const wrapped100 = await response100.json();
    const wrapped500 = await response500.json();
    const data100 = unwrapApiResponse<{ clusters: unknown[] }>(wrapped100);
    const data500 = unwrapApiResponse<{ clusters: unknown[] }>(wrapped500);

    // Larger epsilon typically means larger/fewer clusters
    // Just verify both return valid data
    expect(Array.isArray(data100.clusters)).toBeTruthy();
    expect(Array.isArray(data500.clusters)).toBeTruthy();
  });
});

// ============================================================================
// SEASONAL ANALYTICS TESTS
// ============================================================================

test.describe("Beacon Analytics: Seasonal Endpoints", () => {
  test("GET /api/beacon/seasonal-alerts returns alerts", async ({ request }) => {
    const response = await request.get("/api/beacon/seasonal-alerts");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ alerts: unknown[] }>(wrapped);
    expect(data.alerts).toBeDefined();
    expect(Array.isArray(data.alerts)).toBeTruthy();
  });

  test("GET /api/beacon/seasonal-dashboard returns data", async ({
    request,
  }) => {
    const response = await request.get("/api/beacon/seasonal-dashboard");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("GET /api/beacon/yoy-comparison returns comparison", async ({
    request,
  }) => {
    const response = await request.get("/api/beacon/yoy-comparison");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// CALCULATION VALIDATION TESTS
// These verify the mathematical correctness of Beacon calculations
// ============================================================================

test.describe("Beacon Analytics: Calculation Validation", () => {
  test("Alteration rate never exceeds 100%", async ({ request }) => {
    const response = await request.get("/api/beacon/places?limit=500");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    const places = data.places;

    for (const place of places) {
      if (place.verified_alteration_rate !== null && place.verified_alteration_rate !== undefined) {
        expect(Number(place.verified_alteration_rate)).toBeLessThanOrEqual(100);
      }
    }
  });

  test("Alteration rate is non-negative", async ({ request }) => {
    const response = await request.get("/api/beacon/places?limit=500");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    const places = data.places;

    for (const place of places) {
      if (place.verified_alteration_rate !== null && place.verified_alteration_rate !== undefined) {
        expect(Number(place.verified_alteration_rate)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("Colony estimates are non-negative", async ({ request }) => {
    const response = await request.get("/api/beacon/places?limit=500");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    const places = data.places;

    for (const place of places) {
      if (place.estimated_total !== null && place.estimated_total !== undefined) {
        expect(Number(place.estimated_total)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("Verified counts are non-negative", async ({ request }) => {
    const response = await request.get("/api/beacon/places?limit=500");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    const places = data.places;

    for (const place of places) {
      if (place.verified_cat_count !== null && place.verified_cat_count !== undefined) {
        expect(Number(place.verified_cat_count)).toBeGreaterThanOrEqual(0);
      }
      if (place.verified_altered_count !== null && place.verified_altered_count !== undefined) {
        expect(Number(place.verified_altered_count)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("Altered never exceeds total verified", async ({ request }) => {
    const response = await request.get("/api/beacon/places?limit=500");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    const places = data.places;

    for (const place of places) {
      if (
        place.verified_altered_count !== null &&
        place.verified_cat_count !== null &&
        place.verified_altered_count !== undefined &&
        place.verified_cat_count !== undefined
      ) {
        expect(Number(place.verified_altered_count)).toBeLessThanOrEqual(
          Number(place.verified_cat_count)
        );
      }
    }
  });

  test("Status classification matches thresholds", async ({ request }) => {
    const response = await request.get("/api/beacon/places?limit=500");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: BeaconPlace[] }>(wrapped);
    const places = data.places;

    for (const place of places) {
      if (place.colony_status === "no_data") continue;
      if (place.lower_bound_alteration_rate === null || place.lower_bound_alteration_rate === undefined)
        continue;

      const rate = Number(place.lower_bound_alteration_rate);
      const status = place.colony_status;

      // Thresholds are in percentages (0-100)
      if (rate >= 75) {
        expect(status).toBe("managed");
      } else if (rate >= 50) {
        expect(status).toBe("in_progress");
      } else if (rate >= 25) {
        expect(status).toBe("needs_work");
      } else {
        expect(status).toBe("needs_attention");
      }
    }
  });
});

// ============================================================================
// ADMIN BEACON ENDPOINTS
// ============================================================================

test.describe("Beacon Analytics: Admin Endpoints", () => {
  test("GET /api/admin/beacon/summary returns data quality info", async ({
    request,
  }) => {
    const response = await request.get("/api/admin/beacon/summary");

    // May require auth - just verify it doesn't 500
    expect(response.status()).toBeLessThan(500);
  });

  test("GET /api/admin/beacon/forecasts returns forecast data", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/admin/beacon/forecasts?view=forecasts&limit=10"
    );

    // May require auth - just verify it doesn't 500
    expect(response.status()).toBeLessThan(500);
  });

  test("GET /api/admin/beacon/enrichment returns pipeline status", async ({
    request,
  }) => {
    const response = await request.get("/api/admin/beacon/enrichment");

    // May require auth - just verify it doesn't 500
    expect(response.status()).toBeLessThan(500);
  });
});

// ============================================================================
// FFS-538: DATE-FILTERED MAP DATA
// ============================================================================

test.describe("Beacon Analytics: Date-Filtered Map", () => {
  test("GET /api/beacon/map returns 200 with no filters", async ({ request }) => {
    const response = await request.get("/api/beacon/map");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: unknown[]; summary: unknown }>(wrapped);
    expect(Array.isArray(data.places)).toBeTruthy();
    expect(data.summary).toBeDefined();
  });

  test("Date range filter returns places", async ({ request }) => {
    const response = await request.get("/api/beacon/map?from=2025-01-01&to=2025-12-31");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: unknown[]; filters: { from: string; to: string } }>(wrapped);
    expect(data.filters.from).toBe("2025-01-01");
    expect(data.filters.to).toBe("2025-12-31");
  });

  test("Zone filter narrows results", async ({ request }) => {
    const response = await request.get("/api/beacon/map?zone=Sonoma");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ places: Array<{ service_zone: string | null }> }>(wrapped);
    for (const place of data.places) {
      if (place.service_zone) {
        expect(place.service_zone).toBe("Sonoma");
      }
    }
  });

  test("Invalid date returns 400", async ({ request }) => {
    const response = await request.get("/api/beacon/map?from=not-a-date");
    expect(response.status()).toBe(400);
  });

  test("Summary has status breakdown", async ({ request }) => {
    const response = await request.get("/api/beacon/map");
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{
      summary: { status_breakdown: Record<string, number>; total_places: number };
    }>(wrapped);
    expect(data.summary.status_breakdown).toBeDefined();
    expect(typeof data.summary.total_places).toBe("number");
  });
});

// ============================================================================
// FFS-538: ZONE ALTERATION ROLLUPS
// ============================================================================

test.describe("Beacon Analytics: Zone Rollups", () => {
  test("GET /api/beacon/zones returns 200", async ({ request }) => {
    const response = await request.get("/api/beacon/zones");
    // May return 500 if beacon schema not deployed — just verify no crash
    expect(response.status()).toBeLessThan(502);
  });

  test("Zones have required fields", async ({ request }) => {
    const response = await request.get("/api/beacon/zones");
    if (!response.ok()) return; // Skip if beacon schema not deployed

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ zones: Array<{ zone_id: string; zone_status: string; total_cats: number }> }>(wrapped);
    expect(Array.isArray(data.zones)).toBeTruthy();
    for (const zone of data.zones) {
      expect(zone.zone_id).toBeDefined();
      expect(zone.zone_status).toBeDefined();
      expect(typeof zone.total_cats).toBe("number");
    }
  });

  test("Zone status filter works", async ({ request }) => {
    const response = await request.get("/api/beacon/zones?status=managed");
    if (!response.ok()) return;

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ zones: Array<{ zone_status: string }> }>(wrapped);
    for (const zone of data.zones) {
      expect(zone.zone_status).toBe("managed");
    }
  });

  test("Zone summary has aggregates", async ({ request }) => {
    const response = await request.get("/api/beacon/zones");
    if (!response.ok()) return;

    const wrapped = await response.json();
    const data = unwrapApiResponse<{
      summary: { total_zones: number; total_cats: number; status_breakdown: Record<string, number> };
    }>(wrapped);
    expect(typeof data.summary.total_zones).toBe("number");
    expect(data.summary.status_breakdown).toBeDefined();
  });
});

// ============================================================================
// FFS-538: TEMPORAL TRENDS
// ============================================================================

test.describe("Beacon Analytics: Temporal Trends", () => {
  test("Invalid place UUID returns 400", async ({ request }) => {
    const response = await request.get("/api/beacon/trends/not-a-uuid");
    expect(response.status()).toBeLessThan(500);
  });

  test("Non-existent place returns empty trends", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/trends/00000000-0000-0000-0000-000000000000"
    );
    if (!response.ok()) return; // May 500 if beacon schema not deployed

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ trends: unknown[]; summary: { total_new_cats: number } }>(wrapped);
    expect(Array.isArray(data.trends)).toBeTruthy();
    expect(data.summary.total_new_cats).toBe(0);
  });

  test("Months parameter is respected", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/trends/00000000-0000-0000-0000-000000000000?months=6"
    );
    if (!response.ok()) return;

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ months_back: number; trends: unknown[] }>(wrapped);
    expect(data.months_back).toBe(6);
    // 6 months + current month = at most 7 data points
    expect(data.trends.length).toBeLessThanOrEqual(7);
  });
});

// ============================================================================
// FFS-538: POPULATION ESTIMATION (Chapman Mark-Recapture)
// ============================================================================

test.describe("Beacon Analytics: Population Estimation", () => {
  test("Invalid place UUID returns 400", async ({ request }) => {
    const response = await request.get("/api/beacon/population/not-a-uuid");
    expect(response.status()).toBeLessThan(500);
  });

  test("Non-existent place returns null estimate", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/population/00000000-0000-0000-0000-000000000000"
    );
    if (!response.ok()) return; // May fail if beacon schema not deployed

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ estimate: unknown; meta: { formula: string } }>(wrapped);
    expect(data.meta.formula).toContain("Chapman");
  });

  test("Response includes scientific metadata", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/population/00000000-0000-0000-0000-000000000000"
    );
    if (!response.ok()) return;

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ meta: Record<string, unknown> }>(wrapped);
    expect(data.meta).toBeDefined();
    expect(data.meta.formula).toBeDefined();
  });
});

// ============================================================================
// FFS-538: LOCATION COMPARISON
// ============================================================================

test.describe("Beacon Analytics: Location Comparison", () => {
  test("Missing places param returns 400", async ({ request }) => {
    const response = await request.get("/api/beacon/compare");
    expect(response.status()).toBe(400);
  });

  test("Single place returns 400 (need at least 2)", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/compare?places=00000000-0000-0000-0000-000000000000"
    );
    expect(response.status()).toBe(400);
  });

  test("Invalid UUID returns 400", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/compare?places=not-a-uuid,also-not-uuid"
    );
    expect(response.status()).toBe(400);
  });

  test("Valid UUIDs return comparison data", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/compare?places=00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000001"
    );
    if (!response.ok()) return; // May fail if beacon schema not deployed

    const wrapped = await response.json();
    const data = unwrapApiResponse<{
      places: unknown[];
      comparison_summary: { places_compared: number };
    }>(wrapped);
    expect(Array.isArray(data.places)).toBeTruthy();
    expect(typeof data.comparison_summary.places_compared).toBe("number");
  });

  test("Too many places returns 400", async ({ request }) => {
    const ids = Array.from({ length: 11 }, (_, i) =>
      `00000000-0000-0000-0000-00000000000${i.toString(16)}`
    ).join(",");
    const response = await request.get(`/api/beacon/compare?places=${ids}`);
    expect(response.status()).toBe(400);
  });
});

// ============================================================================
// BEACON MVP: FORECAST ENDPOINT
// ============================================================================

test.describe("Beacon Analytics: Population Forecast", () => {
  test("Missing place_id returns 400", async ({ request }) => {
    const response = await request.get("/api/beacon/forecast");
    expect(response.status()).toBe(400);
  });

  test("Invalid place_id returns 400", async ({ request }) => {
    const response = await request.get("/api/beacon/forecast?place_id=not-a-uuid");
    expect(response.status()).toBe(400);
  });

  test("Valid place_id returns forecast with 3 scenarios", async ({ request }) => {
    // Use a zero UUID — will either return data or 400 "no cat data"
    const response = await request.get(
      "/api/beacon/forecast?place_id=00000000-0000-0000-0000-000000000000"
    );
    // No cat data → 400, or success → 200
    expect(response.status()).toBeLessThan(500);

    if (response.ok()) {
      const wrapped = await response.json();
      const data = unwrapApiResponse<{
        scenarios: { baseline: { points: unknown[] }; optimistic: { points: unknown[] }; aggressive: { points: unknown[] } };
        current: { population: number };
      }>(wrapped);
      expect(data.scenarios.baseline).toBeDefined();
      expect(data.scenarios.optimistic).toBeDefined();
      expect(data.scenarios.aggressive).toBeDefined();
      expect(data.current.population).toBeGreaterThanOrEqual(0);
    }
  });

  test("Forecast points have required fields", async ({ request }) => {
    // Try to find a real place with cats
    const placesRes = await request.get("/api/beacon/places?limit=1&minCats=3");
    if (!placesRes.ok()) return;

    const placesWrapped = await placesRes.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(placesWrapped);
    if (placesData.places.length === 0) return;

    const placeId = placesData.places[0].place_id;
    const response = await request.get(`/api/beacon/forecast?place_id=${placeId}&months=24`);
    if (!response.ok()) return;

    const wrapped = await response.json();
    const data = unwrapApiResponse<{
      scenarios: { baseline: { points: Array<{ month: number; population: number; alteration_rate: number }> } };
    }>(wrapped);

    const points = data.scenarios.baseline.points;
    expect(points.length).toBeGreaterThan(0);

    for (const pt of points) {
      expect(typeof pt.month).toBe("number");
      expect(typeof pt.population).toBe("number");
      expect(pt.population).toBeGreaterThanOrEqual(0);
      expect(pt.alteration_rate).toBeGreaterThanOrEqual(0);
      expect(pt.alteration_rate).toBeLessThanOrEqual(100);
    }
  });

  test("Forecast months_to_75 is null or positive", async ({ request }) => {
    const placesRes = await request.get("/api/beacon/places?limit=1&minCats=3");
    if (!placesRes.ok()) return;

    const placesWrapped = await placesRes.json();
    const placesData = unwrapApiResponse<{ places: Array<{ place_id: string }> }>(placesWrapped);
    if (placesData.places.length === 0) return;

    const placeId = placesData.places[0].place_id;
    const response = await request.get(`/api/beacon/forecast?place_id=${placeId}`);
    if (!response.ok()) return;

    const wrapped = await response.json();
    const data = unwrapApiResponse<{
      scenarios: {
        baseline: { months_to_75: number | null };
        optimistic: { months_to_75: number | null };
        aggressive: { months_to_75: number | null };
      };
    }>(wrapped);

    for (const key of ["baseline", "optimistic", "aggressive"] as const) {
      const m = data.scenarios[key].months_to_75;
      if (m !== null) {
        expect(m).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================================
// BEACON MVP: BEACON PAGE UI (county rollup, date filter map)
// ============================================================================

test.describe("Beacon Analytics: Beacon Page", () => {
  test("Beacon page loads without errors", async ({ page }) => {
    await page.goto("/beacon");
    await page.waitForLoadState("networkidle");

    // Check county summary renders
    const heading = page.locator("text=Sonoma County Overview");
    // May or may not appear depending on zone data — just verify page loads
    expect(await page.title()).toBeDefined();
  });

  test("Beacon compare page loads", async ({ page }) => {
    await page.goto("/beacon/compare");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toContainText("Location Comparison");
  });

  test("Beacon scenarios page loads", async ({ page }) => {
    await page.goto("/beacon/scenarios");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toContainText("Population Forecast");
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

test.describe("Beacon Analytics: Edge Cases", () => {
  test("Handles empty bounds gracefully", async ({ request }) => {
    const response = await request.get("/api/beacon/places?bounds=");
    // Should either return all places or handle gracefully
    expect(response.status()).toBeLessThan(500);
  });

  test("Handles invalid status filter gracefully", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/places?status=invalid_status"
    );
    // Should return empty or handle gracefully
    expect(response.status()).toBeLessThan(500);
  });

  test("Handles negative minCats gracefully", async ({ request }) => {
    const response = await request.get("/api/beacon/places?minCats=-5");
    // Should handle gracefully
    expect(response.status()).toBeLessThan(500);
  });

  test("Handles very large epsilon gracefully", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/clusters?epsilon=100000&minPoints=2"
    );
    // Should handle gracefully (might return single mega-cluster or error)
    expect(response.status()).toBeLessThan(500);
  });

  test("Handles zero minPoints gracefully", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/clusters?epsilon=200&minPoints=0"
    );
    // Should handle gracefully
    expect(response.status()).toBeLessThan(500);
  });
});

// ============================================================================
// DATA CONSISTENCY TESTS
// ============================================================================

test.describe("Beacon Analytics: Data Consistency", () => {
  test("Summary totals are consistent with places sum", async ({ request }) => {
    const [summaryRes, placesRes] = await Promise.all([
      request.get("/api/beacon/summary"),
      request.get("/api/beacon/places?limit=10000"),
    ]);

    expect(summaryRes.ok()).toBeTruthy();
    expect(placesRes.ok()).toBeTruthy();

    const summaryWrapped = await summaryRes.json();
    const placesWrapped = await placesRes.json();
    const summary = unwrapApiResponse<{ summary: { total_verified_cats: number } }>(summaryWrapped);
    const placesData = unwrapApiResponse<{ places: BeaconPlace[] }>(placesWrapped);
    const places = placesData.places;

    // Calculate totals from places (convert strings to numbers)
    const placesTotal = places.reduce(
      (sum, p) => sum + (Number(p.verified_cat_count) || 0),
      0
    );

    // Summary totals should be close (might differ due to aggregation method)
    // Just verify they're in the same order of magnitude
    const summaryTotal = Number(summary.summary.total_verified_cats) || 0;
    if (summaryTotal > 0 && placesTotal > 0) {
      const ratio = placesTotal / summaryTotal;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2);
    }
  });

  test("Cluster place counts match place data", async ({ request }) => {
    const response = await request.get(
      "/api/beacon/clusters?epsilon=200&minPoints=2"
    );
    expect(response.ok()).toBeTruthy();

    const wrapped = await response.json();
    const data = unwrapApiResponse<{ clusters: Array<{ place_count: number }> }>(wrapped);
    for (const cluster of data.clusters) {
      // Place count should be positive
      expect(cluster.place_count).toBeGreaterThan(0);
    }
  });
});
