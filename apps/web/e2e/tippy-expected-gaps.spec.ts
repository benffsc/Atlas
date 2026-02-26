// @real-api - This test file calls the real Anthropic API
/**
 * Tippy Expected Gaps Test Suite
 *
 * These tests document KNOWN LIMITATIONS in Tippy's current capabilities.
 * They are marked with test.skip() to document gaps without breaking CI.
 *
 * Each test includes:
 * - The staff question that SHOULD work
 * - The gap that prevents it from working
 * - The fix needed (database, tool, or API change)
 *
 * When a gap is fixed, convert the test.skip() to a regular test().
 * This creates a clear roadmap for Tippy improvements.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// HELPER: Send message to Tippy
// ============================================================================

interface TippyResponse {
  message: string;
  conversationId?: string;
}

async function askTippy(
  request: { post: (url: string, options: { data: unknown }) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }> },
  question: string
): Promise<TippyResponse> {
  const response = await request.post("/api/tippy/chat", {
    data: { message: question },
  });

  if (!response.ok()) {
    return { message: "ERROR: Request failed" };
  }

  return response.json();
}

// ============================================================================
// GAP CATEGORY 1: TEMPORAL QUERIES
// Tippy can answer "all time" questions but NOT time-bounded questions
// ============================================================================

test.describe("Gap: Temporal Queries - Trapper Stats by Date Range", () => {
  /**
   * GAP: query_trapper_stats returns career totals only
   * FIX NEEDED: Add date range parameters to query_trapper_stats tool
   * MIGRATION: Add v_trapper_stats_by_month view with monthly aggregation
   */

  test.skip("How many cats did Sarah trap last month?", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many cats did Sarah trap last month?"
    );

    // Should return a number for last month specifically
    expect(response.message).toMatch(/\d+\s*(cat|cats)/i);
    expect(response.message.toLowerCase()).toMatch(/last\s*month|january|december/i);
  });

  test.skip("How many cats did David trap this quarter?", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many cats did David trap this quarter vs last quarter?"
    );

    // Should compare two time periods
    expect(response.message).toMatch(/\d+/);
    expect(response.message.toLowerCase()).toMatch(/quarter|comparison|vs|compared/i);
  });

  test.skip("Did Sarah's performance improve this month vs last?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Did Sarah's performance improve this month compared to last month?"
    );

    // Should give a comparison answer
    expect(response.message.toLowerCase()).toMatch(/improve|better|worse|same|change/i);
  });

  test.skip("Who was our top trapper in Q4 2024?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Who was our top trapper in Q4 2024?"
    );

    // Should return a name with a time-bounded count
    expect(response.message).toMatch(/\d+/);
    expect(response.message.toLowerCase()).toMatch(/q4|october|november|december|2024/i);
  });
});

test.describe("Gap: Temporal Queries - Monthly Trends", () => {
  /**
   * GAP: query_ffr_impact only returns yearly buckets
   * FIX NEEDED: Add monthly aggregation option to query_ffr_impact
   * MIGRATION: Add v_monthly_organization_stats view
   */

  test.skip("What's our monthly trend in alterations?", async ({ request }) => {
    const response = await askTippy(
      request,
      "What's our monthly trend in alterations over the past 6 months?"
    );

    // Should return month-by-month data
    expect(response.message.toLowerCase()).toMatch(/january|february|march|april|may|june|july|august|september|october|november|december/i);
  });

  test.skip("Show me monthly intake trends", async ({ request }) => {
    const response = await askTippy(
      request,
      "Show me how many intake submissions we got each month this year"
    );

    // Should return monthly breakdown
    expect(response.message).toMatch(/\d+/);
  });

  test.skip("Compare this month's numbers to last month", async ({ request }) => {
    const response = await askTippy(
      request,
      "How does this month compare to last month for requests completed?"
    );

    // Should return comparison
    expect(response.message.toLowerCase()).toMatch(/more|less|same|increase|decrease/i);
  });
});

// ============================================================================
// GAP CATEGORY 2: EFFICIENCY METRICS
// Tippy can count activities but NOT calculate efficiency
// ============================================================================

