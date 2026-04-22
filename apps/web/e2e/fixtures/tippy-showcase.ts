/**
 * Tippy Showcase Questions & Story-Style Validation
 *
 * These questions are designed for board presentations and demonstrate
 * Tippy's expert reasoning capabilities. Each validates:
 * 1. Correct tool selection
 * 2. Story-like response format
 * 3. Data quality awareness (caveats when appropriate)
 * 4. Mission connection
 *
 * @see /docs/TIPPY_SHOWCASE_QUESTIONS.md for expected responses
 * @see /docs/TIPPY_ARCHITECTURE.md for design principles
 */

export interface ShowcaseQuestion {
  id: string;
  question: string;
  category: "impact" | "success" | "priority" | "geographic" | "transparency" | "strategic";
  expectedTools: string[];
  /**
   * Patterns that SHOULD appear in a good response.
   * Story-like responses explain meaning, not just report numbers.
   */
  shouldInclude: RegExp[];
  /**
   * Patterns that should NOT appear - these indicate poor responses.
   */
  shouldNotInclude: RegExp[];
  /**
   * If true, response should include data quality caveats
   */
  requiresCaveats?: boolean;
  /**
   * Description of what makes a good response
   */
  idealResponseTraits: string[];
}

// =============================================================================
// IMPACT & OVERVIEW QUESTIONS
// =============================================================================

export const IMPACT_QUESTIONS: ShowcaseQuestion[] = [
  {
    id: "impact-total-cats",
    question: "How many cats has FFSC helped, and what's our overall alteration rate?",
    category: "impact",
    expectedTools: ["area_stats"],
    shouldInclude: [
      /\d{2,},?\d{3}/,                    // Large number with commas
      /84|85|percent|%/i,                  // Alteration rate
      /70.*threshold|stabiliz/i,           // Context about 70% threshold
    ],
    shouldNotInclude: [
      /I don't have/i,
      /I cannot/i,
      /no data/i,
    ],
    idealResponseTraits: [
      "Mentions specific count (42,000+)",
      "Explains 84% is above 70% threshold",
      "Connects to population stabilization",
      "Shows pride in FFSC impact",
    ],
  },
  {
    id: "impact-city-comparison",
    question: "Which city in Sonoma County has the most cats in our system?",
    category: "impact",
    expectedTools: ["area_stats", "run_sql"],
    shouldInclude: [
      /santa rosa/i,
      /\d{1,2},?\d{3}/,                    // Thousands of cats
      /petaluma|sebastopol/i,              // Mentions other cities
    ],
    shouldNotInclude: [
      /I don't have/i,
    ],
    idealResponseTraits: [
      "Ranks cities by cat count",
      "Notes Santa Rosa is population center",
      "Mentions good alteration rates despite volume",
    ],
  },
];

// =============================================================================
// SUCCESS STORY QUESTIONS
// =============================================================================

export const SUCCESS_QUESTIONS: ShowcaseQuestion[] = [
  {
    id: "success-scenic",
    question: "Tell me about 175 Scenic Avenue in Santa Rosa",
    category: "success",
    expectedTools: ["full_place_briefing", "place_search"],
    shouldInclude: [
      /164|165|16\d.*cats/i,               // Cat count
      /94|95.*%|percent/i,                 // High alteration rate
      /success|stabiliz|under control/i,   // Positive framing
    ],
    shouldNotInclude: [
      /no data|not found/i,
    ],
    idealResponseTraits: [
      "Tells the story of the colony",
      "Explains 94% means stabilized",
      "Notes dedicated caretaker involvement",
      "Uses 'success story' framing",
    ],
  },
  {
    id: "success-pozzan",
    question: "What happened at 15760 Pozzan Road in Healdsburg?",
    category: "success",
    expectedTools: ["full_place_briefing", "place_search"],
    shouldInclude: [
      /24.*cats|cats.*24/i,                // Cat count
      /one day|single day|mass trapping/i, // Efficiency
      /january|jan|2026/i,                 // Recent
      /emily west|success/i,               // Person or positive framing
    ],
    shouldNotInclude: [],
    idealResponseTraits: [
      "Mentions Emily West by name",
      "Highlights efficiency (24 in one day)",
      "Explains what mass trapping achieves",
      "Shows coordinated TNR in action",
    ],
  },
  {
    id: "success-mass-trapping",
    question: "Show me our biggest mass trapping events",
    category: "success",
    expectedTools: ["run_sql", "full_place_briefing"],
    shouldInclude: [
      /\d{2}.*cats.*day|cats.*one day/i,   // Cats per day
      /empire|pozzan|tomales/i,            // Known locations
    ],
    shouldNotInclude: [],
    idealResponseTraits: [
      "Lists top 3+ events",
      "Explains significance of mass trapping",
      "Notes the efficiency gains",
    ],
  },
];

// =============================================================================
// PRIORITY & ATTENTION QUESTIONS
// =============================================================================

