/**
 * Canonical Question Registry (FFS-91)
 *
 * Maps each question category to its single canonical owner file.
 * When adding new Tippy E2E tests, check this registry first to avoid
 * duplicate API calls across test files.
 *
 * If a question fits multiple categories, it belongs in the FIRST matching
 * owner file. If you need the same question in two files, mock it in the
 * non-canonical file.
 */

export const CANONICAL_OWNERS = {
  // --- Accuracy & Counts ---
  "cat-people-place-counts": {
    owner: "tippy-accuracy-verification.spec.ts",
    examples: [
      "How many cats are in our system?",
      "How many people total?",
      "How many places do we track?",
    ],
  },
  "alteration-rates": {
    owner: "tippy-accuracy-verification.spec.ts",
    examples: [
      "What is the overall alteration rate?",
      "Alteration rate in Santa Rosa?",
    ],
  },

  // --- Core Capabilities ---
  "top-trappers-rankings": {
    owner: "tippy-capabilities.spec.ts",
    examples: [
      "Who are our top trappers?",
      "Top 5 trappers by total cats?",
    ],
  },
  "comprehensive-lookups": {
    owner: "tippy-capabilities.spec.ts",
    examples: [
      "Tell me everything about this person",
      "Comprehensive place lookup",
      "Trace a cat's full journey",
    ],
  },
  "merge-history": {
    owner: "tippy-capabilities.spec.ts",
    examples: [
      "Show merge history for merged records",
      "Can query merge history",
    ],
  },

  // --- Human-Style Questions ---
  "colony-status-at-address": {
    owner: "tippy-human-questions.spec.ts",
    examples: [
      "Colony status at [address]",
      "What's the situation at [address]?",
      "Cats at [address]?",
    ],
  },

  // --- Program Stats ---
  "foster-program-stats": {
    owner: "tippy-complex-queries.spec.ts",
    examples: [
      "How many foster cats in 2025?",
      "Foster program YTD stats",
      "SCAS cats this year",
    ],
  },

  // --- Cross-Source Deductions ---
  "cross-source-deductions": {
    owner: "tippy-cross-source.spec.ts",
    examples: [
      "Person volunteer + trapper detection",
      "Cat journey across ShelterLuv + ClinicHQ",
      "Place activity from multiple sources",
    ],
  },
  "data-quality-checks": {
    owner: "tippy-cross-source.spec.ts",
    examples: [
      "Check data quality for person",
      "Find potential duplicates",
      "Query data lineage",
    ],
  },

  // --- Identity Resolution ---
  "identity-resolution": {
    owner: "tippy-identity-resolution.spec.ts",
    examples: [
      "How does identity matching work?",
      "Fellegi-Sunter scoring",
      "Identity graph explanations",
      "Review workflow for duplicates",
    ],
  },

  // --- Performance ---
  "performance-benchmarks": {
    owner: "tippy-performance.spec.ts",
    examples: [
      "Response time benchmarks",
      "Sustained load testing",
      "Concurrent request handling",
    ],
  },

  // --- Staff Workflows ---
  "staff-workflows": {
    owner: "tippy-staff-workflows.spec.ts",
    examples: [
      "Staff program questions (easy/medium/hard)",
      "Response quality checks",
      "Edge cases (future dates, ambiguous names)",
    ],
  },
} as const;

export type QuestionCategory = keyof typeof CANONICAL_OWNERS;

/**
 * Look up which file owns a question category.
 * Use this when deciding where to add a new test.
 */
export function getCanonicalOwner(category: QuestionCategory): string {
  return CANONICAL_OWNERS[category].owner;
}

/**
 * Get all categories owned by a specific file.
 * Useful for auditing what a file is responsible for.
 */
export function getCategoriesForFile(filename: string): QuestionCategory[] {
  return (Object.entries(CANONICAL_OWNERS) as [QuestionCategory, { owner: string }][])
    .filter(([, v]) => v.owner === filename)
    .map(([k]) => k);
}
