/**
 * Intake Form Schema Definition
 *
 * This file defines the canonical schema for intake submissions.
 * It's the source of truth for:
 * - Receptionist intake form (page.tsx)
 * - Jotform field mapping
 * - Airtable table structure
 * - Atlas API expectations
 * - Database columns
 *
 * When adding new fields:
 * 1. Add to this schema
 * 2. Update intake form (page.tsx)
 * 3. Update API (route.ts)
 * 4. Create database migration
 * 5. Update Airtable table (run sync script)
 * 6. Update Jotform (manual)
 */

// === CALL TYPES ===
export const CALL_TYPES = [
  { value: "pet_spay_neuter", label: "Pet Spay/Neuter", airtable: "pet_spay_neuter" },
  { value: "wellness_check", label: "Wellness / Already Fixed", airtable: "wellness_check" },
  { value: "single_stray", label: "Single Stray or Newcomer", airtable: "single_stray" },
  { value: "colony_tnr", label: "Colony / TNR Request", airtable: "colony_tnr" },
  { value: "kitten_rescue", label: "Kitten Situation", airtable: "kitten_rescue" },
  { value: "medical_concern", label: "Medical Concern / Injured", airtable: "medical_concern" },
] as const;

// === HANDLEABILITY OPTIONS ===
// Critical for Beacon - determines carrier vs trap operations
export const HANDLEABILITY_OPTIONS = [
  { value: "friendly_carrier", label: "Friendly - can use a carrier", airtable: "friendly_carrier" },
  { value: "shy_handleable", label: "Shy but handleable", airtable: "shy_handleable" },
  { value: "feral_trap", label: "Feral - will need a trap", airtable: "feral_trap" },
  { value: "unknown", label: "Unknown / Haven't tried", airtable: "unknown" },
  // Colony-specific
  { value: "some_friendly", label: "Some are friendly (can be carried)", airtable: "some_friendly" },
  { value: "all_feral", label: "All are feral (need traps)", airtable: "all_feral" },
] as const;

// === COUNTY OPTIONS ===
export const COUNTIES = [
  { value: "Sonoma", label: "Sonoma", primary: true },
  { value: "Marin", label: "Marin", primary: false },
  { value: "Napa", label: "Napa", primary: false },
  { value: "Mendocino", label: "Mendocino", primary: false },
  { value: "Lake", label: "Lake", primary: false },
  { value: "other", label: "Other", primary: false },
] as const;

// === FEEDING SITUATIONS ===
export const FEEDING_SITUATIONS = [
  { value: "caller_feeds_daily", label: "Caller feeds daily" },
  { value: "caller_feeds_sometimes", label: "Caller feeds sometimes" },
  { value: "someone_else_feeds", label: "Someone else feeds them" },
  { value: "no_feeding", label: "No regular feeding" },
  { value: "unknown", label: "Unknown" },
] as const;

// === KITTEN AGES ===
export const KITTEN_AGES = [
  { value: "under_4_weeks", label: "Under 4 weeks (bottle babies)" },
  { value: "4_to_8_weeks", label: "4-8 weeks (weaning)" },
  { value: "8_to_12_weeks", label: "8-12 weeks" },
  { value: "over_12_weeks", label: "Over 12 weeks" },
  { value: "unknown", label: "Unknown" },
] as const;

