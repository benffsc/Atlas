/**
 * Standardized intake form options
 *
 * These values are used across:
 * - Digital intake form (/intake/page.tsx)
 * - Quick intake form (/intake/queue/new/page.tsx)
 * - Print forms (/intake/print/*)
 * - Jotform (update manually to match)
 *
 * When changing wording here, also update Jotform to match.
 */

// =============================================================================
// CALL TYPE - What kind of help does the caller need?
// =============================================================================
export const CALL_TYPE_OPTIONS = [
  {
    value: "pet_spay_neuter",
    label: "Pet Spay/Neuter",
    desc: "Caller's own cat needs to be fixed",
  },
  {
    value: "wellness_check",
    label: "Wellness / Already Fixed",
    desc: "Cat is already fixed, needs medical attention",
  },
  {
    value: "single_stray",
    label: "Single Stray or Newcomer",
    desc: "One unfamiliar cat showed up recently",
  },
  {
    value: "colony_tnr",
    label: "Colony / FFR Request",
    desc: "Multiple outdoor cats needing FFR",
  },
  {
    value: "kitten_rescue",
    label: "Kitten Situation",
    desc: "Kittens found, may need foster",
  },
  {
    value: "medical_concern",
    label: "Medical Concern / Injured",
    desc: "Cat appears injured or sick",
  },
] as const;

export type CallType = (typeof CALL_TYPE_OPTIONS)[number]["value"];

// =============================================================================
// OWNERSHIP STATUS - What is the caller's relationship to the cat?
// =============================================================================
export const OWNERSHIP_OPTIONS = [
  {
    value: "unknown_stray",
    label: "Stray cat (no apparent owner)",
    shortLabel: "Stray (no owner)",
  },
  {
    value: "community_colony",
    label: "Community cat I/someone feeds",
    shortLabel: "Outdoor cat I/someone feeds",
  },
  {
    value: "newcomer",
    label: "Newcomer (just showed up recently)",
    shortLabel: "Newcomer (just appeared)",
  },
  {
    value: "neighbors_cat",
    label: "Neighbor's cat",
    shortLabel: "Neighbor's cat",
  },
  {
    value: "my_cat",
    label: "My own pet",
    shortLabel: "My pet",
  },
] as const;

export type OwnershipStatus = (typeof OWNERSHIP_OPTIONS)[number]["value"];

// Helper to get label from value
export function getOwnershipLabel(value: string): string {
  return OWNERSHIP_OPTIONS.find((o) => o.value === value)?.label || value;
}

// =============================================================================
// FIXED STATUS - How many cats appear to be fixed?
// =============================================================================
export const FIXED_STATUS_OPTIONS = [
  {
    value: "none_fixed",
    label: "None appear fixed",
    shortLabel: "None fixed",
  },
  {
    value: "some_fixed",
    label: "Some are fixed (ear-tipped)",
    shortLabel: "Some fixed",
  },
  {
    value: "most_fixed",
    label: "Most or all are fixed",
    shortLabel: "Most/all fixed",
  },
  {
    value: "unknown",
    label: "Unknown / Can't tell",
    shortLabel: "Unknown",
  },
] as const;

export type FixedStatus = (typeof FIXED_STATUS_OPTIONS)[number]["value"];

export function getFixedStatusLabel(value: string): string {
  return FIXED_STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

// =============================================================================
// HANDLEABILITY - Can the caller handle the cat?
// =============================================================================
export const HANDLEABILITY_OPTIONS = [
  {
    value: "friendly_carrier",
    label: "Friendly - can use a carrier",
    desc: "Cat can be picked up or put in a carrier by caller",
  },
  {
    value: "shy_handleable",
    label: "Shy but handleable",
    desc: "Nervous but can be approached and contained with patience",
  },
  {
    value: "unhandleable_trap",
    label: "Unhandleable - will need trap",
    desc: "Cannot be touched, runs away, will require humane trap",
  },
] as const;

export type Handleability = (typeof HANDLEABILITY_OPTIONS)[number]["value"];

// =============================================================================
// AWARENESS DURATION - How long has caller known about the cats?
// =============================================================================
export const AWARENESS_DURATION_OPTIONS = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
] as const;

