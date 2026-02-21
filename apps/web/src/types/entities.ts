/**
 * Atlas Entity Types
 *
 * TypeScript interfaces for core Atlas entities.
 * These correspond to database tables in sot.* and ops.* schemas.
 *
 * IMPORTANT: Entity IDs are permanent stable handles (CLAUDE.md INV-3).
 * Always preserve UUIDs when migrating data.
 */

import type {
  RequestStatus,
  DataQuality,
  SourceSystem,
  TrapperType,
  VolunteerRole,
  AlteredStatus,
  PersonCatRelationship,
  CatPlaceRelationship,
} from '@/lib/constants';

// =============================================================================
// BASE TYPES
// =============================================================================

/**
 * Base entity with common fields.
 * All entities have timestamps and merge chain support.
 */
export interface BaseEntity {
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

/**
 * Entity with merge chain support.
 * IMPORTANT: Never delete entities — use merged_into_*_id instead.
 */
export interface MergeableEntity<IdType = string> extends BaseEntity {
  merged_into_id: IdType | null;
}

/**
 * Entity with source tracking (provenance).
 */
export interface SourcedEntity extends BaseEntity {
  source_system: SourceSystem;
  source_record_id: string | null;
  source_created_at: string | null;
}

// =============================================================================
// PERSON
// =============================================================================

export interface Person extends MergeableEntity {
  person_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;

  // Classification
  entity_type: 'person' | 'organization' | 'unknown';
  is_organization: boolean;
  data_quality: DataQuality;

  // Primary address (optional)
  primary_address_id: string | null;

  // Source tracking
  source_system: SourceSystem;
  source_record_id: string | null;

  // Loaded on demand
  identifiers?: PersonIdentifier[];
  places?: PersonPlaceSummary[];
  cats?: PersonCatSummary[];
  roles?: PersonRole[];
}

export interface PersonIdentifier {
  identifier_id: string;
  person_id: string;
  id_type: 'email' | 'phone';
  id_value: string;
  id_value_norm: string;
  is_primary: boolean;
  confidence: number;
  source_system: SourceSystem;
  created_at: string;
}

export interface PersonRole {
  role_id: string;
  person_id: string;
  role: VolunteerRole;
  role_status: 'active' | 'inactive';
  trapper_type: TrapperType | null;
  valid_from: string | null;
  valid_to: string | null;
  source_system: SourceSystem;
}

export interface PersonPlaceSummary {
  place_id: string;
  display_name: string;
  relationship_type: string;
  is_primary: boolean;
}

export interface PersonCatSummary {
  cat_id: string;
  name: string | null;
  relationship_type: PersonCatRelationship;
}

// =============================================================================
// PLACE
// =============================================================================

export interface Place extends MergeableEntity {
  place_id: string;
  display_name: string;

  // Address components
  normalized_address: string | null;
  formatted_address: string | null;
  house_number: string | null;
  street_name: string | null;
  unit_number: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;

  // Geocoding
  lat: number | null;
  lng: number | null;
  is_geocoded: boolean;
  geocode_confidence: number | null;

  // Classification
  place_type: 'address' | 'coordinates' | 'site' | 'unknown';
  is_address_backed: boolean;

  // Hierarchy
  parent_place_id: string | null;
  requires_unit_selection: boolean;

  // Source tracking
  source_system: SourceSystem;
  source_record_id: string | null;

  // Colony data (from beacon layer, loaded on demand)
  colony_estimate_low?: number;
  colony_estimate_high?: number;
  tnr_coverage_pct?: number;
  last_tnr_date?: string;
  cat_count?: number;

  // Loaded on demand
  children?: PlaceSummary[];
  cats?: PlaceCatSummary[];
  disease_status?: PlaceDiseaseStatus;
}

export interface PlaceSummary {
  place_id: string;
  display_name: string;
  unit_number: string | null;
  cat_count: number;
}

export interface PlaceCatSummary {
  cat_id: string;
  name: string | null;
  relationship_type: CatPlaceRelationship;
  microchip: string | null;
  altered_status: AlteredStatus | null;
}

export interface PlaceDiseaseStatus {
  place_id: string;
  felv_status: 'confirmed_active' | 'historical' | 'unknown' | null;
  fiv_status: 'confirmed_active' | 'historical' | 'unknown' | null;
  last_test_date: string | null;
  positive_count: number;
  total_tested: number;
}

// =============================================================================
// CAT
// =============================================================================

export interface Cat extends MergeableEntity {
  cat_id: string;
  name: string | null;
  sex: 'Male' | 'Female' | 'Unknown' | null;
  color: string | null;
  breed: string | null;
  estimated_birth_date: string | null;
  estimated_birth_confidence: 'exact' | 'estimated' | 'unknown' | null;

  // Alteration status
  altered_status: AlteredStatus | null;
  altered_date: string | null;

  // Primary identifiers
  microchip: string | null;
  clinichq_animal_id: string | null;
  shelterluv_animal_id: string | null;

  // Source tracking
  source_system: SourceSystem;
  source_record_id: string | null;