export const PRIORITY_QUESTIONS: ShowcaseQuestion[] = [
  {
    id: "priority-attention",
    question: "What location needs the most attention right now?",
    category: "priority",
    expectedTools: ["run_sql", "full_place_briefing"],
    shouldInclude: [
      /annapolis|armstrong|request/i,      // Active requests
      /reported.*verified|untrapped/i,     // Gap reasoning
    ],
    shouldNotInclude: [],
    requiresCaveats: true,
    idealResponseTraits: [
      "Focuses on active requests with untrapped potential",
      "If mentions low rates, checks for NULL status",
      "Explains reasoning for prioritization",
      "Distinguishes data gaps from real priorities",
    ],
  },
  {
    id: "priority-untrapped",
    question: "Are there any active requests where we know there are more cats than we've trapped?",
    category: "priority",
    expectedTools: ["run_sql", "request_stats"],
    shouldInclude: [
      /annapolis|armstrong/i,              // Known locations
      /reported|estimated/i,               // What was reported
      /verified|processed|trapped/i,       // What we've done
      /\d+.*cats/i,                        // Specific numbers
    ],
    shouldNotInclude: [],
    idealResponseTraits: [
      "Shows reported vs verified gap",
      "Identifies clear priorities",
      "Explains why this gap matters",
    ],
  },
  {
    id: "priority-low-rate",
    question: "What locations have less than 70% alteration rate?",
    category: "priority",
    expectedTools: ["run_sql", "full_place_briefing"],
    shouldInclude: [
      /70.*threshold|below.*70/i,          // Threshold reference
    ],
    shouldNotInclude: [],
    requiresCaveats: true,
    idealResponseTraits: [
      "Distinguishes NULL (unknown) from intact (confirmed)",
      "Warns about data quality for suspicious rates",
      "Recommends checking individual records for low rates",
      "Prioritizes active requests over data gaps",
    ],
  },
];

// =============================================================================
// GEOGRAPHIC QUESTIONS
// =============================================================================

export const GEOGRAPHIC_QUESTIONS: ShowcaseQuestion[] = [
  {
    id: "geo-roseland",
    question: "What's the situation in the Roseland area - zip code 95407?",
    category: "geographic",
    expectedTools: ["area_stats", "run_sql"],
    shouldInclude: [
      /1,?0\d{2}.*places|places.*1,?0\d{2}/i,  // ~1000 places
      /5,?\d{3}.*cats|cats.*5,?\d{3}/i,        // ~5000 cats
      /density|high|working.?class/i,           // Context
    ],
    shouldNotInclude: [],
    idealResponseTraits: [
      "Notes high density",
      "Mentions community context",
      "Shows FFSC's impact in underserved areas",
    ],
  },
  {
    id: "geo-comparison",
    question: "Compare Santa Rosa and Petaluma - where are we doing better?",
    category: "geographic",
    expectedTools: ["area_stats", "run_sql"],
    shouldInclude: [
      /santa rosa/i,
      /petaluma/i,
      /90|9\d.*%|percent/i,                // High rates
      /both|similar|great/i,               // Comparison language
    ],
    shouldNotInclude: [],
    idealResponseTraits: [
      "Shows both cities performing well",
      "Notes volume difference",
      "Explains model scales well",
    ],
  },
];

// =============================================================================
// TRANSPARENCY & DATA QUALITY QUESTIONS
// =============================================================================

export const TRANSPARENCY_QUESTIONS: ShowcaseQuestion[] = [
  {
    id: "trans-unknown",
    question: "What don't we know about the cat population in Sonoma County?",
    category: "transparency",
    expectedTools: ["run_sql"],
    shouldInclude: [
      /only know|through.*clinic|reported/i,   // Limitation
      /rural|unreported|outreach/i,            // Gaps
      /minimum|actual.*higher/i,               // Framing
    ],
    shouldNotInclude: [],
    idealResponseTraits: [
      "Acknowledges limitations honestly",
      "Explains we only know verified data",
      "Notes geographic and outreach gaps",
      "Uses 'minimum bounds' framing",
    ],
  },
  {
    id: "trans-discrepancy",
    question: "Why might our numbers be different from what a caretaker reports?",
    category: "transparency",
    expectedTools: [],
    shouldInclude: [
      /clinic|verified/i,                      // Our data source
      /food bowl|see|observe/i,                // Caretaker view
      /gap|remaining|work/i,                   // The difference
    ],
    shouldNotInclude: [
      /wrong|incorrect|lying/i,                // Don't blame caretaker
    ],
    idealResponseTraits: [
      "Explains both perspectives are valid",
      "Notes they measure different things",
      "Frames gap as 'work remaining'",
    ],
  },
  {
    id: "trans-gaps",
    question: "Are there areas where we probably have cats but no data?",
    category: "transparency",
    expectedTools: ["run_sql", "area_stats"],
    shouldInclude: [
      /rural|wealth|agricultural|private/i,    // Gap areas
      /outreach|awareness/i,                   // Solution hint
    ],
    shouldNotInclude: [],
    idealResponseTraits: [
      "Identifies likely underserved areas",
      "Notes low data != low cats",
      "Suggests outreach opportunity",
    ],
  },
];

