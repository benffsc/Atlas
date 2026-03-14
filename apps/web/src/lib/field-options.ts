/**
 * Curated print-form option subsets.
 *
 * These arrays have FEWER options than form-options.ts because paper forms
 * have limited space for bubbles/checkboxes. If the full option list fits
 * on paper, derive it from form-options.ts via getShortLabels() instead.
 *
 * All other option arrays live in form-options.ts (FFS-486/499).
 */

// ── Location (curated for print space) ──

/** Print forms show 4 counties; digital form (form-options.ts) has 6 */
export const COUNTY = ["Sonoma", "Marin", "Napa", "Other"] as const;

/** 5 property types for print; form-options.ts has 15 grouped options */
export const PROPERTY_TYPE_PRINT = ["House", "Apt", "Biz", "Rural", "Other"] as const;

/** 5 ownership statuses for print; form-options.ts has 6 */
export const OWNERSHIP_STATUS = [
  "Stray (no owner)",
  "Community cat I feed",
  "Newcomer",
  "Neighbor's cat",
  "My pet",
] as const;

// ── Cat Info (curated for print space) ──

/** 4 eartip statuses for print; form-options.ts has 6 */
export const EARTIP_STATUS = ["None", "Some", "Most/All", "Unknown"] as const;

/** 4 handleability options for print; form-options.ts has 5 (adds "Unknown") */
export const HANDLEABILITY = ["Carrier OK", "Shy but handleable", "Trap needed", "Mixed"] as const;

/** 4 colony durations for print; form-options.ts has 5 (adds "Unknown") */
export const COLONY_DURATION_PRINT = ["<1mo", "1-6mo", "6mo-2yr", "2+yr"] as const;

/** 3 feeding frequencies for print; form-options.ts has 6 */
export const FEEDING_FREQUENCY_PRINT = ["Daily", "Few times/wk", "Occasionally"] as const;

// ── Kitten (curated for print space) ──

/** 6 kitten age estimates for print; form-options.ts has 8 (more granular) */
export const KITTEN_AGE_ESTIMATE = [
  "Under 4 wks",
  "4-8 wks",
  "8-12 wks",
  "12-16 wks",
  "4+ months",
  "Mixed",
] as const;

/** 4 kitten behaviors for print; form-options.ts has 5 (adds "Mixed") */
export const KITTEN_BEHAVIOR = [
  "Friendly",
  "Shy but handleable",
  "Feral/hissy",
  "Unknown",
] as const;

/** 3 mom present options for print; form-options.ts has 4 (adds "Comes/goes") */
export const MOM_PRESENT = ["Yes", "No", "Unsure"] as const;

/** 4 kitten urgency factors for print; form-options.ts has 7 */
export const KITTEN_URGENCY = [
  "Bottle babies",
  "Medical needs",
  "Unsafe location",
  "Mom unfixed",
] as const;

// ── Referral (curated for print space) ──

/** 5 referral sources for print; form-options.ts has 12 */
export const REFERRAL_SOURCE_PRINT = ["Website", "Social", "Friend", "Vet/Shelter", "Repeat"] as const;

// ── Important Notes (curated for print space) ──

/** 9 important notes for call sheet print; form-options.ts has 13 */
export const IMPORTANT_NOTES = [
  "Withhold food 24hr before",
  "Other feeders in area",
  "Cats cross property lines",
  "Pregnant cat suspected",
  "Injured/sick cat priority",
  "Caller can help trap",
  "Wildlife concerns",
  "Neighbor issues",
  "Urgent / time-sensitive",
] as const;

/** Abbreviated for trapper sheet — matches IMPORTANT_NOTES order */
export const IMPORTANT_NOTES_SHORT = [
  "Withhold food",
  "Other feeders",
  "Cross prop lines",
  "Pregnant",
  "Injured/sick",
  "Caller help",
  "Wildlife",
  "Neighbor",
  "Urgent",
] as const;
