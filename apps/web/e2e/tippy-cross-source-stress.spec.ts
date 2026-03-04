// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Cross-Source Stress Tests
 *
 * Tests complex data synthesis across 4+ data sources simultaneously.
 * These are the hardest questions that require Tippy to:
 * - Navigate multiple tables
 * - Combine data from ClinicHQ, ShelterLuv, VolunteerHub, and Airtable
 * - Deduce information not explicitly stored
 *
 * All tests are READ-ONLY against production data.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// HELPER: Send message to Tippy
// ============================================================================

interface TippyResponse {
  message?: string;
  response?: string;
  content?: string;
  error?: string;
  conversationId?: string;
}

async function askTippy(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }>;
  },
  question: string
): Promise<{ ok: boolean; data: TippyResponse; responseText: string }> {
  const response = await request.post("/api/tippy/chat", {
    data: {
      message: question,
    },
  });

  const ok = response.ok();
  const data = await response.json();

  const responseText =
    typeof data === "string"
      ? data
      : data.message || data.response || data.content || JSON.stringify(data);

  return { ok, data, responseText };
}

// ============================================================================
// 4+ SOURCE PERSON SCENARIOS
// Person data spanning ClinicHQ + ShelterLuv + VolunteerHub + Airtable
// ============================================================================

test.describe("Tippy Stress: Person Across 4+ Sources @stress @slow @real-api", () => {
  // Complex cross-source queries can take 60+ seconds
  test.setTimeout(90000);

  test("Find person who is owner + adopter + volunteer + trapper", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Find a person who has ALL of these roles:
       1. Cat owner (brought their own cat to clinic)
       2. Adopter (adopted a cat through ShelterLuv)
       3. Volunteer (has hours in VolunteerHub)
       4. Trapper (assigned to trap requests)

       This person would appear in ClinicHQ as owner, ShelterLuv as adopter,
       VolunteerHub as volunteer, and Airtable/Atlas as trapper.`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
    // Should attempt to search across sources or explain the search
    expect(
      responseText.toLowerCase().includes("volunteer") ||
        responseText.toLowerCase().includes("trapper") ||
        responseText.toLowerCase().includes("search") ||
        responseText.toLowerCase().includes("found") ||
        responseText.toLowerCase().includes("no one")
    ).toBeTruthy();
  });

  test("Trace person role evolution over time", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Find someone who started as a requester (submitted a trapping request),
       then became a volunteer in VolunteerHub,
       then became a trapper.

       Show me their timeline of how they evolved from asking for help
       to providing help.`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("Find person with data discrepancies across sources", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Look for people who have inconsistent data across different sources:
       - Different phone numbers in ClinicHQ vs Airtable
       - Different email addresses in different systems
       - Name spelling variations

       Which source system should be considered authoritative?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("Aggregate all touchpoints for a person across all systems", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `For any active staff member, show me EVERY touchpoint they have in our system:
       - All requests they submitted or were assigned to
       - All clinic appointments they brought cats to
       - All volunteer hours logged
       - All cats they've fostered or adopted
       - All places they're associated with

       Give me the complete picture from ALL data sources.`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(100);
  });
});

// ============================================================================
// CAT FULL LIFECYCLE SCENARIOS
// Request → Trapping → Clinic → Foster → Adoption
// ============================================================================

test.describe("Tippy Stress: Cat Full Lifecycle @stress @slow @real-api", () => {
  test.setTimeout(90000);

  test("Trace cat from original request to adoption", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Find a cat that went through the complete TNR lifecycle:
       1. Started with a trapping request (Airtable/Atlas)
       2. Was trapped and brought to clinic (ClinicHQ)
       3. Went into foster care (ShelterLuv)
       4. Was adopted (ShelterLuv)

       Show me each step with dates if possible.`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });

  test("Find cats that appeared in all 4 source systems", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Are there any cats that have records in ALL of:
       - Atlas/Airtable (trapping requests)
       - ClinicHQ (clinic appointments)
       - ShelterLuv (shelter intake/adoption)
       - VolunteerHub (indirectly via foster volunteer)

       These would be cats we have the most complete data on.`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("Cat with multiple owners/caretakers over time", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Find a cat that has had multiple different people associated with it:
       - Original colony caretaker (from request)
       - Trapper who caught it
       - Foster parent
       - Adopter

       How many different people were involved in this cat's journey?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("Cat returned after adoption and re-fostered", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Find any cats that were adopted out through ShelterLuv,
       then returned, and entered foster care again.

       What was the timeline for these cats?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });
});

// ============================================================================
// PLACE COMPLETE HISTORY SCENARIOS
// Requests + Cats + Appointments + Colony estimates + Context + Trappers
// ============================================================================

test.describe("Tippy Stress: Place Complete History @stress @slow @real-api", () => {
  test.setTimeout(90000);

  test("Full place history across all sources", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `For any active colony site in Santa Rosa, show me the COMPLETE history:
       - All trapping requests ever made
       - All cats ever caught there
       - All clinic appointments for those cats
       - Colony size estimates from different sources
       - All trappers who have worked there
       - Current alteration rate
       - Any place context tags (colony_site, foster_home, etc.)

       I want the full 360-degree view.`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(100);
  });

  test("Compare places with similar activity levels", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Compare two colony sites that have similar characteristics:
       - Similar colony size estimates
       - Similar number of requests
       - Similar number of cats trapped

       But different alteration rates. What explains the difference?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });

  test("Place with most diverse data sources", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Which place has data from the most different sources?
       Count how many different sources contribute data for each place:
       - Airtable requests
       - ClinicHQ appointments
       - ShelterLuv fosters/adoptions
       - Google Maps entries
       - Intake forms
       - Colony surveys

       Which address has the richest data?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });

  test("Track place over 3+ year history", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Find a place that has had activity spanning at least 3 years.
       Show me how the colony status has changed over time:
       - Initial request date
       - First trapping activity
       - Changes in colony size estimates
       - Current alteration rate vs historical

       Has this colony been successfully managed?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });
});

