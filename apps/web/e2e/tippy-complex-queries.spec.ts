/**
 * Tippy Complex Query Tests
 *
 * Tests Tippy's ability to answer complex, multi-part questions that
 * a staff member would realistically ask. These tests use REAL data
 * and validate response accuracy.
 *
 * Categories:
 * 1. Program comparison queries (foster vs county vs regular)
 * 2. Time-based queries (quarterly, year-over-year)
 * 3. Multi-source queries (ClinicHQ + ShelterLuv + VolunteerHub)
 * 4. Data quality detection queries
 */

import { test, expect } from "@playwright/test";

const TIPPY_API = "/api/tippy/chat";

interface TippyResponse {
  message: string;
  response?: string;
  content?: string;
  toolCalls?: any[];
}

async function askTippy(
  request: any,
  question: string
): Promise<TippyResponse> {
  const response = await request.post(TIPPY_API, {
    data: { message: question },
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok()) {
    return { message: `API Error: ${response.status()}` };
  }

  return await response.json();
}

test.describe("Tippy Complex Queries - Program Statistics", () => {
  test("can compare foster Q1 vs Q3 2025", async ({ request }) => {
    const response = await askTippy(
      request,
      "Compare the foster program stats for Q1 2025 vs Q3 2025. How many cats were fixed in each quarter?"
    );

    expect(response.message).toBeDefined();

    // Should mention both quarters
    const text = response.message.toLowerCase();

    // Response should contain numbers
    expect(response.message).toMatch(/\d+/);

    // Should indicate Q1 or Q3 or first/third quarter
    const hasQuarterMention =
      text.includes("q1") ||
      text.includes("q3") ||
      text.includes("first quarter") ||
      text.includes("third quarter") ||
      text.includes("january") ||
      text.includes("july");

    expect(hasQuarterMention).toBeTruthy();
  });

  test("can report foster program year-to-date", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many foster cats have we fixed in 2025 so far?"
    );

    expect(response.message).toBeDefined();
    expect(response.message).toMatch(/\d+/);

    // Should mention 2025 or this year
    const text = response.message.toLowerCase();
    expect(text.includes("2025") || text.includes("this year")).toBeTruthy();
  });

  test("can compare county cats vs foster cats", async ({ request }) => {
    const response = await askTippy(
      request,
      "In 2025, how many county cats have we done compared to foster cats?"
    );

    expect(response.message).toBeDefined();

    // Should have comparison language
    const text = response.message.toLowerCase();
    const hasComparison =
      text.includes("county") &&
      (text.includes("foster") || text.includes("program"));

    expect(hasComparison).toBeTruthy();
  });

  test("can explain LMFM program stats", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many Love Me Fix Me waiver appointments have we had this year?"
    );

    expect(response.message).toBeDefined();

    // Should mention LMFM or waiver
    const text = response.message.toLowerCase();
    expect(
      text.includes("lmfm") ||
        text.includes("waiver") ||
        text.includes("love me fix me")
    ).toBeTruthy();
  });

  test("can provide program breakdown percentages", async ({ request }) => {
    const response = await askTippy(
      request,
      "What percentage of our alterations this year are from the foster program vs regular appointments?"
    );

    expect(response.message).toBeDefined();

    // Should have percentage
    expect(response.message).toMatch(/\d+%|\d+\s*percent/i);
  });
});

test.describe("Tippy Complex Queries - Year-over-Year", () => {
  test("can compare 2024 vs 2025 foster program", async ({ request }) => {
    const response = await askTippy(
      request,
      "How does our 2025 foster program volume compare to 2024?"
    );

    expect(response.message).toBeDefined();

    // Should mention both years
    const text = response.message.toLowerCase();
    expect(text.includes("2024") || text.includes("last year")).toBeTruthy();
    expect(text.includes("2025") || text.includes("this year")).toBeTruthy();
  });

  test("can identify monthly trends", async ({ request }) => {
    const response = await askTippy(
      request,
      "What was our busiest month for the foster program in 2025?"
    );

    expect(response.message).toBeDefined();

    // Should mention a month name
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const text = response.message.toLowerCase();
    const hasMonth = months.some((m) => text.includes(m));

    expect(hasMonth).toBeTruthy();
  });
});

test.describe("Tippy Complex Queries - Multi-Source", () => {
  test("can query person with foster + clinic history", async ({ request }) => {
    // This requires joining VolunteerHub (foster role) + ClinicHQ (appointments)
    const response = await askTippy(
      request,
      "How many cats have our approved foster parents brought to clinic in 2025?"
    );

    expect(response.message).toBeDefined();
    // Response should have numbers
    expect(response.message).toMatch(/\d+/);
  });

  test("can bridge SCAS cats to ShelterLuv", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many of our county SCAS cats have ShelterLuv records?"
    );

    expect(response.message).toBeDefined();

    const text = response.message.toLowerCase();
    expect(
      text.includes("scas") ||
        text.includes("county") ||
        text.includes("shelterluv")
    ).toBeTruthy();
  });
});

