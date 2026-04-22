/**
 * Staff Questions Fixture
 *
 * These are the actual questions FFSC staff ask day-to-day.
 * Unlike technical assertions, these mirror real workflows.
 *
 * Categories:
 * - Intake Processing: Morning intake queue review
 * - Request Management: Active request handling
 * - Trapper Management: Assignment and stats
 * - Data Entry: Duplicate detection and verification
 * - Reporting: Monthly/quarterly numbers
 * - Emergency: Urgent situation handling
 */

export interface StaffQuestion {
  id: string;
  question: string;
  category: "intake" | "requests" | "trappers" | "data_entry" | "reporting" | "emergency" | "navigation";
  persona: "coordinator" | "head_trapper" | "data_entry" | "executive";
  priority: "daily" | "weekly" | "monthly" | "ad_hoc";
  expectedCapability: "works" | "partial" | "gap";
  gapReason?: string;
  validateResponse: (response: string) => boolean;
}

// ============================================================================
// INTAKE PROCESSING QUESTIONS
// Asked every morning when processing the intake queue
// ============================================================================

export const INTAKE_QUESTIONS: StaffQuestion[] = [
  {
    id: "intake-pending-count",
    question: "How many pending intake submissions do we have?",
    category: "intake",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) => r.match(/\d+/) !== null,
  },
  {
    id: "intake-emergency-check",
    question: "Are there any emergency intakes I need to handle first?",
    category: "intake",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("emergency") ||
      r.toLowerCase().includes("urgent") ||
      r.toLowerCase().includes("none") ||
      r.toLowerCase().includes("no "),
  },
  {
    id: "intake-duplicate-check",
    question: "Is there already a request for 456 Oak Street?",
    category: "intake",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("request") ||
      r.toLowerCase().includes("found") ||
      r.toLowerCase().includes("no ") ||
      r.toLowerCase().includes("exist"),
  },
  {
    id: "intake-similar-address",
    question: "Show me similar intakes to this one - it looks like a duplicate",
    category: "intake",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "partial",
    gapReason: "run_sql works but needs better intake-specific matching",
    validateResponse: (r) =>
      r.toLowerCase().includes("similar") ||
      r.toLowerCase().includes("duplicate") ||
      r.toLowerCase().includes("match") ||
      r.length > 50,
  },
  {
    id: "intake-this-week",
    question: "How many intakes came in this week?",
    category: "intake",
    persona: "coordinator",
    priority: "weekly",
    expectedCapability: "gap",
    gapReason: "No date range filtering on intake counts",
    validateResponse: (r) =>
      r.match(/\d+/) !== null &&
      r.toLowerCase().includes("week"),
  },
];

// ============================================================================
// REQUEST MANAGEMENT QUESTIONS
// Asked throughout the day when managing active requests
// ============================================================================

export const REQUEST_QUESTIONS: StaffQuestion[] = [
  {
    id: "requests-waiting-assignment",
    question: "How many requests are waiting to be assigned?",
    category: "requests",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) => r.match(/\d+/) !== null,
  },
  {
    id: "requests-by-trapper",
    question: "Show me all requests assigned to Sarah",
    category: "requests",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("request") ||
      r.toLowerCase().includes("sarah") ||
      r.toLowerCase().includes("assigned") ||
      r.match(/\d+/) !== null,
  },
  {
    id: "requests-on-hold",
    question: "Which requests are on hold and why?",
    category: "requests",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("hold") ||
      r.toLowerCase().includes("reason") ||
      r.toLowerCase().includes("none"),
  },
  {
    id: "requests-overdue",
    question: "Are any requests overdue or sitting too long?",
    category: "requests",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "gap",
    gapReason: "No SLA tracking or overdue calculation",
    validateResponse: (r) =>
      r.toLowerCase().includes("overdue") ||
      r.toLowerCase().includes("old") ||
      r.toLowerCase().includes("waiting"),
  },
  {
    id: "requests-completed-today",
    question: "How many requests did we complete today?",
    category: "requests",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "gap",
    gapReason: "No date filtering on request completion",
    validateResponse: (r) =>
      r.match(/\d+/) !== null &&
      r.toLowerCase().includes("today"),
  },
  {
    id: "requests-in-area",
    question: "What requests do we have in the Santa Rosa area?",
    category: "requests",
    persona: "coordinator",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("santa rosa") ||
      r.toLowerCase().includes("request") ||
      r.match(/\d+/) !== null,
  },
];

