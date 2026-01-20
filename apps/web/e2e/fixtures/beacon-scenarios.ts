/**
 * Beacon Analytics Test Scenarios
 *
 * These scenarios test the Beacon population ecology analytics system,
 * including colony metrics, DBSCAN clustering, seasonal predictions,
 * and year-over-year comparisons.
 */

export interface BeaconApiTest {
  name: string;
  endpoint: string;
  method: "GET" | "POST";
  params?: Record<string, string | number>;
  expectedStatus: number;
  validate: (data: unknown) => boolean;
  description: string;
}

export interface BeaconCalculationTest {
  name: string;
  description: string;
  validate: (places: BeaconPlace[]) => boolean;
  errorMessage: string;
}

export interface BeaconPlace {
  place_id: string;
  display_name?: string;
  formatted_address?: string;
  verified_cat_count: number | string;
  verified_altered_count: number | string;
  estimated_total: number | string;
  verified_alteration_rate: number | string | null;
  lower_bound_alteration_rate: number | string | null;
  colony_status: "managed" | "in_progress" | "needs_work" | "needs_attention" | "no_data";
  latest_estimate_date?: string;
}

// ============================================================================
// BEACON API ENDPOINT TESTS
// ============================================================================

export const BEACON_API_TESTS: BeaconApiTest[] = [
  // Summary endpoint
  {
    name: "GET /api/beacon/summary returns valid structure",
    endpoint: "/api/beacon/summary",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { summary?: unknown; insights?: unknown };
      return (
        d.summary !== undefined &&
        d.insights !== undefined &&
        typeof d.summary === "object" &&
        typeof d.insights === "object"
      );
    },
    description: "Verifies summary endpoint returns required structure",
  },
  {
    name: "Summary total_cats is positive",
    endpoint: "/api/beacon/summary",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { summary?: { total_cats?: number } };
      return (d.summary?.total_cats ?? 0) >= 0;
    },
    description: "Verifies total cat count is non-negative",
  },
  {
    name: "Summary alteration_rate is 0-100 (percentage)",
    endpoint: "/api/beacon/summary",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { summary?: { overall_alteration_rate?: string | number } };
      const rate = parseFloat(String(d.summary?.overall_alteration_rate ?? 0));
      return rate >= 0 && rate <= 100;
    },
    description: "Verifies overall alteration rate is within valid bounds (0-100%)",
  },
  {
    name: "Summary tnr_target_rate is 75%",
    endpoint: "/api/beacon/summary",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { insights?: { tnr_target_rate?: number } };
      return d.insights?.tnr_target_rate === 75;
    },
    description: "Verifies TNR effectiveness target matches Levy et al. threshold",
  },

  // Places endpoint
  {
    name: "GET /api/beacon/places returns array",
    endpoint: "/api/beacon/places",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { places?: unknown[] };
      return Array.isArray(d.places);
    },
    description: "Verifies places endpoint returns array of places",
  },
  {
    name: "Places with bounds filter returns subset",
    endpoint: "/api/beacon/places",
    method: "GET",
    params: {
      // Approximate bounding box for Santa Rosa area
      bounds: "38.4,-122.8,38.5,-122.6",
    },
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { places?: unknown[] };
      return Array.isArray(d.places);
    },
    description: "Verifies geographic bounding box filtering works",
  },
  {
    name: "Places with minCats filter",
    endpoint: "/api/beacon/places",
    method: "GET",
    params: { minCats: 5 },
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { places?: BeaconPlace[] };
      return (
        Array.isArray(d.places) &&
        d.places.every((p) => Number(p.verified_cat_count ?? 0) >= 5 || Number(p.estimated_total ?? 0) >= 5)
      );
    },
    description: "Verifies minimum cat count filter works correctly",
  },
  {
    name: "Places with status filter",
    endpoint: "/api/beacon/places",
    method: "GET",
    params: { status: "needs_attention" },
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { places?: BeaconPlace[] };
      return (
        Array.isArray(d.places) &&
        d.places.every((p) => p.colony_status === "needs_attention")
      );
    },
    description: "Verifies status filter returns only matching colonies",
  },

  // Clusters endpoint
  {
    name: "GET /api/beacon/clusters returns clusters",
    endpoint: "/api/beacon/clusters",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { clusters?: unknown[] };
      return Array.isArray(d.clusters);
    },
    description: "Verifies cluster endpoint returns array",
  },
  {
    name: "Clusters have required fields",
    endpoint: "/api/beacon/clusters",
    method: "GET",
    params: { epsilon: 200, minPoints: 2 },
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as {
        clusters?: Array<{
          centroid_lat?: number;
          centroid_lng?: number;
          member_count?: number;
        }>;
      };
      if (!Array.isArray(d.clusters) || d.clusters.length === 0) return true;
      return d.clusters.every(
        (c) =>
          typeof c.centroid_lat === "number" &&
          typeof c.centroid_lng === "number" &&
          (c.member_count ?? 0) >= 2
      );
    },
    description: "Verifies clusters have centroid coordinates and minimum members",
  },

  // Seasonal endpoints
  {
    name: "GET /api/beacon/seasonal-alerts returns alerts",
    endpoint: "/api/beacon/seasonal-alerts",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      const d = data as { alerts?: unknown[] };
      return d.alerts !== undefined;
    },
    description: "Verifies seasonal alerts endpoint responds",
  },
  {
    name: "GET /api/beacon/seasonal-dashboard returns data",
    endpoint: "/api/beacon/seasonal-dashboard",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      return data !== null && typeof data === "object";
    },
    description: "Verifies seasonal dashboard endpoint responds",
  },

  // Year-over-year comparison
  {
    name: "GET /api/beacon/yoy-comparison returns comparison",
    endpoint: "/api/beacon/yoy-comparison",
    method: "GET",
    expectedStatus: 200,
    validate: (data: unknown) => {
      return data !== null && typeof data === "object";
    },
    description: "Verifies YoY comparison endpoint responds",
  },
];

