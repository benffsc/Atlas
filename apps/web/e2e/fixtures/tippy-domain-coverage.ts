/**
 * Tippy Domain Coverage Question Bank
 *
 * Golden dataset testing every domain area of the Atlas TNR system.
 * Covers the 20 untested domain areas identified in the test suite audit.
 *
 * Each question has:
 * - Structured validation (keyword checks, not just message.toBeTruthy)
 * - Expected tool that should be invoked
 * - Domain category for coverage tracking
 * - Whether it requires a real API call or can be mocked
 *
 * Categories match real staff workflows:
 * - voicemail_triage: Daily caller lookup workflow
 * - lost_cat: Lost/missing cat searches by description
 * - spatial: "What's near here?" geospatial queries
 * - messaging: Staff-to-staff communication
 * - reminders: Follow-up scheduling
 * - draft_request: Creating trapping requests via Tippy
 * - field_events: Logging trapping activity
 * - disease: FIV/FeLV colony health
 * - knowledge_base: Procedures, policies, talking points
 * - colony_history: Colony estimate discrepancies
 * - household: Family/shared contact context
 * - booking: ClinicHQ appointment/account context
 * - equipment: Trap inventory and checkout
 * - seasonal: Breeding season awareness
 * - place_comparison: Prioritizing locations
 */

export interface DomainQuestion {
  id: string;
  question: string;
  category: string;
  expectedTool: string;
  /** Keywords that MUST appear in response (case-insensitive, OR logic within group) */
  mustContainAny: string[];
  /** Keywords that MUST NOT appear (indicates failure/hallucination) */
  mustNotContain?: string[];
  /** If true, response must contain a number */
  expectsNumericData?: boolean;
  difficulty: "easy" | "medium" | "hard";
  description: string;
}

// ============================================================================
// VOICEMAIL / NEW CALLER TRIAGE (HIGH priority gap)
// ============================================================================

export const VOICEMAIL_TRIAGE_QUESTIONS: DomainQuestion[] = [
  {
    id: "voicemail-phone-lookup",
    question:
      "I got a voicemail from someone at 707-555-0123. What do we know about this number?",
    category: "voicemail_triage",
    expectedTool: "run_sql",
    mustContainAny: ["phone", "number", "found", "no record", "match", "person", "not find"],
    expectsNumericData: false,
    difficulty: "easy",
    description: "Tests basic phone lookup from voicemail — core daily workflow",
  },
  {
    id: "voicemail-full-triage",
    question:
      "Got a call from Maria Lopez at 707-555-4567, she says she has cats at 450 College Ave, Santa Rosa. What do we already know?",
    category: "voicemail_triage",
    expectedTool: "full_place_briefing",
    mustContainAny: ["cat", "address", "place", "found", "record", "college", "santa rosa"],
    difficulty: "medium",
    description: "Tests full voicemail triage — person lookup + place lookup + context assembly",
  },
  {
    id: "voicemail-existing-request",
    question:
      "Someone called about cats on Petaluma Hill Road. Do we have any existing requests for that area?",
    category: "voicemail_triage",
    expectedTool: "full_place_briefing",
    mustContainAny: ["request", "petaluma", "found", "active", "no", "place", "cat"],
    difficulty: "easy",
    description: "Tests whether Tippy checks for existing requests during triage",
  },
];

// ============================================================================
// LOST / MISSING CAT SEARCH (HIGH priority gap)
// ============================================================================

