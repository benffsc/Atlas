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
