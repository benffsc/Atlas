/**
 * Tippy Cross-Source Question Bank
 *
 * These questions are designed to test Tippy's ability to deduce information
 * by combining data from multiple sources (ClinicHQ, ShelterLuv, VolunteerHub,
 * Airtable, and Atlas core tables).
 *
 * Each question specifies:
 * - The question text to send to Tippy
 * - The data sources required to answer it
 * - Expected tools that should be called
 * - Validation functions to check response quality
 */

export interface CrossSourceQuestion {
  id: string;
  question: string;
  category: "person" | "cat" | "place" | "data_quality" | "beacon";
  requiresSources: string[];
  expectedTools: string[];
  validateResponse: (response: string) => boolean;
  difficulty: "easy" | "medium" | "hard";
  description: string;
}

// ============================================================================
// PERSON CROSS-SOURCE QUESTIONS
// Require: sot_people + volunteerhub + clinichq + shelterluv + airtable
// ============================================================================

export const PERSON_CROSS_SOURCE_QUESTIONS: CrossSourceQuestion[] = [
  {
    id: "person-volunteer-trapper",
    question:
      "Find someone who is both a volunteer in VolunteerHub AND has brought cats to the clinic as a trapper",
    category: "person",
    requiresSources: ["volunteerhub_volunteers", "sot_appointments", "person_roles"],
    expectedTools: ["person_lookup"],
    validateResponse: (r) =>
      r.toLowerCase().includes("volunteer") && r.toLowerCase().includes("trapper"),
    difficulty: "medium",
    description: "Tests cross-reference between VH volunteer status and clinic trapper role",
  },
  {
    id: "person-hours-foster",
    question: "Who has the most volunteer hours AND has also fostered cats?",
    category: "person",
    requiresSources: [
      "volunteerhub_volunteers",
      "person_cat",
      "shelterluv",
    ],
    expectedTools: ["person_lookup"],
    validateResponse: (r) =>
      r.toLowerCase().includes("hours") || r.toLowerCase().includes("foster"),
    difficulty: "hard",
    description:
      "Requires aggregating VH hours and matching to foster relationships from ShelterLuv",
  },
  {
    id: "person-multi-source-phone",
    question:
      "Show me people who appear in both ClinicHQ and Airtable with different phone numbers",
    category: "person",
    requiresSources: ["person_identifiers", "staged_records", "sot_people"],
    expectedTools: ["person_lookup", "run_sql"],
    validateResponse: (r) =>
      r.toLowerCase().includes("discrepancy") ||
      r.toLowerCase().includes("different") ||
      r.toLowerCase().includes("phone"),
    difficulty: "hard",
    description: "Tests data discrepancy detection across sources",
  },
  {
    id: "person-requester-trapper-same",
    question: "Find people who submitted a trapping request AND later became trappers",
    category: "person",
    requiresSources: [
      "sot_requests",
      "request_trapper_assignments",
      "person_roles",
    ],
    expectedTools: ["person_lookup"],
    validateResponse: (r) =>
      r.toLowerCase().includes("request") || r.toLowerCase().includes("trapper"),
    difficulty: "medium",
    description: "Tests role evolution tracking across request and assignment data",
  },
  {
    id: "person-complete-lookup",
    question: "Tell me everything about the person with email ben@forgottenfelines.org",
    category: "person",
    requiresSources: [
      "sot_people",
      "volunteerhub_volunteers",
      "person_cat",
      "person_roles",
    ],
    expectedTools: ["person_lookup"],
    validateResponse: (r) =>
      r.toLowerCase().includes("found") || r.length > 100,
    difficulty: "easy",
    description: "Tests comprehensive lookup across all person-related sources",
  },
];

// ============================================================================
// CAT JOURNEY QUESTIONS
// Require: sot_cats + sot_appointments + shelterluv + cat_place
// ============================================================================