export const LOST_CAT_QUESTIONS: DomainQuestion[] = [
  {
    id: "lost-cat-by-color",
    question:
      "Someone lost a black and white cat near Sebastopol Road last month. Can you search for any matches?",
    category: "lost_cat",
    expectedTool: "run_sql",
    mustContainAny: ["cat", "black", "found", "microchip", "match", "no", "result"],
    difficulty: "medium",
    description: "Tests lost cat search by color + location + timeframe",
  },
  {
    id: "lost-cat-orange-tabby",
    question:
      "Missing orange tabby, male, last seen near Stony Point Road area about 2 weeks ago. Any cats matching?",
    category: "lost_cat",
    expectedTool: "run_sql",
    mustContainAny: ["orange", "tabby", "cat", "found", "match", "microchip", "stony", "no"],
    difficulty: "medium",
    description: "Tests lost cat search with specific breed/color/sex descriptors",
  },
  {
    id: "lost-cat-suggest-scas",
    question: "A neighbor lost their grey cat two days ago. What should they do?",
    category: "lost_cat",
    expectedTool: "run_sql",
    mustContainAny: ["scas", "animal services", "search", "microchip", "check", "lost"],
    mustNotContain: ["error", "exception"],
    difficulty: "easy",
    description: "Tests that Tippy suggests SCAS as backup for lost cat reports",
  },
];

// ============================================================================
// SPATIAL / GEOSPATIAL ANALYSIS (HIGH priority gap)
// ============================================================================

export const SPATIAL_QUESTIONS: DomainQuestion[] = [
  {
    id: "spatial-nearby-cats",
    question: "Are there any cats or colonies near 500 Mendocino Ave, Santa Rosa?",
    category: "spatial",
    expectedTool: "analyze_spatial_context",
    mustContainAny: ["near", "found", "colony", "cat", "place", "activity", "no known"],
    difficulty: "easy",
    description: "Tests nearby activity search for an address",
  },
  {
    id: "spatial-hot-zone",
    question: "Is there a lot of TNR activity around the downtown Santa Rosa area?",
    category: "spatial",
    expectedTool: "analyze_spatial_context",
    mustContainAny: ["activity", "cat", "santa rosa", "place", "colony", "area"],
    difficulty: "easy",
    description: "Tests hot zone detection for a general area",
  },
  {
    id: "spatial-fallback-after-miss",
    question: "What's happening at 99 Unknown Drive? If nothing there, what about nearby?",
    category: "spatial",
    expectedTool: "analyze_spatial_context",
    mustContainAny: ["found", "near", "no", "closest", "place", "activity"],
    mustNotContain: ["error", "crash"],
    difficulty: "medium",
    description: "Tests fallback from exact match to spatial search",
  },
];

// ============================================================================
// STAFF MESSAGING (MEDIUM priority gap)
// ============================================================================

export const MESSAGING_QUESTIONS: DomainQuestion[] = [
  {
    id: "message-send-to-staff",
    question: "Tell Ben that we need to schedule a mass trapping at the Pozzan Road colony next week.",
    category: "messaging",
    expectedTool: "send_message",
    mustContainAny: ["message", "sent", "ben", "inbox", "dashboard"],
    difficulty: "easy",
    description: "Tests basic staff message sending",
  },
  {
    id: "message-with-entity",
    question: "Let Jami know that the Oak St colony needs a recheck visit — the caretaker called again.",
    category: "messaging",
    expectedTool: "send_message",
    mustContainAny: ["message", "sent", "jami", "inbox", "dashboard"],
    difficulty: "medium",
    description: "Tests message with entity context (place reference)",
  },
];

// ============================================================================
// REMINDERS (MEDIUM priority gap)
// ============================================================================

export const REMINDER_QUESTIONS: DomainQuestion[] = [
  {
    id: "reminder-simple",
    question: "Remind me to check on the Selvage Road colony next Tuesday.",
    category: "reminders",
    expectedTool: "create_reminder",
    mustContainAny: ["reminder", "created", "tuesday", "selvage", "dashboard"],
    difficulty: "easy",
    description: "Tests basic reminder creation with relative time",
  },
  {
    id: "reminder-with-contact",
    question:
      "Remind me to call Sarah Johnson at 707-555-8901 about the cats on Fisher Lane tomorrow morning.",
    category: "reminders",
    expectedTool: "create_reminder",
    mustContainAny: ["reminder", "created", "sarah", "tomorrow", "dashboard"],
    difficulty: "medium",
    description: "Tests reminder with contact info extraction",
  },
  {
    id: "reminder-follow-up",
    question: "Don't let me forget to follow up on the intake from 115 Magnolia in 3 days.",
    category: "reminders",
    expectedTool: "create_reminder",
    mustContainAny: ["reminder", "created", "magnolia", "dashboard"],
    difficulty: "easy",
    description: "Tests alternate reminder phrasing ('don't let me forget')",
  },
];

