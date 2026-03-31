/**
 * Kiosk Help Form — Indirect Question System + Scoring Engine
 *
 * Public visitors answer behavioral questions (where does the cat sleep,
 * can you pick it up, etc.) instead of self-reporting "is this your pet?"
 * which is gameable for free spay/neuter.
 *
 * Each answer option carries per-type score weights. The scoring engine
 * sums across all answers and classifies the situation by highest score.
 *
 * Questions are admin-editable via /admin/kiosk. When `kiosk.help_questions`
 * config is null, these defaults are used.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type SituationType =
  | "community_cat"
  | "pet_cat"
  | "colony"
  | "kitten"
  | "medical";

export const SITUATION_LABELS: Record<SituationType, string> = {
  community_cat: "Community Cat",
  pet_cat: "Pet Cat",
  colony: "Colony / Multiple Cats",
  kitten: "Kitten Situation",
  medical: "Medical / Injured",
};

export const SITUATION_DESCRIPTIONS: Record<SituationType, string> = {
  community_cat: "This sounds like a community cat that lives outdoors. We can help get it fixed through our TNR program.",
  pet_cat: "This sounds like a pet cat. We can help with low-cost spay/neuter.",
  colony: "This sounds like a colony of outdoor cats. We'll connect you with a trapper to help get them fixed.",
  kitten: "Kittens need special attention. We'll get back to you about fostering or TNR options.",
  medical: "A cat may need medical attention. We'll follow up as soon as possible.",
};

/** Maps classification → intake call_type for the submission */
export const SITUATION_TO_CALL_TYPE: Record<SituationType, string> = {
  community_cat: "single_stray",
  pet_cat: "pet_spay_neuter",
  colony: "colony_tnr",
  kitten: "kitten_rescue",
  medical: "medical_concern",
};

export interface QuestionOption {
  value: string;
  label: string;
  icon?: string;
  scores: Record<SituationType, number>;
}

export interface IndirectQuestion {
  id: string;
  text: string;
  help_text?: string;
  options: QuestionOption[];
  display_order: number;
  is_required: boolean;
}

export interface ScoringResult {
  classification: SituationType;
  scores: Record<SituationType, number>;
  confidence: number;
  handleability: string;
}

// ── Default Questions ──────────────────────────────────────────────────────────

