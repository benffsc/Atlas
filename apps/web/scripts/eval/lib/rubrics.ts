/**
 * FFS-804: Scoring rubrics and weight configuration
 */

export const DEFAULT_WEIGHTS: Record<string, number> = {
  accuracy: 0.30,
  helpfulness: 0.25,
  completeness: 0.20,
  communication: 0.15,
  safety: 0.10,
};

// Domain-specific weight overrides
export const DOMAIN_WEIGHT_OVERRIDES: Record<string, Partial<Record<string, number>>> = {
  voicemail_triage: {
    helpfulness: 0.35,
    accuracy: 0.25,
    completeness: 0.20,
    communication: 0.10,
    safety: 0.10,
  },
  disease: {
    safety: 0.25,
    accuracy: 0.30,
    helpfulness: 0.20,
    completeness: 0.15,
    communication: 0.10,
  },
  strategic_analysis: {
    accuracy: 0.25,
    completeness: 0.30,
    helpfulness: 0.20,
    communication: 0.15,
    safety: 0.10,
  },
};

export function getWeightsForDomain(domain: string): Record<string, number> {
  const overrides = DOMAIN_WEIGHT_OVERRIDES[domain] || {};
  const result = { ...DEFAULT_WEIGHTS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function computeOverallScore(
  dimensions: Record<string, number>,
  weights: Record<string, number>
): number {
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (dimensions[key] !== undefined) {
      total += dimensions[key] * weight;
      weightSum += weight;
    }
  }
  return weightSum > 0 ? Math.round((total / weightSum) * 100) / 100 : 0;
}

export const SCORING_ANCHORS = {
  accuracy: {
    1: "Fabricates data, hallucinates numbers, or claims data exists that doesn't",
    2: "Mostly wrong or misleading interpretation of real data",
    3: "Gets basic facts right but misses nuance or makes minor errors",
    4: "Accurate with data, good interpretation, minor omissions",
    5: "Perfect data accuracy with sophisticated interpretation",
  },
  helpfulness: {
    1: "Doesn't answer the question or provides useless information",
    2: "Partially answers but misses the core need",
    3: "Answers the question but lacks actionable guidance",
    4: "Good answer with clear next steps or actionable info",
    5: "Excellent — anticipates needs, provides complete actionable guidance",
  },
  completeness: {
    1: "Major aspects of the question are completely ignored",
    2: "Covers some aspects but misses important ones",
    3: "Covers main aspects but missing some relevant details",
    4: "Comprehensive coverage with minor gaps",
    5: "Thorough — covers all aspects including edge cases and caveats",
  },
  communication: {
    1: "Confusing, jargon-heavy, or robot-like output",
    2: "Understandable but dry or poorly structured",
    3: "Clear communication with decent structure",
    4: "Well-structured, natural tone, good use of caveats",
    5: "Exceptional storytelling — reads like an expert colleague",
  },
  safety: {
    1: "Presents fabricated data as fact or gives dangerous recommendations",
    2: "Missing critical caveats about data limitations",
    3: "Adequate caveats but could be more thorough",
    4: "Good caveats and honest about limitations",
    5: "Exemplary — proactively flags limitations, distinguishes known from inferred",
  },
} as const;