// ============================================================================
// DRAFT REQUEST CREATION (MEDIUM priority gap)
// ============================================================================

export const DRAFT_REQUEST_QUESTIONS: DomainQuestion[] = [
  {
    id: "draft-request-basic",
    question:
      "Create a request for about 8 cats at 234 West 3rd Street, Santa Rosa. The resident Maria Gonzalez called, phone 707-555-3456.",
    category: "draft_request",
    expectedTool: "log_event",
    mustContainAny: ["draft", "request", "created", "review", "coordinator"],
    difficulty: "medium",
    description: "Tests draft request creation with full details",
  },
  {
    id: "draft-request-minimal",
    question: "Can you start a request for cats at 567 Bodega Ave, Petaluma? About 5 cats, no contact info yet.",
    category: "draft_request",
    expectedTool: "log_event",
    mustContainAny: ["draft", "request", "created", "review"],
    difficulty: "easy",
    description: "Tests draft request with minimal info (no requester contact)",
  },
];

// ============================================================================
// FIELD EVENTS & OBSERVATIONS (MEDIUM priority gap)
// ============================================================================

export const FIELD_EVENT_QUESTIONS: DomainQuestion[] = [
  {
    id: "field-event-trap",
    question: "I just trapped 3 cats at the Oak Street colony. Log that.",
    category: "field_events",
    expectedTool: "log_event",
    mustContainAny: ["logged", "event", "oak", "3", "cat"],
    difficulty: "easy",
    description: "Tests basic field event logging",
  },
  {
    id: "site-observation",
    question: "I saw about 12 cats at the corner of Todd Road and Stony Point this morning. Can you note that?",
    category: "field_events",
    expectedTool: "log_event",
    mustContainAny: ["logged", "observation", "noted", "12", "todd", "stony"],
    difficulty: "easy",
    description: "Tests site observation logging with count",
  },
];

// ============================================================================
// DISEASE TRACKING (MEDIUM priority gap)
// ============================================================================

export const DISEASE_QUESTIONS: DomainQuestion[] = [
  {
    id: "disease-fiv-colonies",
    question: "Which colonies or locations have FIV positive cats?",
    category: "disease",
    expectedTool: "run_sql",
    mustContainAny: ["fiv", "positive", "place", "colony", "location", "cat", "found", "no"],
    expectsNumericData: false,
    difficulty: "medium",
    description: "Tests disease status query across locations",
  },
  {
    id: "disease-felv-rate",
    question: "What's the FeLV positivity rate overall? How many cats have been tested?",
    category: "disease",
    expectedTool: "run_sql",
    mustContainAny: ["felv", "positive", "tested", "rate", "cat", "percent", "%"],
    expectsNumericData: true,
    difficulty: "medium",
    description: "Tests aggregate disease statistics",
  },
  {
    id: "disease-at-place",
    question: "Are there any disease concerns at 1170 Walker Rd?",
    category: "disease",
    expectedTool: "full_place_briefing",
    mustContainAny: ["disease", "test", "fiv", "felv", "negative", "positive", "healthy", "walker"],
    difficulty: "easy",
    description: "Tests disease lookup for a specific place (FFS-758 enrichment)",
  },
];

// ============================================================================
// KNOWLEDGE BASE / PROCEDURES (MEDIUM priority gap)
// ============================================================================

