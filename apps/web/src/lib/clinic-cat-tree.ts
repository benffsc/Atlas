/**
 * Clinic Cat Decision Tree — Spay/Neuter Lobby Kiosk
 *
 * A specialized decision tree for the FFSC clinic lobby that:
 * 1. Separates individual cat (1-5) from colony (6+) intake paths
 * 2. Uses progressive behavioral disclosure to distinguish pet vs community cat
 * 3. Detects potential hoarding situations (system-level, invisible to user)
 * 4. Routes pet owners to external low-cost spay/neuter resources
 * 5. Routes community cat situations into FFR intake
 *
 * Two paths based on cat count:
 *   - Behavioral path (1-5 cats): sleeping → feeding → litter → vet → name → collar → approach
 *     Each question checks prior answers; early community-cat signals skip to approach.
 *   - Colony path (6+ cats): ear tips → growth → kittens → feeding → inside → property
 *
 * Both paths converge at shared nodes: ear tip → kittens → property (terminal).
 *
 * FFS-1099 (Digital Lobby Kiosk), FFS-1102 (Clinic Path)
 */

import type {
  TippyTreeConfig,
  TippyResourceCard,
  TippyScoringConfig,
} from "@/lib/tippy-tree";

// ── Classification Interface ─────────────────────────────────────────────────

export interface ClinicClassification {
  classification: "pet_redirect" | "ambiguous" | "community_cat" | "feral" | "colony";
  net_score: number;
  hoarding_flag: boolean;
  needs_trapper: boolean;
  has_kittens: boolean;
}

// ── Resource Cards ───────────────────────────────────────────────────────────

export const FFSC_RESOURCE_CARD: TippyResourceCard = {
  name: "Forgotten Felines of Sonoma County",
  description: "Free spay/neuter for community cats through our Find Fix Return program.",
  phone: "(707) 576-7999",
  address: "1814 Empire Industrial Ct, Santa Rosa",
  icon: "heart",
  urgency: "info",
};

export const PET_SPAY_RESOURCES: TippyResourceCard[] = [
  {
    name: "Sonoma Humane Society",
    description: "Low-cost spay/neuter for owned pets.",
    phone: "(707) 284-3499",
    icon: "heart-handshake",
    urgency: "info",
  },
  {
    name: "Love Me Fix Me",
    description: "Sonoma County's low-cost spay/neuter voucher program for pet owners.",
    phone: "(707) 565-7100",
    icon: "heart-pulse",
    urgency: "info",
  },
  {
    name: "Pets Lifeline",
    description: "Low-cost spay/neuter clinic in Sonoma.",
    phone: "(707) 996-4577",
    icon: "heart",
    urgency: "info",
  },
  {
    name: "Esperanza Spay & Neuter Truck",
    description: "Mobile low-cost spay/neuter service throughout Sonoma County.",
    phone: "(707) 304-6238",
    icon: "truck",
    urgency: "info",
  },
];

// ── Shared Outcome (used by both terminal property nodes) ────────────────────

const FFR_INTAKE_OUTCOME = {
  type: "ffsc_ffr" as const,
  headline: "We can help with that!",
  subtext: "We'll get your information and connect you with our team.",
  icon: "heart",
  resources: [FFSC_RESOURCE_CARD],
  creates_intake: true,
  intake_overrides: { call_type: "colony_tnr" },
};

// ── Scoring Config ───────────────────────────────────────────────────────────

export const CLINIC_SCORING_CONFIG: TippyScoringConfig = {
  cat_count_tags: ["cat_count"],
  scoring_rules: [
    // Per-question pet/community scores are summed by classifyCatFromTags(),
    // not by the generic computePriorityScore(). These rules handle priority scoring.
    { tag: "priority_boost", op: "numeric", points: 1 },
    { tag: "colony_likely", op: "truthy", points: 0 },
    { tag: "hoarding_flag", op: "truthy", points: 0 },
    { tag: "sterilization_gap", op: "equals", match: [1.0], points: 2 },
    { tag: "sterilization_gap", op: "equals", match: [0.5], points: 1 },
    { tag: "has_kittens", op: "equals", match: [true], points: 1 },
    { tag: "needs_trapper", op: "truthy", points: 1 },
  ],
  field_mappings: [
    { tag: "sleeping_location", field: "sleeping_location" },
    { tag: "feeding_location_raw", field: "feeding_location" },
    { tag: "litter_box", field: "litter_box" },
    { tag: "vet_history", field: "vet_history" },
    { tag: "collar_status", field: "collar_status" },
    { tag: "handleability", field: "handleability" },
    { tag: "ear_tip_coverage", field: "ear_tip_coverage" },
    { tag: "growth", field: "growth" },
    { tag: "has_kittens", field: "has_kittens", format: "boolean" },
    { tag: "caller_role", field: "caller_role" },
    { tag: "hoarding_flag", field: "hoarding_flag", format: "boolean" },
    { tag: "cats_inside", field: "cats_inside" },
    { tag: "fixed_status_raw", field: "fixed_status" },
    { tag: "name_response", field: "name_response" },
  ],
};

