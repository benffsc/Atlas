/**
 * Intake → Request Field Mapping
 *
 * Documents how fields flow from intake forms through `ops.intake_submissions`
 * to `ops.requests` via `ops.convert_intake_to_request()`.
 *
 * Three layers:
 *   1. Form UI (what the user fills in)
 *   2. Intake Submission (ops.intake_submissions columns)
 *   3. Request (ops.requests columns, set by SQL convert + TS forward)
 *
 * FFS-500: Unify intake submission pipeline
 * @see sql/schema/v2/MIG_2863__wire_enrich_person.sql — latest convert function
 * @see apps/web/src/app/api/intake/route.ts — intake POST handler
 * @see apps/web/src/app/api/intake/convert/route.ts — TS-side field forwarding
 */

// =============================================================================
// FIELD MAPPING DOCUMENTATION
// =============================================================================

/**
 * How a single field flows from form → intake_submissions → requests.
 *
 * `requestColumn` is null when the field is NOT mapped to requests (gap).
 * `forwardedBy` indicates whether the SQL function or TS convert route handles it.
 */
export interface IntakeFieldMapping {
  /** Field name in the form UI / API body */
  readonly formField: string;
  /** Column in ops.intake_submissions (null if field skips submissions) */
  readonly submissionColumn: string | null;
  /** Column in ops.requests (null = not mapped) */
  readonly requestColumn: string | null;
  /** Who does the mapping: "sql" (convert_intake_to_request), "ts" (convert/route.ts), or "none" */
  readonly forwardedBy: "sql" | "ts" | "none";
  /** Any transformation applied during mapping */
  readonly transform?: string;
}

/**
 * Complete field mapping from intake forms to requests.
 *
 * IMPORTANT: When adding new intake fields, add an entry here so the
 * conversion pipeline forwards it correctly.
 */
