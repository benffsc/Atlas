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
  // Health fields (FFS-424)
  is_deceased: boolean;
  weight_lbs: number | null;
  age_group: string | null;
  health_flags: Array<{
    category: string;
    key: string;
    label: string;
    color?: string | null;
  }>;
  // Lifecycle status (FFS-364)
  current_status: string | null;
  // Adoption context (MIG_3005)
  placement_type: string | null;
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
  // Role & status fields (FFS-434)
  primary_role?: string | null;
  trapper_type?: string | null;
  do_not_contact?: boolean;
  entity_type?: string | null;
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
  // API-enriched fields (not from view directly)
  last_appointment_date?: string | null;
  active_request_count?: number;
  // Risk fields (FFS-430)
  watch_list?: boolean;
  disease_flags?: Array<{
    disease_key: string;
    short_code: string;
    status: string;
    color?: string | null;
    positive_cat_count?: number;
  }>;
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
// BEACON ANALYTICS VIEWS (MIG_2934)
// =============================================================================

/**
 * Contract for beacon.v_zone_alteration_rollup
 * @see sql/schema/v2/MIG_2934__beacon_p0_analytics.sql
 * @route /api/beacon/zones
 */
export interface VZoneAlterationRollupRow {
  zone_id: string;
  zone_code: string;
  zone_name: string;
  service_zone: string;
  centroid_lat: number;
  centroid_lng: number;
  place_count: number;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  zone_status: string;
  total_requests: number;
  active_requests: number;
  total_appointments: number;
  last_appointment_date: string | null;
  appointments_last_90d: number;
  alterations_last_90d: number;
  estimated_population: number | null;
  adequate_estimates: number;
  total_estimates: number;
}

/**
 * Contract for beacon.v_county_alteration_rollup
 * @see sql/schema/v2/MIG_2971__beacon_county_rollup.sql
 * @route /api/beacon/county-rollup
 */
export interface VCountyAlterationRollupRow {
  county: string;
  zone_count: number;
  place_count: number;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  total_requests: number;
  active_requests: number;
  alterations_last_90d: number;
  estimated_population: number;
}

/**
 * Contract for beacon.place_temporal_trends()
 * @see sql/schema/v2/MIG_2934__beacon_p0_analytics.sql
 * @route /api/beacon/trends/[placeId]
 */
export interface BeaconTemporalTrendRow {
  month: string;
  month_label: string;
  new_cats_seen: number;
  alterations: number;
  cumulative_cats: number;
  cumulative_altered: number;
  alteration_rate_pct: number | null;
}

/**
 * Contract for beacon.compare_places()
 * @see sql/schema/v2/MIG_2934__beacon_p0_analytics.sql
 * @route /api/beacon/compare
 */
export interface BeaconPlaceComparisonRow {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  lat: number;
  lng: number;
  service_zone: string | null;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  colony_status: string;
  total_requests: number;
  active_requests: number;
  total_appointments: number;
  last_appointment_date: string | null;
  first_appointment_date: string | null;
  estimated_population: number | null;
  ci_lower: number | null;
  ci_upper: number | null;
  sample_adequate: boolean | null;
  people_count: number;
  days_since_last_activity: number | null;
}

/**
 * Contract for beacon.map_data_filtered()
 * @see sql/schema/v2/MIG_2934__beacon_p0_analytics.sql
 * @route /api/beacon/map-data (with from/to params)
 */
export interface BeaconMapDataFilteredRow {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  lat: number;
  lng: number;
  service_zone: string | null;
  place_kind: string | null;
  cat_count: number;
  altered_count: number;
  intact_count: number;
  alteration_rate_pct: number | null;
  appointment_count: number;
  request_count: number;
  last_activity_date: string | null;
  colony_status: string;
}

/**
 * Contract for beacon.estimate_colony_population()
 * @see sql/schema/v2/MIG_2365__colony_estimation.sql
 * @route /api/beacon/population/[placeId]
 */
/**
 * Contract for beacon.v_service_zone_summary
 * @see sql/schema/v2/MIG_2937__service_zone_summary.sql
 * @route /api/beacon/service-zones
 */
export interface VServiceZoneSummaryRow {
  service_zone: string;
  total_places: number;
  geocoded_places: number;
  centroid_lat: number | null;
  centroid_lng: number | null;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  zone_status: string;
  total_requests: number;
  active_requests: number;
  total_appointments: number;
  last_appointment_date: string | null;
  appointments_last_90d: number;
  alterations_last_90d: number;
  people_count: number;
}

export interface BeaconPopulationEstimate {
  place_id: string;
  estimated_population: number;
  ci_lower: number;
  ci_upper: number;
  marked_count: number;
  capture_count: number;
  recapture_count: number;
  sample_adequate: boolean;
  confidence_level: string;
  observation_start: string;
  observation_end: string;
  last_calculated_at: string;
}

// =============================================================================
// EQUIPMENT VIEWS
// =============================================================================

/**
 * Contract for ops.v_equipment_inventory
 * @see sql/schema/v2/MIG_2977__equipment_overhaul.sql
 * @route /api/equipment
 */
