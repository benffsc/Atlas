/**
 * Tippy Branching Decision Tree — Types, Default Tree, Traversal Engine
 *
 * Replaces the linear scored question system with a branching tree.
 * The first answer determines the path (colony, emergency, pet, kitten, general).
 * Terminal nodes carry outcome data with resource cards and intake flags.
 *
 * FFS-1061, FFS-1062, FFS-1064, FFS-1065
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TippyOption {
  value: string;
  label: string;
  icon?: string;
  next_node_id: string | null; // null = parent node has terminal outcome
}

export interface TippyResourceCard {
  name: string;
  description: string;
  phone?: string;
  address?: string;
  hours?: string;
  icon: string;
  urgency?: "emergency" | "soon" | "info";
}

export type TippyOutcomeType =
  | "ffsc_ffr"
  | "emergency_vet"
  | "pet_spay_redirect"
  | "kitten_intake"
  | "general_info"
  | "hybrid";

export interface TippyOutcome {
  type: TippyOutcomeType;
  headline: string;
  subtext: string;
  icon: string;
  resources: TippyResourceCard[];
  creates_intake: boolean;
  intake_overrides?: {
    call_type?: string;
    has_kittens?: boolean;
    has_medical_concerns?: boolean;
  };
}

export interface TippyNode {
  id: string;
  tippy_text: string;
  help_text?: string;
  options: TippyOption[];
  outcome?: TippyOutcome;
  branch: string;
  max_depth?: number; // set on entry nodes for progress bar
}

export type TippyTree = Record<string, TippyNode>;

export interface TippyState {
  /** Stack of { nodeId, selectedValue } for back navigation */
  history: Array<{ node_id: string; value: string }>;
  /** Current node ID */
  current_node_id: string;
  /** Resolved outcome (set when a terminal option is selected) */
  outcome: TippyOutcome | null;
}

// ── Resource Card Data ─────────────────────────────────────────────────────────

const FFSC_CARD: TippyResourceCard = {
  name: "Forgotten Felines of Sonoma County",
  description: "Free spay/neuter for community cats through our Find Fix Return program.",
  phone: "(707) 576-7999",
  address: "1814 Empire Industrial Ct, Santa Rosa",
  icon: "heart",
  urgency: "info",
};

const VCA_PETCARE_CARD: TippyResourceCard = {
  name: "VCA PetCare East (24/7 Emergency)",
  description: "24-hour emergency veterinary hospital.",
  phone: "(707) 579-3900",
  address: "2425 Mendocino Ave, Santa Rosa",
  hours: "Open 24/7",
  icon: "siren",
  urgency: "emergency",
};

const TRUVET_CARD: TippyResourceCard = {
  name: "TruVet Emergency (24/7)",
  description: "24-hour emergency and specialty hospital.",
  phone: "(707) 787-5340",
  address: "2620 Lakeville Hwy, Petaluma",
  hours: "Open 24/7",
  icon: "siren",
  urgency: "emergency",
};

const SONOMA_HUMANE_CARD: TippyResourceCard = {
  name: "Sonoma Humane Society",
  description: "Low-cost spay/neuter for owned pets.",
  phone: "(707) 284-3499",
  icon: "heart-handshake",
  urgency: "info",
};

const LOVE_ME_FIX_ME_CARD: TippyResourceCard = {
  name: "Love Me Fix Me",
  description: "Sonoma County's low-cost spay/neuter voucher program for pet owners.",
  phone: "(707) 565-7100",
  icon: "heart-pulse",
  urgency: "info",
};

// ── Default Tree ───────────────────────────────────────────────────────────────

