/**
 * Tippy Accuracy Verification Queries
 *
 * These define test cases that compare Tippy's responses to direct SQL queries.
 * Used to verify Tippy returns accurate data, not hallucinations.
 *
 * All queries are READ-ONLY.
 */

export interface AccuracyTest {
  id: string;
  description: string;
  // Question to ask Tippy
  tippyQuestion: string;
  // SQL query to verify the answer (read-only)
  sqlQuery: string;
  // Function to extract the value from Tippy's response
  extractTippyValue: (response: string) => number | string | null;
  // Tolerance for numeric comparisons (0 = exact match)
  tolerance: number;
  // Whether this is a count, rate, or value comparison
  comparisonType: "count" | "rate" | "value" | "exists";
  // Category for grouping
  category: "entity_count" | "alteration" | "trapper_stats" | "colony" | "activity";
}

// ============================================================================
// NARRATIVE ASSERTIONS (PR 4 / FFS-1165)
//
// Value-extraction tests catch "wrong number" failures. Narrative tests
// catch "right number, wrong story" failures — the ones that motivated
// FFS-1156. Each test asserts on the raw response text + the tools Tippy
// called to produce it.
// ============================================================================

export interface NarrativeTest {
  id: string;
  description: string;
  /** Question to ask Tippy */
  tippyQuestion: string;
  /**
   * Regexes the response MUST match. Each one is checked independently;
   * all must pass. Keep the regex specific to the failure mode you're
   * guarding against, not the exact phrasing — we're locking in intent,
   * not prose.
   */
  mustInclude?: RegExp[];
  /**
   * Regexes the response must NOT match. Used to prevent regressions
   * on anti-patterns (UUIDs leaking into responses, collapsing intact
   * with unknown, etc).
   */
  mustNotInclude?: RegExp[];
  /**
   * Tool names that MUST appear in the response's toolsUsed array.
   * Covers "did Tippy even look?" — e.g., we expect
   * `get_place_recent_context` to be called for institutional-knowledge
   * lookups, not just `analyze_place_situation`.
   */
  toolMustBeCalled?: string[];
  /**
   * Minimum length of a valid response. Guards against "I don't know"
   * / single-sentence dodges.
   */
  minLength?: number;
  /** Category for grouping */
  category: "institutional_lookup" | "strategic_priority" | "narrative";
}