  // Multi-source fields (loaded on demand)
  field_sources?: CatFieldSource[];
  identifiers?: CatIdentifier[];
  places?: CatPlaceSummary[];
  procedures?: CatProcedure[];
  lifecycle_events?: CatLifecycleEvent[];
}

export interface CatIdentifier {
  identifier_id: string;
  cat_id: string;
  id_type: 'microchip' | 'clinichq_id' | 'shelterluv_id' | 'airtable_id';
  id_value: string;
  is_primary: boolean;
  source_system: SourceSystem;
}

export interface CatFieldSource {
  field_name: string;
  source_system: SourceSystem;
  source_value: string;
  confidence: number;
  updated_at: string;
}

export interface CatPlaceSummary {
  place_id: string;
  display_name: string;
  relationship_type: CatPlaceRelationship;
  evidence_type: string;
}

export interface CatProcedure {
  procedure_id: string;
  cat_id: string;
  appointment_id: string | null;
  procedure_type: string;
  procedure_date: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  is_spay: boolean;
  is_neuter: boolean;
  source_system: SourceSystem;
}

export interface CatLifecycleEvent {
  event_id: string;
  cat_id: string;
  event_type: 'intake' | 'tnr_procedure' | 'foster_start' | 'foster_end' | 'adoption' | 'return_to_field' | 'transfer' | 'mortality';
  event_date: string;
  place_id: string | null;
  person_id: string | null;
  notes: string | null;
  source_system: SourceSystem;
}

// =============================================================================
// REQUEST
// =============================================================================

export interface Request extends BaseEntity {
  request_id: string;
  status: RequestStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;

  // Location
  place_id: string;
  zone: string | null;

  // Cat counts
  estimated_cat_count: number | null;
  total_cats_reported: number | null;
  cat_count_semantic: 'needs_tnr' | 'legacy_total' | null;

  // People
  requester_person_id: string | null;
  primary_trapper_id: string | null;

  // Lifecycle
  resolved_at: string | null;
  resolution_reason: string | null;

  // Source tracking
  source_system: SourceSystem;
  source_record_id: string | null;
  source_created_at: string | null;

  // Loaded on demand
  place?: PlaceSummary;
  requester?: PersonSummary;
  trappers?: TrapperAssignment[];
  timeline?: RequestTimelineEntry[];
  cats?: RequestCatSummary[];
}

export interface PersonSummary {
  person_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
}

export interface TrapperAssignment {
  assignment_id: string;
  request_id: string;
  person_id: string;
  display_name: string;
  role: 'primary' | 'secondary' | 'backup';
  assigned_at: string;
  is_active: boolean;
}

export interface RequestTimelineEntry {
  entry_id: string;
  request_id: string;
  event_type: 'status_change' | 'note' | 'assignment' | 'cat_linked' | 'visit';
  old_value: string | null;
  new_value: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RequestCatSummary {
  cat_id: string;
  name: string | null;
  microchip: string | null;
  procedure_type: string | null;
  procedure_date: string | null;
}

// =============================================================================
// APPOINTMENT
// =============================================================================

export interface Appointment extends BaseEntity {
  appointment_id: string;
  appointment_number: string | null;
  appointment_date: string;

  // Entities
  cat_id: string | null;
  person_id: string | null;
  place_id: string | null;
  inferred_place_id: string | null;

  // Procedure flags
  is_spay: boolean;
  is_neuter: boolean;
  has_ear_tip: boolean;
  has_microchip: boolean;

  // Service details
  service_type: string | null;

  // Source tracking
  source_system: SourceSystem;
  source_record_id: string | null;
}

// =============================================================================
// VOLUNTEER
// =============================================================================

export interface Volunteer extends BaseEntity {
  volunteer_id: string;
  person_id: string;
  volunteerhub_id: string | null;

  // Role flags
  is_trapper: boolean;
  is_foster: boolean;
  is_clinic_volunteer: boolean;
  is_coordinator: boolean;

  // Status
  status: 'active' | 'inactive' | 'pending';
  trapper_type: TrapperType | null;

  // Group memberships
  groups: string[];

  // Dates
  joined_at: string | null;

  // Loaded on demand
  person?: PersonSummary;
  roles?: VolunteerRoleRecord[];
}

export interface VolunteerRoleRecord {
  role_id: string;
  person_id: string;
  role_type: VolunteerRole;
  trapper_type: TrapperType | null;
  valid_from: string;
  valid_to: string | null;
  source_system: SourceSystem;
}

// =============================================================================
// COLONY ESTIMATE (Beacon Layer)
// =============================================================================

export interface ColonyEstimate {
  place_id: string;
  estimated_population: number;
  ci_lower: number;
  ci_upper: number;

  // Chapman parameters
  marked_count: number;
  capture_count: number;
  recapture_count: number;

  // Quality
  estimation_method: 'chapman' | 'direct_count';
  sample_adequate: boolean;
  confidence_level: 'high' | 'medium' | 'low';

  // Temporal
  observation_start: string;
  observation_end: string;
  last_calculated_at: string;
}

// =============================================================================
// INTAKE SUBMISSION
// =============================================================================

export interface IntakeSubmission extends BaseEntity {
  submission_id: string;
  status: 'pending' | 'processing' | 'completed' | 'rejected';

  // Contact info
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_phone: string | null;

  // Location
  address: string | null;
  lat: number | null;
  lng: number | null;

  // Cat info
  estimated_cats: number | null;
  cat_behavior: string | null;
  urgency: string | null;
  notes: string | null;

  // Processing
  matched_place_id: string | null;
  matched_person_id: string | null;
  created_request_id: string | null;
  processed_at: string | null;
  rejection_reason: string | null;
}