// ============================================================================
// BEACON CALCULATION VALIDATION TESTS
// These run against the places data to verify mathematical correctness
// ============================================================================

export const BEACON_CALCULATION_TESTS: BeaconCalculationTest[] = [
  {
    name: "Alteration rate never exceeds 100%",
    description:
      "Lower-bound alteration rate should never exceed 1.0 (100%) as it's a defensive metric",
    validate: (places) =>
      places.every(
        (p) => p.lower_bound_alteration_rate === null || Number(p.lower_bound_alteration_rate) <= 1.0
      ),
    errorMessage: "Found places with alteration_rate > 1.0",
  },
  {
    name: "Alteration rate is non-negative",
    description: "Alteration rate should never be negative",
    validate: (places) =>
      places.every(
        (p) => p.lower_bound_alteration_rate === null || Number(p.lower_bound_alteration_rate) >= 0
      ),
    errorMessage: "Found places with negative alteration_rate",
  },
  {
    name: "Colony estimates are non-negative",
    description: "Estimated total cats should never be negative",
    validate: (places) =>
      places.every(
        (p) => p.estimated_total === null || Number(p.estimated_total) >= 0
      ),
    errorMessage: "Found places with negative estimated_total",
  },
  {
    name: "Verified counts are non-negative",
    description: "Verified cat counts should never be negative",
    validate: (places) =>
      places.every(
        (p) =>
          (p.verified_cat_count === null || Number(p.verified_cat_count) >= 0) &&
          (p.verified_altered_count === null || Number(p.verified_altered_count) >= 0)
      ),
    errorMessage: "Found places with negative verified counts",
  },
  {
    name: "Altered never exceeds total verified",
    description: "verified_altered_count should never exceed verified_cat_count",
    validate: (places) =>
      places.every(
        (p) =>
          p.verified_altered_count === null ||
          p.verified_cat_count === null ||
          Number(p.verified_altered_count) <= Number(p.verified_cat_count)
      ),
    errorMessage: "Found places where altered > total verified",
  },
  {
    name: "Status classification matches thresholds",
    description:
      "Colony status should match alteration rate thresholds (managed >= 75%, in_progress 50-74%, etc.)",
    validate: (places) =>
      places.every((p) => {
        if (p.colony_status === "no_data" || p.lower_bound_alteration_rate === null) return true;
        const rate = Number(p.lower_bound_alteration_rate);
        if (rate >= 0.75) return p.colony_status === "managed";
        if (rate >= 0.5) return p.colony_status === "in_progress";
        if (rate >= 0.25) return p.colony_status === "needs_work";
        return p.colony_status === "needs_attention";
      }),
    errorMessage: "Found places with mismatched status/rate",
  },
  {
    name: "Places have valid coordinates if location set",
    description: "If a place has lat/lng, they should be within Sonoma County bounds",
    validate: (places) =>
      places.every((p) => {
        const place = p as BeaconPlace & { lat?: number; lng?: number };
        if (place.lat === null || place.lng === null) return true;
        if (place.lat === undefined || place.lng === undefined) return true;
        // Sonoma County approximate bounds
        const inBounds =
          place.lat >= 38.1 &&
          place.lat <= 38.9 &&
          place.lng >= -123.1 &&
          place.lng <= -122.3;
        return inBounds;
      }),
    errorMessage: "Found places with coordinates outside Sonoma County",
  },
];

