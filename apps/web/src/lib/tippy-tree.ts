/**
 * Tippy Branching Decision Tree — Types, Default Tree, Traversal Engine
 *
 * A configurable decision tree that:
 * 1. Routes public visitors to the right resources (emergency vet, pet spay, FFR)
 * 2. Collects structured data for Beacon analytics (colony size, growth, sterilization coverage)
 * 3. Scores situations for intake priority (urgency, feasibility, reproductive risk)
 * 4. Supports conditional branching (show/skip nodes based on accumulated answers)
 * 5. Is fully admin-configurable via kiosk.help_tree in app_config
 *
 * Research basis: TIPPY_TRIAGE_RESEARCH.md (vet triage standards, TNR priority,
 * Alley Cat Allies / Neighborhood Cats intake forms, kitten assessment frameworks)
 *
 * FFS-1061, FFS-1062, FFS-1064, FFS-1065
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/** Condition for conditional node display */
export interface TippyCondition {
  /** node_id whose answer to check */
  node_id: string;
  /** comparison operator */
  op: "eq" | "neq" | "in" | "not_in";
  /** value(s) to compare against */
  values: string[];
}

export interface TippyOption {
  value: string;
  label: string;
  icon?: string;
  next_node_id: string | null; // null = parent node has terminal outcome
  /** Structured data tags accumulated into intake payload */
  tags?: Record<string, string | number | boolean>;
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
  max_depth?: number;
  /** Only show this node if condition is met; otherwise skip to skip_to */
  show_when?: TippyCondition;
  /** Node to jump to when show_when fails */
  skip_to?: string;
  /** Semantic key for what this question captures */
  data_key?: string;
}

// ── Scoring & Interpretation Config (travels with the tree) ────────────────────

/** A single scoring rule: if tag matches, add points */
export interface TippyScoringRule {
  /** Tag key to check */
  tag: string;
  /** How to evaluate: "truthy" (any truthy value), "equals" (exact match), "numeric" (use tag value as points) */
  op: "truthy" | "equals" | "numeric";
  /** For "equals" op: value(s) that trigger this rule */
  match?: (string | number | boolean)[];
  /** Points to add when rule matches */
  points: number;
}

/** Maps tag keys → intake custom_field keys for top-level queryable fields */
export interface TippyFieldMapping {
  /** Tag key to read from */
  tag: string;
  /** custom_fields key to write to (prefixed with tippy_ automatically) */
  field: string;
  /** How to format: "string" (as-is), "boolean" ("true"/"false"), "number" (String()) */
  format?: "string" | "boolean" | "number";
}

/** Config that controls how tags are interpreted — stored in the tree, not hardcoded */
export interface TippyScoringConfig {
  /** Tag keys that represent cat count (first match wins) */
  cat_count_tags: string[];
  /** Rules for computing priority score */
  scoring_rules: TippyScoringRule[];
  /** Maps tags → intake custom_fields for easy querying */
  field_mappings: TippyFieldMapping[];
}

export interface TippyTreeConfig {
  nodes: Record<string, TippyNode>;
  scoring: TippyScoringConfig;
}

/**
 * TippyTree is the full config: nodes + scoring interpretation.
 * For backward compat, also accept a plain Record<string, TippyNode> (legacy format).
 */
export type TippyTree = TippyTreeConfig | Record<string, TippyNode>;

export interface TippyState {
  history: Array<{ node_id: string; value: string }>;
  current_node_id: string;
  outcome: TippyOutcome | null;
  /** Accumulated tags from all answered options */
  tags: Record<string, string | number | boolean>;
}

// ── Tree Accessors (handle both legacy & new format) ───────────────────────────

function isTreeConfig(tree: TippyTree): tree is TippyTreeConfig {
  return "nodes" in tree && "scoring" in tree;
}

/** Get the nodes map from either format */
export function getNodes(tree: TippyTree): Record<string, TippyNode> {
  return isTreeConfig(tree) ? tree.nodes : tree;
}

