/**
 * Staff Program Questions Fixture
 *
 * Real questions that staff would ask about foster, county, and LMFM programs.
 * These are used to test Tippy's ability to answer program-related questions.
 */

export interface StaffQuestion {
  id: string;
  question: string;
  category: "foster" | "county" | "lmfm" | "comparison" | "data_quality";
  expectedDataSources: string[];
  validateResponse: (response: string) => boolean;
  difficulty: "easy" | "medium" | "hard";
  description: string;
}

export const FOSTER_PROGRAM_QUESTIONS: StaffQuestion[] = [
  {
    id: "foster-ytd-2025",
    question: "How many foster cats have we fixed in 2025?",
    category: "foster",
    expectedDataSources: ["v_foster_program_ytd"],
    validateResponse: (r) => /\d+/.test(r) && r.toLowerCase().includes("foster"),
    difficulty: "easy",
    description: "Basic YTD foster count",
  },
  {
    id: "foster-q1-vs-q3",
    question: "Compare Q1 2025 vs Q3 2025 for the foster program",
    category: "foster",
    expectedDataSources: ["v_foster_program_stats"],
    validateResponse: (r) => {
      const text = r.toLowerCase();
      return (
        /\d+/.test(r) &&
        (text.includes("q1") || text.includes("first")) &&
        (text.includes("q3") || text.includes("third"))
      );
    },
    difficulty: "medium",
    description: "Quarterly comparison requires aggregation",
  },
  {
    id: "foster-monthly-peak",
    question: "What was our busiest month for fosters in 2025?",
    category: "foster",
    expectedDataSources: ["v_foster_program_stats"],
    validateResponse: (r) => {
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
      const text = r.toLowerCase();
      return months.some((m) => text.includes(m));
    },
    difficulty: "medium",
    description: "Identify peak month",
  },
  {
    id: "foster-parent-ranking",
    question: "Who are the top 3 foster parents by cats fostered this year?",
    category: "foster",
    expectedDataSources: ["v_foster_parent_activity"],
    validateResponse: (r) => {
      return r.toLowerCase().includes("foster") && /\d/.test(r);
    },
    difficulty: "hard",
    description: "Ranking requires person-cat relationship data",
  },
  {
    id: "foster-spay-neuter-ratio",
    question: "What's the spay vs neuter ratio for foster cats in 2025?",
    category: "foster",
    expectedDataSources: ["v_foster_program_ytd"],
    validateResponse: (r) => {
      return (
        r.toLowerCase().includes("spay") && r.toLowerCase().includes("neuter")
      );
    },
    difficulty: "medium",
    description: "Ratio calculation",
  },
];

export const COUNTY_QUESTIONS: StaffQuestion[] = [
  {
    id: "county-ytd-2025",
    question: "How many county SCAS cats have we done in 2025?",
    category: "county",
    expectedDataSources: ["v_county_cat_ytd"],
    validateResponse: (r) => {
      const text = r.toLowerCase();
      return /\d+/.test(r) && (text.includes("county") || text.includes("scas"));
    },
    difficulty: "easy",
    description: "Basic county count",
  },
  {
    id: "county-shelterluv-bridge",
    question: "How many of our SCAS cats have ShelterLuv records?",
    category: "county",
    expectedDataSources: ["v_county_cat_ytd", "v_scas_shelterluv_bridge"],
    validateResponse: (r) => {
      return /\d+/.test(r);
    },
    difficulty: "medium",
    description: "Cross-source bridge query",
  },
  {
    id: "county-monthly-trend",
    question: "Show me the monthly SCAS cat volume for 2025",
    category: "county",
    expectedDataSources: ["v_county_cat_stats"],
    validateResponse: (r) => {
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug"];
      const text = r.toLowerCase();
      return months.some((m) => text.includes(m)) && /\d+/.test(r);
    },
    difficulty: "medium",
    description: "Monthly breakdown",
  },
];

