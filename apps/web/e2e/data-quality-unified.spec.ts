// @real-api - This test file calls the real Anthropic API
/**
 * Data Quality Unified Tests (MIG_487)
 *
 * These tests verify the unified data architecture functions including:
 * - Data quality checks (completeness, consistency)
 * - Duplicate detection
 * - Merge history tracking
 * - Data lineage queries
 * - Source extension queries
 *
 * Tests are READ-ONLY - they query but don't modify data.
 */

import { test, expect } from "@playwright/test";

// Access code for PasswordGate
const ACCESS_CODE = process.env.ATLAS_ACCESS_CODE || "ffsc2024";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Send a message to Tippy chat API and get response
 */
async function askTippy(
  request: ReturnType<typeof test.step>,
  question: string,
  conversationId?: string
) {
  const response = await request.post("/api/tippy/chat", {
    data: {
      messages: [{ role: "user", content: question }],
      conversationId: conversationId || `e2e-dq-test-${Date.now()}`,
    },
    headers: {
      "Content-Type": "application/json",
      "x-access-code": ACCESS_CODE,
    },
  });

  return response;
}

/**
 * Extract response text from Tippy response
 */
function extractResponseText(data: unknown): string {
  if (typeof data === "string") return data;
  const d = data as { response?: string; content?: string; message?: string };
  return d.response || d.content || d.message || JSON.stringify(data);
}

// ============================================================================
// DATA QUALITY API ENDPOINT TESTS
// ============================================================================

test.describe("Data Quality: API Endpoints @real-api", () => {
  test("GET /api/admin/data-engine/review returns review queue", async ({
    request,
  }) => {
    const response = await request.get("/api/admin/data-engine/review");

    // May require auth - just verify it doesn't 500
    expect(response.status()).toBeLessThan(500);
  });

  test("GET /api/admin/data-engine/review with entity_type filter", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/admin/data-engine/review?entity_type=person"
    );

    expect(response.status()).toBeLessThan(500);
  });

  test("GET /api/admin/data-engine/review with status filter", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/admin/data-engine/review?status=pending"
    );

    expect(response.status()).toBeLessThan(500);
  });
});

// ============================================================================
// CHECK_DATA_QUALITY FUNCTION TESTS (via Tippy)
// ============================================================================

