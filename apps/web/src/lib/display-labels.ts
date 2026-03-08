/**
 * Centralized display label registry for all user-facing enum values.
 *
 * ALL components that render database enum values (place_kind, relationship_type,
 * source_system, status, triage_category, etc.) MUST import from here instead of
 * defining inline label maps. This ensures consistency and makes it easy to add
 * new enum values in one place.
 *
 * Every formatter has a title-case fallback so unknown/new values never show
 * raw snake_case to staff.
 *
 * @see FFS-326
 */

// Re-export from existing authoritative sources
export { SOURCE_SYSTEM_LABELS } from "./constants";

// ── Generic fallback formatter ──────────────────────────────────────

/** Convert snake_case to Title Case. Used as fallback for unknown values. */
function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Place Kind ──────────────────────────────────────────────────────

/** Superset covering both old (residential_house) and new (single_family) enum values. */
export const PLACE_KIND_LABELS: Record<string, string> = {
  // Current schema values
  single_family: "House",
  apartment_unit: "Apartment",
  apartment_building: "Apt Building",
  mobile_home: "Mobile Home",
  business: "Business",
  farm: "Farm",
  outdoor_site: "Outdoor Site",
  clinic: "Clinic",
  shelter: "Shelter",
  unknown: "Other",
  // Legacy / alternate values still in data
  residential_house: "House",
  mobile_home_space: "Mobile Home",
  multi_family: "Multi-Family",
  neighborhood: "Neighborhood",
  farm_ranch: "Farm/Ranch",
  park: "Park",
  school: "School",
};

export function formatPlaceKind(kind: string | null | undefined): string {
  if (!kind) return "Unknown";
  return PLACE_KIND_LABELS[kind] || titleCase(kind);
}

// ── Roles (person-place) ────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  resident: "Resident",
  property_owner: "Property Owner",
  colony_caretaker: "Caretaker",
  colony_supervisor: "Colony Supervisor",
  feeder: "Feeder",
  transporter: "Transporter",
  referrer: "Referrer",
  neighbor: "Neighbor",
  works_at: "Works At",
  volunteers_at: "Volunteers At",
  contact_address: "Contact Address",
  owner: "Owner",
  volunteer: "Volunteer",
  concerned_citizen: "Concerned Citizen",
  trapper: "Trapper",
  property_manager: "Property Manager",
  tenant: "Tenant",
};

// ── Relationship types (person-cat) ─────────────────────────────────

export const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: "Owner",
  caretaker: "Caretaker",
  colony_caretaker: "Colony Caretaker",
  foster: "Foster",
  finder: "Finder",
  surrenderer: "Surrenderer",
  adopter: "Adopter",
  resident: "Resident",
};

export function formatRole(role: string | null | undefined): string {
  if (!role) return "";
  return ROLE_LABELS[role] || RELATIONSHIP_LABELS[role] || titleCase(role);
}

// ── Match reasons (search) ──────────────────────────────────────────

/** Full-text labels for search/page.tsx detail view */
export const MATCH_REASON_LABELS: Record<string, string> = {
  exact_name: "Exact name",
  exact_microchip: "Exact microchip",
  exact_address: "Exact address",
  exact_email: "Exact email",
  exact_phone: "Exact phone",
  prefix_name: "Name starts with",
  prefix_microchip: "Microchip starts with",
  prefix_address: "Address starts with",
  similar_name: "Similar name",
  contains_name: "Name contains",
  trigram: "Fuzzy match",
  alias_match: "Alias",
  expanded_name: "Expanded name",
  name: "Name",
  address: "Address",
  phone: "Phone",
  email: "Email",
};

/** Compact labels for GroupedSearchResult badge display */
export const MATCH_REASON_SHORT_LABELS: Record<string, string> = {
  exact_name: "Exact",
  exact_microchip: "Exact Chip",
  exact_address: "Exact Address",
  exact_email: "Exact Email",
  exact_phone: "Exact Phone",
  prefix_name: "Prefix",
  prefix_microchip: "Prefix Chip",
  prefix_address: "Prefix Address",
  similar_name: "Similar",
  contains_name: "Contains",
  trigram: "Fuzzy",
  alias_match: "Alias",
  expanded_name: "Expanded",
  name: "Name",
  address: "Address",
  phone: "Phone",
  email: "Email",
};

export function formatMatchReason(reason: string, short = false): string {
  const labels = short ? MATCH_REASON_SHORT_LABELS : MATCH_REASON_LABELS;
  return labels[reason] || titleCase(reason);
}

// ── Source tables ────────────────────────────────────────────────────

export const SOURCE_TABLE_LABELS: Record<string, string> = {
  "ops.clinic_raw": "Clinic Record",
  "ops.appointments": "Appointment",
  "ops.intake_submissions": "Intake Submission",
  "ops.requests": "Request",
  "ops.cat_test_results": "Test Result",
  "source.clinichq_raw": "Clinic Import",
  "source.airtable_raw": "Airtable Import",
  "source.shelterluv_raw": "ShelterLuv Import",
  "source.volunteerhub_raw": "VolunteerHub Import",
  "sot.people": "Person",
  "sot.cats": "Cat",
  "sot.places": "Place",
};

// ── Match fields ────────────────────────────────────────────────────

export const MATCH_FIELD_LABELS: Record<string, string> = {
  client_name: "Client name",
  owner_first_name: "First name",
  owner_last_name: "Last name",
  owner_email: "Email",
  owner_phone: "Phone",
  owner_cell_phone: "Cell phone",
  owner_address: "Address",
  animal_name: "Animal name",
  microchip: "Microchip",
  formatted_address: "Address",
  display_name: "Name",
  created_at: "Date",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  summary: "Summary",
  breed: "Breed",
  primary_color: "Color",
  payload: "Record data",
};

// ── Triage categories ───────────────────────────────────────────────

export const TRIAGE_LABELS: Record<string, string> = {
  high_priority: "High Priority",
  high_priority_tnr: "High Priority",
  standard: "Standard",
  standard_tnr: "Standard",
  low_priority: "Low Priority",
  duplicate: "Duplicate",
  spam: "Spam",
  needs_info: "Needs Info",
  follow_up: "Follow-up",
  emergency: "Emergency",
};

// ── Request status (simple, for search context) ─────────────────────
// NOTE: The canonical STATUS_LABELS with legacy mappings lives in
// lib/request-status.ts. This is the simplified version for search display.

export const SEARCH_STATUS_LABELS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  on_hold: "On Hold",
};

// ── Source systems (re-exported above, formatter here) ───────────────

export function formatSourceSystem(source: string | null | undefined): string {
  if (!source) return "";
  // Import would be circular, inline the lookup
  const labels: Record<string, string> = {
    clinichq: "ClinicHQ",
    shelterluv: "ShelterLuv",
    volunteerhub: "VolunteerHub",
    airtable: "Airtable",
    web_intake: "Web Intake",
    petlink: "PetLink",
    google_maps: "Google Maps",
    atlas_ui: "Atlas",
  };
  return labels[source] || titleCase(source);
}

// ── Status formatter ────────────────────────────────────────────────

export function formatStatus(status: string | null | undefined): string {
  if (!status) return "";
  return SEARCH_STATUS_LABELS[status] || titleCase(status);
}

// ── Generic formatter ───────────────────────────────────────────────

/**
 * Format any enum value using an optional label map, with title-case fallback.
 * Convenience function for one-off use when a dedicated formatter doesn't exist.
 */
export function formatEnum(value: string | null | undefined, labels?: Record<string, string>): string {
  if (!value) return "";
  if (labels) return labels[value] || titleCase(value);
  return titleCase(value);
}
