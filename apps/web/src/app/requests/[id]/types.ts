export interface RequestDetail {
  request_id: string;
  status: string;
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
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Enhanced intake fields
  permission_status: string | null;
  property_owner_contact: string | null;
  access_notes: string | null;
  traps_overnight_safe: boolean | null;
  access_without_contact: boolean | null;
  property_type: string | null;
  colony_duration: string | null;
  location_description: string | null;
  eartip_count: number | null;
  eartip_estimate: string | null;
  count_confidence: string | null;
  is_being_fed: boolean | null;
  feeder_name: string | null;
  feeding_schedule: string | null;
  best_times_seen: string | null;
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
  urgency_notes: string | null;
  best_contact_times: string | null;
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
}
