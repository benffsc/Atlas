/**
 * Shared type definitions for cat detail pages.
 * Extracted from the monolithic cat detail page for reuse.
 */
import type { JournalEntry } from "@/components/sections";

export interface CatOwner {
  person_id: string;
  display_name: string;
  role: string;
}

export interface CatPlace {
  place_id: string;
  label: string;
  place_kind: string | null;
  role: string;
}

export interface CatIdentifier {
  type: string;
  value: string;
  source: string | null;
}

export interface ClinicAppointment {
  appointment_date: string;
  appt_number: string;
  client_name: string;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
}

export interface OriginPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  inferred_source: string | null;
}

export interface PartnerOrg {
  org_id: string;
  org_name: string;
  org_name_short: string;
  first_seen: string;
  appointment_count: number;
}

export interface EnhancedClinicAppointment {
  appointment_id: string;
  appointment_date: string;
  appt_number: string;
  client_name: string | null;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
  origin_address: string | null;
  partner_org_short: string | null;
}

export interface CatVital {
  vital_id: string;
  recorded_at: string;
  temperature_f: number | null;
  weight_lbs: number | null;
  is_pregnant: boolean;
  is_lactating: boolean;
  is_in_heat: boolean;
}

export interface CatCondition {
  condition_id: string;
  condition_type: string;
  severity: string | null;
  diagnosed_at: string;
  resolved_at: string | null;
  is_chronic: boolean;
}

export interface CatTestResult {
  test_id: string;
  test_type: string;
  test_date: string;
  result: string;
  result_detail: string | null;
}

export interface CatProcedure {
  procedure_id: string;
  procedure_type: string;
  procedure_date: string;
  status: string;
  performed_by: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  complications: string[] | null;
  post_op_notes: string | null;
}

export interface CatAppointment {
  appointment_id: string;
  appointment_date: string;
  clinic_day_number: number | null;
  appointment_category: string;
  service_types: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  vaccines: string[];
  treatments: string[];
}

export interface MortalityEvent {
  mortality_event_id: string;
  death_date: string | null;
  death_cause: string;
  death_age_category: string;
  mortality_timing: string | null;
  mortality_cause_detail: string | null;
  source_system: string;
  notes: string | null;
  created_at: string;
}

export interface ClinicalNote {
  appointment_date: string | null;
  note_type: "medical" | "quick" | "appointment";
  content: string;
  appointment_type: string | null;
}

export interface ClinicalNotesData {
  notes: ClinicalNote[];
  caution: string | null;
  has_medical_notes: boolean;
}

export interface BirthEvent {
  birth_event_id: string;
  litter_id: string;
  mother_cat_id: string | null;
  mother_name: string | null;
  birth_date: string | null;
  birth_date_precision: string;
  birth_year: number | null;
  birth_month: number | null;
  birth_season: string | null;
  place_id: string | null;
  place_name: string | null;
  kitten_count_in_litter: number | null;
  survived_to_weaning: boolean | null;
  litter_survived_count: number | null;
  source_system: string;
  notes: string | null;
  created_at: string;
}

export interface Sibling {
  cat_id: string;
  display_name: string;
  sex: string | null;
  microchip: string | null;
}

export interface FieldSourceValue {
  value: string;
  source: string;
  observed_at: string;
  is_current: boolean;
  confidence: number | null;
}

export interface ScheduledAppointment {
  appointment_id: string;
  scheduled_at: string;
  scheduled_date: string;
  status: string;
  appointment_type: string;
  provider_name: string | null;
  person_name: string | null;
  person_id: string | null;
  place_name: string | null;
  source_system: string;
}

export interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  altered_by_clinic: boolean | null;
  breed: string | null;
  color: string | null;
  secondary_color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  needs_microchip: boolean;
  data_source: string | null;
  ownership_type: string | null;
  quality_tier: string | null;
  quality_reason: string | null;
  notes: string | null;
  identifiers: CatIdentifier[];
  owners: CatOwner[];
  places: CatPlace[];
  clinic_history: ClinicAppointment[];
  vitals: CatVital[];
  conditions: CatCondition[];
  tests: CatTestResult[];
  procedures: CatProcedure[];
  appointments: CatAppointment[];
  first_appointment_date: string | null;
  last_appointment_date: string | null;
  total_appointments: number;
  photo_url: string | null;
  is_deceased: boolean | null;
  deceased_date: string | null;
  mortality_event: MortalityEvent | null;
  birth_event: BirthEvent | null;
  siblings: Sibling[];
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  primary_origin_place: OriginPlace | null;
  partner_orgs: PartnerOrg[];
  enhanced_clinic_history: EnhancedClinicAppointment[];
  field_sources: Record<string, FieldSourceValue[]> | null;
  has_field_conflicts: boolean;
  field_source_count: number;
  atlas_cat_id: string | null;
  atlas_cat_id_type: "microchip" | "hash" | null;
  description: string | null;
  current_status: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
}

/**
 * Combined data type returned by useCatDetail hook.
 * Used as the TData parameter for entity config types.
 */
export interface CatDetailData {
  cat: CatDetail | null;
  appointments: ScheduledAppointment[];
  journal: JournalEntry[];
  clinicalNotes: ClinicalNotesData | null;
  loading: boolean;
  error: string | null;
  fetchCat: () => Promise<void>;
  fetchJournal: () => Promise<void>;
  /** Derived FeLV/FIV status */
  felvFivStatus: FelvFivStatus;
  /** Latest weight vital */
  latestWeight: CatVital | null;
  /** Latest temperature vital */
  latestTemp: CatVital | null;
}

export interface FelvFivStatus {
  fivResult: string | null;
  felvResult: string | null;
  testDate: string | null;
  hasAnyTest: boolean;
  anyPositive: boolean;
  allNegative: boolean;
}
