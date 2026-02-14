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