export const DEFAULT_TIPPY_TREE: TippyTree = {
  // ── ROOT ──
  root: {
    id: "root",
    tippy_text: "Which best describes your situation?",
    help_text: "Pick the one that's closest — we'll ask a few follow-ups.",
    branch: "root",
    options: [
      { value: "colony", label: "Stray or outdoor cats near me", icon: "map-pin", next_node_id: "a_count" },
      { value: "emergency", label: "A cat looks hurt or sick", icon: "alert-circle", next_node_id: "b_symptoms" },
      { value: "pet", label: "Get my own cat fixed", icon: "home", next_node_id: "c_indoor" },
      { value: "kittens", label: "I found kittens", icon: "baby", next_node_id: "d_age" },
      { value: "general", label: "Something else / just have a question", icon: "help-circle", next_node_id: null },
    ],
    outcome: {
      type: "general_info",
      headline: "We can help!",
      subtext: "Give us a call or leave your info and we'll get back to you.",
      icon: "phone",
      resources: [FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "general_inquiry" },
    },
  },

  // ── BRANCH A: Colony / Stray ──

  a_count: {
    id: "a_count",
    tippy_text: "How many cats are you seeing?",
    help_text: "Your best guess — it doesn't have to be exact.",
    branch: "colony",
    max_depth: 4,
    options: [
      { value: "one", label: "Just 1 cat", icon: "cat", next_node_id: "a_eartip" },
      { value: "few", label: "2–5 cats", icon: "users", next_node_id: "a_eartip" },
      { value: "many", label: "6 or more", icon: "users", next_node_id: "a_eartip" },
    ],
  },

  a_eartip: {
    id: "a_eartip",
    tippy_text: "Do any of the cats have a tipped left ear?",
    help_text: "An ear tip (flat cut on the left ear) means the cat has already been fixed.",
    branch: "colony",
    options: [
      { value: "all_tipped", label: "Yes, all of them", icon: "check-circle", next_node_id: "a_growth" },
      { value: "some_tipped", label: "Some do, some don't", icon: "minus-circle", next_node_id: "a_growth" },
      { value: "none_tipped", label: "No ear tips", icon: "x-circle", next_node_id: "a_growth" },
      { value: "not_sure", label: "I'm not sure", icon: "help-circle", next_node_id: "a_growth" },
    ],
  },

  a_growth: {
    id: "a_growth",
    tippy_text: "Are new cats showing up?",
    help_text: "This helps us understand if the colony is growing.",
    branch: "colony",
    options: [
      { value: "growing", label: "Yes, new cats are arriving", icon: "trending-up", next_node_id: "a_kittens" },
      { value: "stable", label: "No, it's been about the same", icon: "minus", next_node_id: "a_kittens" },
      { value: "unsure", label: "Not sure", icon: "help-circle", next_node_id: "a_kittens" },
    ],
  },

  a_kittens: {
    id: "a_kittens",
    tippy_text: "Are there any kittens?",
    help_text: "Kittens are small cats under about 6 months old.",
    branch: "colony",
    options: [
      { value: "yes", label: "Yes, there are kittens", icon: "baby", next_node_id: null },
      { value: "no", label: "No kittens", icon: "check", next_node_id: null },
      { value: "maybe", label: "I think so / not sure", icon: "help-circle", next_node_id: null },
    ],
    outcome: {
      type: "ffsc_ffr",
      headline: "We can help with this!",
      subtext: "Our Find Fix Return program provides free spay/neuter for community cats. Leave your info and a team member will follow up to schedule trapping.",
      icon: "heart",
      resources: [FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "colony_tnr" },
    },
  },

  // ── BRANCH B: Emergency / Injured ──

  b_symptoms: {
    id: "b_symptoms",
    tippy_text: "What's going on with the cat?",
    help_text: "Pick the closest match.",
    branch: "emergency",
    max_depth: 2,
    options: [
      { value: "breathing", label: "Open-mouth breathing or gasping", icon: "alert-triangle", next_node_id: null },
      { value: "bleeding", label: "Bleeding or visible wounds", icon: "alert-triangle", next_node_id: null },
      { value: "not_moving", label: "Can't move or stand up", icon: "alert-triangle", next_node_id: null },
      { value: "lethargic", label: "Very lethargic or not eating", icon: "thermometer", next_node_id: "b_eating" },
      { value: "eye_nose", label: "Eye or nose discharge", icon: "eye", next_node_id: "b_eating" },
      { value: "limping", label: "Limping or favoring a leg", icon: "footprints", next_node_id: "b_eating" },
    ],
    outcome: {
      type: "emergency_vet",
      headline: "This sounds like an emergency",
      subtext: "Please contact an emergency vet right away. These hospitals are open 24/7.",
      icon: "siren",
      resources: [VCA_PETCARE_CARD, TRUVET_CARD, FFSC_CARD],
      creates_intake: false,
    },
  },

  b_eating: {
    id: "b_eating",
    tippy_text: "Is the cat still eating and drinking?",
    branch: "emergency",
    options: [
      { value: "yes", label: "Yes, eating normally", icon: "check", next_node_id: null },
      { value: "some", label: "A little, but less than usual", icon: "minus", next_node_id: null },
      { value: "no", label: "No, hasn't eaten in a while", icon: "x", next_node_id: null },
    ],
    outcome: {
      type: "ffsc_ffr",
      headline: "We'll help get this cat checked out",
      subtext: "Leave your info and we'll follow up about getting this cat to the clinic. If the situation gets worse, contact an emergency vet.",
      icon: "heart-pulse",
      resources: [FFSC_CARD, VCA_PETCARE_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "medical_concern", has_medical_concerns: true },
    },
  },

  // ── BRANCH C: Pet Owner ──

  c_indoor: {
    id: "c_indoor",
    tippy_text: "Is your cat indoor or outdoor?",
    branch: "pet",
    max_depth: 2,
    options: [
      { value: "indoor", label: "Indoor only", icon: "home", next_node_id: null },
      { value: "outdoor", label: "Indoor/outdoor or outdoor only", icon: "sun", next_node_id: "c_strays" },
    ],
    outcome: {
      type: "pet_spay_redirect",
      headline: "Great — here's how to get your cat fixed",
      subtext: "These organizations offer low-cost spay/neuter for owned pets in Sonoma County.",
      icon: "heart-handshake",
      resources: [SONOMA_HUMANE_CARD, LOVE_ME_FIX_ME_CARD],
      creates_intake: false,
    },
  },

  c_strays: {
    id: "c_strays",
    tippy_text: "Are there also stray cats around your property?",
    help_text: "If there are community cats nearby, we might be able to help with those too.",
    branch: "pet",
    options: [
      { value: "yes", label: "Yes, there are strays too", icon: "map-pin", next_node_id: null },
      { value: "no", label: "No, just my cat", icon: "home", next_node_id: null },
    ],
    outcome: {
      type: "hybrid",
      headline: "We can help with the strays!",
      subtext: "For your pet, use the resources below. For the community cats, leave your info and we'll follow up about our free FFR program.",
      icon: "heart",
      resources: [SONOMA_HUMANE_CARD, LOVE_ME_FIX_ME_CARD, FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "colony_tnr" },
    },
  },

  // ── BRANCH D: Kittens ──

  d_age: {
    id: "d_age",
    tippy_text: "How old do the kittens look?",
    help_text: "Eyes closed = under 2 weeks. Wobbly walking = 2–4 weeks. Playful = 4+ weeks.",
    branch: "kittens",
    max_depth: 3,
    options: [
      { value: "eyes_closed", label: "Eyes still closed (under 2 weeks)", icon: "baby", next_node_id: "d_mom" },
      { value: "tiny", label: "Eyes open but wobbly (2–4 weeks)", icon: "baby", next_node_id: "d_mom" },
      { value: "playful", label: "Walking and playful (4+ weeks)", icon: "cat", next_node_id: "d_mom" },
      { value: "unsure", label: "Not sure how old", icon: "help-circle", next_node_id: "d_mom" },
    ],
  },

  d_mom: {
    id: "d_mom",
    tippy_text: "Is the mom cat around?",
    help_text: "Mom may be nearby hunting. If you haven't seen her for several hours, she may be gone.",
    branch: "kittens",
    options: [
      { value: "yes", label: "Yes, mom is with them", icon: "heart", next_node_id: "d_safe" },
      { value: "seen_recently", label: "I saw her earlier today", icon: "clock", next_node_id: "d_safe" },
      { value: "no", label: "No mom — haven't seen her in 12+ hours", icon: "alert-circle", next_node_id: null },
      { value: "unsure", label: "Not sure", icon: "help-circle", next_node_id: "d_safe" },
    ],
    outcome: {
      type: "kitten_intake",
      headline: "These kittens may need immediate help",
      subtext: "Kittens without a mom need care quickly. Leave your info and we'll get back to you as soon as possible. If they seem cold or unresponsive, contact an emergency vet.",
      icon: "alert-circle",
      resources: [FFSC_CARD, VCA_PETCARE_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "kitten_rescue", has_kittens: true },
    },
  },

  d_safe: {
    id: "d_safe",
    tippy_text: "Are the kittens in a safe spot?",
    help_text: "Safe = not near traffic, dogs, or machinery.",
    branch: "kittens",
    options: [
      { value: "yes", label: "Yes, they seem safe", icon: "check", next_node_id: null },
      { value: "no", label: "No, they're in a risky area", icon: "alert-triangle", next_node_id: null },
      { value: "unsure", label: "Not sure", icon: "help-circle", next_node_id: null },
    ],
    outcome: {
      type: "kitten_intake",
      headline: "We'll help with these kittens",
      subtext: "Leave your info and we'll follow up about the best next steps. If mom is around, it's usually best to leave them where they are until we can coordinate.",
      icon: "heart",
      resources: [FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "kitten_rescue", has_kittens: true },
    },
  },
};

