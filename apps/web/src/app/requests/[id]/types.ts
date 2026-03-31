import type { RequestStatus } from "@/lib/request-status";
import type { IntakeExtendedData } from "@/lib/schemas/intake-extended-data";

/**
 * RequestDetail - Complete request data structure
 *
 * Includes fields from:
 * - MIG_2530: Simplified 4-state status system
 * - MIG_2531: Intake-request field unification
 * - MIG_2532: Complete request field coverage (Beacon-critical)
 * - MIG_2522: Third-party reporter intelligence
 */
export interface RequestDetail {
  request_id: string;
  status: RequestStatus;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  assigned_to: string | null;
  assigned_trapper_type: string | null;
  assigned_at: string | null;
  assignment_notes: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  resolution_outcome: string | null;
  resolution_reason: string | null;
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  // ==========================================================================
  // MIG_2532: BEACON-CRITICAL FIELDS
  // These fields enable Chapman mark-recapture population estimation
  // ==========================================================================

  /** Peak count of cats observed at one time - CRITICAL for Chapman estimation */
  peak_count: number | null;
  /** How long requester has known about the colony (e.g., "6 months - 2 years") */
  awareness_duration: string | null;
  /** Service area county (Sonoma, Marin, Napa, etc.) */
  county: string | null;

  // ==========================================================================
  // MIG_2531: INTAKE-REQUEST UNIFIED FIELDS
  // Structured data captured from intake submissions
  // ==========================================================================

  // Property & Access
  permission_status: string | null;
  property_owner_contact: string | null;
  access_notes: string | null;
  traps_overnight_safe: boolean | null;
  access_without_contact: boolean | null;
  property_type: string | null;
  /** Is the requester the property owner? */
  is_property_owner: boolean | null;
  /** Does requester have direct property access? */
  has_property_access: boolean | null;

  // Colony information
  colony_duration: string | null;
  location_description: string | null;
  eartip_count: number | null;
  eartip_estimate: string | null;
  count_confidence: string | null;

  // Feeding information
  is_being_fed: boolean | null;
  feeder_name: string | null;
  /** Feeding frequency enum: daily, few_times_week, occasionally, rarely */
  feeding_frequency: string | null;
  /** Where cats are fed (back porch, garage, etc.) */
  feeding_location: string | null;
  /** What time cats are typically fed */
  feeding_time: string | null;
  best_times_seen: string | null;

  // Urgency
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
  urgency_notes: string | null;
  /** Is this an emergency situation? */
  is_emergency: boolean | null;
  best_contact_times: string | null;

  // ==========================================================================
  // MIG_2531: CAT DESCRIPTION FIELDS
  // Fields for individual cat descriptions when not linking to cat records
  // ==========================================================================

  /** Name of cat (if known, for single-cat requests) */
  cat_name: string | null;
  /** Physical description of cat(s) */
  cat_description: string | null;

  // ==========================================================================
  // MIG_2531: ENHANCED KITTEN TRACKING
  // Comprehensive kitten assessment and tracking
  // ==========================================================================

  /** Kitten behavior observation */
  kitten_behavior: string | null;
  /** Are kittens contained/secured? */
  kitten_contained: string | null;
  /** Is the mother cat present? */
  mom_present: string | null;
  /** Is the mother cat fixed? */
  mom_fixed: string | null;
  /** Can requester bring kittens in? */
  can_bring_in: string | null;
  /** Estimate of kitten age (e.g., "under 4 weeks", "4-8 weeks") */
  kitten_age_estimate: string | null;

  // ==========================================================================
  // MIG_2522: THIRD-PARTY REPORTER INTELLIGENCE
  // Distinguishes between requester and site contact
  // ==========================================================================

  /** Is this a report from someone other than the site contact? */
  is_third_party_report: boolean | null;
  /** Relationship of third-party reporter (neighbor, friend, concerned citizen) */
  third_party_relationship: string | null;

  // ==========================================================================
  // MIG_2532: TRAPPING LOGISTICS
  // Information critical for successful trapping operations
  // ==========================================================================

  /** Best time for trapping operations */
  best_trapping_time: string | null;

  // ==========================================================================
  // TRIAGE FIELDS
  // Staff categorization and routing
  // ==========================================================================