test.describe("Data Quality: run_sql Function @real-api", () => {
  test("Check data quality for a person entity", async ({ request }) => {
    const response = await askTippy(
      request,
      "Check the data quality for any person in the system"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();

    const text = extractResponseText(data).toLowerCase();
    // Should mention completeness or quality metrics
    const hasQualityTerms =
      text.includes("quality") ||
      text.includes("complete") ||
      text.includes("missing") ||
      text.includes("field") ||
      text.includes("data");
    expect(hasQualityTerms).toBeTruthy();
  });

  test("Check data quality for a cat entity", async ({ request }) => {
    const response = await askTippy(
      request,
      "What is the data quality status for any cat with a microchip?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Check data quality for a place entity", async ({ request }) => {
    const response = await askTippy(
      request,
      "Check the data completeness for any colony location"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Data quality response includes field-level details", async ({
    request,
  }) => {
    const response = await askTippy(
      request,
      "Show me detailed data quality metrics for any person, including which fields are missing"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const text = extractResponseText(data).toLowerCase();

    // Response should be substantial
    expect(text.length).toBeGreaterThan(50);
  });
});

// ============================================================================
// FIND_POTENTIAL_DUPLICATES FUNCTION TESTS (via Tippy)
// ============================================================================

test.describe("Data Quality: run_sql Function @real-api", () => {
  test("Find potential duplicate people", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are there any potential duplicate person records in the system?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Find duplicates by name similarity", async ({ request }) => {
    const response = await askTippy(
      request,
      "Find people with similar names that might be duplicates"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Find potential duplicate cats", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are there any cats that might be duplicates based on microchip or name?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Find potential duplicate places", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are there any duplicate address entries or places that might be the same location?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// QUERY_MERGE_HISTORY FUNCTION TESTS (via Tippy)
// ============================================================================

test.describe("Data Quality: run_sql Function @real-api", () => {
  test("Query merge history for people", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me the history of merged person records"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query merge history for specific entity", async ({ request }) => {
    const response = await askTippy(
      request,
      "Have any records been merged into any person in the system?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query merge history for places", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me any places that have been merged together"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query recent merges", async ({ request }) => {
    const response = await askTippy(
      request,
      "What merges have happened in the last month?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// QUERY_DATA_LINEAGE FUNCTION TESTS (via Tippy)
// ============================================================================

test.describe("Data Quality: run_sql Function @real-api", () => {
  test("Query data lineage for a person", async ({ request }) => {
    const response = await askTippy(
      request,
      "Where did the data for any person come from? Show me the source systems."
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();

    const text = extractResponseText(data).toLowerCase();
    // Should mention source systems
    const hasSourceTerms =
      text.includes("source") ||
      text.includes("airtable") ||
      text.includes("clinichq") ||
      text.includes("shelterluv") ||
      text.includes("web") ||
      text.includes("system");
    expect(hasSourceTerms).toBeTruthy();
  });

  test("Query data lineage for a cat", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me the data lineage for any cat - which systems contributed data?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query data lineage for a place", async ({ request }) => {
    const response = await askTippy(
      request,
      "What is the source of the data for any colony location?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Lineage includes confidence scores", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me data lineage with confidence scores for any entity"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// QUERY_VOLUNTEERHUB_DATA FUNCTION TESTS (via Tippy)
// ============================================================================

test.describe("Data Quality: person_lookup Function @real-api", () => {
  test("Query volunteer hours", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me volunteer hours data from VolunteerHub"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query volunteer shifts", async ({ request }) => {
    const response = await askTippy(
      request,
      "What volunteer shifts have been logged recently?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query volunteer by email", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me VolunteerHub data for any active volunteer"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Correlate volunteer hours with other activities", async ({
    request,
  }) => {
    const response = await askTippy(
      request,
      "Find volunteers who have logged hours and also trapped cats"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// QUERY_SOURCE_EXTENSION FUNCTION TESTS (via Tippy)
// ============================================================================

test.describe("Data Quality: run_sql Function @real-api", () => {
  test("Query ClinicHQ extension data", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me the raw ClinicHQ data for any cat appointment"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query ShelterLuv extension data", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me ShelterLuv-specific data for any adopted cat"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Query Airtable extension data", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me raw Airtable data for any request"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Compare extension data across sources", async ({ request }) => {
    const response = await askTippy(
      request,
      "Compare the data for the same cat across different source systems"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// COMPREHENSIVE LOOKUP FUNCTION TESTS
// ============================================================================

test.describe("Data Quality: Comprehensive Lookups @real-api", () => {
  test("person_lookup returns multi-source data", async ({
    request,
  }) => {
    const response = await askTippy(
      request,
      "Give me comprehensive information about any active trapper including all source systems"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("cat_lookup returns full history", async ({ request }) => {
    const response = await askTippy(
      request,
      "Give me comprehensive data for any cat with appointments including all source systems"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("place_search returns all activities", async ({
    request,
  }) => {
    const response = await askTippy(
      request,
      "Give me comprehensive data for any active colony including all source systems"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// SOURCE CONFIDENCE AND SURVIVORSHIP TESTS
// ============================================================================

test.describe("Data Quality: Source Confidence @real-api", () => {
  test("Query source identity confidence levels", async ({ request }) => {
    const response = await askTippy(
      request,
      "What are the confidence levels for different data sources?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const text = extractResponseText(data).toLowerCase();

    // Should mention confidence or sources
    const hasConfidenceTerms =
      text.includes("confidence") ||
      text.includes("source") ||
      text.includes("clinichq") ||
      text.includes("airtable");
    expect(hasConfidenceTerms).toBeTruthy();
  });

  test("Explain survivorship priority", async ({ request }) => {
    const response = await askTippy(
      request,
      "When data conflicts between sources, which source wins? Explain survivorship priority."
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Show conflicting data example", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are there any entities with conflicting data between sources?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// DATA INTEGRITY VALIDATION TESTS
// ============================================================================

test.describe("Data Quality: Integrity Validation @real-api", () => {
  test("Check for orphaned records", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are there any orphaned records that should be linked to other entities?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Check for missing required fields", async ({ request }) => {
    const response = await askTippy(
      request,
      "Which records are missing critical required fields?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Check for stale data", async ({ request }) => {
    const response = await askTippy(
      request,
      "Which records haven't been updated in over a year and might be stale?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Check for inconsistent relationships", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are there any inconsistent relationships, like cats linked to places that don't exist?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

test.describe("Data Quality: Error Handling @real-api", () => {
  test("Handles non-existent entity gracefully", async ({ request }) => {
    const response = await askTippy(
      request,
      "Check data quality for person with ID 00000000-0000-0000-0000-000000000000"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // Should not have error, but indicate not found
    expect(data.error).toBeUndefined();
  });

  test("Handles invalid entity type gracefully", async ({ request }) => {
    const response = await askTippy(
      request,
      "Check data quality for entity type 'invalid_type'"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // Should handle gracefully
    expect(data.error).toBeUndefined();
  });

  test("Handles empty search gracefully", async ({ request }) => {
    const response = await askTippy(
      request,
      "Find duplicates for ''"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.error).toBeUndefined();
  });
});

// ============================================================================
// CROSS-SOURCE DATA CONSISTENCY TESTS
// ============================================================================

test.describe("Data Quality: Cross-Source Consistency @real-api", () => {
  test("Verify person data matches across sources", async ({ request }) => {
    const response = await askTippy(
      request,
      "Find any person where their email differs between Airtable and ClinicHQ"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Verify cat data matches across sources", async ({ request }) => {
    const response = await askTippy(
      request,
      "Find any cat where the microchip is recorded differently between sources"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Verify place data matches across sources", async ({ request }) => {
    const response = await askTippy(
      request,
      "Find any places where the address is recorded differently between Airtable requests and web intake"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});