export const CAT_JOURNEY_QUESTIONS: CrossSourceQuestion[] = [
  {
    id: "cat-full-journey",
    question:
      "Find a cat that was trapped from a colony, altered at clinic, then adopted through ShelterLuv",
    category: "cat",
    requiresSources: [
      "sot_cats",
      "sot_appointments",
      "cat_place",
      "person_cat",
    ],
    expectedTools: ["cat_lookup"],
    validateResponse: (r) =>
      (r.toLowerCase().includes("trapped") ||
        r.toLowerCase().includes("colony")) &&
      (r.toLowerCase().includes("alter") || r.toLowerCase().includes("spay") || r.toLowerCase().includes("neuter")),
    difficulty: "hard",
    description: "Tests full cat lifecycle tracking across all data sources",
  },
  {
    id: "cat-colony-repeat-visits",
    question:
      "Which cats from any Santa Rosa colony have been seen at the clinic multiple times?",
    category: "cat",
    requiresSources: [
      "places",
      "cat_place",
      "sot_appointments",
    ],
    expectedTools: ["cat_lookup", "full_place_briefing"],
    validateResponse: (r) =>
      r.toLowerCase().includes("appointment") ||
      r.toLowerCase().includes("visit") ||
      r.toLowerCase().includes("clinic"),
    difficulty: "medium",
    description: "Tests geographic filtering combined with appointment history",
  },
  {
    id: "cat-microchip-trace",
    question: "Trace the complete history of a cat with microchip starting with 985",
    category: "cat",
    requiresSources: [
      "cat_identifiers",
      "sot_cats",
      "sot_appointments",
      "person_cat",
    ],
    expectedTools: ["cat_lookup"],
    validateResponse: (r) =>
      r.toLowerCase().includes("microchip") || r.toLowerCase().includes("985"),
    difficulty: "easy",
    description: "Tests microchip-based lookup across all cat data sources",
  },
  {
    id: "cat-owner-change",
    question: "Find cats that have had multiple different owners or caretakers",
    category: "cat",
    requiresSources: ["person_cat", "sot_cats"],
    expectedTools: ["cat_lookup"],
    validateResponse: (r) =>
      r.toLowerCase().includes("owner") ||
      r.toLowerCase().includes("caretaker") ||
      r.toLowerCase().includes("relationship"),
    difficulty: "medium",
    description: "Tests relationship history tracking for cats",
  },
  {
    id: "cat-shelterluv-clinic-match",
    question:
      "Find cats that appear in both ShelterLuv and ClinicHQ records",
    category: "cat",
    requiresSources: ["staged_records", "sot_cats", "cat_identifiers"],
    expectedTools: ["cat_lookup", "run_sql"],
    validateResponse: (r) =>
      r.toLowerCase().includes("shelterluv") ||
      r.toLowerCase().includes("clinic") ||
      r.toLowerCase().includes("found"),
    difficulty: "medium",
    description: "Tests cross-source cat matching via identifiers",
  },
];

// ============================================================================
// PLACE-CENTRIC CROSS-SOURCE QUESTIONS
// Require: places + colony_estimates + requests + appointments + person_place
// ============================================================================

export const PLACE_CROSS_SOURCE_QUESTIONS: CrossSourceQuestion[] = [
  {
    id: "place-trapper-alteration",
    question:
      "Which colony has had the most trappers work it AND has the lowest alteration rate?",
    category: "place",
    requiresSources: [
      "places",
      "request_trapper_assignments",
      "v_beacon_place_metrics",
    ],
    expectedTools: ["place_search", "full_place_briefing"],
    validateResponse: (r) =>
      r.toLowerCase().includes("trapper") ||
      r.toLowerCase().includes("alteration") ||
      r.toLowerCase().includes("rate"),
    difficulty: "hard",
    description:
      "Tests combining trapper assignment counts with Beacon alteration metrics",
  },
  {
    id: "place-estimate-comparison",
    question:
      "Compare colony size estimates from different sources for any Santa Rosa address",
    category: "place",
    requiresSources: [
      "place_colony_estimates",
      "colony_source_confidence",
      "places",
    ],
    expectedTools: ["place_search", "full_place_briefing"],
    validateResponse: (r) =>
      r.toLowerCase().includes("estimate") ||
      r.toLowerCase().includes("confidence") ||
      r.toLowerCase().includes("colony"),
    difficulty: "medium",
    description: "Tests multi-source colony estimate aggregation",
  },
  {
    id: "place-requester-trapper-same",
    question: "Find places where the requester and trapper are the same person",
    category: "place",
    requiresSources: [
      "sot_requests",
      "request_trapper_assignments",
      "person_place",
    ],
    expectedTools: ["place_search"],
    validateResponse: (r) =>
      r.toLowerCase().includes("requester") ||
      r.toLowerCase().includes("trapper") ||
      r.toLowerCase().includes("same"),
    difficulty: "medium",
    description: "Tests cross-referencing requester with trapper assignments",
  },
  {
    id: "place-activity-history",
    question: "Show me all activity at any address on Selvage Road",
    category: "place",
    requiresSources: [
      "places",
      "sot_requests",
      "cat_place",
      "sot_appointments",
    ],
    expectedTools: ["place_search"],
    validateResponse: (r) =>
      r.toLowerCase().includes("selvage") ||
      r.toLowerCase().includes("request") ||
      r.toLowerCase().includes("cat"),
    difficulty: "easy",
    description: "Tests address-based comprehensive lookup",
  },
  {
    id: "place-no-recent-activity",
    question: "Find colonies with cats but no clinic activity in the last year",
    category: "place",
    requiresSources: [
      "places",
      "cat_place",
      "sot_appointments",
      "v_beacon_place_metrics",
    ],
    expectedTools: ["place_search", "full_place_briefing"],
    validateResponse: (r) =>
      r.toLowerCase().includes("colony") ||
      r.toLowerCase().includes("activity") ||
      r.toLowerCase().includes("clinic"),
    difficulty: "hard",
    description: "Tests temporal filtering combined with location data",
  },
];

