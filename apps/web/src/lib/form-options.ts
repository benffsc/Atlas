/**
 * Centralized Form Option Registry
 *
 * SINGLE SOURCE OF TRUTH for all form field options across Atlas.
 * Every dropdown, radio group, and checkbox list reads from here.
 *
 * Design:
 *   - `value`      — canonical DB value (snake_case), stored in ops.requests / ops.intake_submissions
 *   - `label`      — full human-readable label for digital forms
 *   - `shortLabel`  — abbreviated label for print forms (defaults to label)
 *   - `description` — help text shown under radio/checkbox options
 *   - `group`       — visual grouping for long option lists
 *
 * Consumers:
 *   - Digital forms: import { PROPERTY_TYPE_OPTIONS } and use .label
 *   - Print forms:   import { PROPERTY_TYPE_OPTIONS } and use .shortLabel
 *   - API validation: import { getValues } and use getValues(PROPERTY_TYPE_OPTIONS)
 *   - enums.ts:      derives const arrays from getValues()
 *
 * FFS-486: Centralize form option registry
 * @see CLAUDE.md invariant 48: All enum validation MUST use central registry
 */

// =============================================================================
// TYPES
// =============================================================================

export interface FormOption {
  readonly value: string;
  readonly label: string;
  readonly shortLabel?: string;
  readonly description?: string;
  readonly group?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Extract just the values from an options array (for enums.ts / API validation) */
export function getValues<T extends readonly FormOption[]>(options: T): string[] {
  return options.map((o) => o.value);
}

/** Get the label for a value, or the value itself if not found */
export function getLabel(options: readonly FormOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Get the short label for a value (falls back to label, then value) */
export function getShortLabel(options: readonly FormOption[], value: string): string {
  const opt = options.find((o) => o.value === value);
  return opt?.shortLabel ?? opt?.label ?? value;
}

/** Get labels as a simple string array (for print form fields that use full labels) */
export function getLabels(options: readonly FormOption[]): string[] {
  return options.map((o) => o.label);
}

/** Get short labels as a simple string array (for print form checkboxes/bubbles) */
export function getShortLabels(options: readonly FormOption[]): string[] {
  return options.map((o) => o.shortLabel ?? o.label);
}

/** Convert to {value, label} pairs for <select> / radio UI components */
export function toSelectOptions(options: readonly FormOption[]): { value: string; label: string }[] {
  return options.map((o) => ({ value: o.value, label: o.label }));
}

// =============================================================================
// CONTACT
// =============================================================================

export const PREFERRED_CONTACT_METHOD_OPTIONS = [
  { value: "call", label: "Call", shortLabel: "Call" },
  { value: "text", label: "Text", shortLabel: "Text" },
  { value: "email", label: "Email", shortLabel: "Email" },
] as const satisfies readonly FormOption[];

export const CALL_TYPE_OPTIONS = [
  { value: "pet_spay_neuter", label: "Pet Spay/Neuter", description: "Caller's own cat needs to be fixed" },
  { value: "wellness_check", label: "Wellness / Already Fixed", description: "Cat is already fixed, needs medical attention" },
  { value: "single_stray", label: "Single Stray or Newcomer", description: "One unfamiliar cat showed up recently" },
  { value: "colony_tnr", label: "Colony / FFR Request", description: "Multiple outdoor cats needing FFR" },
  { value: "kitten_rescue", label: "Kitten Situation", description: "Kittens found, may need foster" },
  { value: "medical_concern", label: "Medical Concern / Injured", description: "Cat appears injured or sick" },
  { value: "relocation", label: "Cat Relocation", description: "Cats need to be moved to a different location" },
  { value: "caretaker_support", label: "Caretaker Support", description: "Existing colony caretaker needs help or supplies" },
  { value: "info_only", label: "Information / Resources", description: "Caller seeking information, not requesting service" },
] as const satisfies readonly FormOption[];

// =============================================================================
// LOCATION
// =============================================================================

export const COUNTY_OPTIONS = [
  { value: "Sonoma", label: "Sonoma" },
  { value: "Marin", label: "Marin" },
  { value: "Napa", label: "Napa" },
  { value: "Mendocino", label: "Mendocino" },
  { value: "Lake", label: "Lake" },
  { value: "Other", label: "Other" },
] as const satisfies readonly FormOption[];

export const PROPERTY_TYPE_OPTIONS = [
  // Residential
  { value: "private_home", label: "Private Home", shortLabel: "House", group: "Residential" },
  { value: "condo_townhome", label: "Condo/Townhome", shortLabel: "Condo", group: "Residential" },
  { value: "duplex_multiplex", label: "Duplex/Multiplex", shortLabel: "Duplex", group: "Residential" },
  { value: "apartment_complex", label: "Apartment Complex", shortLabel: "Apt", group: "Residential" },
  { value: "mobile_home_park", label: "Mobile Home Park", shortLabel: "Mobile", group: "Residential" },
  { value: "farm_ranch", label: "Farm/Ranch", shortLabel: "Farm", group: "Residential" },
  { value: "rural_unincorporated", label: "Rural/Unincorporated", shortLabel: "Rural", group: "Residential" },
  // Commercial / Institutional
  { value: "business", label: "Business/Commercial", shortLabel: "Biz", group: "Commercial" },
  { value: "industrial", label: "Industrial/Warehouse", shortLabel: "Industrial", group: "Commercial" },
  { value: "school_campus", label: "School/Campus", shortLabel: "School", group: "Commercial" },
  { value: "church_religious", label: "Church/Religious", shortLabel: "Church", group: "Commercial" },
  { value: "government_municipal", label: "Government/Municipal", shortLabel: "Gov", group: "Commercial" },
  // Outdoor / Other
  { value: "public_park", label: "Public Park/Open Space", shortLabel: "Park", group: "Outdoor" },
  { value: "vacant_lot", label: "Vacant Lot/Undeveloped", shortLabel: "Vacant", group: "Outdoor" },
  { value: "other", label: "Other", shortLabel: "Other", group: "Outdoor" },
] as const satisfies readonly FormOption[];

export const OWNERSHIP_OPTIONS = [
  { value: "unknown_stray", label: "Stray cat (no apparent owner)", shortLabel: "Stray (no owner)", description: "No one claims or feeds this cat" },
  { value: "community_colony", label: "Community cat I/someone feeds", shortLabel: "Outdoor cat I/someone feeds", description: "Outdoor cat being fed by someone" },
  { value: "newcomer", label: "Newcomer (just showed up recently)", shortLabel: "Newcomer (just appeared)", description: "Cat just appeared recently" },
  { value: "neighbors_cat", label: "Neighbor's cat", shortLabel: "Neighbor's cat", description: "Belongs to a neighbor" },
  { value: "my_cat", label: "My own pet", shortLabel: "My pet", description: "Caller owns this cat" },
  { value: "unsure", label: "Unsure", shortLabel: "Unsure", description: "Caller doesn't know" },
] as const satisfies readonly FormOption[];

export const IS_PROPERTY_OWNER_OPTIONS = [
  { value: "yes", label: "Yes", shortLabel: "Yes" },
  { value: "renter", label: "Renter", shortLabel: "Renter" },
  { value: "neighbor", label: "Neighbor", shortLabel: "Neighbor" },
] as const satisfies readonly FormOption[];

export const HAS_PROPERTY_ACCESS_OPTIONS = [
  { value: "yes", label: "Yes", shortLabel: "Yes" },
  { value: "need_permission", label: "Need Permission", shortLabel: "Need perm" },
  { value: "no", label: "No", shortLabel: "No" },
] as const satisfies readonly FormOption[];

// =============================================================================
// CAT INFO
// =============================================================================

export const COUNT_CONFIDENCE_OPTIONS = [
  { value: "exact", label: "Exact count", shortLabel: "Exact", description: "Caller knows exactly how many cats there are" },
  { value: "good_estimate", label: "Good estimate", shortLabel: "Estimate", description: "Caller has a reliable estimate based on regular observation" },
  { value: "rough_guess", label: "Rough guess", shortLabel: "Guess", description: "Caller is uncertain, number could vary significantly" },
  { value: "unknown", label: "Unknown", shortLabel: "Unknown", description: "Caller can't estimate with any confidence" },
] as const satisfies readonly FormOption[];

export const CATS_FRIENDLY_OPTIONS = [
  { value: "yes", label: "Yes", shortLabel: "Yes" },
  { value: "no", label: "No", shortLabel: "No" },
  { value: "mixed", label: "Mixed", shortLabel: "Mixed" },
  { value: "unknown", label: "Unknown", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

export const HANDLEABILITY_OPTIONS = [
  { value: "friendly_carrier", label: "Friendly - can use a carrier", shortLabel: "Carrier OK", description: "Cat can be picked up or put in a carrier" },
  { value: "shy_handleable", label: "Shy but handleable", shortLabel: "Shy but handleable", description: "Nervous but can be approached and contained with patience" },
  { value: "unhandleable_trap", label: "Unhandleable - will need trap", shortLabel: "Trap needed", description: "Cannot be touched, runs away, will require humane trap" },
  { value: "some_friendly", label: "Mixed (some friendly, some feral)", shortLabel: "Mixed", description: "Some cats are friendly, others need traps" },
  { value: "unknown", label: "Unknown / Haven't tried", shortLabel: "Unknown", description: "Caller hasn't tried to approach" },
] as const satisfies readonly FormOption[];

export const FIXED_STATUS_OPTIONS = [
  { value: "none_fixed", label: "None appear fixed", shortLabel: "None fixed", description: "No cats appear to be fixed" },
  { value: "some_fixed", label: "Some are fixed (ear-tipped)", shortLabel: "Some fixed", description: "A few cats are already fixed" },
  { value: "most_fixed", label: "Most or all are fixed", shortLabel: "Most/all fixed", description: "Majority are already fixed" },
  { value: "all_fixed", label: "All have ear tips", shortLabel: "All fixed", description: "All cats appear fixed" },
  { value: "unknown", label: "Unknown / Can't tell", shortLabel: "Unknown", description: "Caller can't see ear tips" },
] as const satisfies readonly FormOption[];

export const COLONY_DURATION_OPTIONS = [
  { value: "under_1_month", label: "Less than a month", shortLabel: "<1mo", description: "New situation, cats recently appeared" },
  { value: "1_to_6_months", label: "1-6 months", shortLabel: "1-6mo", description: "Relatively recent, cats have been around a while" },
  { value: "6_to_24_months", label: "6 months to 2 years", shortLabel: "6mo-2yr", description: "Established situation" },
  { value: "over_2_years", label: "Over 2 years", shortLabel: "2+yr", description: "Long-established colony or ongoing situation" },
  { value: "unknown", label: "Unknown / Not sure", shortLabel: "Unknown", description: "Caller doesn't know how long cats have been there" },
] as const satisfies readonly FormOption[];

export const FEEDING_FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily (scheduled times)", shortLabel: "Daily" },
  { value: "free_fed", label: "Free-fed (food always out)", shortLabel: "Free-fed" },
  { value: "few_times_week", label: "A few times a week", shortLabel: "Few times/wk" },
  { value: "occasionally", label: "Occasionally", shortLabel: "Occasionally" },
  { value: "rarely", label: "Rarely", shortLabel: "Rarely" },
  { value: "not_fed", label: "Not being fed", shortLabel: "Not fed", description: "No one is feeding these cats" },
] as const satisfies readonly FormOption[];

export const FEEDING_DURATION_OPTIONS = [
  { value: "just_started", label: "Just started (days)" },
  { value: "few_weeks", label: "A few weeks" },
  { value: "few_months", label: "A few months" },
  { value: "over_year", label: "Over a year" },
] as const satisfies readonly FormOption[];

export const AWARENESS_DURATION_OPTIONS = [
  { value: "days", label: "Days", shortLabel: "Days" },
  { value: "weeks", label: "Weeks", shortLabel: "Weeks" },
  { value: "months", label: "Months", shortLabel: "Months" },
  { value: "years", label: "1+ year", shortLabel: "1+ year" },
] as const satisfies readonly FormOption[];

export const EARTIP_ESTIMATE_OPTIONS = [
  { value: "none", label: "None ear-tipped", shortLabel: "None" },
  { value: "few", label: "A few (less than 25%)", shortLabel: "Some" },
  { value: "some", label: "Some (25-50%)", shortLabel: "Some" },
  { value: "most", label: "Most (50-75%)", shortLabel: "Most/All" },
  { value: "all", label: "All or almost all (75%+)", shortLabel: "Most/All" },
  { value: "unknown", label: "Unknown", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

export const CAT_INSIDE_OPTIONS = [
  { value: "yes_regularly", label: "Yes, regularly" },
  { value: "sometimes", label: "Sometimes" },
  { value: "never", label: "Never / Outdoor only" },
] as const satisfies readonly FormOption[];

export const HOME_ACCESS_OPTIONS = [
  { value: "yes", label: "Yes", shortLabel: "Yes" },
  { value: "sometimes", label: "Sometimes", shortLabel: "Sometimes" },
  { value: "never", label: "Never", shortLabel: "Never" },
] as const satisfies readonly FormOption[];

// =============================================================================
// LOGISTICS
// =============================================================================

export const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const satisfies readonly FormOption[];

export const YES_NO_UNKNOWN_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
] as const satisfies readonly FormOption[];

export const DOGS_ON_SITE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const satisfies readonly FormOption[];

export const TRAP_SAVVY_OPTIONS = [
  { value: "yes", label: "Yes", shortLabel: "Yes" },
  { value: "no", label: "No", shortLabel: "No" },
  { value: "unknown", label: "Unknown", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

export const PREVIOUS_TNR_OPTIONS = [
  { value: "yes", label: "Yes", shortLabel: "Yes" },
  { value: "no", label: "No", shortLabel: "No" },
  { value: "partial", label: "Partial", shortLabel: "Partial" },
] as const satisfies readonly FormOption[];

export const TRAPS_OVERNIGHT_SAFE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const satisfies readonly FormOption[];

export const PERMISSION_STATUS_OPTIONS = [
  { value: "yes", label: "Yes - Permission granted", shortLabel: "Yes" },
  { value: "pending", label: "Pending - Waiting for response", shortLabel: "Pending" },
  { value: "no", label: "No - Permission denied", shortLabel: "No" },
  { value: "not_needed", label: "Not needed - Public property", shortLabel: "Not needed" },
  { value: "unknown", label: "Unknown", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

// =============================================================================
// KITTENS
// =============================================================================

export const KITTEN_AGE_OPTIONS = [
  { value: "newborn", label: "Newborn (eyes closed)", shortLabel: "Under 4 wks" },
  { value: "2_3_weeks", label: "2-3 weeks (eyes open, wobbly)", shortLabel: "Under 4 wks" },
  { value: "4_5_weeks", label: "4-5 weeks (walking, playing)", shortLabel: "4-8 wks" },
  { value: "6_8_weeks", label: "6-8 weeks (weaning age)", shortLabel: "4-8 wks" },
  { value: "8_12_weeks", label: "8-12 weeks (ready for adoption)", shortLabel: "8-12 wks" },
  { value: "over_12_weeks", label: "Over 12 weeks", shortLabel: "12-16 wks" },
  { value: "mixed_ages", label: "Mixed ages", shortLabel: "Mixed" },
  { value: "unknown", label: "Unknown / Not sure", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

export const KITTEN_BEHAVIOR_OPTIONS = [
  { value: "friendly", label: "Friendly - approaches people", shortLabel: "Friendly" },
  { value: "shy", label: "Shy - hides but can be approached", shortLabel: "Shy but handleable" },
  { value: "feral", label: "Feral - hisses, runs away", shortLabel: "Feral/hissy" },
  { value: "mixed", label: "Mixed behaviors", shortLabel: "Mixed" },
  { value: "unknown", label: "Unknown", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

/** More granular behavior options for intake forms */
export const KITTEN_BEHAVIOR_INTAKE_OPTIONS = [
  { value: "friendly_handleable", label: "Friendly (handleable)", shortLabel: "Friendly (handleable)" },
  { value: "shy_can_pick_up", label: "Shy but can pick up", shortLabel: "Shy but can pick up" },
  { value: "shy_hissy_young", label: "Shy/hissy (young)", shortLabel: "Shy/hissy (young)" },
  { value: "unhandleable_older", label: "Unhandleable (older)", shortLabel: "Unhandleable (older)" },
  { value: "unknown", label: "Unknown", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

export const KITTEN_CONTAINED_OPTIONS = [
  { value: "yes", label: "Yes, all caught", shortLabel: "Yes" },
  { value: "some", label: "Some caught", shortLabel: "Some" },
  { value: "no", label: "No", shortLabel: "No" },
] as const satisfies readonly FormOption[];

export const MOM_PRESENT_OPTIONS = [
  { value: "yes_present", label: "Yes, mom is present", shortLabel: "Yes" },
  { value: "comes_goes", label: "Comes and goes", shortLabel: "Comes/goes" },
  { value: "not_seen", label: "Haven't seen mom", shortLabel: "No" },
  { value: "unknown", label: "Unknown", shortLabel: "Unsure" },
] as const satisfies readonly FormOption[];

export const MOM_FIXED_OPTIONS = [
  { value: "yes", label: "Yes (ear-tipped)", shortLabel: "Yes" },
  { value: "no", label: "No / Don't think so", shortLabel: "No" },
  { value: "unknown", label: "Unknown", shortLabel: "Unsure" },
] as const satisfies readonly FormOption[];

export const CAN_BRING_IN_OPTIONS = [
  { value: "yes", label: "Yes", shortLabel: "Yes" },
  { value: "need_help", label: "Need Help", shortLabel: "Need help" },
  { value: "no", label: "No", shortLabel: "No" },
] as const satisfies readonly FormOption[];

export const KITTEN_OUTCOME_OPTIONS = [
  { value: "foster_intake", label: "Foster intake", shortLabel: "Foster intake" },
  { value: "ffr_candidate", label: "FFR candidate", shortLabel: "FFR candidate" },
  { value: "tnr_candidate", label: "FFR candidate (unhandleable/older)", shortLabel: "FFR candidate" },
  { value: "pending_space", label: "Pending space", shortLabel: "Pending space" },
  { value: "return_to_colony", label: "Return to colony", shortLabel: "Return to colony" },
  { value: "declined", label: "Declined", shortLabel: "Declined" },
] as const satisfies readonly FormOption[];

/** Assessment outcomes — what happened after in-person kitten assessment (FFS-559) */
export const KITTEN_ASSESSMENT_OUTCOME_OPTIONS = [
  { value: "taken_in", label: "Taken in (foster/shelter)", shortLabel: "Taken in" },
  { value: "tnr", label: "TNR'd (returned to field)", shortLabel: "TNR'd" },
  { value: "redirected", label: "Redirected to another shelter", shortLabel: "Redirected" },
  { value: "temp_hold", label: "Temporary hold (caller keeping)", shortLabel: "Temp hold" },
  { value: "no_action", label: "No action needed", shortLabel: "No action" },
] as const satisfies readonly FormOption[];

export const KITTEN_READINESS_OPTIONS = [
  { value: "high", label: "High (friendly, ideal age)", shortLabel: "High (friendly, ideal age)" },
  { value: "medium", label: "Medium (needs work)", shortLabel: "Medium (needs work)" },
  { value: "low", label: "Low (FFR likely)", shortLabel: "Low (FFR likely)" },
] as const satisfies readonly FormOption[];

export const KITTEN_URGENCY_OPTIONS = [
  { value: "bottle_babies", label: "Bottle babies (need bottle feeding)", shortLabel: "Bottle babies" },
  { value: "orphaned", label: "Orphaned (no mom present)", shortLabel: "Orphaned" },
  { value: "fading", label: "Fading / declining health", shortLabel: "Fading" },
  { value: "medical_needs", label: "Medical needs", shortLabel: "Medical needs" },
  { value: "unsafe_location", label: "Unsafe location", shortLabel: "Unsafe location" },
  { value: "exposed_elements", label: "Exposed to elements (no shelter)", shortLabel: "Exposed" },
  { value: "mom_unfixed", label: "Mom unfixed", shortLabel: "Mom unfixed" },
] as const satisfies readonly FormOption[];

// =============================================================================
// MEDICAL / URGENCY
// =============================================================================

export const URGENCY_REASON_OPTIONS = [
  { value: "kittens", label: "Young kittens present" },
  { value: "sick_injured", label: "Sick or injured cat(s)" },
  { value: "threat", label: "Cats at risk (neighbor threat, etc.)" },
  { value: "poison", label: "Poison risk" },
  { value: "eviction", label: "Eviction/property issue" },
  { value: "moving", label: "Requester moving soon" },
  { value: "pregnant", label: "Pregnant cat(s)" },
  { value: "nursing_mother", label: "Nursing mother with kittens" },
  { value: "weather", label: "Weather concerns" },
  { value: "hoarding", label: "Hoarding situation" },
  { value: "property_threat", label: "Property threat (construction, demolition, sale)" },
  { value: "no_caretaker", label: "Colony with no caretaker" },
  { value: "colony_growth", label: "Rapid colony growth / reproduction" },
  { value: "public_health", label: "Public health concern" },
] as const satisfies readonly FormOption[];

export const URGENT_SITUATION_EXAMPLES =
  "pregnant female, cat safety at risk, stray cat needs non-immediate medical attention";

export const URGENT_SITUATION_LABEL = "This is an urgent situation";

// =============================================================================
// STAFF
// =============================================================================

export const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent", shortLabel: "Urgent" },
  { value: "high", label: "High", shortLabel: "High" },
  { value: "normal", label: "Normal", shortLabel: "Normal" },
  { value: "low", label: "Low", shortLabel: "Low" },
] as const satisfies readonly FormOption[];

export const TRIAGE_CATEGORY_OPTIONS = [
  { value: "ffr", label: "FFR", shortLabel: "FFR" },
  { value: "wellness", label: "Wellness", shortLabel: "Wellness" },
  { value: "owned", label: "Owned", shortLabel: "Owned" },
  { value: "out_of_area", label: "Out of Area", shortLabel: "Out of area" },
  { value: "review", label: "Review", shortLabel: "Review" },
] as const satisfies readonly FormOption[];

export const INTAKE_SOURCE_OPTIONS = [
  { value: "phone", label: "Phone", shortLabel: "Phone" },
  { value: "paper", label: "Paper", shortLabel: "Paper" },
  { value: "walk_in", label: "Walk-in", shortLabel: "Walk-in" },
  { value: "website", label: "Website", shortLabel: "Website" },
] as const satisfies readonly FormOption[];

// =============================================================================
// REFERRAL
// =============================================================================

export const REFERRAL_SOURCE_OPTIONS = [
  { value: "website", label: "FFSC Website", shortLabel: "Website" },
  { value: "google", label: "Google search", shortLabel: "Google" },
  { value: "facebook", label: "Facebook", shortLabel: "Facebook" },
  { value: "instagram", label: "Instagram", shortLabel: "Instagram" },
  { value: "nextdoor", label: "Nextdoor", shortLabel: "Nextdoor" },
  { value: "friend_family", label: "Friend or family", shortLabel: "Friend" },
  { value: "vet", label: "Veterinarian", shortLabel: "Vet/Shelter" },
  { value: "shelter", label: "Shelter / Animal services", shortLabel: "Vet/Shelter" },
  { value: "animal_control", label: "Animal control / City services", shortLabel: "Animal ctrl" },
  { value: "community_event", label: "Community event / Workshop", shortLabel: "Event" },
  { value: "repeat_caller", label: "Have called before", shortLabel: "Repeat" },
  { value: "other", label: "Other", shortLabel: "Other" },
] as const satisfies readonly FormOption[];

// =============================================================================
// IMPORTANT NOTES (multi-select checkboxes)
// =============================================================================

export const IMPORTANT_NOTE_OPTIONS = [
  { value: "withhold_food_24hr", label: "Withhold food 24hr before", shortLabel: "Withhold food" },
  { value: "other_feeders", label: "Other feeders in area", shortLabel: "Other feeders" },
  { value: "cats_cross_property", label: "Cats cross property lines", shortLabel: "Cross prop lines" },
  { value: "pregnant_cat", label: "Pregnant cat suspected", shortLabel: "Pregnant" },
  { value: "injured_sick_priority", label: "Injured/sick cat priority", shortLabel: "Injured/sick" },
  { value: "caller_can_help_trap", label: "Caller can help trap", shortLabel: "Caller help" },
  { value: "wildlife_concerns", label: "Wildlife concerns (raccoons etc.)", shortLabel: "Wildlife" },
  { value: "neighbor_issues", label: "Neighbor issues / complaints", shortLabel: "Neighbor" },
  { value: "urgent_time_sensitive", label: "Urgent / time-sensitive", shortLabel: "Urgent" },
  { value: "hoarding_situation", label: "Possible hoarding situation", shortLabel: "Hoarding" },
  { value: "property_sale_construction", label: "Property being sold/demolished", shortLabel: "Property threat" },
  { value: "no_colony_caretaker", label: "No known caretaker for colony", shortLabel: "No caretaker" },
  { value: "school_campus_nearby", label: "School/campus nearby", shortLabel: "School nearby" },
] as const satisfies readonly FormOption[];

// =============================================================================
// CHECKLISTS (trapper-specific, print forms only)
// =============================================================================

export const RECON_CHECKLIST_OPTIONS = [
  { value: "dogs", label: "Dogs", shortLabel: "Dogs" },
  { value: "feeders", label: "Feeders", shortLabel: "Feeders" },
  { value: "wildlife", label: "Wildlife", shortLabel: "Wildlife" },
  { value: "trap_savvy", label: "TrapSavvy", shortLabel: "TrapSavvy" },
  { value: "safe_on", label: "SafeON", shortLabel: "SafeON" },
  { value: "gate", label: "Gate", shortLabel: "Gate" },
  { value: "drop_trap", label: "DropTrap", shortLabel: "DropTrap" },
] as const satisfies readonly FormOption[];

export const TRAP_DAY_CHECKLIST_OPTIONS = [
  { value: "food_withheld", label: "Food withheld", shortLabel: "Food withheld" },
  { value: "contact_notified", label: "Contact notified", shortLabel: "Contact notified" },
  { value: "clinic_confirmed", label: "Clinic confirmed", shortLabel: "Clinic confirmed" },
  { value: "equip_ready", label: "Equip ready", shortLabel: "Equip ready" },
] as const satisfies readonly FormOption[];

// =============================================================================
// CALL TYPE → OWNERSHIP MAPPING
// =============================================================================

// =============================================================================
// KITTEN ASSESSMENT (staff detail page)
// =============================================================================

export const KITTEN_ASSESSMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending Assessment", shortLabel: "Pending" },
  { value: "assessed", label: "Assessed", shortLabel: "Assessed" },
  { value: "follow_up", label: "Needs Follow-up", shortLabel: "Follow-up" },
  { value: "not_assessing", label: "Not Assessing", shortLabel: "Not assessing" },
  { value: "placed", label: "Placed in foster", shortLabel: "Placed" },
] as const satisfies readonly FormOption[];

export const NOT_ASSESSING_REASON_OPTIONS = [
  { value: "older_kittens", label: "Older kittens (6+ months) - no capacity" },
  { value: "no_foster_capacity", label: "No foster capacity currently" },
  { value: "feral_unsuitable", label: "Feral/unsocialized - unsuitable for foster" },
  { value: "health_concerns", label: "Health concerns preclude foster" },
  { value: "owner_keeping", label: "Owner plans to keep" },
  { value: "already_altered", label: "Already altered - no intervention needed" },
  { value: "other", label: "Other (specify in notes)" },
] as const satisfies readonly FormOption[];

export const KITTEN_URGENCY_FACTOR_OPTIONS = [
  { value: "very_young", label: "Very young (bottle babies)" },
  { value: "medical_concern", label: "Medical concern" },
  { value: "exposed_danger", label: "Exposed to danger" },
  { value: "cold_weather", label: "Cold weather risk" },
  { value: "hot_weather", label: "Hot weather risk" },
  { value: "mom_missing", label: "Mom missing/dead" },
  { value: "construction", label: "Construction/demolition" },
  { value: "eviction", label: "Eviction/displacement" },
] as const satisfies readonly FormOption[];

// =============================================================================
// KITTEN AGE (coarse ranges for intake/assessment — different from granular KITTEN_AGE_OPTIONS)
// =============================================================================

export const KITTEN_AGE_COARSE_OPTIONS = [
  { value: "under_4_weeks", label: "Under 4 weeks (bottle babies)", shortLabel: "Under 4 wks" },
  { value: "4_8_weeks", label: "4-8 weeks (weaning)", shortLabel: "4-8 wks" },
  { value: "8_12_weeks", label: "8-12 weeks (ideal foster)", shortLabel: "8-12 wks" },
  { value: "12_16_weeks", label: "12-16 weeks (socialization critical)", shortLabel: "12-16 wks" },
  { value: "over_16_weeks", label: "Over 16 weeks / 4+ months", shortLabel: "4+ months" },
  { value: "mixed_ages", label: "Mixed ages", shortLabel: "Mixed" },
  { value: "unknown", label: "Unknown / Not sure", shortLabel: "Unknown" },
] as const satisfies readonly FormOption[];

// =============================================================================
// KITTEN SOCIALIZATION (simplified for public intake)
// =============================================================================

export const KITTEN_SOCIALIZATION_OPTIONS = [
  { value: "friendly", label: "Friendly - can be handled" },
  { value: "shy_handleable", label: "Shy but handleable" },
  { value: "unhandleable", label: "Shy/scared - hard to handle" },
  { value: "unknown", label: "Unknown" },
] as const satisfies readonly FormOption[];

// =============================================================================
// SINGLE CAT FIXED STATUS (for single stray path)
// =============================================================================

export const SINGLE_CAT_FIXED_STATUS_OPTIONS = [
  { value: "yes_eartip", label: "Yes (ear-tipped)" },
  { value: "no", label: "No / Not fixed" },
  { value: "unknown", label: "Don't know" },
] as const satisfies readonly FormOption[];

// =============================================================================
// COLONY HANDLEABILITY (simplified for colony path)
// =============================================================================

export const COLONY_HANDLEABILITY_OPTIONS = [
  { value: "some_friendly", label: "Some are friendly (can be carried)" },
  { value: "all_unhandleable", label: "All unhandleable (need traps)" },
  { value: "unknown", label: "Unknown / varies" },
] as const satisfies readonly FormOption[];

// =============================================================================
// TIME OF DAY
// =============================================================================

export const TIME_OF_DAY_OPTIONS = [
  { value: "morning", label: "Morning (6am-12pm)" },
  { value: "afternoon", label: "Afternoon (12pm-5pm)" },
  { value: "evening", label: "Evening (5pm-9pm)" },
  { value: "night", label: "Night (9pm-6am)" },
] as const satisfies readonly FormOption[];

export const TIME_OF_DAY_DETAILED_OPTIONS = [
  { value: "dawn", label: "Dawn (5-7am)" },
  { value: "morning", label: "Morning (7am-12pm)" },
  { value: "midday", label: "Midday (12-2pm)" },
  { value: "afternoon", label: "Afternoon (2-5pm)" },
  { value: "dusk", label: "Dusk (5-7pm)" },
  { value: "evening", label: "Evening (7-9pm)" },
  { value: "night", label: "Night (9pm-5am)" },
] as const satisfies readonly FormOption[];

// =============================================================================
// DEATH / MORTALITY
// =============================================================================

export const DEATH_CAUSE_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "natural", label: "Natural causes (old age)" },
  { value: "vehicle", label: "Hit by vehicle" },
  { value: "predator", label: "Predator (dog, coyote, etc.)" },
  { value: "disease", label: "Disease / Illness" },
  { value: "euthanasia", label: "Euthanasia (humane)" },
  { value: "injury", label: "Injury (non-vehicle trauma)" },
  { value: "starvation", label: "Starvation / Malnutrition" },
  { value: "weather", label: "Weather exposure (heat/cold)" },
  { value: "other", label: "Other (specify in notes)" },
] as const satisfies readonly FormOption[];

export const DATE_PRECISION_OPTIONS = [
  { value: "exact", label: "Exact date known" },
  { value: "week", label: "Within a week" },
  { value: "month", label: "Within a month" },
  { value: "estimated", label: "Approximate / Estimated" },
] as const satisfies readonly FormOption[];

export const AGE_CATEGORY_OPTIONS = [
  { value: "", label: "Unknown" },
  { value: "kitten", label: "Kitten (under 6 months)" },
  { value: "juvenile", label: "Juvenile (6-12 months)" },
  { value: "young_adult", label: "Young adult (1-3 years)" },
  { value: "adult", label: "Adult (3-7 years)" },
  { value: "senior", label: "Senior (7+ years)" },
] as const satisfies readonly FormOption[];

/** Maps age category to approximate age in months (for mortality calculations) */
export const AGE_CATEGORY_MONTHS: Record<string, number | null> = {
  "": null,
  kitten: 3,
  juvenile: 9,
  young_adult: 24,
  adult: 60,
  senior: 96,
};

// =============================================================================
// REQUEST PURPOSE (staff call-sheet)
// =============================================================================

export const REQUEST_PURPOSE_OPTIONS = [
  { value: "tnr", label: "Cats need spay/neuter" },
  { value: "wellness", label: "Check on altered cats" },
  { value: "relocation", label: "Trapping to move cats" },
  { value: "rescue", label: "Emergency assistance" },
] as const satisfies readonly FormOption[];

// =============================================================================
// RESOLUTION
// =============================================================================

export const RESOLUTION_OUTCOME_OPTIONS = [
  { value: "successful", label: "Successful" },
  { value: "partial", label: "Partial" },
  { value: "unable_to_complete", label: "Unable to Complete" },
  { value: "no_longer_needed", label: "No Longer Needed" },
  { value: "referred_out", label: "Referred Out" },
] as const satisfies readonly FormOption[];

// =============================================================================
// REDIRECT
// =============================================================================

export const REDIRECT_REASON_OPTIONS = [
  { value: "different_address", label: "Cats are at a different address" },
  { value: "different_contact", label: "Different person is responsible" },
  { value: "location_changed", label: "Colony location changed" },
  { value: "duplicate_area", label: "Duplicate - combine with existing request" },
  { value: "property_access", label: "Cannot access original property" },
  { value: "other", label: "Other reason" },
] as const satisfies readonly FormOption[];

// =============================================================================
// CONTACT / RELATIONSHIPS
// =============================================================================

export const THIRD_PARTY_RELATIONSHIP_OPTIONS = [
  { value: "neighbor", label: "Neighbor" },
  { value: "family_member", label: "Family member" },
  { value: "concerned_citizen", label: "Concerned citizen" },
  { value: "volunteer", label: "FFSC Volunteer" },
  { value: "other", label: "Other" },
] as const satisfies readonly FormOption[];

export const REQUESTER_RELATIONSHIP_OPTIONS = [
  { value: "resident", label: "I live here" },
  { value: "property_owner", label: "I own this property" },
  { value: "colony_caretaker", label: "Colony caretaker" },
  { value: "neighbor", label: "Neighbor" },
  { value: "concerned_citizen", label: "Concerned citizen" },
  { value: "other", label: "Other" },
] as const satisfies readonly FormOption[];

// =============================================================================
// PROPERTY (simplified for public intake)
// =============================================================================

export const IS_PROPERTY_OWNER_SIMPLE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Unsure" },
] as const satisfies readonly FormOption[];

export const HAS_PROPERTY_ACCESS_SIMPLE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Unsure" },
] as const satisfies readonly FormOption[];

// =============================================================================
// REFERRAL (simplified for public intake — fewer options than REFERRAL_SOURCE_OPTIONS)
// =============================================================================

export const REFERRAL_SOURCE_SIMPLE_OPTIONS = [
  { value: "search", label: "Online search" },
  { value: "social", label: "Social media" },
  { value: "friend", label: "Friend/family" },
  { value: "shelter", label: "Animal shelter" },
  { value: "vet", label: "Veterinarian" },
  { value: "repeat", label: "Previous experience" },
  { value: "other", label: "Other" },
] as const satisfies readonly FormOption[];

// =============================================================================
// FEEDING SITUATION (for colony intake path)
// =============================================================================

export const FEEDING_SITUATION_OPTIONS = [
  { value: "caller_feeds_daily", label: "Caller feeds daily" },
  { value: "caller_feeds_sometimes", label: "Caller feeds sometimes" },
  { value: "someone_else_feeds", label: "Someone else feeds them" },
  { value: "no_feeding", label: "No regular feeding" },
  { value: "unknown", label: "Unknown" },
] as const satisfies readonly FormOption[];

// =============================================================================
// SITE VISIT ISSUES
// =============================================================================

export const SITE_VISIT_ISSUE_OPTIONS = [
  { value: "no_access", label: "Could not access property" },
  { value: "cat_hiding", label: "Cat(s) hiding" },
  { value: "trap_shy", label: "Trap shy cat(s)" },
  { value: "bad_weather", label: "Bad weather" },
  { value: "equipment_issue", label: "Equipment issue" },
  { value: "owner_absent", label: "Owner/contact not available" },
  { value: "aggressive_cat", label: "Aggressive cat" },
  { value: "cats_not_present", label: "No cats present" },
  { value: "other", label: "Other issue" },
] as const satisfies readonly FormOption[];

// =============================================================================
// CALL TYPE → OWNERSHIP MAPPING
// =============================================================================

export function callTypeToOwnership(callType: string): string {
  switch (callType) {
    case "pet_spay_neuter":
      return "my_cat";
    case "colony_tnr":
      return "community_colony";
    case "wellness_check":
      return "my_cat";
    case "single_stray":
    case "kitten_rescue":
    case "medical_concern":
    default:
      return "unknown_stray";
  }
}