test.describe("Gap: Efficiency Metrics", () => {
  /**
   * GAP: No cross-join between VolunteerHub hours and trapping stats
   * FIX NEEDED: New view joining volunteer hours to cats trapped
   * MIGRATION: Add v_trapper_efficiency view
   */

  test.skip("Who's our most efficient trapper per hour volunteered?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Who traps the most cats per volunteer hour?"
    );

    // Should return efficiency metric (cats/hour)
    expect(response.message).toMatch(/\d+(\.\d+)?\s*(cats?\s*per|\/)\s*hour/i);
  });

  test.skip("What's our cost per cat by region?", async ({ request }) => {
    const response = await askTippy(
      request,
      "What's our average cost per cat altered, by region?"
    );

    // Should return dollar amounts by area
    expect(response.message).toMatch(/\$\d+/);
  });

  test.skip("How long does it take on average to complete a request?", async ({ request }) => {
    const response = await askTippy(
      request,
      "What's the average time from request creation to completion?"
    );

    // Should return time duration
    expect(response.message).toMatch(/\d+\s*(day|week|hour)/i);
  });

  test.skip("Which trapper has the fastest completion time?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Which trapper completes requests the fastest on average?"
    );

    // Should return trapper name with time metric
    expect(response.message).toMatch(/\d+\s*(day|week)/i);
  });
});

// ============================================================================
// GAP CATEGORY 3: GOAL TRACKING
// Tippy cannot answer questions about organizational goals
// ============================================================================

test.describe("Gap: Goal Tracking", () => {
  /**
   * GAP: No organization_goals table exists
   * FIX NEEDED: Add organization_goals table with targets
   * MIGRATION: MIG_492__organization_goals.sql
   */

  test.skip("Are we on track for our yearly goal?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are we on track to meet our goal of altering 5000 cats this year?"
    );

    // Should compare current progress to target
    expect(response.message.toLowerCase()).toMatch(/on track|ahead|behind|goal|target/i);
  });

  test.skip("How far behind are we on our quarterly goal?", async ({ request }) => {
    const response = await askTippy(
      request,
      "How many cats behind our quarterly goal are we?"
    );

    // Should return deficit or surplus
    expect(response.message).toMatch(/\d+/);
  });

  test.skip("What's our goal completion percentage?", async ({ request }) => {
    const response = await askTippy(
      request,
      "What percentage of our yearly goal have we achieved?"
    );

    // Should return percentage
    expect(response.message).toMatch(/\d+%/);
  });
});

// ============================================================================
// GAP CATEGORY 4: FORECASTING
// Tippy cannot predict future states based on current rates
// ============================================================================

test.describe("Gap: Forecasting", () => {
  /**
   * GAP: No forecasting logic based on current alteration rates
   * FIX NEEDED: Add predict_completion_date tool
   * This would use current monthly rate to project when thresholds are met
   */

  test.skip("When will colony X reach 75% alteration?", async ({ request }) => {
    const response = await askTippy(
      request,
      "At current rates, when will our largest unmanaged colony reach the 75% threshold?"
    );

    // Should return a date or time estimate
    expect(response.message).toMatch(/\d+\s*(month|week|year)|(january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{4}/i);
  });

  test.skip("Predict kitten surge timing", async ({ request }) => {
    const response = await askTippy(
      request,
      "Based on pregnant/lactating counts, when should we expect the next kitten surge?"
    );

    // Should return prediction
    expect(response.message.toLowerCase()).toMatch(/expect|predict|likely|surge|spring|summer/i);
  });

  test.skip("Project colony growth", async ({ request }) => {
    const response = await askTippy(
      request,
      "If we don't intervene at Oak St, how big will the colony be in 6 months?"
    );

    // Should return projected count
    expect(response.message).toMatch(/\d+\s*cats/i);
  });
});

// ============================================================================
// GAP CATEGORY 5: WORKLOAD BALANCING
// Tippy cannot help with resource allocation decisions
// ============================================================================

test.describe("Gap: Workload Balancing", () => {
  /**
   * GAP: No current workload calculation per trapper
   * FIX NEEDED: Add v_trapper_current_workload view
   * Should show: assigned requests, pending cats, estimated hours
   */

  test.skip("Who has capacity for new assignments?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Which trappers have capacity to take on new requests?"
    );

    // Should return trappers with low current workload
    expect(response.message.toLowerCase()).toMatch(/available|capacity|assign/i);
  });

  test.skip("Is Sarah overloaded?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Does Sarah have too many requests assigned right now?"
    );

    // Should return workload assessment
    expect(response.message).toMatch(/\d+/);
    expect(response.message.toLowerCase()).toMatch(/request|assign|work/i);
  });

  test.skip("Balance workload across trappers", async ({ request }) => {
    const response = await askTippy(
      request,
      "How should we redistribute requests to balance workload?"
    );

    // Should give allocation suggestions
    expect(response.message.toLowerCase()).toMatch(/assign|move|transfer|balance/i);
  });
});

// ============================================================================
// GAP CATEGORY 6: GEOGRAPHIC ANALYSIS
// Tippy has basic location queries but lacks route optimization
// ============================================================================