// ============================================================================
// DATA QUALITY QUESTIONS (New MIG_487 Functions)
// Tests the new unified data quality tools
// ============================================================================

export const DATA_QUALITY_QUESTIONS: CrossSourceQuestion[] = [
  {
    id: "quality-person-check",
    question: "Check data quality for a person record - any staff member",
    category: "data_quality",
    requiresSources: ["sot_people", "person_identifiers", "person_roles"],
    expectedTools: ["run_sql"],
    validateResponse: (r) =>
      r.toLowerCase().includes("completeness") ||
      r.toLowerCase().includes("quality") ||
      r.toLowerCase().includes("missing"),
    difficulty: "easy",
    description: "Tests the run_sql function for person entities",
  },
  {
    id: "quality-cat-check",
    question: "Check data quality for any cat with a microchip",
    category: "data_quality",
    requiresSources: ["sot_cats", "cat_identifiers"],
    expectedTools: ["run_sql"],
    validateResponse: (r) =>
      r.toLowerCase().includes("quality") ||
      r.toLowerCase().includes("complete") ||
      r.toLowerCase().includes("missing"),
    difficulty: "easy",
    description: "Tests the run_sql function for cat entities",
  },
  {
    id: "quality-duplicates-person",
    question: "Find potential duplicates for person name 'Smith'",
    category: "data_quality",
    requiresSources: ["sot_people", "person_identifiers"],
    expectedTools: ["run_sql"],
    validateResponse: (r) =>
      r.toLowerCase().includes("duplicate") ||
      r.toLowerCase().includes("similar") ||
      r.toLowerCase().includes("match"),
    difficulty: "medium",
    description: "Tests the run_sql function",
  },
  {
    id: "quality-merge-history",
    question: "Show merge history for any merged person record",
    category: "data_quality",
    requiresSources: ["sot_people"],
    expectedTools: ["run_sql"],
    validateResponse: (r) =>
      r.toLowerCase().includes("merge") ||
      r.toLowerCase().includes("combined") ||
      r.toLowerCase().includes("history"),
    difficulty: "medium",
    description: "Tests the run_sql function",
  },
  {
    id: "quality-data-lineage",
    question: "Where did the data for a specific cat come from?",
    category: "data_quality",
    requiresSources: ["staged_records", "sot_cats", "cat_identifiers"],
    expectedTools: ["run_sql"],
    validateResponse: (r) =>
      r.toLowerCase().includes("source") ||
      r.toLowerCase().includes("lineage") ||
      r.toLowerCase().includes("origin"),
    difficulty: "medium",
    description: "Tests the run_sql function",
  },
  {
    id: "quality-volunteerhub-data",
    question: "Get VolunteerHub data for any active volunteer",
    category: "data_quality",
    requiresSources: ["volunteerhub_volunteers", "sot_people"],
    expectedTools: ["person_lookup"],
    validateResponse: (r) =>
      r.toLowerCase().includes("volunteer") ||
      r.toLowerCase().includes("hours") ||
      r.toLowerCase().includes("role"),
    difficulty: "easy",
    description: "Tests the person_lookup function",
  },
];

// ============================================================================
// BEACON ANALYTICS QUESTIONS (Hard ecological questions)
// Tests Beacon's population dynamics and forecasting capabilities
// ============================================================================

