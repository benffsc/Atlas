/**
 * TypeScript types for the form system (mirrors ops.form_field_definitions,
 * ops.form_templates, ops.form_template_fields, ops.form_submissions).
 *
 * Three-layer architecture:
 *   Layer 1: FormFieldDefinition — define fields once
 *   Layer 2: FormTemplate + FormTemplateField — compose fields into documents
 *   Layer 3: FormSubmission — record what was captured (audit trail)
 */

// ── Layer 1: Field Definitions ──

export type FieldType =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "multi_select"
  | "date"
  | "textarea"
  | "phone"
  | "email";

/** Runtime-checkable array of all valid field types. */
export const FIELD_TYPES = ["text", "number", "boolean", "select", "multi_select", "date", "textarea", "phone", "email"] as const satisfies readonly FieldType[];

export type FieldCategory =
  | "contact"
  | "location"
  | "cat_info"
  | "logistics"
  | "trapping"
  | "kitten"
  | "medical"
  | "staff"
  | "referral";

/** Runtime-checkable array of all valid field categories. */
export const FIELD_CATEGORIES = ["contact", "location", "cat_info", "logistics", "trapping", "kitten", "medical", "staff", "referral"] as const satisfies readonly FieldCategory[];

/** All known field_key values in the registry. */
export type FieldKey =
  // Contact
  | "first_name"
  | "last_name"
  | "phone"
  | "email"
  | "preferred_contact_method"
  | "best_contact_times"
  | "is_third_party_report"
  | "third_party_relationship"
  | "property_owner_name"
  | "property_owner_contact"
  // Location
  | "address"
  | "city"
  | "zip"
  | "county"
  | "property_type"
  | "ownership_status"
  | "location_description"
  | "access_notes"
  | "is_property_owner"
  | "has_property_access"
  // Cat Info
  | "cat_count"
  | "peak_count"
  | "eartip_count"
  | "count_confidence"
  | "cats_friendly"
  | "handleability"
  | "fixed_status"
  | "colony_duration"
  | "cat_descriptions"
  | "is_being_fed"
  | "feeding_frequency"
  | "awareness_duration"
  | "eartip_status"
  | "home_access"
  // Logistics
  | "dogs_on_site"
  | "trap_savvy"
  | "previous_tnr"
  | "traps_overnight_safe"
  | "permission_status"
  | "feeder_name"
  | "feeding_time"
  | "feeding_location"
  | "best_trapping_time"
  | "important_notes"
  // Trapping
  | "trap_count"
  | "set_time"
  | "return_time"
  | "cats_caught"
  | "trap_locations"
  | "recon_count"
  | "recon_adult_kitten_tipped"
  | "recon_observations"
  // Kitten
  | "has_kittens"
  | "kitten_count"
  | "kitten_age_estimate"
  | "kitten_behavior"
  | "kitten_contained"
  | "mom_present"
  | "mom_fixed"
  | "can_bring_in"
  | "kitten_notes"
  | "kitten_outcome"
  | "kitten_readiness"
  | "kitten_urgency"
  // Medical
  | "has_medical_concerns"
  | "medical_description"
  | "is_emergency"
  | "urgency_reasons"
  | "urgency_notes"
  // Staff
  | "date_received"
  | "received_by"
  | "intake_source"
  | "priority"
  | "triage_category"
  | "staff_notes"
  | "assigned_trapper"
  | "scheduled_date"
  // Referral
  | "referral_source"
  | "situation_description"
  | "caller_notes";

export interface FieldValidation {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface FormFieldDefinition {
  id: string;
  field_key: FieldKey;
  label: string;
  print_label: string | null;
  field_type: FieldType;
  options: string[] | null;
  validation: FieldValidation | null;
  default_value: unknown;
  description: string | null;
  category: FieldCategory;
  sort_order: number;
}

// ── Layer 2: Templates ──

export type TemplateKey = "help_request" | "tnr_call_sheet" | "trapper_sheet";

/** Runtime-checkable array of all valid template keys. */
export const FORM_TEMPLATE_KEYS = ["help_request", "tnr_call_sheet", "trapper_sheet"] as const satisfies readonly TemplateKey[];

export type FormEntityType = "request" | "cat" | "place";

/** Runtime-checkable array of all valid form entity types. */
export const FORM_ENTITY_TYPES = ["request", "cat", "place"] as const satisfies readonly FormEntityType[];

export type FieldWidth = "sm" | "md" | "lg" | "xl";

/** Runtime-checkable array of all valid field widths. */
export const FIELD_WIDTHS = ["sm", "md", "lg", "xl"] as const satisfies readonly FieldWidth[];

export interface PrintLayout {
  pages: number;
  orientation: "portrait" | "landscape";
  audience: "public" | "trappers" | "staff";
}

export interface FormTemplate {
  id: string;
  template_key: TemplateKey;
  name: string;
  description: string | null;
  entity_type: FormEntityType;
  schema_version: number;
  is_active: boolean;
  print_layout: PrintLayout | null;
}

export interface FormTemplateField {
  id: string;
  template_id: string;
  field_definition_id: string;
  sort_order: number;
  is_required: boolean;
  section_name: string;
  print_section: string | null;
  override_label: string | null;
  override_validation: FieldValidation | null;
  field_width: FieldWidth;
}

/** A resolved template field: template_field joined with its definition. */
export interface ResolvedTemplateField {
  // From template_fields
  sort_order: number;
  is_required: boolean;
  section_name: string;
  field_width: FieldWidth;
  override_label: string | null;
  // From field_definitions (resolved)
  field_key: FieldKey;
  label: string;
  print_label: string | null;
  field_type: FieldType;
  options: string[] | null;
  validation: FieldValidation | null;
  description: string | null;
  category: FieldCategory;
}

/** Full template config ready for rendering. */
export interface ResolvedTemplate {
  template_key: TemplateKey;
  name: string;
  description: string | null;
  entity_type: FormEntityType;
  schema_version: number;
  print_layout: PrintLayout | null;
  sections: TemplateSection[];
}

export interface TemplateSection {
  name: string;
  fields: ResolvedTemplateField[];
}

// ── Layer 3: Submissions ──

export type SubmissionSource = "atlas_ui" | "paper_entry" | "web_intake" | "import";

/** Runtime-checkable array of all valid submission sources. */
export const SUBMISSION_SOURCES = ["atlas_ui", "paper_entry", "web_intake", "import"] as const satisfies readonly SubmissionSource[];

/** Data stored in form_submissions.data — keyed by FieldKey. */
export type FormData = Partial<Record<FieldKey, unknown>>;

export interface FormSubmission {
  id: string;
  template_key: TemplateKey;
  schema_version: number;
  entity_type: FormEntityType;
  entity_id: string;
  data: FormData;
  submitted_by: string | null;
  submitted_at: string;
  source: SubmissionSource;
  paper_scan_url: string | null;
  notes: string | null;
}

// ── Admin form config section components ──

export type FormSectionComponent = "person" | "place" | "catDetails" | "kittens" | "propertyAccess" | "urgencyNotes";

/** Runtime-checkable array of all valid form section components. */
export const FORM_SECTION_COMPONENTS = ["person", "place", "catDetails", "kittens", "propertyAccess", "urgencyNotes"] as const satisfies readonly FormSectionComponent[];