export const LMFM_QUESTIONS: StaffQuestion[] = [
  {
    id: "lmfm-ytd-2025",
    question: "How many Love Me Fix Me waiver appointments in 2025?",
    category: "lmfm",
    expectedDataSources: ["v_lmfm_stats"],
    validateResponse: (r) => {
      const text = r.toLowerCase();
      return (
        /\d+/.test(r) &&
        (text.includes("lmfm") ||
          text.includes("waiver") ||
          text.includes("love me"))
      );
    },
    difficulty: "easy",
    description: "Basic LMFM count",
  },
  {
    id: "lmfm-detection-method",
    question: "How do we identify LMFM appointments in the system?",
    category: "lmfm",
    expectedDataSources: [],
    validateResponse: (r) => {
      const text = r.toLowerCase();
      return (
        text.includes("caps") ||
        text.includes("marker") ||
        text.includes("$lmfm") ||
        text.includes("pattern")
      );
    },
    difficulty: "hard",
    description: "System knowledge question",
  },
];

export const COMPARISON_QUESTIONS: StaffQuestion[] = [
  {
    id: "program-comparison-2025",
    question:
      "Compare foster vs county vs LMFM numbers for 2025. Which is biggest?",
    category: "comparison",
    expectedDataSources: ["v_program_comparison_ytd"],
    validateResponse: (r) => {
      const text = r.toLowerCase();
      return (
        text.includes("foster") &&
        (text.includes("county") || text.includes("scas"))
      );
    },
    difficulty: "medium",
    description: "Multi-program comparison",
  },
  {
    id: "program-pct-breakdown",
    question: "What percentage of our alterations are from special programs?",
    category: "comparison",
    expectedDataSources: ["v_program_comparison_ytd"],
    validateResponse: (r) => {
      return /\d+%|\d+\s*percent/i.test(r);
    },
    difficulty: "medium",
    description: "Percentage calculation",
  },
  {
    id: "year-over-year-growth",
    question: "Has the foster program grown compared to last year?",
    category: "comparison",
    expectedDataSources: ["v_program_comparison_ytd"],
    validateResponse: (r) => {
      const text = r.toLowerCase();
      return (
        text.includes("grow") ||
        text.includes("increas") ||
        text.includes("decreas") ||
        text.includes("more") ||
        text.includes("less")
      );
    },
    difficulty: "hard",
    description: "Year-over-year trend",
  },
];

export const DATA_QUALITY_QUESTIONS: StaffQuestion[] = [
  {
    id: "missing-cat-links",
    question: "How many appointments are missing cat links?",
    category: "data_quality",
    expectedDataSources: [],
    validateResponse: (r) => /\d+/.test(r),
    difficulty: "medium",
    description: "Data quality check",
  },
  {
    id: "categorization-accuracy",
    question:
      "Are there any appointments that might be miscategorized as regular when they should be foster or SCAS?",
    category: "data_quality",
    expectedDataSources: [],
    validateResponse: (r) => {
      const text = r.toLowerCase();
      return (
        text.includes("check") ||
        text.includes("review") ||
        text.includes("found") ||
        text.includes("none")
      );
    },
    difficulty: "hard",
    description: "Categorization audit",
  },
];

export const ALL_STAFF_QUESTIONS: StaffQuestion[] = [
  ...FOSTER_PROGRAM_QUESTIONS,
  ...COUNTY_QUESTIONS,
  ...LMFM_QUESTIONS,
  ...COMPARISON_QUESTIONS,
  ...DATA_QUALITY_QUESTIONS,
];

// Questions grouped by difficulty for staged testing
export const EASY_QUESTIONS = ALL_STAFF_QUESTIONS.filter(
  (q) => q.difficulty === "easy"
);
export const MEDIUM_QUESTIONS = ALL_STAFF_QUESTIONS.filter(
  (q) => q.difficulty === "medium"
);
export const HARD_QUESTIONS = ALL_STAFF_QUESTIONS.filter(
  (q) => q.difficulty === "hard"
);