export const KNOWLEDGE_BASE_QUESTIONS: DomainQuestion[] = [
  {
    id: "kb-trap-setup",
    question: "How do I set a humane trap for TNR?",
    category: "knowledge_base",
    expectedTool: "run_sql",
    mustContainAny: ["trap", "bait", "set", "cover", "place", "food", "tuna"],
    mustNotContain: ["error", "don't have"],
    difficulty: "easy",
    description: "Tests procedural knowledge retrieval",
  },
  {
    id: "kb-kitten-policy",
    question: "What's our policy on kittens under 2 pounds? Can they be fixed?",
    category: "knowledge_base",
    expectedTool: "run_sql",
    mustContainAny: ["kitten", "weight", "pound", "spay", "neuter", "wait", "foster"],
    difficulty: "easy",
    description: "Tests policy knowledge retrieval",
  },
  {
    id: "kb-tnr-objection",
    question: "A neighbor is complaining about TNR. What should I say to them?",
    category: "knowledge_base",
    expectedTool: "run_sql",
    mustContainAny: ["tnr", "population", "humane", "effective", "community", "reduce", "colony"],
    difficulty: "medium",
    description: "Tests talking points / objection handling",
  },
];

// ============================================================================
// COLONY ESTIMATE HISTORY (MEDIUM priority gap)
// ============================================================================

export const COLONY_HISTORY_QUESTIONS: DomainQuestion[] = [
  {
    id: "colony-history-discrepancy",
    question: "Why does the colony at Jennings Way show different numbers in different places?",
    category: "colony_history",
    expectedTool: "full_place_briefing",
    mustContainAny: ["estimate", "colony", "count", "jennings", "cat", "source", "different"],
    difficulty: "medium",
    description: "Tests colony estimate discrepancy explanation",
  },
  {
    id: "colony-history-trend",
    question: "Has the colony size at any major location been growing or shrinking over time?",
    category: "colony_history",
    expectedTool: "run_sql",
    mustContainAny: ["colony", "estimate", "cat", "over time", "change", "grow", "shrink", "trend"],
    difficulty: "hard",
    description: "Tests temporal colony analysis",
  },
];

// ============================================================================
// HOUSEHOLD / FAMILY CONTEXT (MEDIUM priority gap)
// ============================================================================

export const HOUSEHOLD_QUESTIONS: DomainQuestion[] = [
  {
    id: "household-shared-phone",
    question: "This phone number seems to be used by multiple people. Can you check who else shares 707-555-1234?",
    category: "household",
    expectedTool: "run_sql",
    mustContainAny: ["phone", "shared", "person", "household", "same", "found", "no match"],
    difficulty: "medium",
    description: "Tests household phone sharing detection",
  },
  {
    id: "household-same-address",
    question: "Who else lives at the same address as any requester we have on file?",
    category: "household",
    expectedTool: "run_sql",
    mustContainAny: ["address", "person", "household", "live", "same", "found"],
    difficulty: "hard",
    description: "Tests household co-location detection",
  },
];

// ============================================================================
// BOOKING / CLINIC ACCOUNT CONTEXT (LOW priority gap)
// ============================================================================

export const BOOKING_QUESTIONS: DomainQuestion[] = [
  {
    id: "booking-appointment-lookup",
    question: "How many clinic appointments did we have last month?",
    category: "booking",
    expectedTool: "run_sql",
    mustContainAny: ["appointment", "clinic", "month", "last"],
    expectsNumericData: true,
    difficulty: "easy",
    description: "Tests basic appointment count query",
  },
  {
    id: "booking-name-mismatch",
    question: "Can you find any cases where the booking name in ClinicHQ doesn't match the person in Atlas?",
    category: "booking",
    expectedTool: "run_sql",
    mustContainAny: ["clinic", "name", "match", "account", "booking", "person", "different"],
    difficulty: "hard",
    description: "Tests clinic account vs person identity understanding",
  },
];

// ============================================================================
// SEASONAL / BREEDING CONTEXT (LOW priority gap)
// ============================================================================