// =============================================================================
// STRATEGIC QUESTIONS
// =============================================================================

export const STRATEGIC_QUESTIONS: ShowcaseQuestion[] = [
  {
    id: "strategic-priority",
    question: "Based on our data, what should FFSC prioritize to have the biggest impact?",
    category: "strategic",
    expectedTools: ["run_sql", "request_stats", "area_stats"],
    shouldInclude: [
      /active request|untrapped/i,             // Priority 1
      /recent activity|follow.?up/i,           // Priority 2
      /data gap|verify|caution/i,              // Caveat
    ],
    shouldNotInclude: [],
    requiresCaveats: true,
    idealResponseTraits: [
      "Lists 2-3 concrete priorities",
      "Warns about chasing data gaps",
      "Focuses on real impact, not statistics",
      "Connects to mission",
    ],
  },
  {
    id: "strategic-resources",
    question: "If we had limited trapping resources next month, where should we focus?",
    category: "strategic",
    expectedTools: ["run_sql", "request_stats"],
    shouldInclude: [
      /annapolis|armstrong|request/i,          // Active requests
      /gap|reported|verified/i,                // Evidence-based
    ],
    shouldNotInclude: [],
    requiresCaveats: true,
    idealResponseTraits: [
      "Focuses on places with someone ready to help",
      "Prioritizes evidence over statistics",
      "Mentions logistics consideration",
    ],
  },
];

// =============================================================================
// ALL SHOWCASE QUESTIONS
// =============================================================================

export const ALL_SHOWCASE_QUESTIONS: ShowcaseQuestion[] = [
  ...IMPACT_QUESTIONS,
  ...SUCCESS_QUESTIONS,
  ...PRIORITY_QUESTIONS,
  ...GEOGRAPHIC_QUESTIONS,
  ...TRANSPARENCY_QUESTIONS,
  ...STRATEGIC_QUESTIONS,
];

// =============================================================================
// QUICK DEMO SET (5 questions for time-limited presentations)
// =============================================================================

export const QUICK_DEMO_QUESTIONS: ShowcaseQuestion[] = [
  ALL_SHOWCASE_QUESTIONS.find(q => q.id === "impact-total-cats")!,
  ALL_SHOWCASE_QUESTIONS.find(q => q.id === "success-pozzan")!,
  ALL_SHOWCASE_QUESTIONS.find(q => q.id === "priority-attention")!,
  ALL_SHOWCASE_QUESTIONS.find(q => q.id === "geo-roseland")!,
  ALL_SHOWCASE_QUESTIONS.find(q => q.id === "strategic-priority")!,
];

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate a response against showcase question expectations.
 * Returns a score and list of issues.
 */
export function validateShowcaseResponse(
  question: ShowcaseQuestion,
  response: string
): {
  score: number;
  maxScore: number;
  passed: boolean;
  issues: string[];
  strengths: string[];
} {
  const issues: string[] = [];
  const strengths: string[] = [];
  let score = 0;
  const maxScore = question.shouldInclude.length + question.shouldNotInclude.length + (question.requiresCaveats ? 1 : 0);

  // Check required patterns
  for (const pattern of question.shouldInclude) {
    if (pattern.test(response)) {
      score++;
      strengths.push(`Includes: ${pattern.source.slice(0, 30)}...`);
    } else {
      issues.push(`Missing: ${pattern.source.slice(0, 30)}...`);
    }
  }

  // Check forbidden patterns
  for (const pattern of question.shouldNotInclude) {
    if (!pattern.test(response)) {
      score++;
    } else {
      issues.push(`Should not include: ${pattern.source}`);
    }
  }

  // Check caveats if required
  if (question.requiresCaveats) {
    const hasCaveat = /caveat|should note|should mention|data.*gap|NULL|unknown.*status/i.test(response);
    if (hasCaveat) {
      score++;
      strengths.push("Includes appropriate caveat");
    } else {
      issues.push("Missing data quality caveat");
    }
  }

  return {
    score,
    maxScore,
    passed: score >= maxScore * 0.7,  // 70% threshold
    issues,
    strengths,
  };
}

/**
 * Get questions by category.
 */
export function getShowcaseByCategory(category: ShowcaseQuestion["category"]): ShowcaseQuestion[] {
  return ALL_SHOWCASE_QUESTIONS.filter(q => q.category === category);
}

/**
 * Get questions that require caveats.
 */
export function getQuestionsRequiringCaveats(): ShowcaseQuestion[] {
  return ALL_SHOWCASE_QUESTIONS.filter(q => q.requiresCaveats);
}
