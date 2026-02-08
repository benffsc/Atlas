/**
 * Identity Resolution Questions Fixture
 *
 * Tests Tippy's ability to explain the Phase 3-4 identity resolution system:
 * - Fellegi-Sunter probabilistic matching
 * - Identity graph and merge tracking
 * - Match probability explanations
 * - Data Engine decisions
 *
 * These questions validate that Tippy can correctly explain the system to staff.
 */

export interface IdentityResolutionQuestion {
  id: string;
  question: string;
  category: "fs_scoring" | "identity_graph" | "review_workflow" | "match_explanation";
  difficulty: "basic" | "intermediate" | "advanced";
  expectedCapability: "works" | "partial" | "gap";
  gapReason?: string;
  validateResponse: (response: string) => boolean;
  description: string;
}

// ============================================================================
// FELLEGI-SUNTER SCORING EXPLANATION QUESTIONS
// Staff asking how the matching system works
// ============================================================================

export const FS_SCORING_QUESTIONS: IdentityResolutionQuestion[] = [
  {
    id: "fs-what-is-probability",
    question: "What does the match probability percentage mean in identity review?",
    category: "fs_scoring",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("probabilit") ||
      r.toLowerCase().includes("likelihood") ||
      r.toLowerCase().includes("confidence") ||
      r.toLowerCase().includes("match"),
    description: "Basic explanation of match probability for staff",
  },
  {
    id: "fs-how-calculated",
    question: "How is the identity match score calculated?",
    category: "fs_scoring",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      (r.toLowerCase().includes("email") || r.toLowerCase().includes("phone")) &&
      (r.toLowerCase().includes("weight") || r.toLowerCase().includes("score")),
    description: "Explains the multi-field scoring approach",
  },
  {
    id: "fs-why-90-percent",
    question: "Why is 90% considered high confidence for identity matching?",
    category: "fs_scoring",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("confident") ||
      r.toLowerCase().includes("reliable") ||
      r.toLowerCase().includes("likely") ||
      r.match(/9\d%/),
    description: "Explains confidence thresholds",
  },
  {
    id: "fs-missing-data",
    question: "What happens if someone doesn't have an email address when matching?",
    category: "fs_scoring",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("missing") ||
      r.toLowerCase().includes("neutral") ||
      r.toLowerCase().includes("other field") ||
      r.toLowerCase().includes("phone"),
    description: "Explains how missing data is handled (neutral, not penalizing)",
  },
  {
    id: "fs-field-weights",
    question: "Which fields are most important for identity matching?",
    category: "fs_scoring",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("email") &&
      (r.toLowerCase().includes("phone") || r.toLowerCase().includes("name")),
    description: "Lists the most important matching fields",
  },
  {
    id: "fs-email-vs-phone",
    question: "Why is email matching weighted higher than phone matching?",
    category: "fs_scoring",
    difficulty: "intermediate",
    expectedCapability: "partial",
    gapReason: "May need F-S parameter documentation for precise explanation",
    validateResponse: (r) =>
      r.toLowerCase().includes("email") &&
      (r.toLowerCase().includes("unique") || r.toLowerCase().includes("reliable")),
    description: "Explains email uniqueness vs phone sharing",
  },
  {
    id: "fs-thresholds",
    question: "What are the thresholds for automatic matching vs manual review?",
    category: "fs_scoring",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      (r.toLowerCase().includes("auto") || r.toLowerCase().includes("automatic")) &&
      (r.toLowerCase().includes("review") || r.toLowerCase().includes("manual")),
    description: "Explains upper/lower thresholds",
  },
  {
    id: "fs-negative-score",
    question: "Can a match score be negative? What does that mean?",
    category: "fs_scoring",
    difficulty: "advanced",
    expectedCapability: "partial",
    gapReason: "Log-odds scoring is technical, may need simplified explanation",
    validateResponse: (r) =>
      r.toLowerCase().includes("negative") ||
      r.toLowerCase().includes("different") ||
      r.toLowerCase().includes("unlikely") ||
      r.toLowerCase().includes("disagree"),
    description: "Explains negative log-odds for disagreements",
  },
];