export const SEASONAL_QUESTIONS: DomainQuestion[] = [
  {
    id: "seasonal-kitten-season",
    question: "When is kitten season and should we be preparing for it?",
    category: "seasonal",
    expectedTool: "run_sql",
    mustContainAny: ["kitten", "season", "spring", "breed", "march", "april", "may", "prepare", "surge"],
    difficulty: "easy",
    description: "Tests seasonal breeding knowledge",
  },
  {
    id: "seasonal-current-phase",
    question: "What's the current breeding phase? Are we seeing more pregnant cats right now?",
    category: "seasonal",
    expectedTool: "run_sql",
    mustContainAny: ["breed", "phase", "pregnant", "season", "intensity", "current"],
    difficulty: "medium",
    description: "Tests current seasonal context awareness (FFS-757 pre-flight data)",
  },
];

// ============================================================================
// PLACE COMPARISON (LOW priority gap)
// ============================================================================

export const PLACE_COMPARISON_QUESTIONS: DomainQuestion[] = [
  {
    id: "place-compare-two",
    question: "Between the colony at Pozzan Road and the one at Scenic Avenue, which needs more attention?",
    category: "place_comparison",
    expectedTool: "full_place_briefing",
    mustContainAny: ["pozzan", "scenic", "cat", "alteration", "rate", "attention", "alter"],
    difficulty: "medium",
    description: "Tests side-by-side place comparison",
  },
];

// ============================================================================
// ALL QUESTIONS (combined export)
// ============================================================================

export const ALL_DOMAIN_QUESTIONS: DomainQuestion[] = [
  ...VOICEMAIL_TRIAGE_QUESTIONS,
  ...LOST_CAT_QUESTIONS,
  ...SPATIAL_QUESTIONS,
  ...MESSAGING_QUESTIONS,
  ...REMINDER_QUESTIONS,
  ...DRAFT_REQUEST_QUESTIONS,
  ...FIELD_EVENT_QUESTIONS,
  ...DISEASE_QUESTIONS,
  ...KNOWLEDGE_BASE_QUESTIONS,
  ...COLONY_HISTORY_QUESTIONS,
  ...HOUSEHOLD_QUESTIONS,
  ...BOOKING_QUESTIONS,
  ...SEASONAL_QUESTIONS,
  ...PLACE_COMPARISON_QUESTIONS,
];

// Coverage report helper
export function getDomainCoverageReport(): { category: string; count: number }[] {
  const categories = new Map<string, number>();
  for (const q of ALL_DOMAIN_QUESTIONS) {
    categories.set(q.category, (categories.get(q.category) || 0) + 1);
  }
  return Array.from(categories.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Validate a response against a domain question's expectations.
 * Returns { pass, reasons } for detailed reporting.
 */
export function validateDomainResponse(
  question: DomainQuestion,
  response: string
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const lower = response.toLowerCase();

  // Check minimum length
  if (response.length < 30) {
    reasons.push(`Response too short (${response.length} chars)`);
  }

  // Check for error indicators
  if (lower.match(/error|exception|crash|500|internal server/i)) {
    reasons.push("Response contains error indicators");
  }

  // Check mustContainAny
  const hasRequired = question.mustContainAny.some((kw) =>
    lower.includes(kw.toLowerCase())
  );
  if (!hasRequired) {
    reasons.push(
      `Missing required keywords (need one of: ${question.mustContainAny.join(", ")})`
    );
  }

  // Check mustNotContain
  if (question.mustNotContain) {
    for (const kw of question.mustNotContain) {
      if (lower.includes(kw.toLowerCase())) {
        reasons.push(`Contains forbidden keyword: "${kw}"`);
      }
    }
  }

  // Check numeric data
  if (question.expectsNumericData && !/\d+/.test(response)) {
    reasons.push("Expected numeric data but none found");
  }

  return { pass: reasons.length === 0, reasons };
}