  /** Triage category assigned by staff */
  triage_category: string | null;
  /** Staff member who received/triaged the request */
  received_by: string | null;
  // Hold tracking
  hold_reason: string | null;
  hold_reason_notes: string | null;
  hold_started_at: string | null;
  // Activity tracking
  last_activity_at: string | null;
  last_activity_type: string | null;
  // Place info
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_kind: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates: { lat: number; lng: number } | null;
  place_safety_notes: string | null;
  place_safety_concerns: string[] | null;
  place_service_zone: string | null;
  // Requester info
  requester_person_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  requester_role_at_submission: string | null;
  requester_is_site_contact: boolean | null;
  /** Requester's home place_id (FFS-1028: for dual display when cats ≠ home) */
  requester_home_place_id: string | null;
  /** Requester's home address display string */
  requester_home_address: string | null;
  // Site contact info (MIG_2522 - may be same as requester or different)
  site_contact_person_id: string | null;
  site_contact_name: string | null;
  site_contact_email: string | null;
  site_contact_phone: string | null;
  // Linked cats & verification
  cats: { cat_id: string; cat_name: string | null; link_purpose: string; microchip: string | null; altered_status: string | null; linked_at: string }[] | null;
  linked_cat_count: number | null;
  verified_altered_count: number | null;
  verified_intact_count: number | null;
  // Computed scores
  readiness_score: number | null;
  urgency_score: number | null;
  // Kitten assessment fields
  kitten_count: number | null;
  kitten_age_weeks: number | null;
  kitten_assessment_status: string | null;
  kitten_assessment_outcome: string | null;
  kitten_foster_readiness: string | null;
  kitten_urgency_factors: string[] | null;
  kitten_assessment_notes: string | null;
  not_assessing_reason: string | null;
  kitten_assessed_by: string | null;
  kitten_assessed_at: string | null;
  // Redirect fields
  redirected_to_request_id: string | null;
  redirected_from_request_id: string | null;
  transfer_type: string | null;
  redirect_reason: string | null;
  redirect_at: string | null;
  // MIG_534 cat count semantic fields
  total_cats_reported: number | null;
  cat_count_semantic: string | null;
  // MIG_562 colony summary
  colony_size_estimate: number | null;
  colony_verified_altered: number | null;
  colony_work_remaining: number | null;
  colony_alteration_rate: number | null;
  colony_estimation_method: string | null;
  colony_has_override: boolean | null;
  colony_override_note: string | null;
  colony_verified_exceeds_reported: boolean | null;
  // Email batching (MIG_605)
  ready_to_email: boolean;
  email_summary: string | null;
  email_batch_id: string | null;
  // Classification suggestion (MIG_622)
  suggested_classification: string | null;
  classification_confidence: number | null;
  classification_signals: Record<string, { value: string | number | boolean; weight: number; toward: string; note?: string }> | null;
  classification_disposition: string | null;
  classification_suggested_at: string | null;
  classification_reviewed_at: string | null;
  classification_reviewed_by: string | null;
  current_place_classification: string | null;
  // Source timestamp
  source_created_at: string | null;
  // Archive fields (MIG_2580)
  is_archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  archive_notes: string | null;
  // Verification counts
  unverified_count: number | null;
  verification_completeness: string | null;
  // Assignment status (MIG_2495)
  no_trapper_reason: string | null;
  assignment_status: string;
  // Call sheet trapping logistics (MIG_2495)
  dogs_on_site: string | null;
  trap_savvy: string | null;
  previous_tnr: string | null;
  handleability: string | null;
  fixed_status: string | null;
  ownership_status: string | null;
  has_medical_concerns: boolean;
  medical_description: string | null;
  important_notes: string[] | null;
  // MIG_2817: Additional restored columns
  request_purpose: string | null;
  request_purposes: string[] | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  authorization_pending: boolean | null;
  kitten_mixed_ages_description: string | null;
  kitten_notes: string | null;
  wellness_cat_count: number | null;
  entry_mode: string | null;
  completion_data: Record<string, unknown> | null;
  // MIG_2868: Extended intake data (fields without dedicated columns)
  intake_extended_data: IntakeExtendedData | null;
  // FFS-349: Place's last clinic visit
  place_last_appointment_date: string | null;
  // Status history and trappers (from API response)
  status_history?: Array<{
    old_status: string | null;
    new_status: string;
    changed_by: string | null;
    changed_at: string;
    reason: string | null;
  }>;
  current_trappers?: Array<{
    trapper_person_id: string;
    trapper_name: string;
    trapper_type: string | null;
    is_ffsc_trapper: boolean;
    is_primary: boolean;
    assigned_at: string;
  }>;
}
