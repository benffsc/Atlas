/**
 * View↔Route Contract Types
 *
 * TypeScript interfaces that mirror SQL view columns exactly.
 * These serve as contracts between database views and API routes.
 *
 * See CLAUDE.md invariant 49: Routes querying views MUST have a
 * corresponding interface in this file.
 *
 * Naming convention:
 * - VCatListRow → matches sot.v_cat_list view
 * - VPersonDetailRow → matches sot.v_person_detail view
 *
 * When updating a view migration, update the corresponding interface here.
 */

// =============================================================================
// CAT VIEWS
// =============================================================================

/**
 * Contract for sot.v_cat_list
 * @see sql/schema/v2/MIG_2322__create_v_cat_list.sql
 * @see sql/schema/v2/MIG_2401__add_source_system_to_v_cat_list.sql
 * @route /api/cats
 */
export interface VCatListRow {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  microchip: string | null;
  quality_tier: string;
  quality_reason: string;
  has_microchip: boolean;
  owner_count: number;
  owner_names: string | null;
  primary_place_id: string | null;
  primary_place_label: string | null;
  place_kind: string | null;
  has_place: boolean;
  created_at: string;
  last_appointment_date: string | null; // Mapped from last_visit_date in view
  appointment_count: number; // Mapped from visit_count in view
  source_system: string | null;
  photo_url: string | null;
}

// =============================================================================
// PERSON VIEWS
// =============================================================================

/**
 * Contract for sot.v_person_list_v3
 * @see sql/schema/v2/MIG_2400__fix_v_person_list_v3_columns.sql
 * @route /api/people
 */
export interface VPersonListRow {
  person_id: string;
  display_name: string;
  account_type: string | null;
  is_canonical: boolean;
  surface_quality: string | null;
  quality_reason: string | null;
  has_email: boolean;
  has_phone: boolean;
  cat_count: number;
  place_count: number;
  cat_names: string | null;
  primary_place: string | null;
  created_at: string;
  source_quality: string;
}

/**
 * Contract for sot.v_person_detail
 * @see sql/schema/v2/MIG_2080__core_detail_views.sql
 * @route /api/people/[id]
 */
export interface VPersonDetailRow {
  person_id: string;
  display_name: string;
  merged_into_person_id: string | null;
  created_at: string;
  updated_at: string;
  cats: unknown[] | null;
  places: unknown[] | null;
  person_relationships: unknown[] | null;
  cat_count: number;
  place_count: number;
  is_valid_name: boolean;
  primary_address_id: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  data_source: string | null;
  identifiers: unknown[] | null;
  entity_type: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  data_quality: string | null;
  primary_place_id: string | null;
  partner_orgs: unknown[] | null;
  associated_places: unknown[] | null;
  aliases: unknown[] | null;
}

// =============================================================================
// PLACE VIEWS
// =============================================================================

/**
 * Contract for sot.v_place_list
 * @route /api/places
 */
export interface VPlaceListRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  postal_code: string | null;
  cat_count: number;
  person_count: number;
  has_cat_activity: boolean;
  created_at: string;
}

/**
 * Contract for sot.v_place_detail_v2
 * @see sql/schema/v2/MIG_2080__core_detail_views.sql
 * @route /api/places/[id]
 */
export interface VPlaceDetailRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: unknown[] | null;
  people: unknown[] | null;
  place_relationships: unknown[] | null;
  cat_count: number;
  person_count: number;
}

// =============================================================================
// REQUEST VIEWS
// =============================================================================

/**
 * Contract for ops.v_request_list
 * @see sql/schema/v2/MIG_2034__create_v_request_list.sql
 * @route /api/requests
 */
export interface VRequestListRow {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  scheduled_date: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  source_created_at: string | null;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_person_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  linked_cat_count: number;
  is_legacy_request: boolean;
  active_trapper_count: number;
  place_has_location: boolean;
  data_quality_flags: string[];
  no_trapper_reason: string | null;
  primary_trapper_name: string | null;
  assignment_status: string;
}

/**
 * Contract for ops.v_request_detail
 * @see sql/schema/v2/MIG_2080__core_detail_views.sql
 * @route /api/requests/[id]
 */
export interface VRequestDetailRow {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
  total_cats_reported: number | null;
  cat_count_semantic: string | null;
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
  source_created_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Place info
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_kind: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates: { lat: number; lng: number } | null;
  // Requester info
  requester_person_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  // Linked cats
  cats: unknown[] | null;
  linked_cat_count: number | null;
  // Colony summary
  colony_size_estimate: number | null;
  colony_verified_altered: number | null;
  colony_work_remaining: number | null;
  colony_alteration_rate: number | null;
}

// =============================================================================
// APPOINTMENT VIEWS
// =============================================================================

/**
 * Contract for ops.v_appointment_detail
 * @route /api/appointments
 */
export interface VAppointmentDetailRow {
  appointment_id: string;
  appointment_date: string;
  cat_id: string | null;
  cat_name: string | null;
  cat_microchip: string | null;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  procedure_type: string | null;
  altered_status: string | null;
  source_system: string;
  created_at: string;
}

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Generic pagination parameters.
 */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Generic list response wrapper.
 */
export interface ListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