// ============================================================================
// TRAPPER MANAGEMENT QUESTIONS
// Asked when assigning work or reviewing performance
// ============================================================================

export const TRAPPER_QUESTIONS: StaffQuestion[] = [
  {
    id: "trapper-available",
    question: "Who's available to take a new request?",
    category: "trappers",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "gap",
    gapReason: "No workload/availability tracking",
    validateResponse: (r) =>
      r.toLowerCase().includes("trapper") ||
      r.toLowerCase().includes("available") ||
      r.toLowerCase().includes("assign"),
  },
  {
    id: "trapper-monthly-count",
    question: "How many cats did David trap this month?",
    category: "trappers",
    persona: "head_trapper",
    priority: "monthly",
    expectedCapability: "gap",
    gapReason: "trapper_stats has no date range",
    validateResponse: (r) =>
      r.match(/\d+/) !== null &&
      r.toLowerCase().includes("month"),
  },
  {
    id: "trapper-total-stats",
    question: "What are Sarah's total trapping stats?",
    category: "trappers",
    persona: "coordinator",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.match(/\d+/) !== null ||
      r.toLowerCase().includes("cat") ||
      r.toLowerCase().includes("sarah"),
  },
  {
    id: "trapper-incomplete-requests",
    question: "Show me Sarah's assigned but incomplete requests",
    category: "trappers",
    persona: "coordinator",
    priority: "weekly",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("request") ||
      r.toLowerCase().includes("incomplete") ||
      r.toLowerCase().includes("pending") ||
      r.toLowerCase().includes("assign"),
  },
  {
    id: "trapper-top-performers",
    question: "Who are our top trappers?",
    category: "trappers",
    persona: "executive",
    priority: "monthly",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.match(/\d+/) !== null ||
      r.toLowerCase().includes("trapper") ||
      r.toLowerCase().includes("top"),
  },
  {
    id: "trapper-performance-trend",
    question: "Is Sarah trapping more or less than last month?",
    category: "trappers",
    persona: "head_trapper",
    priority: "monthly",
    expectedCapability: "gap",
    gapReason: "No month-over-month comparison",
    validateResponse: (r) =>
      r.toLowerCase().includes("more") ||
      r.toLowerCase().includes("less") ||
      r.toLowerCase().includes("same"),
  },
];

// ============================================================================
// DATA ENTRY QUESTIONS
// Asked when entering or verifying data
// ============================================================================

export const DATA_ENTRY_QUESTIONS: StaffQuestion[] = [
  {
    id: "data-email-lookup",
    question: "Is jane@example.com already in the system?",
    category: "data_entry",
    persona: "data_entry",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("found") ||
      r.toLowerCase().includes("yes") ||
      r.toLowerCase().includes("no") ||
      r.toLowerCase().includes("person"),
  },
  {
    id: "data-phone-lookup",
    question: "Is this phone number in the system: 707-555-1234",
    category: "data_entry",
    persona: "data_entry",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("found") ||
      r.toLowerCase().includes("phone") ||
      r.toLowerCase().includes("person") ||
      r.toLowerCase().includes("no "),
  },
  {
    id: "data-name-search",
    question: "Show me everyone named John Smith",
    category: "data_entry",
    persona: "data_entry",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.match(/\d+/) !== null ||
      r.toLowerCase().includes("john") ||
      r.toLowerCase().includes("smith") ||
      r.toLowerCase().includes("found"),
  },
  {
    id: "data-same-person",
    question: "Are these two people the same person?",
    category: "data_entry",
    persona: "data_entry",
    priority: "ad_hoc",
    expectedCapability: "partial",
    gapReason: "run_sql helps but no explicit merge recommendation",
    validateResponse: (r) =>
      r.toLowerCase().includes("same") ||
      r.toLowerCase().includes("different") ||
      r.toLowerCase().includes("match") ||
      r.toLowerCase().includes("duplicate"),
  },
  {
    id: "data-address-exists",
    question: "Is 123 Main St already in the system?",
    category: "data_entry",
    persona: "data_entry",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("place") ||
      r.toLowerCase().includes("address") ||
      r.toLowerCase().includes("found") ||
      r.toLowerCase().includes("main"),
  },
  {
    id: "data-microchip-scan",
    question: "Scan microchip 985012345678900 - is this cat in the system?",
    category: "data_entry",
    persona: "data_entry",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("microchip") ||
      r.toLowerCase().includes("cat") ||
      r.toLowerCase().includes("found") ||
      r.toLowerCase().includes("985"),
  },
  {
    id: "data-microchip-history",
    question: "Show me all appointments for microchip 985012345678900",
    category: "data_entry",
    persona: "data_entry",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("appointment") ||
      r.toLowerCase().includes("clinic") ||
      r.toLowerCase().includes("cat") ||
      r.match(/\d+/) !== null,
  },
];

