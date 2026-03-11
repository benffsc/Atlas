/**
 * Shared field option constants for the form system.
 *
 * Single source of truth for all option lists used across:
 *   - Print pages (abbreviated labels for space)
 *   - TemplateRenderer (full labels)
 *   - Submission validation (canonical values)
 *
 * Mirrors ops.form_field_definitions.options in the DB.
 * If you add/change an option here, also update MIG_2899 seed data.
 */

// ── Contact ──

export const PREFERRED_CONTACT_METHOD = ["Call", "Text", "Email"] as const;

// ── Location ──

export const COUNTY = ["Sonoma", "Marin", "Napa", "Other"] as const;

export const PROPERTY_TYPE = ["House", "Apartment", "Business", "Rural", "Other"] as const;
/** Abbreviated for print — matches PROPERTY_TYPE order */
export const PROPERTY_TYPE_PRINT = ["House", "Apt", "Biz", "Rural", "Other"] as const;

export const OWNERSHIP_STATUS = [
  "Stray (no owner)",
  "Community cat I feed",
  "Newcomer",
  "Neighbor's cat",
  "My pet",
] as const;

export const IS_PROPERTY_OWNER = ["Yes", "Renter", "Neighbor"] as const;

export const HAS_PROPERTY_ACCESS = ["Yes", "Need Permission", "No"] as const;
export const HAS_PROPERTY_ACCESS_PRINT = ["Yes", "Need perm", "No"] as const;

// ── Cat Info ──

export const COUNT_CONFIDENCE = ["Exact", "Estimate", "Unknown"] as const;

export const CATS_FRIENDLY = ["Yes", "No", "Mixed", "Unknown"] as const;

export const HANDLEABILITY = ["Carrier OK", "Shy but handleable", "Trap needed", "Mixed"] as const;

export const FIXED_STATUS = ["None fixed", "Some fixed", "All fixed", "Unknown"] as const;

export const COLONY_DURATION = ["<1 month", "1-6 months", "6mo-2yr", "2+ years", "Unknown"] as const;
export const COLONY_DURATION_PRINT = ["<1mo", "1-6mo", "6mo-2yr", "2+yr"] as const;

export const FEEDING_FREQUENCY = ["Daily", "Few times/week", "Occasionally", "Rarely"] as const;
export const FEEDING_FREQUENCY_PRINT = ["Daily", "Few times/wk", "Occasionally"] as const;

export const AWARENESS_DURATION = ["Days", "Weeks", "Months", "1+ year"] as const;

export const EARTIP_STATUS = ["None", "Some", "Most/All", "Unknown"] as const;

export const HOME_ACCESS = ["Yes", "Sometimes", "Never"] as const;

// ── Logistics ──

export const YES_NO = ["Yes", "No"] as const;
export const YES_NO_UNKNOWN = ["Yes", "No", "Unknown"] as const;

export const DOGS_ON_SITE = ["Yes", "No"] as const;
export const TRAP_SAVVY = ["Yes", "No", "Unknown"] as const;
export const PREVIOUS_TNR = ["Yes", "No", "Partial"] as const;
export const TRAPS_OVERNIGHT_SAFE = ["Yes", "No"] as const;
export const PERMISSION_STATUS = ["Yes", "Pending", "No"] as const;

// ── Kitten ──

export const KITTEN_AGE_ESTIMATE = [
  "Under 4 wks",
  "4-8 wks",
  "8-12 wks",
  "12-16 wks",
  "4+ months",
  "Mixed",
] as const;

export const KITTEN_BEHAVIOR = [
  "Friendly",
  "Shy but handleable",
  "Feral/hissy",
  "Unknown",
] as const;

/** Intake form uses more granular behavior options for kittens */
export const KITTEN_BEHAVIOR_INTAKE = [
  "Friendly (handleable)",
  "Shy but can pick up",
  "Shy/hissy (young)",
  "Unhandleable (older)",
  "Unknown",
] as const;

export const KITTEN_CONTAINED = ["Yes", "Some", "No"] as const;
export const KITTEN_CONTAINED_INTAKE = ["Yes, all caught", "Some caught", "No"] as const;

export const MOM_PRESENT = ["Yes", "No", "Unsure"] as const;
export const MOM_FIXED = ["Yes", "No", "Unsure"] as const;
export const CAN_BRING_IN = ["Yes", "Need Help", "No"] as const;
export const CAN_BRING_IN_PRINT = ["Yes", "Need help", "No"] as const;

export const KITTEN_OUTCOME = ["Foster intake", "FFR candidate", "Pending space", "Declined"] as const;
export const KITTEN_READINESS = [
  "High (friendly, ideal age)",
  "Medium (needs work)",
  "Low (FFR likely)",
] as const;
export const KITTEN_URGENCY = [
  "Bottle babies",
  "Medical needs",
  "Unsafe location",
  "Mom unfixed",
] as const;

// ── Medical ──

export const URGENCY_REASONS = [
  "Injured cat",
  "Sick cat",
  "Abandoned kittens",
  "Pregnant cat",
  "Immediate danger",
] as const;

// ── Staff ──

export const PRIORITY = ["High", "Normal", "Low"] as const;
export const TRIAGE_CATEGORY = ["FFR", "Wellness", "Owned", "Out of Area", "Review"] as const;
export const TRIAGE_CATEGORY_PRINT = ["FFR", "Wellness", "Owned", "Out of area", "Review"] as const;
export const INTAKE_SOURCE = ["Phone", "Paper", "Walk-in", "Website"] as const;

// ── Referral ──

export const REFERRAL_SOURCE = [
  "Website",
  "Social Media",
  "Friend",
  "Vet/Shelter",
  "Repeat Caller",
  "Other",
] as const;
export const REFERRAL_SOURCE_PRINT = ["Website", "Social", "Friend", "Vet/Shelter", "Repeat"] as const;

// ── Important Notes (multi-select checkboxes) ──

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

/** Abbreviated for trapper sheet */
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

// ── Recon checklist (trapper-specific) ──

export const RECON_CHECKLIST = [
  "Dogs",
  "Feeders",
  "Wildlife",
  "TrapSavvy",
  "SafeON",
  "Gate",
  "DropTrap",
] as const;

export const TRAP_DAY_CHECKLIST = [
  "Food withheld",
  "Contact notified",
  "Clinic confirmed",
  "Equip ready",
] as const;