// ── Traversal Engine ───────────────────────────────────────────────────────────

export function createInitialState(tree: TippyTree): TippyState {
  return {
    history: [],
    current_node_id: "root",
    outcome: null,
  };
}

/**
 * Advance the tree by selecting a value on the current node.
 * If the selected option's `next_node_id` is null, resolves the current node's outcome.
 * If `next_node_id` points to another node, moves there.
 */
export function advanceTree(state: TippyState, value: string, tree: TippyTree): TippyState {
  const currentNode = tree[state.current_node_id];
  if (!currentNode) return state;

  const option = currentNode.options.find((o) => o.value === value);
  if (!option) return state;

  const historyEntry = { node_id: state.current_node_id, value };

  if (option.next_node_id === null) {
    // Terminal — resolve outcome from current node
    return {
      history: [...state.history, historyEntry],
      current_node_id: state.current_node_id,
      outcome: currentNode.outcome ?? null,
    };
  }

  // Move to next node
  return {
    history: [...state.history, historyEntry],
    current_node_id: option.next_node_id,
    outcome: null,
  };
}

export function goBackTree(state: TippyState): TippyState {
  if (state.history.length === 0) return state;

  const newHistory = state.history.slice(0, -1);
  const lastEntry = state.history[state.history.length - 1];

  return {
    history: newHistory,
    current_node_id: lastEntry.node_id,
    outcome: null,
  };
}