export const NARRATIVE_TESTS: NarrativeTest[] = [
  // -------------------------------------------------------------------------
  // 717 Cherry St — the institutional-knowledge lookup failure case.
  // See memory/ffsc-institutional-knowledge.md. The Google Maps note
  // ("This is a Donna colony ... Karen the tenant feeds them") is
  // real data. No existing tool queried source.google_map_entries,
  // so Tippy had to say "no info" on something staff cared about.
  // PR 2 (get_place_recent_context) fixes the data access; PR 3
  // (narrative_seed) ensures it reaches Jami in plain language.
  // -------------------------------------------------------------------------
  {
    id: "narrative-717-cherry-institutional-lookup",
    description: "717 Cherry St lookup surfaces Donna colony + tenant context",
    tippyQuestion: "What do we know about 717 Cherry St in Santa Rosa?",
    toolMustBeCalled: ["get_place_recent_context"],
    mustInclude: [
      // Must reference Donna (the key person from the KML note)
      /donna/i,
      // Must reference the tenant (the secondary key person)
      /tenant|karen/i,
    ],
    mustNotInclude: [
      // No raw UUIDs in the response
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      // No column name literals
      /linked_place_id|resolved_place_id|source_record_id/,
      // No "site_name" enum literal (should be translated to English)
      /\baccount_type\b|\bsite_name\b/,
    ],
    minLength: 120,
    category: "institutional_lookup",
  },

  // -------------------------------------------------------------------------
  // Santa Rosa strategic priority — the NULL-status-misleads-priority case.
  // Old tools conflated NULL altered_status with confirmed intact. A
  // query like "which areas need targeted TNR in Santa Rosa?" would
  // recommend places like 535 Mark West Springs based on a ~6% rate
  // that was really 95% NULL. PR 1 fixes this by auto-applying
  // caveats and DATA_GAP_059 to the tool result.
  // -------------------------------------------------------------------------
  {
    id: "narrative-santa-rosa-null-status-caveat",
    description: "Strategic Santa Rosa query acknowledges NULL vs intact",
    tippyQuestion: "Which areas of Santa Rosa most need targeted TNR right now?",
    mustInclude: [
      // Must distinguish unknown/null from confirmed intact
      /unknown|null status|no (?:recorded |known )?status|don't (?:yet )?know/i,
    ],
    mustNotInclude: [
      // Must not report "X% altered" without qualification when the
      // underlying data is mostly NULL. We guard against the worst
      // anti-pattern: calling a low-rate place a "priority" with no
      // caveat about the NULL denominator.
      /highest\s+priority.*\d+%\s+altered\b(?!.*unknown)/is,
    ],
    minLength: 200,
    category: "strategic_priority",
  },
  // -------------------------------------------------------------------------
  // PR 5 (FFS-1160/1161/1163): the same Santa Rosa question must trigger
  // the strategic-mode prompt + find_intact_cat_clusters tool. This is
  // the tool-routing assertion that locks in the routing classifier.
  // -------------------------------------------------------------------------
  {
    id: "narrative-santa-rosa-uses-find-intact-tool",
    description: "Strategic Santa Rosa query calls find_intact_cat_clusters",
    tippyQuestion: "Where should we focus trapping resources in Santa Rosa?",
    toolMustBeCalled: ["find_intact_cat_clusters"],
    mustNotInclude: [
      // Should not recommend a place in plain prose without showing
      // it ran the right tool. The tool guarantees no-active-request
      // filtering — bypassing it means the model fabricated.
      /already\s+(?:in\s+progress|being\s+worked|assigned)/i,
    ],
    minLength: 150,
    category: "strategic_priority",
  },
  // -------------------------------------------------------------------------
  // PR 6 (FFS-1164): humility default for "we have no data on this"
  // cases. Uses a deliberately nonsense address. The response MUST
  // acknowledge the miss before offering any adjacent data, and must
  // NOT fabricate specifics about a place we have no record of.
  // -------------------------------------------------------------------------
  {
    id: "narrative-unknown-place-humility",
    description: "Unknown place query acknowledges the miss before offering alternatives",
    tippyQuestion: "What do we know about 99999 Nonexistent Imaginary Boulevard in Santa Rosa?",
    mustInclude: [
      // Must explicitly acknowledge we don't have data
      /(?:no\s+(?:records?|data|activity|information|results)|not\s+(?:in\s+our\s+records|on\s+file|found|in\s+atlas)|don't\s+(?:have|show|see)|couldn't\s+find)/i,
    ],
    mustNotInclude: [
      // Must not invent a cat count, resident, or status for a place
      // we have no record of
      /\b\d+\s+cats?\s+(?:at|live|on file|recorded)/i,
      // Must not claim an active request exists
      /active\s+request.*(?:at|on|for)\s+(?:this|99999)/i,
      // No raw UUIDs
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    ],
    minLength: 80,
    category: "narrative",
  },
];

/**
 * Run a narrative assertion against a response. Returns the list of
 * failure messages (empty array = pass).
 */
export function evaluateNarrativeTest(
  test: NarrativeTest,
  responseText: string,
  toolsUsed: string[],
): string[] {
  const failures: string[] = [];

  if (test.minLength && responseText.length < test.minLength) {
    failures.push(
      `Response too short: ${responseText.length} < ${test.minLength} (likely a dodge or "I don't know")`,
    );
  }

  for (const rx of test.mustInclude ?? []) {
    if (!rx.test(responseText)) {
      failures.push(`Missing required pattern: ${rx}`);
    }
  }

  for (const rx of test.mustNotInclude ?? []) {
    if (rx.test(responseText)) {
      failures.push(`Response contains forbidden pattern: ${rx}`);
    }
  }

  for (const toolName of test.toolMustBeCalled ?? []) {
    if (!toolsUsed.includes(toolName)) {
      failures.push(
        `Required tool not called: ${toolName} (got: [${toolsUsed.join(", ") || "none"}])`,
      );
    }
  }

  return failures;
}

// ============================================================================
// ENTITY COUNT ACCURACY TESTS
// Verify Tippy reports correct counts
// ============================================================================