// === FIELD MAPPING ===
// Maps between form fields, Airtable columns, and database columns
export const FIELD_MAPPING = {
  // Contact fields
  first_name: { airtable: "First Name", db: "first_name", required: true },
  last_name: { airtable: "Last Name", db: "last_name", required: true },
  email: { airtable: "Email", db: "email", required: false },
  phone: { airtable: "Phone", db: "phone", required: false },

  // Third-party
  is_third_party_report: { airtable: "Is Third Party Report", db: "is_third_party_report", type: "checkbox" },
  third_party_relationship: { airtable: "Third Party Relationship", db: "third_party_relationship" },
  property_owner_name: { airtable: "Property Owner Name", db: "property_owner_name" },
  property_owner_phone: { airtable: "Property Owner Phone", db: "property_owner_phone" },

  // Location
  cats_address: { airtable: "Street Address", db: "cats_address", required: true },
  cats_city: { airtable: "City", db: "cats_city" },
  cats_zip: { airtable: "ZIP", db: "cats_zip" },
  county: { airtable: "County", db: "county" },

  // Cat details
  cat_name: { airtable: "Cat Name", db: "cat_name" },
  cat_description: { airtable: "Cat Description", db: "cat_description" },
  cat_count_estimate: { airtable: "Cat Count", db: "cat_count_estimate", type: "number" },
  cat_count_text: { airtable: "Cat Count Text", db: "cat_count_text" },

  // Colony data (critical for Beacon)
  peak_count: { airtable: "Peak Count", db: "peak_count", type: "number", beacon: true },
  eartip_count: { airtable: "Eartip Count", db: "eartip_count_observed", type: "number", beacon: true },
  feeding_situation: { airtable: "Feeding Situation", db: "feeding_situation" },
  handleability: { airtable: "Handleability", db: "handleability", beacon: true },
  fixed_status: { airtable: "Fixed Status", db: "fixed_status" },

  // Kittens
  has_kittens: { airtable: "Has Kittens", db: "has_kittens", type: "checkbox" },
  kitten_count: { airtable: "Kitten Count", db: "kitten_count", type: "number" },
  kitten_age: { airtable: "Kitten Age", db: "kitten_age_estimate" },
  kitten_socialization: { airtable: "Kitten Socialization", db: "kitten_behavior" },
  mom_present: { airtable: "Mom Present", db: "mom_present" },

  // Medical
  has_medical_concerns: { airtable: "Has Medical Concerns", db: "has_medical_concerns", type: "checkbox" },
  medical_description: { airtable: "Medical Description", db: "medical_description" },
  is_emergency: { airtable: "Is Emergency", db: "is_emergency", type: "checkbox" },

  // Property
  is_property_owner: { airtable: "Is Property Owner", db: "is_property_owner" },
  has_property_access: { airtable: "Has Property Access", db: "has_property_access" },

  // Notes
  notes: { airtable: "Notes", db: "situation_description" },
  referral_source: { airtable: "Referral Source", db: "referral_source" },

  // Metadata
  call_type: { airtable: "Call Type", db: "source_system", transform: "call_type_to_ownership" },
  jotform_id: { airtable: "Jotform Submission ID", db: "source_record_id" },
  submitted_at: { airtable: "Submitted At", db: "submitted_at" },
} as const;

// === AIRTABLE SCHEMA ===
// Used by schema sync script to ensure Airtable matches
export const AIRTABLE_SCHEMA = {
  tableName: "Public Intake Submissions",
  baseId: "appwFuRddph1krmcd",
  tableId: "tblGQDVELZBhnxvUm",
  fields: Object.entries(FIELD_MAPPING).map(([key, config]) => ({
    name: config.airtable,
    formField: key,
    dbColumn: config.db,
    type: config.type || "text",
    required: config.required || false,
    beacon: (config as { beacon?: boolean }).beacon || false,
  })),
};

// === VALIDATION ===
export function validateIntakeSubmission(data: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!data.first_name) errors.push("First name is required");
  if (!data.last_name) errors.push("Last name is required");
  if (!data.email && !data.phone) errors.push("Email or phone is required");
  if (!data.cats_address) errors.push("Street address is required");

  return { valid: errors.length === 0, errors };
}

// === TRANSFORM FUNCTIONS ===
export function callTypeToOwnershipStatus(callType: string): string {
  switch (callType) {
    case "pet_spay_neuter":
      return "my_cat";
    case "colony_tnr":
      return "community_colony";
    case "single_stray":
    case "kitten_rescue":
    case "medical_concern":
    case "wellness_check":
    default:
      return "unknown_stray";
  }
}

// === BEACON CRITICAL FIELDS ===
// These fields are essential for colony population modeling
export const BEACON_CRITICAL_FIELDS = [
  "peak_count",       // Most cats seen at once - population estimation
  "eartip_count",     // Already-fixed cats - mark-resight calculation
  "handleability",    // Carrier vs trap - operation planning
  "cat_count_estimate", // Colony size tracking
  "has_medical_concerns", // Resource allocation
];