/** Get the scoring config (returns default if legacy format) */
export function getScoring(tree: TippyTree): TippyScoringConfig {
  return isTreeConfig(tree) ? tree.scoring : DEFAULT_SCORING_CONFIG;
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

const EMERGENCY_ANIMAL_HOSPITAL_CARD: TippyResourceCard = {
  name: "Emergency Animal Hospital of Santa Rosa",
  description: "After-hours emergency care (weekday evenings, weekends 24hr).",
  phone: "(707) 542-4012",
  address: "1946 Santa Rosa Ave, Santa Rosa",
  hours: "After-hours: weekday 6PM–8AM, weekends 24hr",
  icon: "siren",
  urgency: "emergency",
};

// ── Default Tree ───────────────────────────────────────────────────────────────
//
// 5 branches, ~35 nodes, conditional depth based on cat count.
// Low cat count (1-2) → behavioral questions to distinguish pet vs community.
// High cat count (6+) → skip behavioral, focus on colony data.
//
// Each option carries `tags` that accumulate into structured intake data.

// ── Default Scoring Config ──────────────────────────────────────────────────────
//
// This config controls how accumulated tags are interpreted into priority scores
// and mapped to intake fields. It ships with the default tree but can be
// overridden by admin via kiosk.help_tree (the scoring section).
//
// If you rename a tag in the tree, update the corresponding rule/mapping here.

export const DEFAULT_SCORING_CONFIG: TippyScoringConfig = {
  cat_count_tags: ["cat_count", "kitten_count"],

  scoring_rules: [
    // Direct boosts set by options
    { tag: "priority_boost", op: "numeric", points: 1 }, // uses the tag's numeric value directly
    // Colony indicators
    { tag: "sterilization_gap", op: "equals", match: [1.0], points: 2 },
    { tag: "sterilization_gap", op: "equals", match: [0.5], points: 1 },
    { tag: "colony_likely", op: "truthy", points: 1 },
    // Reproductive urgency
    { tag: "has_kittens", op: "equals", match: [true], points: 1 },
    { tag: "has_pregnant", op: "truthy", points: 2 },
    // Feasibility & urgency
    { tag: "needs_trapper", op: "truthy", points: 1 },
    { tag: "urgency", op: "equals", match: ["animal_control", "hostile_neighbors"], points: 3 },
    { tag: "urgency", op: "equals", match: ["deadline"], points: 2 },
  ],

  field_mappings: [
    { tag: "ear_tip_coverage", field: "ear_tip_coverage", format: "string" },
    { tag: "growth", field: "growth", format: "string" },
    { tag: "handleability", field: "handleability", format: "string" },
    { tag: "trapping_feasibility", field: "trapping_feasibility", format: "string" },
    { tag: "caller_role", field: "caller_role", format: "string" },
    { tag: "urgency", field: "urgency", format: "string" },
    { tag: "has_feeder", field: "has_feeder", format: "boolean" },
    { tag: "trapping_willing", field: "trapping_willing", format: "boolean" },
    { tag: "pet_likelihood", field: "pet_likelihood", format: "number" },
    { tag: "kitten_age", field: "kitten_age", format: "string" },
    { tag: "kitten_urgency", field: "kitten_urgency", format: "string" },
    { tag: "kitten_condition", field: "kitten_condition", format: "string" },
    { tag: "mom_present", field: "mom_present", format: "string" },
    { tag: "symptom", field: "symptom", format: "string" },
    { tag: "triage_level", field: "triage_level", format: "string" },
  ],
};

// ── Default Tree ───────────────────────────────────────────────────────────────

export const DEFAULT_TIPPY_TREE: TippyTree = {
  scoring: DEFAULT_SCORING_CONFIG,
  nodes: {

  // ════════════════════════════════════════════════════════════════════════════
  // ROOT
  // ════════════════════════════════════════════════════════════════════════════

  root: {
    id: "root",
    tippy_text: "Which best describes your situation?",
    help_text: "Pick the one that's closest — we'll ask a few follow-ups.",
    branch: "root",
    data_key: "situation_type",
    options: [
      { value: "colony", label: "Stray or outdoor cats near me", icon: "map-pin", next_node_id: "a_count", tags: { situation: "colony_stray" } },
      { value: "emergency", label: "A cat looks hurt or sick", icon: "alert-circle", next_node_id: "b_symptoms", tags: { situation: "emergency" } },
      { value: "pet", label: "Get my own cat fixed", icon: "home", next_node_id: "c_indoor", tags: { situation: "pet_spay" } },
      { value: "kittens", label: "I found kittens", icon: "baby", next_node_id: "d_age", tags: { situation: "kittens" } },
      { value: "general", label: "Something else / just have a question", icon: "help-circle", next_node_id: null, tags: { situation: "general" } },
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

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH A: Colony / Stray
  // Collects: count, behavioral (conditional on low count), ear tips, growth,
  //           kittens, feeding situation, property relationship, trapping willingness
  // ════════════════════════════════════════════════════════════════════════════

  a_count: {
    id: "a_count",
    tippy_text: "How many cats are you seeing?",
    help_text: "Your best guess — it doesn't have to be exact.",
    branch: "colony",
    data_key: "cat_count",
    max_depth: 7,
    options: [
      { value: "one", label: "Just 1 cat", icon: "cat", next_node_id: "a_touch", tags: { cat_count: 1, colony_likely: false } },
      { value: "few", label: "2–5 cats", icon: "users", next_node_id: "a_touch", tags: { cat_count: 3, colony_likely: false } },
      { value: "many", label: "6 or more", icon: "users", next_node_id: "a_eartip", tags: { cat_count: 8, colony_likely: true } },
    ],
  },

  // ── Behavioral assessment (low cat count only) ──

  a_touch: {
    id: "a_touch",
    tippy_text: "Can you pet or pick up this cat?",
    help_text: "This helps us understand if the cat might be someone's pet.",
    branch: "colony",
    data_key: "handleability",
    // Only shown for 1-5 cats; 6+ skips to a_eartip
    show_when: { node_id: "a_count", op: "in", values: ["one", "few"] },
    skip_to: "a_eartip",
    options: [
      { value: "yes_friendly", label: "Yes, it's friendly — I can pick it up", icon: "heart", next_node_id: "a_collar", tags: { handleability: "friendly", pet_likelihood: 0.7 } },
      { value: "close_no_touch", label: "Gets close but won't let me touch it", icon: "hand", next_node_id: "a_sleeping", tags: { handleability: "semi_social", pet_likelihood: 0.3 } },
      { value: "runs_away", label: "Runs away when I get close", icon: "zap", next_node_id: "a_eartip", tags: { handleability: "feral", pet_likelihood: 0.05 } },
    ],
  },

  a_collar: {
    id: "a_collar",
    tippy_text: "Does the cat have a collar or flea treatment?",
    help_text: "A collar or flea collar usually means someone owns the cat.",
    branch: "colony",
    data_key: "collar_status",
    show_when: { node_id: "a_touch", op: "eq", values: ["yes_friendly"] },
    skip_to: "a_sleeping",
    options: [
      { value: "collar_yes", label: "Yes, it has a collar", icon: "check-circle", next_node_id: "a_pet_detected", tags: { has_collar: true, pet_likelihood: 0.9 } },
      { value: "flea_collar", label: "It has a flea collar", icon: "shield", next_node_id: "a_pet_detected", tags: { has_flea_treatment: true, pet_likelihood: 0.8 } },
      { value: "no_collar", label: "No collar", icon: "x-circle", next_node_id: "a_sleeping", tags: { has_collar: false } },
      { value: "cant_tell", label: "Can't tell", icon: "help-circle", next_node_id: "a_sleeping", tags: {} },
    ],
  },

  a_pet_detected: {
    id: "a_pet_detected",
    tippy_text: "Are there also other cats outside — without collars?",
    help_text: "We can help with community cats even if you also have a pet.",
    branch: "colony",
    data_key: "pet_plus_strays",
    options: [
      { value: "yes_strays_too", label: "Yes, there are other cats too", icon: "map-pin", next_node_id: "a_eartip", tags: { has_strays_nearby: true } },
      { value: "just_this_one", label: "No, just this one cat", icon: "cat", next_node_id: null, tags: { has_strays_nearby: false } },
    ],
    outcome: {
      type: "pet_spay_redirect",
      headline: "This sounds like a pet cat",
      subtext: "A friendly cat with a collar is likely someone's pet. If it seems lost, try posting on Nextdoor or Pawboost. For low-cost spay/neuter for your own pet:",
      icon: "home",
      resources: [SONOMA_HUMANE_CARD, LOVE_ME_FIX_ME_CARD, FFSC_CARD],
      creates_intake: false,
    },
  },

  a_sleeping: {
    id: "a_sleeping",
    tippy_text: "Where does the cat sleep at night?",
    help_text: "Think about where the cat usually is after dark.",
    branch: "colony",
    data_key: "sleeping_location",
    show_when: { node_id: "a_count", op: "in", values: ["one", "few"] },
    skip_to: "a_eartip",
    options: [
      { value: "inside", label: "Inside my home", icon: "home", next_node_id: "a_feeding", tags: { sleeps_inside: true, pet_likelihood: 0.8 } },
      { value: "porch_garage", label: "On my porch or in my garage", icon: "building", next_node_id: "a_feeding", tags: { sleeps_inside: false, pet_likelihood: 0.3 } },
      { value: "outside", label: "Outside or I don't know", icon: "cloud", next_node_id: "a_eartip", tags: { sleeps_inside: false, pet_likelihood: 0.1 } },
    ],
  },

  a_feeding: {
    id: "a_feeding",
    tippy_text: "Where do you feed the cat?",
    help_text: "If you feed the cat, where does it eat?",
    branch: "colony",
    data_key: "feeding_location",
    show_when: { node_id: "a_sleeping", op: "in", values: ["inside", "porch_garage"] },
    skip_to: "a_eartip",
    options: [
      { value: "kitchen", label: "Inside — in the kitchen or house", icon: "home", next_node_id: "a_eartip", tags: { feeds_inside: true, pet_likelihood: 0.9 } },
      { value: "porch", label: "On my porch or deck", icon: "building", next_node_id: "a_eartip", tags: { feeds_inside: false, pet_likelihood: 0.4 } },
      { value: "outside", label: "Outside somewhere", icon: "map-pin", next_node_id: "a_eartip", tags: { feeds_inside: false, pet_likelihood: 0.1 } },
      { value: "not_feeding", label: "I don't feed this cat", icon: "x", next_node_id: "a_eartip", tags: { feeds_inside: false, no_feeder: true } },
    ],
  },

  // ── Colony assessment (all cat counts converge here) ──

  a_eartip: {
    id: "a_eartip",
    tippy_text: "Do any of the cats have a tipped left ear?",
    help_text: "An ear tip (flat cut on the left ear) means the cat has already been fixed through a program like ours.",
    branch: "colony",
    data_key: "ear_tip_status",
    options: [
      { value: "all_tipped", label: "Yes, all of them", icon: "check-circle", next_node_id: "a_growth", tags: { ear_tip_coverage: "all", sterilization_gap: 0 } },
      { value: "some_tipped", label: "Some do, some don't", icon: "minus-circle", next_node_id: "a_growth", tags: { ear_tip_coverage: "partial", sterilization_gap: 0.5 } },
      { value: "none_tipped", label: "No ear tips", icon: "x-circle", next_node_id: "a_growth", tags: { ear_tip_coverage: "none", sterilization_gap: 1.0 } },
      { value: "not_sure", label: "I'm not sure", icon: "help-circle", next_node_id: "a_growth", tags: { ear_tip_coverage: "unknown" } },
    ],
  },

  a_growth: {
    id: "a_growth",
    tippy_text: "Are new cats showing up?",
    help_text: "This helps us understand if the colony is growing.",
    branch: "colony",
    data_key: "growth_trajectory",
    options: [
      { value: "growing", label: "Yes, new cats keep arriving", icon: "trending-up", next_node_id: "a_kittens", tags: { growth: "growing", reproductive_active: true, priority_boost: 2 } },
      { value: "stable", label: "About the same number", icon: "minus", next_node_id: "a_kittens", tags: { growth: "stable", reproductive_active: false } },
      { value: "shrinking", label: "Fewer cats than before", icon: "trending-down", next_node_id: "a_kittens", tags: { growth: "shrinking" } },
      { value: "unsure", label: "Not sure", icon: "help-circle", next_node_id: "a_kittens", tags: { growth: "unknown" } },
    ],
  },

  a_kittens: {
    id: "a_kittens",
    tippy_text: "Are there any kittens?",
    help_text: "Kittens are small cats under about 6 months old — playful and squeaky.",
    branch: "colony",
    data_key: "kittens_present",
    options: [
      { value: "yes", label: "Yes, there are kittens", icon: "baby", next_node_id: "a_feeding_who", tags: { has_kittens: true, priority_boost: 2 } },
      { value: "pregnant", label: "I think a cat is pregnant", icon: "alert-circle", next_node_id: "a_feeding_who", tags: { has_pregnant: true, priority_boost: 3 } },
      { value: "no", label: "No kittens", icon: "check", next_node_id: "a_feeding_who", tags: { has_kittens: false } },
      { value: "maybe", label: "I think so / not sure", icon: "help-circle", next_node_id: "a_feeding_who", tags: { has_kittens: "maybe" } },
    ],
  },

  a_feeding_who: {
    id: "a_feeding_who",
    tippy_text: "Is someone feeding these cats regularly?",
    help_text: "Regular feeding makes it much easier for us to help — it's how we catch them safely.",
    branch: "colony",
    data_key: "feeding_situation",
    options: [
      { value: "i_feed", label: "Yes, I feed them", icon: "heart", next_node_id: "a_property", tags: { has_feeder: true, feeder_is_caller: true, trapping_feasibility: "high" } },
      { value: "someone_else", label: "Someone else feeds them", icon: "users", next_node_id: "a_property", tags: { has_feeder: true, feeder_is_caller: false, trapping_feasibility: "medium" } },
      { value: "no_feeding", label: "No one that I know of", icon: "x", next_node_id: "a_property", tags: { has_feeder: false, trapping_feasibility: "low" } },
      { value: "unsure", label: "Not sure", icon: "help-circle", next_node_id: "a_property", tags: { has_feeder: "unknown" } },
    ],
  },

  a_property: {
    id: "a_property",
    tippy_text: "What's your relationship to this property?",
    help_text: "We need to coordinate access for trapping.",
    branch: "colony",
    data_key: "caller_relationship",
    options: [
      { value: "owner", label: "I own or rent here", icon: "home", next_node_id: "a_urgency", tags: { caller_role: "owner_renter", property_access: true } },
      { value: "neighbor", label: "I'm a neighbor", icon: "users", next_node_id: "a_urgency", tags: { caller_role: "neighbor", property_access: false } },
      { value: "caretaker", label: "I manage this property", icon: "key-round", next_node_id: "a_urgency", tags: { caller_role: "property_manager", property_access: true } },
      { value: "passerby", label: "Just passing through", icon: "map", next_node_id: null, tags: { caller_role: "passerby", property_access: false } },
    ],
    outcome: {
      type: "ffsc_ffr",
      headline: "Thanks for letting us know!",
      subtext: "Leave your info so we can add this location to our system. If you can, try to get the property owner's contact info too — we need their permission to trap.",
      icon: "heart",
      resources: [FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "colony_tnr" },
    },
  },

  a_urgency: {
    id: "a_urgency",
    tippy_text: "Is there any urgency to this situation?",
    help_text: "This helps us prioritize.",
    branch: "colony",
    data_key: "urgency_factor",
    options: [
      { value: "animal_control", label: "Animal control has been called", icon: "alert-triangle", next_node_id: "a_help_trap", tags: { urgency: "animal_control", priority_boost: 3 } },
      { value: "hostile", label: "Neighbors are threatening the cats", icon: "alert-triangle", next_node_id: "a_help_trap", tags: { urgency: "hostile_neighbors", priority_boost: 3 } },
      { value: "deadline", label: "Construction, moving, or eviction coming", icon: "clock", next_node_id: "a_help_trap", tags: { urgency: "deadline", priority_boost: 2 } },
      { value: "none", label: "No rush — just want to get them fixed", icon: "check", next_node_id: "a_help_trap", tags: { urgency: "none" } },
    ],
  },

  a_help_trap: {
    id: "a_help_trap",
    tippy_text: "Would you be able to help with trapping?",
    help_text: "We can train you! Many people trap their own cats with our guidance and loaner traps.",
    branch: "colony",
    data_key: "trapping_willingness",
    options: [
      { value: "yes_experienced", label: "Yes — I've trapped before", icon: "check-circle", next_node_id: null, tags: { trapping_willing: true, trapping_experience: "experienced" } },
      { value: "yes_learn", label: "Yes — I'd like to learn", icon: "book-open", next_node_id: null, tags: { trapping_willing: true, trapping_experience: "beginner" } },
      { value: "maybe", label: "Maybe — tell me more", icon: "help-circle", next_node_id: null, tags: { trapping_willing: "maybe", trapping_experience: "none" } },
      { value: "no", label: "No — I need someone to come out", icon: "x", next_node_id: null, tags: { trapping_willing: false, needs_trapper: true } },
    ],
    outcome: {
      type: "ffsc_ffr",
      headline: "We can help with this!",
      subtext: "Our Find Fix Return program provides free spay/neuter for community cats. Leave your info and a team member will follow up to schedule next steps.",
      icon: "heart",
      resources: [FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "colony_tnr" },
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH B: Emergency / Injured
  // Research: VECCS 5-level triage → simplified to 3 public tiers.
  // Key: open-mouth breathing in cats is ALWAYS an emergency.
  // Also catches "crying at night" / "spraying" as TNR redirect (not emergency).
  // ════════════════════════════════════════════════════════════════════════════

  b_symptoms: {
    id: "b_symptoms",
    tippy_text: "What's going on with the cat?",
    help_text: "Pick the closest match — you can pick more than one if needed.",
    branch: "emergency",
    data_key: "symptoms",
    max_depth: 3,
    options: [
      { value: "breathing", label: "Open-mouth breathing or gasping", icon: "alert-triangle", next_node_id: null, tags: { symptom: "respiratory", triage_level: "emergency" } },
      { value: "bleeding", label: "Bleeding or visible wounds", icon: "alert-triangle", next_node_id: null, tags: { symptom: "bleeding", triage_level: "emergency" } },
      { value: "not_moving", label: "Can't move, paralyzed, or hit by car", icon: "alert-triangle", next_node_id: null, tags: { symptom: "immobile", triage_level: "emergency" } },
      { value: "straining", label: "Male cat straining to urinate", icon: "alert-triangle", next_node_id: null, tags: { symptom: "urinary_blockage", triage_level: "emergency" } },
      { value: "lethargic", label: "Very lethargic or hiding", icon: "thermometer", next_node_id: "b_eating", tags: { symptom: "lethargic", triage_level: "urgent" } },
      { value: "eye_nose", label: "Eye or nose discharge, sneezing", icon: "eye", next_node_id: "b_eating", tags: { symptom: "uri", triage_level: "schedulable" } },
      { value: "limping", label: "Limping but still walking", icon: "footprints", next_node_id: "b_eating", tags: { symptom: "limping", triage_level: "schedulable" } },
      { value: "crying_spraying", label: "Cat crying at night or spraying", icon: "volume-2", next_node_id: null, tags: { symptom: "intact_behavior", triage_level: "not_medical" } },
    ],
    outcome: {
      type: "emergency_vet",
      headline: "This sounds like an emergency",
      subtext: "Please contact an emergency vet right away. These hospitals are open 24/7. Time matters — don't wait.",
      icon: "siren",
      resources: [VCA_PETCARE_CARD, TRUVET_CARD, EMERGENCY_ANIMAL_HOSPITAL_CARD],
      creates_intake: false,
    },
  },

  b_eating: {
    id: "b_eating",
    tippy_text: "Is the cat still eating and drinking?",
    help_text: "A cat that hasn't eaten in 2+ days needs urgent care.",
    branch: "emergency",
    data_key: "eating_status",
    options: [
      { value: "yes", label: "Yes, eating normally", icon: "check", next_node_id: "b_duration", tags: { eating: "normal" } },
      { value: "less", label: "Less than usual", icon: "minus", next_node_id: "b_duration", tags: { eating: "reduced" } },
      { value: "no", label: "Not eating — 2+ days", icon: "x", next_node_id: null, tags: { eating: "none", triage_level: "emergency" } },
    ],
    outcome: {
      type: "emergency_vet",
      headline: "This cat needs a vet soon",
      subtext: "A cat that hasn't eaten in 2+ days is at risk of liver failure. Please contact a vet today.",
      icon: "alert-circle",
      resources: [VCA_PETCARE_CARD, TRUVET_CARD, FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "medical_concern", has_medical_concerns: true },
    },
  },

  b_duration: {
    id: "b_duration",
    tippy_text: "How long has this been going on?",
    branch: "emergency",
    data_key: "symptom_duration",
    options: [
      { value: "today", label: "Just noticed today", icon: "clock", next_node_id: null, tags: { duration: "acute" } },
      { value: "days", label: "A few days", icon: "calendar", next_node_id: null, tags: { duration: "days" } },
      { value: "week_plus", label: "More than a week", icon: "calendar", next_node_id: null, tags: { duration: "chronic" } },
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

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH C: Pet Owner
  // Routes to low-cost spay programs. Detects hybrid (pet + strays nearby).
  // ════════════════════════════════════════════════════════════════════════════

  c_indoor: {
    id: "c_indoor",
    tippy_text: "Is your cat indoor or outdoor?",
    branch: "pet",
    data_key: "pet_lifestyle",
    max_depth: 2,
    options: [
      { value: "indoor", label: "Indoor only", icon: "home", next_node_id: null, tags: { pet_lifestyle: "indoor" } },
      { value: "outdoor", label: "Indoor/outdoor or outdoor only", icon: "sun", next_node_id: "c_strays", tags: { pet_lifestyle: "outdoor" } },
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
    help_text: "If there are community cats nearby, we can help with those too — for free.",
    branch: "pet",
    data_key: "strays_nearby",
    options: [
      { value: "yes", label: "Yes, there are strays too", icon: "map-pin", next_node_id: null, tags: { has_strays_nearby: true } },
      { value: "no", label: "No, just my cat", icon: "home", next_node_id: null, tags: { has_strays_nearby: false } },
    ],
    outcome: {
      type: "hybrid",
      headline: "We can help with the strays!",
      subtext: "For your pet, use the low-cost programs below. For the community cats, leave your info and we'll follow up about our free Find Fix Return program.",
      icon: "heart",
      resources: [SONOMA_HUMANE_CARD, LOVE_ME_FIX_ME_CARD, FFSC_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "colony_tnr" },
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH D: Kittens
  // Research: Kitten Lady / UC Davis framework. Age → mom → warmth → safety.
  // Key insight: "leave them be" is often the best advice. Mom is usually nearby.
  // ════════════════════════════════════════════════════════════════════════════

  d_age: {
    id: "d_age",
    tippy_text: "How old do the kittens look?",
    help_text: "Eyes closed = under 2 weeks. Wobbly walking = 2–4 weeks. Playful = 4+ weeks.",
    branch: "kittens",
    data_key: "kitten_age",
    max_depth: 4,
    options: [
      { value: "eyes_closed", label: "Eyes still closed (under 2 weeks)", icon: "baby", next_node_id: "d_mom", tags: { kitten_age: "neonatal", kitten_urgency: "critical" } },
      { value: "tiny", label: "Eyes open but wobbly (2–4 weeks)", icon: "baby", next_node_id: "d_mom", tags: { kitten_age: "infant", kitten_urgency: "high" } },
      { value: "playful", label: "Walking and playful (4–8 weeks)", icon: "cat", next_node_id: "d_mom", tags: { kitten_age: "young", kitten_urgency: "moderate" } },
      { value: "older", label: "Bigger — almost adult-sized", icon: "cat", next_node_id: "d_mom", tags: { kitten_age: "juvenile", kitten_urgency: "low" } },
      { value: "unsure", label: "Not sure how old", icon: "help-circle", next_node_id: "d_mom", tags: { kitten_age: "unknown" } },
    ],
  },

  d_mom: {
    id: "d_mom",
    tippy_text: "Is the mom cat around?",
    help_text: "Mom may be nearby hunting — she often leaves for a few hours. That's normal.",
    branch: "kittens",
    data_key: "mom_present",
    options: [
      { value: "yes", label: "Yes, mom is with them", icon: "heart", next_node_id: "d_warm", tags: { mom_present: true } },
      { value: "seen_recently", label: "I saw her earlier today", icon: "clock", next_node_id: "d_warm", tags: { mom_present: "recent" } },
      { value: "no", label: "No mom — haven't seen her in 12+ hours", icon: "alert-circle", next_node_id: "d_warm", tags: { mom_present: false, priority_boost: 2 } },
      { value: "unsure", label: "Not sure", icon: "help-circle", next_node_id: "d_warm", tags: { mom_present: "unknown" } },
    ],
  },

  d_warm: {
    id: "d_warm",
    tippy_text: "How do the kittens seem?",
    help_text: "Cold or silent kittens need help faster than warm, active ones.",
    branch: "kittens",
    data_key: "kitten_condition",
    options: [
      { value: "warm_quiet", label: "Warm, sleeping peacefully", icon: "check", next_node_id: "d_safe", tags: { kitten_condition: "stable", kitten_urgency: "low" } },
      { value: "warm_crying", label: "Warm but crying", icon: "volume-2", next_node_id: "d_safe", tags: { kitten_condition: "hungry", kitten_urgency: "moderate" } },
      { value: "cold_crying", label: "Cold to touch and crying", icon: "alert-triangle", next_node_id: null, tags: { kitten_condition: "hypothermic", kitten_urgency: "critical" } },
      { value: "cold_quiet", label: "Cold and not moving much", icon: "alert-triangle", next_node_id: null, tags: { kitten_condition: "critical", kitten_urgency: "critical" } },
      { value: "not_touched", label: "I haven't touched them", icon: "hand", next_node_id: "d_safe", tags: { kitten_condition: "unassessed" } },
    ],
    outcome: {
      type: "kitten_intake",
      headline: "These kittens need help now",
      subtext: "Cold kittens can fade quickly. If you can, bring them inside and place them on a warm (not hot) towel. Call us or an emergency vet right away.",
      icon: "alert-circle",
      resources: [FFSC_CARD, VCA_PETCARE_CARD],
      creates_intake: true,
      intake_overrides: { call_type: "kitten_rescue", has_kittens: true, has_medical_concerns: true },
    },
  },

  d_safe: {
    id: "d_safe",
    tippy_text: "Are the kittens in a safe spot?",
    help_text: "Safe = away from traffic, dogs, machinery, and heavy foot traffic.",
    branch: "kittens",
    data_key: "kitten_safety",
    options: [
      { value: "yes", label: "Yes, they seem safe", icon: "check", next_node_id: "d_count", tags: { kitten_safe: true } },
      { value: "no", label: "No — near a road, dogs, or danger", icon: "alert-triangle", next_node_id: "d_count", tags: { kitten_safe: false, priority_boost: 2 } },
      { value: "unsure", label: "Not sure", icon: "help-circle", next_node_id: "d_count", tags: { kitten_safe: "unknown" } },
    ],
  },

  d_count: {
    id: "d_count",
    tippy_text: "How many kittens are there?",
    branch: "kittens",
    data_key: "kitten_count",
    options: [
      { value: "one", label: "1 kitten", icon: "cat", next_node_id: null, tags: { kitten_count: 1 } },
      { value: "few", label: "2–4 kittens", icon: "users", next_node_id: null, tags: { kitten_count: 3 } },
      { value: "many", label: "5 or more", icon: "users", next_node_id: null, tags: { kitten_count: 6 } },
      { value: "unsure", label: "Hard to tell", icon: "help-circle", next_node_id: null, tags: {} },
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
  }, // close nodes
};

// ── Traversal Engine ───────────────────────────────────────────────────────────

export function createInitialState(_tree: TippyTree): TippyState {
  return {
    history: [],
    current_node_id: "root",
    outcome: null,
    tags: {},
  };
}

/** Check if a show_when condition is satisfied by the current answers */
function evaluateCondition(condition: TippyCondition, history: Array<{ node_id: string; value: string }>): boolean {
  const entry = history.find((h) => h.node_id === condition.node_id);
  if (!entry) return false;

  switch (condition.op) {
    case "eq":
      return condition.values.includes(entry.value);
    case "neq":
      return !condition.values.includes(entry.value);
    case "in":
      return condition.values.includes(entry.value);
    case "not_in":
      return !condition.values.includes(entry.value);
    default:
      return true;
  }
}

/**
 * Resolve the actual next node, handling show_when conditions.
 * If a node's condition fails, follow its skip_to chain.
 */
function resolveNextNode(nodeId: string, nodes: Record<string, TippyNode>, history: Array<{ node_id: string; value: string }>): string | null {
  let current = nodeId;
  const visited = new Set<string>(); // prevent infinite loops
  while (current && !visited.has(current)) {
    visited.add(current);
    const node = nodes[current];
    if (!node) return null;
    if (!node.show_when || evaluateCondition(node.show_when, history)) {
      return current; // condition passes, show this node
    }
    // Condition fails — skip
    if (node.skip_to) {
      current = node.skip_to;
    } else {
      return null; // no skip target, dead end
    }
  }
  return null;
}

/**
 * Advance the tree by selecting a value on the current node.
 * Handles conditional nodes via show_when + skip_to resolution.
 */
export function advanceTree(state: TippyState, value: string, tree: TippyTree): TippyState {
  const nodes = getNodes(tree);
  const currentNode = nodes[state.current_node_id];
  if (!currentNode) return state;

  const option = currentNode.options.find((o) => o.value === value);
  if (!option) return state;

  const historyEntry = { node_id: state.current_node_id, value };
  const newHistory = [...state.history, historyEntry];

  // Merge option tags
  const newTags = { ...state.tags, ...(option.tags || {}) };

  if (option.next_node_id === null) {
    // Terminal — resolve outcome from current node
    return {
      history: newHistory,
      current_node_id: state.current_node_id,
      outcome: currentNode.outcome ?? null,
      tags: newTags,
    };
  }

  // Resolve next node (handling show_when/skip_to)
  const resolvedId = resolveNextNode(option.next_node_id, nodes, newHistory);

  if (!resolvedId) {
    // All skip targets exhausted — treat as terminal on current node
    return {
      history: newHistory,
      current_node_id: state.current_node_id,
      outcome: currentNode.outcome ?? null,
      tags: newTags,
    };
  }

  return {
    history: newHistory,
    current_node_id: resolvedId,
    outcome: null,
    tags: newTags,
  };
}

export function goBackTree(state: TippyState): TippyState {
  if (state.history.length === 0) return state;

  const newHistory = state.history.slice(0, -1);
  const lastEntry = state.history[state.history.length - 1];

  // Rebuild tags from remaining history
  // (we don't store per-step tags, so this is approximate — good enough for back nav)
  return {
    history: newHistory,
    current_node_id: lastEntry.node_id,
    outcome: null,
    tags: state.tags, // tags are additive, not worth recomputing on back
  };
}

export function getCurrentNode(state: TippyState, tree: TippyTree): TippyNode | null {
  return getNodes(tree)[state.current_node_id] ?? null;
}

/**
 * Calculate progress through the current branch.
 * Uses max_depth from the branch entry node to estimate total question steps.
 */
export function getProgress(
  state: TippyState,
  tree: TippyTree,
  createsIntake: boolean,
): { current: number; total: number } {
  const nodes = getNodes(tree);
  let maxDepth = 4;
  for (const entry of state.history) {
    const node = nodes[entry.node_id];
    if (node?.max_depth != null) {
      maxDepth = node.max_depth;
      break;
    }
  }
  const currentNode = nodes[state.current_node_id];
  if (currentNode?.max_depth != null) {
    maxDepth = currentNode.max_depth;
  }

  const intakeSteps = createsIntake ? 3 : 0;
  const total = 1 + maxDepth + 1 + intakeSteps;
  const questionStep = state.history.length;
  const current = 1 + questionStep;

  return { current: Math.min(current, total), total };
}

/**
 * Compute priority score from tags using configurable scoring rules.
 * Rules live in the tree config so admins can tune without code changes.
 */
export function computePriorityScore(tags: Record<string, string | number | boolean>, rules: TippyScoringRule[]): number {
  let score = 0;
  for (const rule of rules) {
    const val = tags[rule.tag];
    if (val === undefined || val === null) continue;

    switch (rule.op) {
      case "truthy":
        if (val) score += rule.points;
        break;
      case "equals":
        if (rule.match && rule.match.includes(val)) score += rule.points;
        break;
      case "numeric":
        if (typeof val === "number") score += val * rule.points;
        break;
    }
  }
  return score;
}

/**
 * Map tags → custom_fields using configurable field mappings.
 * Admins can add/remove/rename mappings without touching code.
 */
function mapTagsToFields(
  tags: Record<string, string | number | boolean>,
  mappings: TippyFieldMapping[],
): Record<string, string | undefined> {
  const fields: Record<string, string | undefined> = {};
  for (const mapping of mappings) {
    const val = tags[mapping.tag];
    if (val === undefined || val === null) continue;
    const fmt = mapping.format || "string";
    const key = `tippy_${mapping.field}`;
    switch (fmt) {
      case "boolean":
        fields[key] = val === true ? "true" : val === false ? "false" : String(val);
        break;
      case "number":
        fields[key] = String(val);
        break;
      default:
        fields[key] = String(val);
    }
  }
  return fields;
}

/**
 * Build the intake API payload from tree state + contact/location data.
 * Scoring and field mappings are driven by the tree's scoring config — not hardcoded.
 */
export function buildIntakePayload(
  state: TippyState,
  contact: { firstName: string; phone: string; email: string },
  place: { formatted_address?: string | null; display_name?: string | null; place_id?: string } | null,
  freeformAddress: string,
  tree?: TippyTree,
) {
  const scoring = tree ? getScoring(tree) : DEFAULT_SCORING_CONFIG;
  const outcome = state.outcome;
  const overrides = outcome?.intake_overrides ?? {};
  const tags = state.tags;

  // Build answers map from history
  const tippyAnswers: Record<string, string> = {};
  for (const entry of state.history) {
    tippyAnswers[entry.node_id] = entry.value;
  }

  // Derive cat count from configured tag keys (first numeric match wins)
  let catCount: number | undefined;
  for (const key of scoring.cat_count_tags) {
    if (typeof tags[key] === "number") {
      catCount = tags[key] as number;
      break;
    }
  }

  const catsAddress =
    place?.formatted_address || place?.display_name || freeformAddress.trim() || "Unknown";
  const phoneDigits = contact.phone.replace(/\D/g, "");

  // Compute priority score from configurable rules
  const priorityScore = computePriorityScore(tags, scoring.scoring_rules);

  // Map tags to custom_fields via configurable mappings
  const mappedFields = mapTagsToFields(tags, scoring.field_mappings);

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
    has_kittens: overrides.has_kittens || tags.has_kittens === true || undefined,
    has_medical_concerns: overrides.has_medical_concerns || undefined,
    custom_fields: {
      // Tree metadata (always present)
      tippy_branch: outcome?.type || "unknown",
      tippy_outcome: outcome?.headline || "unknown",
      tippy_answers: JSON.stringify(tippyAnswers),
      // Full tags dump (for Beacon deep queries)
      tippy_tags: JSON.stringify(tags),
      tippy_priority_score: String(priorityScore),
      tippy_cat_count: catCount != null ? String(catCount) : undefined,
      // Config-driven field mappings
      ...mappedFields,
    },
  };
}