// ============================================================================
// REPORTING QUESTIONS
// Asked for monthly/quarterly reports
// ============================================================================

export const REPORTING_QUESTIONS: StaffQuestion[] = [
  {
    id: "report-cats-last-month",
    question: "How many cats did we fix last month?",
    category: "reporting",
    persona: "executive",
    priority: "monthly",
    expectedCapability: "gap",
    gapReason: "area_stats only has yearly granularity",
    validateResponse: (r) =>
      r.match(/\d+/) !== null &&
      r.toLowerCase().includes("month"),
  },
  {
    id: "report-quarterly-comparison",
    question: "How many cats did we fix this quarter vs last quarter?",
    category: "reporting",
    persona: "executive",
    priority: "monthly",
    expectedCapability: "gap",
    gapReason: "No quarterly aggregation available",
    validateResponse: (r) =>
      r.match(/\d+/) !== null &&
      r.toLowerCase().includes("quarter"),
  },
  {
    id: "report-overall-rate",
    question: "What's our alteration rate across all colonies?",
    category: "reporting",
    persona: "executive",
    priority: "monthly",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.includes("%") ||
      r.toLowerCase().includes("rate") ||
      r.match(/\d+/) !== null,
  },
  {
    id: "report-yoy",
    question: "Show me our progress this year vs last year",
    category: "reporting",
    persona: "executive",
    priority: "monthly",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("year") ||
      r.includes("%") ||
      r.match(/\d+/) !== null,
  },
  {
    id: "report-top-trappers-quarter",
    question: "Who trapped the most cats this quarter?",
    category: "reporting",
    persona: "executive",
    priority: "monthly",
    expectedCapability: "gap",
    gapReason: "No date range on trapper stats",
    validateResponse: (r) =>
      r.toLowerCase().includes("trapper") &&
      r.toLowerCase().includes("quarter"),
  },
  {
    id: "report-regional-comparison",
    question: "What's the alteration rate in Santa Rosa vs Petaluma?",
    category: "reporting",
    persona: "executive",
    priority: "monthly",
    expectedCapability: "partial",
    gapReason: "Can query regions separately but no direct comparison",
    validateResponse: (r) =>
      (r.toLowerCase().includes("santa rosa") ||
        r.toLowerCase().includes("petaluma")) &&
      r.includes("%"),
  },
  {
    id: "report-needs-attention",
    question: "Show me colonies that need attention",
    category: "reporting",
    persona: "coordinator",
    priority: "weekly",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("colony") ||
      r.toLowerCase().includes("attention") ||
      r.toLowerCase().includes("need"),
  },
];

// ============================================================================
// NAVIGATION QUESTIONS
// Asked when trying to find something in Atlas
// ============================================================================

export const NAVIGATION_QUESTIONS: StaffQuestion[] = [
  {
    id: "nav-new-request",
    question: "How do I create a new request?",
    category: "navigation",
    persona: "coordinator",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("request") &&
      (r.includes("/") || r.toLowerCase().includes("button") || r.toLowerCase().includes("click")),
  },
  {
    id: "nav-find-cat",
    question: "How do I find a cat by microchip?",
    category: "navigation",
    persona: "data_entry",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("cat") &&
      (r.toLowerCase().includes("search") || r.toLowerCase().includes("microchip")),
  },
  {
    id: "nav-intake-queue",
    question: "Where's the intake queue?",
    category: "navigation",
    persona: "coordinator",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("intake") &&
      r.includes("/"),
  },
  {
    id: "nav-beacon",
    question: "How do I see colony analytics?",
    category: "navigation",
    persona: "executive",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("beacon") ||
      (r.toLowerCase().includes("analytics") && r.includes("/")),
  },
];