export const ENTITY_COUNT_TESTS: AccuracyTest[] = [
  {
    id: "accuracy-total-cats",
    description: "Total cat count matches database",
    tippyQuestion: "How many cats total are in the Atlas system?",
    sqlQuery: `SELECT COUNT(*)::int as count FROM sot.cats WHERE merged_into_cat_id IS NULL`,
    extractTippyValue: (r) => {
      const match = r.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:cats?|total)/i);
      return match ? parseInt(match[1].replace(/,/g, "")) : null;
    },
    tolerance: 50, // Allow some variance for recent additions
    comparisonType: "count",
    category: "entity_count",
  },
  {
    id: "accuracy-total-people",
    description: "Total person count matches database",
    tippyQuestion: "How many people are in the Atlas system?",
    sqlQuery: `SELECT COUNT(*)::int as count FROM sot.people WHERE merged_into_person_id IS NULL`,
    extractTippyValue: (r) => {
      const match = r.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:people|persons?|total)/i);
      return match ? parseInt(match[1].replace(/,/g, "")) : null;
    },
    tolerance: 20,
    comparisonType: "count",
    category: "entity_count",
  },
  {
    id: "accuracy-total-places",
    description: "Total place count matches database",
    tippyQuestion: "How many unique places/addresses are in Atlas?",
    sqlQuery: `SELECT COUNT(*)::int as count FROM sot.places WHERE merged_into_place_id IS NULL`,
    extractTippyValue: (r) => {
      const match = r.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:places?|addresses?|locations?)/i);
      return match ? parseInt(match[1].replace(/,/g, "")) : null;
    },
    tolerance: 30,
    comparisonType: "count",
    category: "entity_count",
  },
  {
    id: "accuracy-total-requests",
    description: "Total request count matches database",
    tippyQuestion: "How many trapping requests total have been submitted?",
    sqlQuery: `SELECT COUNT(*)::int as count FROM ops.requests`,
    extractTippyValue: (r) => {
      const match = r.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:requests?|total)/i);
      return match ? parseInt(match[1].replace(/,/g, "")) : null;
    },
    tolerance: 20,
    comparisonType: "count",
    category: "entity_count",
  },
  {
    id: "accuracy-active-trappers",
    description: "Active trapper count matches database",
    tippyQuestion: "How many active trappers do we have?",
    sqlQuery: `
      SELECT COUNT(DISTINCT person_id)::int as count
      FROM ops.person_roles
      WHERE role IN ('ffsc_trapper', 'head_trapper', 'coordinator')
        AND (ended_at IS NULL OR ended_at > NOW())
    `,
    extractTippyValue: (r) => {
      const match = r.match(/(\d+)\s*(?:active\s*)?trappers?/i);
      return match ? parseInt(match[1]) : null;
    },
    tolerance: 5,
    comparisonType: "count",
    category: "entity_count",
  },
];

// ============================================================================
// ALTERATION RATE ACCURACY TESTS
// Verify Tippy reports correct alteration percentages
// ============================================================================

export const ALTERATION_TESTS: AccuracyTest[] = [
  {
    id: "accuracy-overall-alteration-rate",
    description: "Overall alteration rate within tolerance",
    tippyQuestion: "What is the overall alteration rate across all colonies?",
    sqlQuery: `
      SELECT ROUND(
        100.0 * SUM(verified_altered) / NULLIF(SUM(weighted_estimate), 0),
        1
      )::numeric as rate
      FROM ops.v_beacon_summary
    `,
    extractTippyValue: (r) => {
      const match = r.match(/(\d+(?:\.\d+)?)\s*%/);
      return match ? parseFloat(match[1]) : null;
    },
    tolerance: 5, // 5% tolerance
    comparisonType: "rate",
    category: "alteration",
  },
  {
    id: "accuracy-cats-altered-this-year",
    description: "Cats altered this year count",
    tippyQuestion: "How many cats have been altered this year?",
    sqlQuery: `
      SELECT COUNT(*)::int as count
      FROM ops.appointments
      WHERE EXTRACT(YEAR FROM appointment_date) = EXTRACT(YEAR FROM NOW())
        AND procedure_type IN ('spay', 'neuter', 'snr')
    `,
    extractTippyValue: (r) => {
      const match = r.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*cats?\s*(?:have\s*been\s*)?altered/i);
      return match ? parseInt(match[1].replace(/,/g, "")) : null;
    },
    tolerance: 20,
    comparisonType: "count",
    category: "alteration",
  },
];

// ============================================================================
// TRAPPER STATISTICS ACCURACY TESTS
// Verify trapper stats are accurate
// ============================================================================

export const TRAPPER_STATS_TESTS: AccuracyTest[] = [
  {
    id: "accuracy-top-trapper-count",
    description: "Top trapper cat count is accurate",
    tippyQuestion: "Who is the top trapper by total cats brought to clinic, and how many?",
    sqlQuery: `
      SELECT
        p.display_name,
        COUNT(*)::int as cat_count
      FROM ops.appointments a
      JOIN sot.people p ON p.person_id = a.trapper_person_id
      WHERE a.trapper_person_id IS NOT NULL
      GROUP BY p.person_id, p.display_name
      ORDER BY cat_count DESC
      LIMIT 1
    `,
    extractTippyValue: (r) => {
      // Extract the largest number mentioned in context of "cats" or "brought"
      const matches = r.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*cats?/gi);
      if (matches && matches.length > 0) {
        const numbers = matches.map((m) => parseInt(m.replace(/[^\d]/g, "")));
        return Math.max(...numbers);
      }
      return null;
    },
    tolerance: 10,
    comparisonType: "count",
    category: "trapper_stats",
  },
];