// ============================================================================
// COMPLEX DEDUCTION SCENARIOS
// Questions requiring inference across multiple data points
// ============================================================================

test.describe("Tippy Stress: Complex Deductions @stress @slow @real-api", () => {
  test.setTimeout(90000);

  test("Deduce effective trapper-place combinations", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Which trapper-place combinations have been most effective?
       Look at:
       - Cats caught per visit
       - Alteration rate improvement after their work
       - Time to complete a colony

       Are there trappers who consistently perform better at certain types of locations?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });

  test("Identify seasonal patterns across all sources", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Looking at data from all sources, identify seasonal patterns:
       - When do most requests come in?
       - When is clinic busiest?
       - When do kitten surges happen?
       - How do volunteer hours correlate?

       What month should we expect the most activity?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });

  test("Calculate total impact of a single volunteer", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `For any volunteer who has been active for at least 2 years, calculate their total impact:
       - Total volunteer hours
       - Cats trapped (if they became a trapper)
       - Cats fostered
       - Colonies improved
       - Requests completed

       What's the most impactful thing this person has done?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });

  test("Find data gaps that exist across all sources", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Identify places or cats where we have significant data gaps:
       - Cats seen at clinic but not linked to any request
       - Places with requests but no cat records
       - People who appear in one system but not linked in Atlas

       What's our biggest blind spot in the data?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });

  test("Predict which colonies need attention next", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Based on historical patterns, which colonies are most likely to need attention in the next 3 months?
       Consider:
       - Time since last activity
       - Incomplete alteration rate
       - Known unaltered cats
       - Historical reproduction patterns

       Prioritize by impact.`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(50);
  });
});

// ============================================================================
// DATA RECONCILIATION SCENARIOS
// Questions about matching records across systems
// ============================================================================

test.describe("Tippy Stress: Data Reconciliation @stress @real-api", () => {
  test.setTimeout(60000);

  test("Match ClinicHQ records to Atlas people", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `How many ClinicHQ appointment records have we successfully matched
       to Atlas person records? What percentage remain unmatched?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("Identify ShelterLuv records without Atlas match", async ({
    request,
  }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Are there ShelterLuv adopter or foster records that haven't been
       matched to Atlas person records yet? How would we match them?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("Cross-check VolunteerHub against Atlas roles", async ({ request }) => {
    const { ok, data, responseText } = await askTippy(
      request,
      `Do all VolunteerHub volunteers have corresponding Atlas person records?
       Are there any mismatches in role assignments?`
    );

    expect(ok).toBeTruthy();
    expect(data.error).toBeUndefined();
    expect(responseText.length).toBeGreaterThan(30);
  });
});