// ============================================================================
// EMERGENCY QUESTIONS
// Asked when urgent situations arise
// ============================================================================

export const EMERGENCY_QUESTIONS: StaffQuestion[] = [
  {
    id: "emergency-urgent-intakes",
    question: "Are there any urgent intakes right now?",
    category: "emergency",
    persona: "coordinator",
    priority: "daily",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("urgent") ||
      r.toLowerCase().includes("emergency") ||
      r.toLowerCase().includes("none") ||
      r.toLowerCase().includes("no "),
  },
  {
    id: "emergency-cats-at-address",
    question: "There's an emergency at 789 Elm St - how many cats are there?",
    category: "emergency",
    persona: "coordinator",
    priority: "ad_hoc",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.match(/\d+/) !== null ||
      r.toLowerCase().includes("cat") ||
      r.toLowerCase().includes("elm"),
  },
  {
    id: "emergency-nearest-trapper",
    question: "Who's the nearest available trapper to 123 Oak St?",
    category: "emergency",
    persona: "coordinator",
    priority: "ad_hoc",
    expectedCapability: "gap",
    gapReason: "No trapper location/availability tracking",
    validateResponse: (r) =>
      r.toLowerCase().includes("trapper") ||
      r.toLowerCase().includes("available") ||
      r.toLowerCase().includes("near"),
  },
];

// ============================================================================
// ALL QUESTIONS COMBINED
// ============================================================================

export const ALL_STAFF_QUESTIONS: StaffQuestion[] = [
  ...INTAKE_QUESTIONS,
  ...REQUEST_QUESTIONS,
  ...TRAPPER_QUESTIONS,
  ...DATA_ENTRY_QUESTIONS,
  ...REPORTING_QUESTIONS,
  ...NAVIGATION_QUESTIONS,
  ...EMERGENCY_QUESTIONS,
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function getQuestionsByCapability(
  capability: "works" | "partial" | "gap"
): StaffQuestion[] {
  return ALL_STAFF_QUESTIONS.filter((q) => q.expectedCapability === capability);
}

export function getQuestionsByCategory(
  category: StaffQuestion["category"]
): StaffQuestion[] {
  return ALL_STAFF_QUESTIONS.filter((q) => q.category === category);
}

export function getQuestionsByPersona(
  persona: StaffQuestion["persona"]
): StaffQuestion[] {
  return ALL_STAFF_QUESTIONS.filter((q) => q.persona === persona);
}

export function getQuestionsByPriority(
  priority: StaffQuestion["priority"]
): StaffQuestion[] {
  return ALL_STAFF_QUESTIONS.filter((q) => q.priority === priority);
}

export function getDailyQuestions(): StaffQuestion[] {
  return ALL_STAFF_QUESTIONS.filter((q) => q.priority === "daily");
}

export function getWorkingQuestions(): StaffQuestion[] {
  return ALL_STAFF_QUESTIONS.filter((q) => q.expectedCapability === "works");
}

export function getGapQuestions(): StaffQuestion[] {
  return ALL_STAFF_QUESTIONS.filter(
    (q) => q.expectedCapability === "gap" || q.expectedCapability === "partial"
  );
}

// ============================================================================
// GAP SUMMARY
// ============================================================================

export const GAP_SUMMARY = {
  temporal_queries: [
    "intake-this-week",
    "requests-completed-today",
    "trapper-monthly-count",
    "trapper-performance-trend",
    "report-cats-last-month",
    "report-quarterly-comparison",
    "report-top-trappers-quarter",
  ],
  workload_tracking: [
    "trapper-available",
    "requests-overdue",
    "emergency-nearest-trapper",
  ],
  comparison_queries: [
    "report-regional-comparison",
    "data-same-person",
  ],
};