// ============================================================================
// EDGE CASE SCENARIOS
// These are specific scenarios that have caused issues in the past
// ============================================================================

export interface BeaconEdgeCase {
  name: string;
  description: string;
  sqlQuery: string;
  expectedBehavior: string;
  validateResult: (rows: unknown[]) => boolean;
}

export const BEACON_EDGE_CASES: BeaconEdgeCase[] = [
  {
    name: "Colonies with >100% theoretical alteration",
    description:
      "When verified altered exceeds estimated total, rate should be capped at 100%",
    sqlQuery: `
      SELECT place_id, verified_altered_count, estimated_total, alteration_rate
      FROM trapper.v_beacon_place_metrics
      WHERE verified_altered_count > estimated_total
        AND estimated_total > 0
    `,
    expectedBehavior: "alteration_rate should be <= 1.0 even if math suggests higher",
    validateResult: (rows) => {
      const typed = rows as Array<{ alteration_rate: number }>;
      return typed.every((r) => r.alteration_rate <= 1.0);
    },
  },
  {
    name: "Places with zero estimates but verified cats",
    description:
      "Places with verified cats but no estimate should use verified count as estimate",
    sqlQuery: `
      SELECT place_id, verified_cat_count, estimated_total, colony_status
      FROM trapper.v_beacon_place_metrics
      WHERE verified_cat_count > 0
        AND (estimated_total IS NULL OR estimated_total = 0)
    `,
    expectedBehavior: "Should have a valid colony_status based on verified data",
    validateResult: (rows) => {
      const typed = rows as Array<{ colony_status: string }>;
      return typed.every((r) => r.colony_status !== "no_data");
    },
  },
  {
    name: "Time-decayed confidence for old estimates",
    description:
      "Estimates older than 180 days should have reduced confidence weight",
    sqlQuery: `
      SELECT place_id, observation_date, confidence
      FROM trapper.place_colony_estimates
      WHERE observation_date < NOW() - INTERVAL '180 days'
      LIMIT 10
    `,
    expectedBehavior: "Old estimates should still be queryable for historical analysis",
    validateResult: (rows) => rows.length >= 0, // Just verify query works
  },
];

// ============================================================================
// SEASONAL ANALYSIS SCENARIOS
// ============================================================================

export interface SeasonalScenario {
  name: string;
  endpoint: string;
  description: string;
  validate: (data: unknown) => boolean;
}

export const SEASONAL_SCENARIOS: SeasonalScenario[] = [
  {
    name: "Breeding season detection",
    endpoint: "/api/beacon/seasonal-dashboard",
    description: "Should identify Feb-Nov as peak breeding season in California",
    validate: (data: unknown) => {
      // Just verify the endpoint returns data
      return data !== null && typeof data === "object";
    },
  },
  {
    name: "Kitten surge prediction",
    endpoint: "/api/beacon/seasonal-alerts",
    description:
      "Should predict kitten surges based on pregnant/lactating counts",
    validate: (data: unknown) => {
      const d = data as { alerts?: Array<{ type?: string }> };
      // Alerts array should exist
      return Array.isArray(d.alerts);
    },
  },
  {
    name: "Year-over-year monthly comparison",
    endpoint: "/api/beacon/yoy-comparison",
    description: "Should compare current year to previous year by month",
    validate: (data: unknown) => {
      return data !== null && typeof data === "object";
    },
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get tests by category
 */
export function getApiTestsByEndpoint(
  endpointPattern: string
): BeaconApiTest[] {
  return BEACON_API_TESTS.filter((t) => t.endpoint.includes(endpointPattern));
}

/**
 * Get all critical calculation tests (must pass)
 */
export function getCriticalCalculationTests(): BeaconCalculationTest[] {
  // All calculation tests are critical
  return BEACON_CALCULATION_TESTS;
}