export function getCurrentNode(state: TippyState, tree: TippyTree): TippyNode | null {
  return tree[state.current_node_id] ?? null;
}

/**
 * Calculate progress through the current branch.
 * Uses `max_depth` from the branch entry node to estimate total question steps.
 */
export function getProgress(
  state: TippyState,
  tree: TippyTree,
  createsIntake: boolean,
): { current: number; total: number } {
  // Find branch max_depth from the first non-root node in history
  let maxDepth = 3; // sensible default
  for (const entry of state.history) {
    const node = tree[entry.node_id];
    if (node?.max_depth != null) {
      maxDepth = node.max_depth;
      break;
    }
  }
  // Also check current node
  const currentNode = tree[state.current_node_id];
  if (currentNode?.max_depth != null) {
    maxDepth = currentNode.max_depth;
  }

  // Steps: welcome(1) + questions(maxDepth) + outcome(1) + optional(location + contact + review = 3)
  const intakeSteps = createsIntake ? 3 : 0;
  const total = 1 + maxDepth + 1 + intakeSteps;

  // Current: welcome is step 0, first question is step 1, etc.
  const questionStep = state.history.length; // 0 = on first question (root answered puts us at 1)
  const current = 1 + questionStep; // +1 for welcome

  return { current: Math.min(current, total), total };
}

/**
 * Build the intake API payload from tree state + contact/location data.
 */
export function buildIntakePayload(
  state: TippyState,
  contact: { firstName: string; phone: string; email: string },
  place: { formatted_address?: string | null; display_name?: string | null; place_id?: string } | null,
  freeformAddress: string,
) {
  const outcome = state.outcome;
  const overrides = outcome?.intake_overrides ?? {};

  // Build answers map from history
  const tippyAnswers: Record<string, string> = {};
  for (const entry of state.history) {
    tippyAnswers[entry.node_id] = entry.value;
  }

  // Derive cat count from colony branch
  const countAnswer = tippyAnswers["a_count"];
  const catCount = countAnswer === "one" ? 1 : countAnswer === "few" ? 3 : countAnswer === "many" ? 8 : undefined;

  const catsAddress =
    place?.formatted_address || place?.display_name || freeformAddress.trim() || "Unknown";
  const phoneDigits = contact.phone.replace(/\D/g, "");

  return {
    source: "in_person" as const,
    source_system: "kiosk_tippy",
    first_name: contact.firstName.trim(),
    last_name: "(Walk-in)",
    phone: phoneDigits,
    email: contact.email.trim() || undefined,
    cats_address: catsAddress,
    selected_address_place_id: place?.place_id || undefined,
    call_type: overrides.call_type || "general_inquiry",
    cat_count_estimate: catCount,
    has_kittens: overrides.has_kittens || (tippyAnswers["a_kittens"] === "yes" || tippyAnswers["a_kittens"] === "maybe") || undefined,
    has_medical_concerns: overrides.has_medical_concerns || undefined,
    custom_fields: {
      tippy_branch: outcome?.type || "unknown",
      tippy_outcome: outcome?.headline || "unknown",
      tippy_answers: JSON.stringify(tippyAnswers),
    },
  };
}