export const BEACON_QUESTIONS: CrossSourceQuestion[] = [
  {
    id: "beacon-overcounted",
    question:
      "Find colonies where verified altered cats exceed the estimated colony size",
    category: "beacon",
    requiresSources: ["v_beacon_place_metrics", "place_colony_estimates"],
    expectedTools: ["place_search", "full_place_briefing"],
    validateResponse: (r) =>
      r.toLowerCase().includes("alter") ||
      r.toLowerCase().includes("estimate") ||
      r.toLowerCase().includes("exceed"),
    difficulty: "hard",
    description: "Tests edge case handling when alteration > estimate (>100%)",
  },
  {
    id: "beacon-stale-estimates",
    question: "Which colony estimates are older than 6 months and might be stale?",
    category: "beacon",
    requiresSources: ["place_colony_estimates", "v_beacon_place_metrics"],
    expectedTools: ["full_place_briefing", "place_search"],
    validateResponse: (r) =>
      r.toLowerCase().includes("month") ||
      r.toLowerCase().includes("old") ||
      r.toLowerCase().includes("stale") ||
      r.toLowerCase().includes("estimate"),
    difficulty: "medium",
    description: "Tests time decay confidence weighting awareness",
  },
  {
    id: "beacon-immigration",
    question:
      "At any managed colony, how many cats were born there vs immigrated?",
    category: "beacon",
    requiresSources: [
      "cat_place",
      "cat_birth_events",
      "v_beacon_place_metrics",
    ],
    expectedTools: ["place_search"],
    validateResponse: (r) =>
      r.toLowerCase().includes("born") ||
      r.toLowerCase().includes("immigrat") ||
      r.toLowerCase().includes("arrival"),
    difficulty: "hard",
    description: "Tests immigration detection (MIG_306) functionality",
  },
  {
    id: "beacon-kitten-surge",
    question:
      "Based on historical data, when should we expect the next kitten surge?",
    category: "beacon",
    requiresSources: ["v_kitten_surge_prediction", "v_breeding_season_indicators"],
    expectedTools: ["area_stats"],
    validateResponse: (r) =>
      r.toLowerCase().includes("kitten") ||
      r.toLowerCase().includes("season") ||
      r.toLowerCase().includes("surge") ||
      r.toLowerCase().includes("spring") ||
      r.toLowerCase().includes("breeding"),
    difficulty: "hard",
    description: "Tests seasonal prediction z-score analysis",
  },
  {
    id: "beacon-completion-forecast",
    question:
      "At current alteration rate, how long until our largest unmanaged colony is managed?",
    category: "beacon",
    requiresSources: ["v_beacon_place_metrics", "sot_appointments"],
    expectedTools: ["full_place_briefing", "place_search"],
    validateResponse: (r) =>
      r.toLowerCase().includes("month") ||
      r.toLowerCase().includes("rate") ||
      r.toLowerCase().includes("managed") ||
      r.toLowerCase().includes("forecast"),
    difficulty: "hard",
    description: "Tests Vortex forecasting cycles_to_completion",
  },
  {
    id: "beacon-yoy-comparison",
    question: "Are we doing better or worse than last year at this time?",
    category: "beacon",
    requiresSources: ["v_yoy_activity_comparison", "sot_appointments"],
    expectedTools: ["area_stats"],
    validateResponse: (r) =>
      r.toLowerCase().includes("year") ||
      r.toLowerCase().includes("compare") ||
      r.toLowerCase().includes("better") ||
      r.toLowerCase().includes("worse") ||
      r.toLowerCase().includes("%"),
    difficulty: "medium",
    description: "Tests year-over-year comparison functionality",
  },
  {
    id: "beacon-overall-impact",
    question: "What's our overall alteration rate across all of Sonoma County?",
    category: "beacon",
    requiresSources: ["v_beacon_place_metrics", "sot_appointments"],
    expectedTools: ["area_stats"],
    validateResponse: (r) =>
      r.toLowerCase().includes("rate") ||
      r.toLowerCase().includes("%") ||
      r.toLowerCase().includes("alter") ||
      r.toLowerCase().includes("sonoma"),
    difficulty: "easy",
    description: "Tests overall impact metrics aggregation",
  },
];

// ============================================================================
// ALL QUESTIONS COMBINED
// ============================================================================

export const ALL_CROSS_SOURCE_QUESTIONS: CrossSourceQuestion[] = [
  ...PERSON_CROSS_SOURCE_QUESTIONS,
  ...CAT_JOURNEY_QUESTIONS,
  ...PLACE_CROSS_SOURCE_QUESTIONS,
  ...DATA_QUALITY_QUESTIONS,
  ...BEACON_QUESTIONS,
];

// Get questions by difficulty
export function getQuestionsByDifficulty(
  difficulty: "easy" | "medium" | "hard"
): CrossSourceQuestion[] {
  return ALL_CROSS_SOURCE_QUESTIONS.filter((q) => q.difficulty === difficulty);
}

// Get questions by category
export function getQuestionsByCategory(
  category: CrossSourceQuestion["category"]
): CrossSourceQuestion[] {
  return ALL_CROSS_SOURCE_QUESTIONS.filter((q) => q.category === category);
}

// Get a random sample of questions
export function getRandomQuestions(count: number): CrossSourceQuestion[] {
  const shuffled = [...ALL_CROSS_SOURCE_QUESTIONS].sort(
    () => Math.random() - 0.5
  );
  return shuffled.slice(0, count);
}