// ============================================================================
// COLONY STATUS ACCURACY TESTS
// Verify colony estimates and status
// ============================================================================

export const COLONY_TESTS: AccuracyTest[] = [
  {
    id: "accuracy-managed-colony-count",
    description: "Managed colony count is accurate",
    tippyQuestion: "How many colonies are currently considered 'managed' (>85% alteration rate)?",
    sqlQuery: `
      SELECT COUNT(*)::int as count
      FROM ops.v_beacon_summary
      WHERE alteration_rate >= 85
    `,
    extractTippyValue: (r) => {
      const match = r.match(/(\d+)\s*(?:colonies?|are|managed)/i);
      return match ? parseInt(match[1]) : null;
    },
    tolerance: 5,
    comparisonType: "count",
    category: "colony",
  },
  {
    id: "accuracy-needs-attention-count",
    description: "Needs attention colony count is accurate",
    tippyQuestion: "How many colonies need attention (below 50% alteration rate)?",
    sqlQuery: `
      SELECT COUNT(*)::int as count
      FROM ops.v_beacon_summary
      WHERE alteration_rate < 50
        AND weighted_estimate > 0
    `,
    extractTippyValue: (r) => {
      const match = r.match(/(\d+)\s*(?:colonies?|need|attention)/i);
      return match ? parseInt(match[1]) : null;
    },
    tolerance: 5,
    comparisonType: "count",
    category: "colony",
  },
];

// ============================================================================
// ACTIVITY ACCURACY TESTS
// Verify activity counts
// ============================================================================

export const ACTIVITY_TESTS: AccuracyTest[] = [
  {
    id: "accuracy-appointments-this-month",
    description: "Appointments this month count",
    tippyQuestion: "How many clinic appointments have we had this month?",
    sqlQuery: `
      SELECT COUNT(*)::int as count
      FROM ops.appointments
      WHERE appointment_date >= DATE_TRUNC('month', NOW())
    `,
    extractTippyValue: (r) => {
      const match = r.match(/(\d+)\s*(?:appointments?|visits?)/i);
      return match ? parseInt(match[1]) : null;
    },
    tolerance: 5,
    comparisonType: "count",
    category: "activity",
  },
  {
    id: "accuracy-requests-pending",
    description: "Pending request count",
    tippyQuestion: "How many requests are currently pending triage?",
    sqlQuery: `
      SELECT COUNT(*)::int as count
      FROM ops.requests
      WHERE status = 'new'
    `,
    extractTippyValue: (r) => {
      const match = r.match(/(\d+)\s*(?:requests?|pending)/i);
      return match ? parseInt(match[1]) : null;
    },
    tolerance: 3,
    comparisonType: "count",
    category: "activity",
  },
];

// ============================================================================
// COMBINED EXPORTS
// ============================================================================

export const ALL_ACCURACY_TESTS: AccuracyTest[] = [
  ...ENTITY_COUNT_TESTS,
  ...ALTERATION_TESTS,
  ...TRAPPER_STATS_TESTS,
  ...COLONY_TESTS,
  ...ACTIVITY_TESTS,
];

export function getAccuracyTestsByCategory(
  category: AccuracyTest["category"]
): AccuracyTest[] {
  return ALL_ACCURACY_TESTS.filter((t) => t.category === category);
}

/**
 * Compare Tippy value to SQL value with tolerance
 */
export function compareWithTolerance(
  tippyValue: number | string | null,
  sqlValue: number | string | null,
  tolerance: number,
  comparisonType: AccuracyTest["comparisonType"]
): { passes: boolean; details: string } {
  if (tippyValue === null) {
    return { passes: false, details: "Could not extract value from Tippy response" };
  }
  if (sqlValue === null) {
    return { passes: false, details: "SQL query returned null" };
  }

  if (comparisonType === "exists") {
    return {
      passes: !!tippyValue,
      details: `Existence check: ${tippyValue ? "found" : "not found"}`,
    };
  }

  const tippyNum = typeof tippyValue === "number" ? tippyValue : parseFloat(String(tippyValue));
  const sqlNum = typeof sqlValue === "number" ? sqlValue : parseFloat(String(sqlValue));

  if (isNaN(tippyNum) || isNaN(sqlNum)) {
    return { passes: false, details: `Could not compare: Tippy=${tippyValue}, SQL=${sqlValue}` };
  }

  const diff = Math.abs(tippyNum - sqlNum);
  const passes = diff <= tolerance;

  return {
    passes,
    details: `Tippy: ${tippyNum}, SQL: ${sqlNum}, Diff: ${diff}, Tolerance: ${tolerance}`,
  };
}