export const INTAKE_FIELD_MAP: readonly IntakeFieldMapping[] = [
  // ── Contact ──
  { formField: "first_name", submissionColumn: "first_name", requestColumn: null, forwardedBy: "none", transform: "Person created via match_intake_to_person()" },
  { formField: "last_name", submissionColumn: "last_name", requestColumn: null, forwardedBy: "none", transform: "Person created via match_intake_to_person()" },
  { formField: "email", submissionColumn: "email", requestColumn: null, forwardedBy: "none", transform: "Linked via matched_person_id → requester_person_id" },
  { formField: "phone", submissionColumn: "phone", requestColumn: null, forwardedBy: "none", transform: "Linked via matched_person_id → requester_person_id" },

  // ── Location ──
  { formField: "cats_address", submissionColumn: "cats_address", requestColumn: null, forwardedBy: "none", transform: "Linked via place_id" },
  { formField: "cats_city", submissionColumn: "cats_city", requestColumn: null, forwardedBy: "none", transform: "Used in summary generation" },
  { formField: "county", submissionColumn: "county", requestColumn: "county", forwardedBy: "sql" },
  { formField: "selected_address_place_id", submissionColumn: "selected_address_place_id", requestColumn: "place_id", forwardedBy: "sql", transform: "Maps to place_id via link_intake_to_place()" },

  // ── Cat Details ──
  { formField: "cat_count_estimate", submissionColumn: "cat_count_estimate", requestColumn: "total_cats_reported", forwardedBy: "sql" },
  { formField: "cat_count_estimate", submissionColumn: "cat_count_estimate", requestColumn: "estimated_cat_count", forwardedBy: "sql", transform: "COALESCE(cats_needing_tnr, cat_count_estimate)" },
  { formField: "count_confidence", submissionColumn: "count_confidence", requestColumn: "count_confidence", forwardedBy: "sql" },
  { formField: "fixed_status", submissionColumn: "fixed_status", requestColumn: "fixed_status", forwardedBy: "sql", transform: "Cast to TEXT" },
  { formField: "handleability", submissionColumn: "handleability", requestColumn: "handleability", forwardedBy: "sql", transform: "Cast to TEXT" },
  { formField: "eartip_count_observed", submissionColumn: "eartip_count_observed", requestColumn: "eartip_count_observed", forwardedBy: "sql" },
  { formField: "colony_duration", submissionColumn: "colony_duration", requestColumn: "colony_duration", forwardedBy: "sql" },
  { formField: "awareness_duration", submissionColumn: "awareness_duration", requestColumn: "awareness_duration", forwardedBy: "sql" },

  // ── Ownership (KNOWN GAP: not forwarded to request) ──
  { formField: "ownership_status", submissionColumn: "ownership_status", requestColumn: "ownership_status", forwardedBy: "none", transform: "GAP: saved to submission but not mapped by convert function" },

  // ── Kittens ──
  { formField: "has_kittens", submissionColumn: "has_kittens", requestColumn: "has_kittens", forwardedBy: "sql" },
  { formField: "kitten_count", submissionColumn: "kitten_count", requestColumn: "kitten_count", forwardedBy: "sql" },
  { formField: "kitten_age_estimate", submissionColumn: "kitten_age_estimate", requestColumn: "kitten_age_estimate", forwardedBy: "sql" },
  { formField: "kitten_behavior", submissionColumn: "kitten_behavior", requestColumn: "kitten_behavior", forwardedBy: "sql" },
  { formField: "kitten_contained", submissionColumn: "kitten_contained", requestColumn: "kitten_contained", forwardedBy: "sql" },
  { formField: "mom_present", submissionColumn: "mom_present", requestColumn: "mom_present", forwardedBy: "sql" },
  { formField: "mom_fixed", submissionColumn: "mom_fixed", requestColumn: "mom_fixed", forwardedBy: "sql" },
  { formField: "can_bring_in", submissionColumn: "can_bring_in", requestColumn: "can_bring_in", forwardedBy: "sql" },

  // ── Feeding ──
  { formField: "feeds_cat", submissionColumn: "feeds_cat", requestColumn: "is_being_fed", forwardedBy: "sql", transform: "COALESCE(feeds_cat, cats_being_fed, FALSE) — NAME MISMATCH" },
  { formField: "feeding_frequency", submissionColumn: "feeding_frequency", requestColumn: "feeding_frequency", forwardedBy: "sql" },
  { formField: "feeder_info", submissionColumn: "feeder_info", requestColumn: "feeder_name", forwardedBy: "sql", transform: "NAME MISMATCH: submission=feeder_info, request=feeder_name" },
  { formField: "feeding_location", submissionColumn: "feeding_location", requestColumn: "feeding_location", forwardedBy: "sql" },
  { formField: "feeding_time", submissionColumn: "feeding_time", requestColumn: "feeding_time", forwardedBy: "sql" },

  // ── Medical / Emergency ──
  { formField: "has_medical_concerns", submissionColumn: "has_medical_concerns", requestColumn: "has_medical_concerns", forwardedBy: "sql" },
  { formField: "medical_description", submissionColumn: "medical_description", requestColumn: "medical_description", forwardedBy: "sql" },
  { formField: "is_emergency", submissionColumn: "is_emergency", requestColumn: "is_emergency", forwardedBy: "sql" },

  // ── Property Access ──
  { formField: "has_property_access", submissionColumn: "has_property_access", requestColumn: "has_property_access", forwardedBy: "sql" },
  { formField: "access_notes", submissionColumn: "access_notes", requestColumn: "access_notes", forwardedBy: "sql" },
  { formField: "is_property_owner", submissionColumn: "is_property_owner", requestColumn: "is_property_owner", forwardedBy: "sql" },
  { formField: "property_type", submissionColumn: null, requestColumn: "property_type", forwardedBy: "ts", transform: "NOT in intake_submissions; forwarded via custom_fields hack" },

  // ── Trapping Logistics ──
  { formField: "dogs_on_site", submissionColumn: "dogs_on_site", requestColumn: "dogs_on_site", forwardedBy: "sql" },
  { formField: "trap_savvy", submissionColumn: "trap_savvy", requestColumn: "trap_savvy", forwardedBy: "sql" },
  { formField: "previous_tnr", submissionColumn: "previous_tnr", requestColumn: "previous_tnr", forwardedBy: "sql" },
  { formField: "best_trapping_time", submissionColumn: "best_trapping_time", requestColumn: null, forwardedBy: "none", transform: "GAP: saved to submission, not mapped to request" },
  { formField: "important_notes", submissionColumn: "important_notes", requestColumn: "important_notes", forwardedBy: "ts", transform: "Forwarded via custom_fields in direct-create path only" },

  // ── Staff Assessment ──
  { formField: "priority_override", submissionColumn: "priority_override", requestColumn: "priority", forwardedBy: "ts", transform: "NAME MISMATCH: form=priority_override, request=priority" },
  { formField: "situation_description", submissionColumn: "situation_description", requestColumn: "notes", forwardedBy: "sql" },
  { formField: "triage_category", submissionColumn: "triage_category", requestColumn: "triage_category", forwardedBy: "sql", transform: "Auto-computed by trigger, then mapped" },

  // ── Third Party ──
  { formField: "is_third_party_report", submissionColumn: "is_third_party_report", requestColumn: "is_third_party_report", forwardedBy: "sql" },
  { formField: "third_party_relationship", submissionColumn: "third_party_relationship", requestColumn: "third_party_relationship", forwardedBy: "sql" },

  // ── Referral (KNOWN GAP: not forwarded to request) ──
  { formField: "referral_source", submissionColumn: "referral_source", requestColumn: null, forwardedBy: "none", transform: "GAP: saved to submission, no column on ops.requests" },

  // ── Call Type (stored in custom_fields, not a request column) ──
  { formField: "call_type", submissionColumn: "call_type", requestColumn: null, forwardedBy: "none", transform: "No matching request column" },
] as const;

// =============================================================================
// KNOWN FIELD NAME MISMATCHES
// =============================================================================

/**
 * Fields where the name differs between intake_submissions and ops.requests.
 * These are the most error-prone points in the pipeline.
 *
 * To fix: Either rename the submission column or add an alias in the convert function.
 */
export const FIELD_NAME_MISMATCHES = [
  { submission: "feeds_cat", request: "is_being_fed", note: "Also has alias: cats_being_fed" },
  { submission: "feeder_info", request: "feeder_name", note: "Same data, different column name" },
  { submission: "cat_count_estimate", request: "estimated_cat_count", note: "Also maps to total_cats_reported" },
  { submission: "priority_override", request: "priority", note: "Forwarded by TS, not SQL" },
  { submission: "situation_description", request: "notes", note: "Mapped in SQL convert function" },
] as const;

// =============================================================================
// KNOWN GAPS (fields saved but never reach ops.requests)
// =============================================================================

/**
 * Fields that are saved to intake_submissions but NOT forwarded to requests.
 * Some are intentional (contact info goes through person matching), others are bugs.
 */
export const CONVERSION_GAPS = [
  { field: "ownership_status", severity: "bug", note: "Has a column on ops.requests but SQL convert doesn't map it" },
  { field: "referral_source", severity: "intentional", note: "No column on ops.requests — could add one" },
  { field: "best_trapping_time", severity: "bug", note: "Has ops.requests column but not mapped" },
  { field: "call_type", severity: "intentional", note: "Stored as custom_field, no request column" },
  { field: "property_type", severity: "workaround", note: "Not in intake_submissions; forwarded via TS custom_fields hack" },
] as const;