// ============================================================================
// IDENTITY GRAPH QUESTIONS
// Staff asking about merge history and relationships
// ============================================================================

export const IDENTITY_GRAPH_QUESTIONS: IdentityResolutionQuestion[] = [
  {
    id: "graph-what-is-merge",
    question: "What happens to a person's data when they are merged?",
    category: "identity_graph",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("merge") &&
      (r.toLowerCase().includes("combine") ||
        r.toLowerCase().includes("transfer") ||
        r.toLowerCase().includes("keep")),
    description: "Basic merge explanation",
  },
  {
    id: "graph-undo-merge",
    question: "Can we undo a merge if it was wrong?",
    category: "identity_graph",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("undo") ||
      r.toLowerCase().includes("reverse") ||
      r.toLowerCase().includes("admin") ||
      r.toLowerCase().includes("track"),
    description: "Explains merge reversibility",
  },
  {
    id: "graph-merge-history",
    question: "How can I see the merge history for a person?",
    category: "identity_graph",
    difficulty: "intermediate",
    expectedCapability: "partial",
    gapReason: "Merge history UI may not be fully implemented",
    validateResponse: (r) =>
      r.toLowerCase().includes("history") ||
      r.toLowerCase().includes("record") ||
      r.toLowerCase().includes("identity") ||
      r.toLowerCase().includes("edge"),
    description: "How to view merge audit trail",
  },
  {
    id: "graph-household",
    question: "What is a household in the identity system?",
    category: "identity_graph",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("household") &&
      (r.toLowerCase().includes("address") ||
        r.toLowerCase().includes("family") ||
        r.toLowerCase().includes("same")),
    description: "Explains household grouping concept",
  },
  {
    id: "graph-multiple-merges",
    question: "What if the same person was entered three different times?",
    category: "identity_graph",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("merge") ||
      r.toLowerCase().includes("duplicate") ||
      r.toLowerCase().includes("canonical"),
    description: "Explains transitive merge chains",
  },
];

// ============================================================================
// REVIEW WORKFLOW QUESTIONS
// Staff asking how to use the review system
// ============================================================================

export const REVIEW_WORKFLOW_QUESTIONS: IdentityResolutionQuestion[] = [
  {
    id: "workflow-when-merge",
    question: "When should I merge two records in identity review?",
    category: "review_workflow",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("merge") &&
      (r.toLowerCase().includes("same person") ||
        r.toLowerCase().includes("confident") ||
        r.toLowerCase().includes("email") ||
        r.toLowerCase().includes("phone")),
    description: "Guidance on when to merge",
  },
  {
    id: "workflow-when-keep-separate",
    question: "When should I keep two records separate?",
    category: "review_workflow",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("separate") ||
      r.toLowerCase().includes("different") ||
      r.toLowerCase().includes("household") ||
      r.toLowerCase().includes("uncertain"),
    description: "Guidance on when to keep separate",
  },
  {
    id: "workflow-green-check",
    question: "What does the green checkmark mean in field comparison?",
    category: "review_workflow",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("match") ||
      r.toLowerCase().includes("agree") ||
      r.toLowerCase().includes("same"),
    description: "Explains agreement indicator",
  },
  {
    id: "workflow-red-x",
    question: "What does the red X mean in field comparison?",
    category: "review_workflow",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("different") ||
      r.toLowerCase().includes("disagree") ||
      r.toLowerCase().includes("mismatch"),
    description: "Explains disagreement indicator",
  },
  {
    id: "workflow-dash-missing",
    question: "What does the dash mean in field comparison?",
    category: "review_workflow",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("missing") ||
      r.toLowerCase().includes("empty") ||
      r.toLowerCase().includes("no ") ||
      r.toLowerCase().includes("neutral"),
    description: "Explains missing field indicator",
  },
  {
    id: "workflow-batch",
    question: "Can I merge multiple records at once?",
    category: "review_workflow",
    difficulty: "basic",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("batch") ||
      r.toLowerCase().includes("multiple") ||
      r.toLowerCase().includes("select") ||
      r.toLowerCase().includes("all"),
    description: "Explains batch processing",
  },
  {
    id: "workflow-priority",
    question: "Which identity reviews should I do first?",
    category: "review_workflow",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("high") ||
      r.toLowerCase().includes("90") ||
      r.toLowerCase().includes("confident") ||
      r.toLowerCase().includes("email"),
    description: "Review prioritization guidance",
  },
];