test.describe("Gap: Geographic Analysis", () => {
  /**
   * GAP: No route optimization or clustering analysis
   * FIX NEEDED: Tools for efficient visit planning
   */

  test.skip("Plan efficient route for today's visits", async ({ request }) => {
    const response = await askTippy(
      request,
      "I need to visit 5 colonies today. What's the most efficient route?"
    );

    // Should return ordered list
    expect(response.message).toMatch(/1\.|first|start/i);
  });

  test.skip("Which pending requests are near each other?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Which pending requests are close together and could be handled in one trip?"
    );

    // Should return clustered requests
    expect(response.message.toLowerCase()).toMatch(/near|close|cluster|group|mile/i);
  });
});

// ============================================================================
// GAP CATEGORY 7: ALERT & NOTIFICATION INTELLIGENCE
// Tippy cannot proactively alert about important conditions
// ============================================================================

test.describe("Gap: Proactive Alerts", () => {
  /**
   * GAP: No alerting rules or thresholds defined
   * FIX NEEDED: Alert conditions table + proactive check tool
   */

  test.skip("What should I be worried about today?", async ({ request }) => {
    const response = await askTippy(
      request,
      "What issues need my attention today?"
    );

    // Should list prioritized concerns
    expect(response.message.toLowerCase()).toMatch(/urgent|overdue|attention|priority/i);
  });

  test.skip("Any requests about to miss SLA?", async ({ request }) => {
    const response = await askTippy(
      request,
      "Are any requests at risk of missing our response time target?"
    );

    // Should identify at-risk requests
    expect(response.message).toMatch(/\d+/);
  });
});

// ============================================================================
// GAP CATEGORY 8: COMPARATIVE ANALYSIS
// Tippy struggles with multi-entity comparisons
// ============================================================================

test.describe("Gap: Comparative Analysis", () => {
  /**
   * GAP: No tools designed for entity comparison
   * FIX NEEDED: compare_entities tool
   */

  test.skip("Compare two trappers' performance", async ({ request }) => {
    const response = await askTippy(
      request,
      "Compare Sarah and David's trapping performance side by side"
    );

    // Should return comparison table or structured comparison
    expect(response.message).toMatch(/sarah|david/i);
    expect(response.message.toLowerCase()).toMatch(/more|less|higher|lower|better/i);
  });

  test.skip("Compare two colonies' progress", async ({ request }) => {
    const response = await askTippy(
      request,
      "Compare the TNR progress between Oak St and Main St colonies"
    );

    // Should compare metrics between places
    expect(response.message).toMatch(/%/);
  });
});

// ============================================================================
// GAP SUMMARY: Long-Term Fixes Required
// ============================================================================

/**
 * DATABASE SCHEMA ADDITIONS NEEDED:
 *
 * MIG_490__trapper_stats_by_month:
 *   - v_trapper_stats_by_month view with monthly aggregation
 *   - Parameters: trapper_id, year, month
 *
 * MIG_491__monthly_org_stats:
 *   - v_monthly_organization_stats with all key metrics by month
 *   - Enables trend analysis
 *
 * MIG_492__organization_goals:
 *   - organization_goals table with period, metric, target
 *   - v_goal_progress view comparing actual to target
 *
 * MIG_493__trapper_efficiency:
 *   - Cross-join volunteerhub_volunteers with trapper stats
 *   - Calculate cats_per_hour, hours_per_request
 *
 * MIG_494__request_completion_time:
 *   - Add calculated time_to_complete to requests
 *   - v_request_turnaround_stats with averages
 *
 * MIG_495__trapper_workload:
 *   - v_trapper_current_workload with active assignments
 *   - Include pending cats, estimated hours
 */

/**
 * TIPPY TOOL ADDITIONS NEEDED:
 *
 * query_trapper_performance_by_period:
 *   - Parameters: trapper_name, start_date, end_date, period (month|quarter|year)
 *   - Returns: aggregated stats for that period
 *
 * query_monthly_organization_stats:
 *   - Parameters: metric, months_back
 *   - Returns: monthly breakdown with trend
 *
 * query_goal_progress:
 *   - Parameters: goal_type, period
 *   - Returns: target, actual, percentage, on_track boolean
 *
 * predict_completion_date:
 *   - Parameters: place_id, target_rate
 *   - Returns: estimated date based on current alteration rate
 *
 * query_trapper_workload:
 *   - Parameters: trapper_name
 *   - Returns: current assignments, pending cats, availability score
 *
 * compare_entities:
 *   - Parameters: entity_type, entity_ids[], metrics[]
 *   - Returns: side-by-side comparison
 */