// ── Clinic Cat Tree ──────────────────────────────────────────────────────────

export const CLINIC_CAT_TREE: TippyTreeConfig = {
  scoring: CLINIC_SCORING_CONFIG,
  nodes: {

  // ════════════════════════════════════════════════════════════════════════════
  // ROOT — Cat count determines path
  // ════════════════════════════════════════════════════════════════════════════

  clinic_root: {
    id: "clinic_root",
    tippy_text: "How many cats are we talking about?",
    branch: "clinic_root",
    data_key: "cat_count",
    options: [
      { value: "one", label: "Just one", icon: "cat", next_node_id: "clinic_sleeping", tags: { cat_count: 1 } },
      { value: "few", label: "A few (2-5)", icon: "users", next_node_id: "clinic_sleeping", tags: { cat_count: 3 } },
      { value: "several", label: "Several (6+)", icon: "users", next_node_id: "clinic_colony_eartip", tags: { cat_count: 8 } },
      { value: "many", label: "A lot (10+)", icon: "users", next_node_id: "clinic_colony_eartip", tags: { cat_count: 15 } },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // BEHAVIORAL PATH (1-5 cats) — Progressive disclosure funnel
  //
  // Each node checks prior answers. If earlier signals indicate community cat,
  // skip deeper pet-detection questions and jump straight to clinic_approach.
  // ════════════════════════════════════════════════════════════════════════════

  // NOTE: Tag keys are per-question (pet_sleeping, pet_feeding, etc.) to avoid
  // overwrite collisions — the tree engine merges tags via spread, not addition.
  // classifyCatFromTags() sums all pet_* and community_* numeric values.

  clinic_sleeping: {
    id: "clinic_sleeping",
    tippy_text: "Where does the cat usually sleep?",
    branch: "clinic_behavioral",
    data_key: "sleeping_location",
    max_depth: 10,
    show_when: { node_id: "clinic_root", op: "in", values: ["one", "few"] },
    skip_to: "clinic_colony_eartip",
    options: [
      { value: "bed_couch", label: "On my bed or couch", icon: "sofa", next_node_id: "clinic_feeding", tags: { pet_sleeping: 3, sleeping_location: "bed_couch" } },
      { value: "inside_floor", label: "Inside, on the floor", icon: "home", next_node_id: "clinic_feeding", tags: { pet_sleeping: 2, sleeping_location: "inside_floor" } },
      { value: "porch_garage", label: "On the porch or in the garage", icon: "door-open", next_node_id: "clinic_feeding", tags: { pet_sleeping: 1, sleeping_location: "porch_garage" } },
      { value: "outside", label: "Outside somewhere", icon: "cloud-sun", next_node_id: "clinic_approach", tags: { community_sleeping: 2, sleeping_location: "outside" } },
    ],
  },

  clinic_feeding: {
    id: "clinic_feeding",
    tippy_text: "Where do you feed this cat?",
    branch: "clinic_behavioral",
    data_key: "feeding_location",
    show_when: { node_id: "clinic_sleeping", op: "in", values: ["bed_couch", "inside_floor", "porch_garage"] },
    skip_to: "clinic_approach",
    options: [
      { value: "kitchen", label: "In the kitchen", icon: "cooking-pot", next_node_id: "clinic_litter", tags: { pet_feeding: 3, feeding_location_raw: "kitchen" } },
      { value: "bedroom", label: "In the bedroom or living room", icon: "lamp", next_node_id: "clinic_litter", tags: { pet_feeding: 2, feeding_location_raw: "bedroom" } },
      { value: "porch", label: "On the porch", icon: "door-open", next_node_id: "clinic_litter", tags: { pet_feeding: 1, feeding_location_raw: "porch" } },
      { value: "outside", label: "Outside", icon: "trees", next_node_id: "clinic_approach", tags: { community_feeding: 1, feeding_location_raw: "outside" } },
    ],
  },

  clinic_litter: {
    id: "clinic_litter",
    tippy_text: "Does this cat use a litter box?",
    branch: "clinic_behavioral",
    data_key: "litter_box",
    show_when: { node_id: "clinic_feeding", op: "in", values: ["kitchen", "bedroom", "porch"] },
    skip_to: "clinic_approach",
    options: [
      { value: "yes", label: "Yes, always inside", icon: "box", next_node_id: "clinic_vet", tags: { pet_litter: 3, litter_box: "yes" } },
      { value: "sometimes", label: "Sometimes", icon: "minus", next_node_id: "clinic_vet", tags: { pet_litter: 1, litter_box: "sometimes" } },
      { value: "no", label: "No", icon: "x", next_node_id: "clinic_approach", tags: { community_litter: 1, litter_box: "no" } },
    ],
  },

  clinic_vet: {
    id: "clinic_vet",
    tippy_text: "Has this cat seen a vet before?",
    branch: "clinic_behavioral",
    data_key: "vet_history",
    show_when: { node_id: "clinic_litter", op: "in", values: ["yes", "sometimes"] },
    skip_to: "clinic_approach",
    options: [
      { value: "regular", label: "Yes, regularly", icon: "stethoscope", next_node_id: "clinic_name_response", tags: { pet_vet: 3, vet_history: "regular" } },
      { value: "once", label: "Once or twice", icon: "clipboard-check", next_node_id: "clinic_name_response", tags: { pet_vet: 1, vet_history: "once" } },
      { value: "never", label: "Never", icon: "x", next_node_id: "clinic_approach", tags: { community_vet: 1, vet_history: "never" } },
    ],
  },

  clinic_name_response: {
    id: "clinic_name_response",
    tippy_text: "Does the cat come when you call its name?",
    branch: "clinic_behavioral",
    data_key: "name_response",
    show_when: { node_id: "clinic_vet", op: "in", values: ["regular", "once"] },
    skip_to: "clinic_approach",
    options: [
      { value: "yes", label: "Yes, right away", icon: "volume-2", next_node_id: "clinic_collar", tags: { pet_name: 2, name_response: "yes" } },
      { value: "sometimes", label: "Sometimes", icon: "volume-1", next_node_id: "clinic_collar", tags: { pet_name: 1, name_response: "sometimes" } },
      { value: "no", label: "No", icon: "volume-x", next_node_id: "clinic_collar", tags: { name_response: "no" } },
    ],
  },

  clinic_collar: {
    id: "clinic_collar",
    tippy_text: "Does the cat have a collar or flea treatment?",
    branch: "clinic_behavioral",
    data_key: "collar_status",
    options: [
      { value: "collar", label: "Yes, a collar", icon: "tag", next_node_id: "clinic_approach", tags: { pet_collar: 2, collar_status: "collar" } },
      { value: "flea_treatment", label: "Flea treatment", icon: "shield-check", next_node_id: "clinic_approach", tags: { pet_collar: 2, collar_status: "flea_treatment" } },
      { value: "no", label: "No", icon: "minus", next_node_id: "clinic_approach", tags: { collar_status: "none" } },
    ],
  },

  clinic_approach: {
    id: "clinic_approach",
    tippy_text: "Can you pick up or hold this cat?",
    branch: "clinic_behavioral",
    data_key: "handleability",
    options: [
      { value: "friendly", label: "Yes, easily", icon: "hand", next_node_id: "clinic_eartip", tags: { pet_approach: 2, handleability: "friendly_carrier" } },
      { value: "careful", label: "Yes, but carefully", icon: "shield", next_node_id: "clinic_eartip", tags: { pet_approach: 1, handleability: "shy_handleable" } },
      { value: "close_no_touch", label: "I can get close but can't touch", icon: "eye", next_node_id: "clinic_eartip", tags: { community_approach: 1, handleability: "shy_handleable" } },
      { value: "runs_away", label: "No, it runs away", icon: "rabbit", next_node_id: "clinic_eartip", tags: { community_approach: 3, handleability: "unhandleable_trap", needs_trapper: true } },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // SHARED CONVERGENCE NODES — Both paths end here
  // ════════════════════════════════════════════════════════════════════════════

  clinic_eartip: {
    id: "clinic_eartip",
    tippy_text: "Does this cat have a tipped (flat-cut) left ear?",
    help_text: "A tipped ear means the cat has already been spayed or neutered.",
    branch: "clinic_shared",
    data_key: "ear_tip_status",
    show_when: { node_id: "clinic_root", op: "in", values: ["one", "few"] },
    skip_to: "clinic_kittens",
    options: [
      { value: "yes", label: "Yes, ear is tipped", icon: "check-circle", next_node_id: "clinic_kittens", tags: { ear_tip_status: "tipped", already_fixed: true } },
      { value: "no", label: "No", icon: "x-circle", next_node_id: "clinic_kittens", tags: { ear_tip_status: "not_tipped" } },
      { value: "unsure", label: "I'm not sure", icon: "help-circle", next_node_id: "clinic_kittens", tags: { ear_tip_status: "unsure" } },
    ],
  },

  clinic_kittens: {
    id: "clinic_kittens",
    tippy_text: "Are there kittens?",
    branch: "clinic_shared",
    data_key: "has_kittens",
    options: [
      { value: "yes", label: "Yes", icon: "baby", next_node_id: "clinic_property", tags: { has_kittens: true, priority_boost: 1 } },
      { value: "no", label: "No", icon: "x", next_node_id: "clinic_property", tags: { has_kittens: false } },
    ],
  },

  clinic_property: {
    id: "clinic_property",
    tippy_text: "What's your relationship to this property?",
    branch: "clinic_shared",
    data_key: "caller_role",
    options: [
      { value: "resident", label: "I live here", icon: "home", next_node_id: null, tags: { caller_role: "resident", property_access: true } },
      { value: "neighbor", label: "I'm a neighbor", icon: "users", next_node_id: null, tags: { caller_role: "neighbor", property_access: false } },
      { value: "manager", label: "I manage this property", icon: "building", next_node_id: null, tags: { caller_role: "property_manager", property_access: true } },
      { value: "other", label: "Other", icon: "circle-dot", next_node_id: null, tags: { caller_role: "other", property_access: false } },
    ],
    outcome: FFR_INTAKE_OUTCOME,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // COLONY PATH (6+ cats) — Colony-specific assessment
  // ════════════════════════════════════════════════════════════════════════════

  clinic_colony_eartip: {
    id: "clinic_colony_eartip",
    tippy_text: "Do any of the cats have tipped (flat-cut) left ears?",
    help_text: "A tipped ear means the cat has already been spayed or neutered.",
    branch: "clinic_colony",
    data_key: "ear_tip_coverage",
    max_depth: 8,
    options: [
      { value: "most", label: "Yes, most of them", icon: "check-circle", next_node_id: "clinic_colony_growth", tags: { ear_tip_coverage: "most_fixed", fixed_status_raw: "most_fixed", community_eartip: 2 } },
      { value: "some", label: "Yes, some", icon: "minus-circle", next_node_id: "clinic_colony_growth", tags: { ear_tip_coverage: "some_fixed", fixed_status_raw: "some_fixed", community_eartip: 2, sterilization_gap: 0.5 } },
      { value: "none", label: "No, none", icon: "x-circle", next_node_id: "clinic_colony_growth", tags: { ear_tip_coverage: "none_fixed", fixed_status_raw: "none_fixed", community_eartip: 3, sterilization_gap: 1.0 } },
      { value: "unsure", label: "I'm not sure", icon: "help-circle", next_node_id: "clinic_colony_growth", tags: { ear_tip_coverage: "unsure", fixed_status_raw: "unknown" } },
    ],
  },

  clinic_colony_growth: {
    id: "clinic_colony_growth",
    tippy_text: "Are new cats showing up?",
    branch: "clinic_colony",
    data_key: "growth",
    options: [
      { value: "growing", label: "Yes, more keep coming", icon: "trending-up", next_node_id: "clinic_colony_kittens", tags: { growth: "growing", priority_boost: 2 } },
      { value: "stable", label: "About the same", icon: "minus", next_node_id: "clinic_colony_kittens", tags: { growth: "stable" } },
      { value: "shrinking", label: "Fewer than before", icon: "trending-down", next_node_id: "clinic_colony_kittens", tags: { growth: "shrinking" } },
    ],
  },

  clinic_colony_kittens: {
    id: "clinic_colony_kittens",
    tippy_text: "Are there kittens?",
    branch: "clinic_colony",
    data_key: "has_kittens",
    options: [
      { value: "yes", label: "Yes", icon: "baby", next_node_id: "clinic_colony_feeding", tags: { has_kittens: true, priority_boost: 1 } },
      { value: "pregnant", label: "No, but a cat looks pregnant", icon: "heart-pulse", next_node_id: "clinic_colony_feeding", tags: { has_kittens: false, pregnant_suspected: true, priority_boost: 2 } },
      { value: "no", label: "No", icon: "x", next_node_id: "clinic_colony_feeding", tags: { has_kittens: false } },
    ],
  },

  clinic_colony_feeding: {
    id: "clinic_colony_feeding",
    tippy_text: "Is someone feeding these cats regularly?",
    branch: "clinic_colony",
    data_key: "feeding",
    options: [
      { value: "self", label: "Yes, I feed them", icon: "utensils", next_node_id: "clinic_colony_inside", tags: { has_feeder: true, feeder_is_caller: true } },
      { value: "other", label: "Yes, someone else does", icon: "user", next_node_id: "clinic_colony_inside", tags: { has_feeder: true, feeder_is_caller: false } },
      { value: "no", label: "Not regularly", icon: "x", next_node_id: "clinic_colony_inside", tags: { has_feeder: false } },
    ],
  },

  clinic_colony_inside: {
    id: "clinic_colony_inside",
    tippy_text: "Do any of these cats live inside your home?",
    help_text: "It's OK either way — this helps us understand the situation.",
    branch: "clinic_colony",
    data_key: "cats_inside",
    options: [
      { value: "all", label: "Yes, all of them", icon: "home", next_node_id: "clinic_colony_property", tags: { cats_inside: "all", pet_inside: 3 } },
      { value: "some", label: "Some come inside", icon: "door-open", next_node_id: "clinic_colony_property", tags: { cats_inside: "some", pet_inside: 1 } },
      { value: "none", label: "No, they're all outside", icon: "cloud-sun", next_node_id: "clinic_colony_property", tags: { cats_inside: "none", community_inside: 2, colony_likely: true } },
    ],
  },

  clinic_colony_property: {
    id: "clinic_colony_property",
    tippy_text: "What's your relationship to this property?",
    branch: "clinic_colony",
    data_key: "caller_role",
    options: [
      { value: "resident", label: "I live here", icon: "home", next_node_id: null, tags: { caller_role: "resident", property_access: true } },
      { value: "neighbor", label: "I'm a neighbor", icon: "users", next_node_id: null, tags: { caller_role: "neighbor", property_access: false } },
      { value: "manager", label: "I manage this property", icon: "building", next_node_id: null, tags: { caller_role: "property_manager", property_access: true } },
      { value: "other", label: "Other", icon: "circle-dot", next_node_id: null, tags: { caller_role: "other", property_access: false } },
    ],
    outcome: FFR_INTAKE_OUTCOME,
  },

  }, // end nodes
};

// ── Classification Function ──────────────────────────────────────────────────
//
// Interprets accumulated tags into a structured classification.
// Called after tree traversal completes to determine routing:
//   - pet_redirect → show PET_SPAY_RESOURCES
//   - ambiguous → FFR intake with note for staff review
//   - community_cat / feral → standard FFR intake
//   - colony → FFR intake with colony-specific fields

export function classifyCatFromTags(
  tags: Record<string, string | number | boolean>,
): ClinicClassification {
  // Sum all per-question pet_* and community_* numeric tags.
  // Tag keys are unique per question (pet_sleeping, pet_feeding, etc.) to avoid
  // overwrite collisions in the tree engine's spread-merge behavior.
  let petScore = 0;
  let communityScore = 0;

  for (const [key, val] of Object.entries(tags)) {
    if (typeof val !== "number") continue;
    if (key.startsWith("pet_")) petScore += val;
    else if (key.startsWith("community_")) communityScore += val;
  }

  const netScore = petScore - communityScore;

  // Hoarding detection (system-level, never surfaced to user)
  const catCount = typeof tags.cat_count === "number" ? tags.cat_count : 0;
  const hoardingFlag =
    catCount >= 6 &&
    tags.cats_inside === "all" &&
    tags.fixed_status_raw === "none_fixed";

  const needsTrapper = tags.needs_trapper === true;
  const hasKittens = tags.has_kittens === true;

  // Classification thresholds
  let classification: ClinicClassification["classification"];
  if (netScore >= 7) {
    classification = "pet_redirect";
  } else if (netScore >= 3) {
    classification = "ambiguous";
  } else if (netScore >= 0) {
    classification = "community_cat";
  } else {
    classification = catCount >= 6 ? "colony" : "feral";
  }

  return {
    classification,
    net_score: netScore,
    hoarding_flag: hoardingFlag,
    needs_trapper: needsTrapper,
    has_kittens: hasKittens,
  };
}