// =============================================================================
// FEEDING FREQUENCY - How often does caller feed the cats?
// =============================================================================
export const FEEDING_FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "few_times_week", label: "A few times a week" },
  { value: "occasionally", label: "Occasionally" },
  { value: "rarely", label: "Rarely / Not at all" },
] as const;

// =============================================================================
// FEEDING DURATION - How long has caller been feeding?
// =============================================================================
export const FEEDING_DURATION_OPTIONS = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
] as const;

// =============================================================================
// CAT COMES INSIDE - Does the cat come inside?
// =============================================================================
export const CAT_INSIDE_OPTIONS = [
  { value: "yes_regularly", label: "Yes, regularly" },
  { value: "sometimes", label: "Sometimes" },
  { value: "never", label: "Never / Outdoor only" },
] as const;

// =============================================================================
// KITTEN AGE ESTIMATE
// =============================================================================
export const KITTEN_AGE_OPTIONS = [
  { value: "newborn", label: "Newborn (eyes closed)" },
  { value: "2_3_weeks", label: "2-3 weeks (eyes open, wobbly)" },
  { value: "4_5_weeks", label: "4-5 weeks (walking, playing)" },
  { value: "6_8_weeks", label: "6-8 weeks (weaning age)" },
  { value: "8_12_weeks", label: "8-12 weeks (ready for adoption)" },
  { value: "over_12_weeks", label: "Over 12 weeks" },
  { value: "mixed_ages", label: "Mixed ages" },
  { value: "unknown", label: "Unknown / Not sure" },
] as const;

// =============================================================================
// KITTEN BEHAVIOR
// =============================================================================
export const KITTEN_BEHAVIOR_OPTIONS = [
  { value: "friendly", label: "Friendly - approaches people" },
  { value: "shy", label: "Shy - hides but can be approached" },
  { value: "feral", label: "Feral - hisses, runs away" },
  { value: "mixed", label: "Mixed behaviors" },
  { value: "unknown", label: "Unknown" },
] as const;

// =============================================================================
// MOM CAT STATUS
// =============================================================================
export const MOM_PRESENT_OPTIONS = [
  { value: "yes_present", label: "Yes, mom is present" },
  { value: "comes_goes", label: "Comes and goes" },
  { value: "not_seen", label: "Haven't seen mom" },
  { value: "unknown", label: "Unknown" },
] as const;

export const MOM_FIXED_OPTIONS = [
  { value: "yes", label: "Yes (ear-tipped)" },
  { value: "no", label: "No / Don't think so" },
  { value: "unknown", label: "Unknown" },
] as const;

// =============================================================================
// REFERRAL SOURCES - How did caller hear about FFSC?
// =============================================================================
export const REFERRAL_SOURCE_OPTIONS = [
  { value: "website", label: "FFSC Website" },
  { value: "google", label: "Google search" },
  { value: "facebook", label: "Facebook" },
  { value: "nextdoor", label: "Nextdoor" },
  { value: "friend_family", label: "Friend or family" },
  { value: "vet", label: "Veterinarian" },
  { value: "shelter", label: "Shelter / Animal services" },
  { value: "repeat_caller", label: "Have called before" },
  { value: "other", label: "Other" },
] as const;

// =============================================================================
// URGENT SITUATION DEFINITION
// This text should be consistent across all forms and print materials.
// =============================================================================
export const URGENT_SITUATION_EXAMPLES =
  "pregnant female, cat safety at risk, stray cat needs non-immediate medical attention";

export const URGENT_SITUATION_LABEL = "This is an urgent situation";

// =============================================================================
// HELPER: Map call type to default ownership status
// =============================================================================
export function callTypeToOwnership(callType: string): OwnershipStatus {
  switch (callType) {
    case "pet_spay_neuter":
      return "my_cat";
    case "colony_tnr":
      return "community_colony";
    case "single_stray":
      return "unknown_stray";
    case "kitten_rescue":
      return "unknown_stray";
    case "medical_concern":
      return "unknown_stray";
    case "wellness_check":
      return "my_cat";
    default:
      return "unknown_stray";
  }
}