test.describe("Tippy Complex Queries - Data Quality", () => {
  test("can identify appointments missing cat links", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many appointments don't have cat records linked?"
    );

    expect(response.message).toBeDefined();

    // Should acknowledge the query and provide a number
    expect(response.message).toMatch(/\d+/);
  });

  test("can report on unlinked foster appointments", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many foster program appointments are missing person links?"
    );

    expect(response.message).toBeDefined();

    // Even if zero, should provide a meaningful response
    const text = response.message.toLowerCase();
    expect(
      text.includes("missing") ||
        text.includes("link") ||
        text.includes("foster") ||
        text.includes("none") ||
        text.includes("0")
    ).toBeTruthy();
  });

  test("can identify categorization issues", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are there any appointments that might be miscategorized? Like SCAS cats marked as regular?"
    );

    expect(response.message).toBeDefined();

    // Should engage with the question
    const text = response.message.toLowerCase();
    expect(
      text.includes("categor") ||
        text.includes("scas") ||
        text.includes("check") ||
        text.includes("found") ||
        text.includes("no ")
    ).toBeTruthy();
  });
});

test.describe("Tippy Complex Queries - Staff Workflow", () => {
  test("can answer 'who is our top foster parent'", async ({ request }) => {
    const response = await askTippy(
      request,
      "Who are our most active foster parents this year? Top 3 by cats fostered."
    );

    expect(response.message).toBeDefined();

    // Should list names or indicate no data
    const text = response.message.toLowerCase();
    expect(
      text.includes("foster") ||
        text.includes("top") ||
        text.includes("most active") ||
        text.includes("parent")
    ).toBeTruthy();
  });

  test("can explain program trends", async ({ request }) => {
    const response = await askTippy(
      request,
      "Is our foster program growing or shrinking compared to last year?"
    );

    expect(response.message).toBeDefined();

    // Should have trend language
    const text = response.message.toLowerCase();
    const hasTrend =
      text.includes("grow") ||
      text.includes("increas") ||
      text.includes("decreas") ||
      text.includes("shrink") ||
      text.includes("more") ||
      text.includes("less") ||
      text.includes("compared");

    expect(hasTrend).toBeTruthy();
  });

  test("can handle edge case: future date query", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many fosters will we have in Q4 2026?"
    );

    expect(response.message).toBeDefined();

    // Should acknowledge it can't predict the future
    const text = response.message.toLowerCase();
    expect(
      text.includes("cannot") ||
        text.includes("don't have") ||
        text.includes("no data") ||
        text.includes("future") ||
        text.includes("predict") ||
        text.includes("projection")
    ).toBeTruthy();
  });

  test("can handle ambiguous program reference", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many did we do for that special program this year?"
    );

    expect(response.message).toBeDefined();

    // Should ask for clarification or list options
    const text = response.message.toLowerCase();
    expect(
      text.includes("which program") ||
        text.includes("clarify") ||
        text.includes("foster") ||
        text.includes("county") ||
        text.includes("lmfm") ||
        text.includes("multiple")
    ).toBeTruthy();
  });
});

test.describe("Tippy Response Accuracy - Cross-Validation", () => {
  test("foster count matches view data", async ({ request }) => {
    // Get Tippy's answer
    const tippyResponse = await askTippy(
      request,
      "Exactly how many foster program alterations in 2025?"
    );

    // Extract number from response
    const tippyNumber = tippyResponse.message.match(/\d+/)?.[0];

    // Get direct view data (if available)
    const viewResponse = await request.get(
      "/api/admin/query?view=v_foster_program_ytd&year=2025"
    );

    if (viewResponse.ok() && tippyNumber) {
      const viewData = await viewResponse.json();
      const ytd2025 = viewData.find((r: any) => r.year === 2025);

      if (ytd2025) {
        const viewTotal = ytd2025.total_alterations.toString();

        // Tippy's number should be close to view data
        // Allow some variance for phrasing differences
        console.log(`Tippy reported: ${tippyNumber}`);
        console.log(`View shows: ${viewTotal}`);

        // At minimum, should be in same order of magnitude
        const tippyNum = parseInt(tippyNumber);
        const viewNum = parseInt(viewTotal);

        expect(Math.abs(tippyNum - viewNum)).toBeLessThan(viewNum * 0.1 + 10);
      }
    }
  });
});