export interface VEquipmentInventoryRow {
  equipment_id: string;
  barcode: string | null;
  display_name: string;
  equipment_type_key: string | null;
  type_display_name: string | null;
  type_category: string | null;
  legacy_type: string;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  custody_status: string;
  condition_status: string;
  current_custodian_id: string | null;
  custodian_name: string | null;
  current_place_id: string | null;
  current_place_address: string | null;
  current_request_id: string | null;
  current_kit_id: string | null;
  acquired_at: string | null;
  retired_at: string | null;
  notes: string | null;
  source_system: string;
  created_at: string;
  updated_at: string;
  // Enrichment fields (MIG_2982)
  item_type: string | null;
  size: string | null;
  functional_status: string | null;
  current_holder_name: string | null;
  expected_return_date: string | null;
  photo_url: string | null;
  barcode_image_url: string | null;
  // Phase 2 enrichment (MIG_2983)
  checkout_type: string | null;
  inferred_due_date: string | null;
  tracking_tier: string | null;
  cage_type: string | null;
  cage_size: string | null;
  // Computed fields
  days_checked_out: number | null;
  total_checkouts: number;
  current_due_date: string | null;
  is_available: boolean;
}

/**
 * Contract for ops.equipment_collection_tasks
 * @see sql/schema/v2/MIG_2982__equipment_data_correction.sql
 * @route /api/equipment/collections
 */