// ============================================================================
// SPECIFIC MATCH EXPLANATION QUESTIONS
// Staff asking about specific scenarios
// ============================================================================

export const MATCH_EXPLANATION_QUESTIONS: IdentityResolutionQuestion[] = [
  {
    id: "explain-same-email-diff-phone",
    question: "Why is this showing as a likely match when the phone numbers are different?",
    category: "match_explanation",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("email") &&
      (r.toLowerCase().includes("strong") || r.toLowerCase().includes("reliable")),
    description: "Email match overrides phone difference",
  },
  {
    id: "explain-same-address-diff-name",
    question: "Why are these two different names flagged as a potential match?",
    category: "match_explanation",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("address") ||
      r.toLowerCase().includes("household") ||
      r.toLowerCase().includes("phone") ||
      r.toLowerCase().includes("email"),
    description: "Shared identifiers despite name difference",
  },
  {
    id: "explain-common-name",
    question: "John Smith appears multiple times - how do I know which are the same person?",
    category: "match_explanation",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("email") ||
      r.toLowerCase().includes("phone") ||
      r.toLowerCase().includes("identifier") ||
      r.toLowerCase().includes("address"),
    description: "Handling common names",
  },
  {
    id: "explain-shared-phone",
    question:
      "Why is this phone number marked as shared? What does that mean for matching?",
    category: "match_explanation",
    difficulty: "advanced",
    expectedCapability: "partial",
    gapReason: "Soft-blacklist concept may need better documentation",
    validateResponse: (r) =>
      r.toLowerCase().includes("shared") ||
      r.toLowerCase().includes("household") ||
      r.toLowerCase().includes("multiple") ||
      r.toLowerCase().includes("careful"),
    description: "Explains soft-blacklisted identifiers",
  },
  {
    id: "explain-low-score-same-name",
    question:
      "These have the same exact name but a low match score - why?",
    category: "match_explanation",
    difficulty: "intermediate",
    expectedCapability: "works",
    validateResponse: (r) =>
      r.toLowerCase().includes("name") &&
      (r.toLowerCase().includes("not enough") ||
        r.toLowerCase().includes("email") ||
        r.toLowerCase().includes("phone") ||
        r.toLowerCase().includes("address")),
    description: "Names alone are insufficient for matching",
  },
];

// ============================================================================
// EXPORTS
// ============================================================================

export const ALL_IDENTITY_QUESTIONS: IdentityResolutionQuestion[] = [
  ...FS_SCORING_QUESTIONS,
  ...IDENTITY_GRAPH_QUESTIONS,
  ...REVIEW_WORKFLOW_QUESTIONS,
  ...MATCH_EXPLANATION_QUESTIONS,
];

export function getWorkingIdentityQuestions(): IdentityResolutionQuestion[] {
  return ALL_IDENTITY_QUESTIONS.filter((q) => q.expectedCapability === "works");
}

export function getPartialIdentityQuestions(): IdentityResolutionQuestion[] {
  return ALL_IDENTITY_QUESTIONS.filter((q) => q.expectedCapability === "partial");
}

export function getGapIdentityQuestions(): IdentityResolutionQuestion[] {
  return ALL_IDENTITY_QUESTIONS.filter((q) => q.expectedCapability === "gap");
}

export function getBasicIdentityQuestions(): IdentityResolutionQuestion[] {
  return ALL_IDENTITY_QUESTIONS.filter((q) => q.difficulty === "basic");
}