export const DEFAULT_QUESTIONS: IndirectQuestion[] = [
  {
    id: "q_sleeping",
    text: "Where does this cat sleep at night?",
    help_text: "Think about where the cat usually is after dark.",
    options: [
      {
        value: "inside_home",
        label: "Inside my home",
        icon: "home",
        scores: { pet_cat: 3, community_cat: 0, colony: 0, kitten: 0, medical: 0 },
      },
      {
        value: "porch_garage",
        label: "On my porch or in my garage",
        icon: "building",
        scores: { pet_cat: 1, community_cat: 2, colony: 0, kitten: 0, medical: 0 },
      },
      {
        value: "outside",
        label: "Outside / I don't know",
        icon: "map",
        scores: { pet_cat: 0, community_cat: 3, colony: 1, kitten: 0, medical: 0 },
      },
    ],
    display_order: 1,
    is_required: true,
  },
  {
    id: "q_feeding",
    text: "Where do you feed this cat?",
    help_text: "If you feed the cat, where does it eat?",
    options: [
      {
        value: "inside",
        label: "Inside my home",
        icon: "home",
        scores: { pet_cat: 3, community_cat: 0, colony: 0, kitten: 0, medical: 0 },
      },
      {
        value: "porch",
        label: "On my porch or deck",
        icon: "building",
        scores: { pet_cat: 1, community_cat: 2, colony: 1, kitten: 0, medical: 0 },
      },
      {
        value: "outside",
        label: "Outside / somewhere else",
        icon: "map-pin",
        scores: { pet_cat: 0, community_cat: 2, colony: 2, kitten: 0, medical: 0 },
      },
      {
        value: "not_feeding",
        label: "I don't feed this cat",
        icon: "x",
        scores: { pet_cat: 0, community_cat: 2, colony: 1, kitten: 0, medical: 0 },
      },
    ],
    display_order: 2,
    is_required: true,
  },
  {
    id: "q_handleable",
    text: "Can you pick up this cat?",
    help_text: "Could you safely put this cat in a carrier?",
    options: [
      {
        value: "yes_friendly",
        label: "Yes, it's friendly and I can handle it",
        icon: "heart",
        scores: { pet_cat: 2, community_cat: 1, colony: 0, kitten: 1, medical: 0 },
      },
      {
        value: "maybe",
        label: "Maybe — it's shy but approachable",
        icon: "help-circle",
        scores: { pet_cat: 1, community_cat: 2, colony: 0, kitten: 0, medical: 0 },
      },
      {
        value: "no",
        label: "No — it runs away when I get close",
        icon: "alert-triangle",
        scores: { pet_cat: 0, community_cat: 2, colony: 2, kitten: 0, medical: 0 },
      },
    ],
    display_order: 3,
    is_required: true,
  },
  {
    id: "q_duration",
    text: "How long have you known this cat?",
    help_text: "How long has this cat been around?",
    options: [
      {
        value: "years",
        label: "Years — it's been around a long time",
        icon: "calendar",
        scores: { pet_cat: 2, community_cat: 1, colony: 1, kitten: 0, medical: 0 },
      },
      {
        value: "months",
        label: "A few months",
        icon: "clock",
        scores: { pet_cat: 1, community_cat: 2, colony: 1, kitten: 0, medical: 0 },
      },
      {
        value: "recent",
        label: "Just showed up recently",
        icon: "zap",
        scores: { pet_cat: 0, community_cat: 3, colony: 0, kitten: 1, medical: 0 },
      },
    ],
    display_order: 4,
    is_required: true,
  },
  {
    id: "q_vet",
    text: "Has this cat been to a vet?",
    help_text: "Has it ever received veterinary care that you know of?",
    options: [
      {
        value: "regular",
        label: "Yes, it sees a vet regularly",
        icon: "heart-pulse",
        scores: { pet_cat: 3, community_cat: 0, colony: 0, kitten: 0, medical: 0 },
      },
      {
        value: "once",
        label: "Once or twice",
        icon: "check",
        scores: { pet_cat: 2, community_cat: 1, colony: 0, kitten: 0, medical: 0 },
      },
      {
        value: "never",
        label: "No / I don't think so",
        icon: "x",
        scores: { pet_cat: 0, community_cat: 2, colony: 2, kitten: 0, medical: 0 },
      },
    ],
    display_order: 5,
    is_required: true,
  },
  {
    id: "q_count",
    text: "How many cats are you seeing?",
    help_text: "Total cats in this area, not just the ones you want help with.",
    options: [
      {
        value: "one",
        label: "Just 1 cat",
        icon: "cat",
        scores: { pet_cat: 1, community_cat: 2, colony: 0, kitten: 0, medical: 0 },
      },
      {
        value: "few",
        label: "2–5 cats",
        icon: "users",
        scores: { pet_cat: 0, community_cat: 1, colony: 2, kitten: 0, medical: 0 },
      },
      {
        value: "many",
        label: "6 or more cats",
        icon: "users",
        scores: { pet_cat: 0, community_cat: 0, colony: 4, kitten: 0, medical: 0 },
      },
    ],
    display_order: 6,
    is_required: true,
  },
  {
    id: "q_kittens",
    text: "Are there kittens?",
    help_text: "Kittens are cats under about 6 months old — small, playful, squeaky.",
    options: [
      {
        value: "yes",
        label: "Yes, there are kittens",
        icon: "baby",
        scores: { pet_cat: 0, community_cat: 0, colony: 0, kitten: 4, medical: 0 },
      },
      {
        value: "maybe",
        label: "I think so / not sure",
        icon: "help-circle",
        scores: { pet_cat: 0, community_cat: 0, colony: 0, kitten: 2, medical: 0 },
      },
      {
        value: "no",
        label: "No kittens",
        icon: "check",
        scores: { pet_cat: 0, community_cat: 0, colony: 0, kitten: 0, medical: 0 },
      },
    ],
    display_order: 7,
    is_required: true,
  },
  {
    id: "q_medical",
    text: "Does a cat appear injured or sick?",
    help_text: "Limping, visible wounds, discharge from eyes/nose, lethargy.",
    options: [
      {
        value: "yes",
        label: "Yes, a cat looks injured or sick",
        icon: "alert-circle",
        scores: { pet_cat: 0, community_cat: 0, colony: 0, kitten: 0, medical: 4 },
      },
      {
        value: "maybe",
        label: "I'm not sure",
        icon: "help-circle",
        scores: { pet_cat: 0, community_cat: 0, colony: 0, kitten: 0, medical: 2 },
      },
      {
        value: "no",
        label: "No, cats seem healthy",
        icon: "check",
        scores: { pet_cat: 0, community_cat: 0, colony: 0, kitten: 0, medical: 0 },
      },
    ],
    display_order: 8,
    is_required: true,
  },
];

// ── Scoring Engine ─────────────────────────────────────────────────────────────

const SITUATION_TYPES: SituationType[] = [
  "community_cat",
  "pet_cat",
  "colony",
  "kitten",
  "medical",
];

/**
 * Score all answers against the question weights and classify the situation.
 *
 * @param answers - Map of question ID → selected option value
 * @param questions - The question set (defaults to DEFAULT_QUESTIONS)
 * @returns classification, raw scores, confidence, and handleability
 */
export function scoreAnswers(
  answers: Record<string, string>,
  questions: IndirectQuestion[] = DEFAULT_QUESTIONS,
): ScoringResult {
  // Sum scores across all answered questions
  const totals: Record<SituationType, number> = {
    community_cat: 0,
    pet_cat: 0,
    colony: 0,
    kitten: 0,
    medical: 0,
  };

  for (const question of questions) {
    const selectedValue = answers[question.id];
    if (!selectedValue) continue;

    const option = question.options.find((o) => o.value === selectedValue);
    if (!option) continue;

    for (const type of SITUATION_TYPES) {
      totals[type] += option.scores[type] ?? 0;
    }
  }

  // Find top classification
  let topType: SituationType = "community_cat";
  let topScore = -1;
  let secondScore = -1;

  for (const type of SITUATION_TYPES) {
    if (totals[type] > topScore) {
      secondScore = topScore;
      topScore = totals[type];
      topType = type;
    } else if (totals[type] > secondScore) {
      secondScore = totals[type];
    }
  }

  // Confidence: how far ahead is the top score?
  // 0 = tied, 1 = completely dominant
  const maxPossible = Math.max(topScore, 1);
  const spread = topScore - Math.max(secondScore, 0);
  const confidence = Math.min(spread / maxPossible, 1);

  // Derive handleability from the handleable question
  let handleability = "unknown";
  const handleAnswer = answers["q_handleable"];
  if (handleAnswer === "yes_friendly") handleability = "friendly_carrier";
  else if (handleAnswer === "maybe") handleability = "shy_handleable";
  else if (handleAnswer === "no") handleability = "unhandleable_trap";

  return {
    classification: topType,
    scores: totals,
    confidence,
    handleability,
  };
}