export interface EquipmentCollectionTaskRow {
  task_id: string;
  person_name: string;
  phone: string | null;
  person_id: string | null;
  equipment_description: string | null;
  trap_count: number | null;
  collection_status: string;
  outreach_method: string | null;
  notes: string | null;
  traps_returned: number;
  last_contacted_at: string | null;
  resolved_at: string | null;
  source_system: string;
  source_record_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Contract for ops.equipment_events rows
 * @route /api/equipment/[id]/events
 */
export interface EquipmentEventRow {
  event_id: string;
  equipment_id: string;
  event_type: string;
  actor_person_id: string | null;
  actor_name: string | null;
  custodian_person_id: string | null;
  custodian_name: string | null;
  place_id: string | null;
  place_address: string | null;
  request_id: string | null;
  kit_id: string | null;
  condition_before: string | null;
  condition_after: string | null;
  due_date: string | null;
  notes: string | null;
  source_system: string;
  created_at: string;
  // MIG_2983 fields
  checkout_type: string | null;
  deposit_amount: number | null;
  deposit_returned_at: string | null;
  custodian_phone: string | null;
  appointment_id: string | null;
  // MIG_2996 fields
  checkout_purpose: string | null;
  custodian_name_raw: string | null;
  resolution_status: string | null;
  // MIG_3005 fields
  photo_url: string | null;
}

/**
 * Contract for ops.equipment_kits with item count
 * @route /api/equipment/kits
 */
export interface EquipmentKitRow {
  kit_id: string;
  person_id: string | null;
  person_name: string | null;
  request_id: string | null;
  place_id: string | null;
  place_address: string | null;
  checked_out_at: string;
  returned_at: string | null;
  notes: string | null;
  item_count: number;
  items: Array<{
    equipment_id: string;
    barcode: string | null;
    display_name: string;
    type_display_name: string | null;
  }>;
}

/**
 * Contract for /api/equipment/stats dashboard
 * @route /api/equipment/stats
 */
export interface EquipmentStatsRow {
  total: number;
  available: number;
  checked_out: number;
  in_maintenance: number;
  missing: number;
  overdue: number;
  needs_repair: number;
  by_category: Array<{ category: string; count: number }>;
  by_type: Array<{ type_key: string; display_name: string; count: number }>;
  by_item_type: Array<{ item_type: string; count: number }>;
}

/**
 * Contract for ops.v_equipment_activity view
 * Extends EquipmentEventRow with equipment context fields.
 * @see sql/schema/v2/MIG_3030__equipment_activity_view.sql
 * @route /api/equipment/activity
 */
export interface EquipmentActivityRow extends EquipmentEventRow {
  equipment_name: string;
  equipment_barcode: string | null;
  equipment_category: string;
  equipment_type_name: string;
}

/**
 * Contract for GET /api/equipment/stats/today
 * @route /api/equipment/stats/today
 */
export interface KioskDailyStatsRow {
  checkouts_today: number;
  checkins_today: number;
  deposits_today: number;
  overdue_count: number;
  last_activity_at: string | null;
  active_staff_today: string[];
}

/**
 * Contract for ops.equipment_types rows
 * @route /api/equipment/types
 */
export interface EquipmentTypeRow {
  type_key: string;
  display_name: string;
  category: string;
  manufacturer: string | null;
  is_active: boolean;
  sort_order: number;
  item_count: number;
}

/**
 * Contract for GET /api/people/[id]/equipment-context
 * @route /api/people/[id]/equipment-context
 */
export interface EquipmentContextResponse {
  active_requests: Array<{
    request_id: string;
    place_address: string | null;
    estimated_cat_count: number | null;
    status: string;
  }>;
  upcoming_appointments: Array<{
    appointment_id: string;
    appointment_date: string;
    service_name: string | null;
    place_address: string;
  }>;
  service_places: Array<{
    place_id: string;
    place_name: string;
    service_type: string;
  }>;
  recent_checkouts: Array<{
    event_id: string;
    created_at: string;
    equipment_name: string;
    place_address: string;
  }>;
}

// =============================================================================
// EQUIPMENT RECONCILIATION
// =============================================================================

/**
 * Contract for POST /api/equipment/reconcile response items
 */
export interface EquipmentReconcileResult extends VEquipmentInventoryRow {
  was_scanned: boolean;
  scan_status: string;
  suggested_action: string | null;
  last_holder_name: string | null;
  last_holder_date: string | null;
  last_event_type: string | null;
}

/**
 * Contract for POST /api/equipment/reconcile summary
 */
export interface EquipmentReconcileSummary {
  total_equipment: number;
  total_scanned: number;
  confirmed: number;
  found_here: number;
  found: number;
  possibly_missing: number;
  expected_out: number;
  still_missing: number;
  unknown_barcodes: string[];
}

// =============================================================================
// TNR DATA SURFACING VIEWS (MIG_3009)
// =============================================================================

/**
 * Contract for ops.v_place_breeding_activity
 * @see sql/schema/v2/MIG_3009__tnr_data_surfacing.sql
 * @route /api/beacon/places (via matview)
 */
export interface VPlaceBreedingActivityRow {
  place_id: string;
  pregnant_recent: number;
  lactating_recent: number;
  has_recent_breeding: boolean;
  last_breeding_detected: string | null;
}

/**
 * Contract for ops.v_trapper_efficiency
 * @see sql/schema/v2/MIG_3009__tnr_data_surfacing.sql
 * @route /api/trappers
 */
export interface VTrapperEfficiencyRow {
  trapper_person_id: string;
  total_sessions: number;
  total_trapped: number;
  total_traps_set: number;
  total_cats_seen: number;
  total_eartipped_seen: number;
  catch_per_trap: number | null;
}

/**
 * Contract for ops.v_place_lifecycle_summary
 * @see sql/schema/v2/MIG_3009__tnr_data_surfacing.sql
 * @route /api/places/[id]/population-events
 */
export interface VPlaceLifecycleSummaryRow {
  place_id: string;
  tnr_count: number;
  adoption_count: number;
  mortality_count: number;
  rtf_count: number;
  transfer_count: number;
  foster_count: number;
  intake_count: number;
  total_events: number;
}

/**
 * Extended beacon place metrics with MIG_3009 columns
 * @see sql/schema/v2/MIG_3009__tnr_data_surfacing.sql
 * @route /api/beacon/places
 */
export interface VBeaconPlaceMetricsRow {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  place_kind: string | null;
  latitude: number | null;
  longitude: number | null;
  total_cats: number;
  altered_cats: number;
  known_status_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  total_people: number;
  total_requests: number;
  active_requests: number;
  total_appointments: number;
  last_appointment_date: string | null;
  colony_estimate: number | null;
  estimate_method: string | null;
  last_activity_at: string | null;
  zone_code: string | null;
  // MIG_3009 columns
  has_recent_breeding: boolean;
  last_breeding_detected: string | null;
  colony_trend: string;
  new_intact_arrivals: number;
  immigration_pressure: string;
}

// =============================================================================
// CALL SHEET VIEWS (MIG_3077)
// =============================================================================

/**
 * Contract for ops.v_call_sheet_summary
 * @see sql/schema/v2/MIG_3077__call_sheet_tracking.sql
 * @route /api/admin/call-sheets
 */
export interface VCallSheetSummaryRow {
  call_sheet_id: string;
  title: string;
  status: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  assigned_to_person_id: string | null;
  assigned_to_name: string | null;
  assigned_to_trapper_type: string | null;
  total_items: number;
  pending_count: number;
  attempted_count: number;
  follow_up_count: number;
  converted_count: number;
  dead_end_count: number;
  skipped_count: number;
  completed_items: number;
  is_overdue: boolean;
}

/**
 * Contract for ops.v_call_sheet_items_detail
 * @see sql/schema/v2/MIG_3077__call_sheet_tracking.sql
 * @route /api/admin/call-sheets/[id]
 */
export interface VCallSheetItemsDetailRow {
  item_id: string;
  call_sheet_id: string;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  place_id: string | null;
  place_address: string | null;
  request_id: string | null;
  person_id: string | null;
  priority_order: number;
  status: string;
  disposition: string | null;
  attempt_count: number;
  last_attempted_at: string | null;
  follow_up_at: string | null;
  notes: string | null;
  converted_to_type: string | null;
  converted_to_id: string | null;
  converted_at: string | null;
  context_summary: string | null;
  created_at: string;
  updated_at: string;
  place_name: string | null;
  place_full_address: string | null;
  request_status: string | null;
  request_summary: string | null;
  request_priority: string | null;
  person_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
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
