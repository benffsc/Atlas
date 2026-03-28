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
function titleCase(value: string | null | undefined): string {
  if (!value) return "";
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

// ── Placement types (adoption context, MIG_3005) ─────────────────────

export const PLACEMENT_TYPE_LABELS: Record<string, string> = {
  relocation: "Relocation",
  colony_return: "Colony Return",
  permanent_foster: "Permanent Foster",
  transfer: "Transfer",
  residential: "Residential",
};

export const NOTABLE_PLACEMENT_TYPES = new Set([
  "relocation", "colony_return", "permanent_foster", "transfer",
]);

export function formatPlacementType(type: string | null | undefined): string {
  if (!type) return "";
  return PLACEMENT_TYPE_LABELS[type] || titleCase(type);
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

export function formatMatchReason(reason: string | null | undefined, short = false): string {
  if (!reason) return "";
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

// ── Kitten priority (FFS-559) ────────────────────────────────────────

export const KITTEN_PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "#dc3545" },
  medium: { label: "Med", color: "#fd7e14" },
  low: { label: "Low", color: "#6c757d" },
};

export function getKittenPriorityTier(score: number | null): "high" | "medium" | "low" | null {
  if (score == null || score === 0) return null;
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

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

// ── SAC (Shelter Animals Count) vocabulary (FFS-416) ────────────────
// Maps FFSC-specific intake/outcome terms to ASPCA SAC national standards
// for grant reporting compatibility. These are DISPLAY mappings only —
// no schema changes needed. Use formatSacIntakeType() and formatSacOutcome()
// to convert FFSC values for SAC-compatible reports.

/** SAC Intake Type — maps call_type + ownership_status to SAC categories */
export const SAC_INTAKE_TYPE_LABELS: Record<string, string> = {
  // SAC standard intake types
  stray: "Stray/At-Large",
  owner_relinquished: "Owner/Guardian Relinquished",
  transfer_in: "Transferred In",
  return_to_field: "Return-to-Field (RTF)",
  other_intake: "Other Intake",
};

/** Map FFSC call_type + ownership to SAC intake type */
export function classifySacIntakeType(
  callType: string | null,
  ownershipStatus: string | null,
): string {
  // Owner's own pet = Owner Relinquished
  if (ownershipStatus === "my_cat") return "owner_relinquished";
  // Colony TNR = Return-to-Field
  if (callType === "colony_tnr") return "return_to_field";
  // Stray, newcomer, unknown = Stray/At-Large
  if (ownershipStatus === "unknown_stray" || ownershipStatus === "newcomer") return "stray";
  // Community cats being fed = Stray/At-Large (SAC classification)
  if (ownershipStatus === "community_colony") return "stray";
  // Kitten rescue = Stray/At-Large
  if (callType === "kitten_rescue") return "stray";
  // Medical/wellness for non-owned = Stray
  if (callType === "medical_concern" || callType === "wellness_check") return "stray";
  // Pet spay/neuter (not my_cat) = Other
  if (callType === "pet_spay_neuter") return "other_intake";
  // Info, relocation, caretaker support = Other
  if (callType === "info_only" || callType === "relocation" || callType === "caretaker_support") return "other_intake";
  return "other_intake";
}

export function formatSacIntakeType(callType: string | null, ownershipStatus: string | null): string {
  const sacType = classifySacIntakeType(callType, ownershipStatus);
  return SAC_INTAKE_TYPE_LABELS[sacType] || "Other Intake";
}

/** SAC Outcome Type — maps resolution_outcome to SAC live release categories */
export const SAC_OUTCOME_LABELS: Record<string, string> = {
  return_to_field: "Return-to-Field (RTF)",
  adoption: "Adoption",
  transfer_out: "Transfer Out",
  died_in_care: "Died in Care",
  euthanasia: "Shelter Euthanasia",
  owner_requested_euthanasia: "Owner/Guardian Requested Euthanasia",
  missing_lost_stolen: "Missing/Lost/Stolen",
  other_live: "Other Live Outcome",
  other_outcome: "Other Outcome",
};

/** Map FFSC resolution_outcome to SAC outcome type */
export function classifySacOutcome(
  resolutionOutcome: string | null,
  callType?: string | null,
): string {
  if (!resolutionOutcome) return "other_outcome";
  // Successful TNR = Return-to-Field
  if (resolutionOutcome === "successful") return "return_to_field";
  // Partial success = still RTF (some cats were fixed)
  if (resolutionOutcome === "partial") return "return_to_field";
  // Referred out = Transfer Out
  if (resolutionOutcome === "referred_out") return "transfer_out";
  // Unable to complete = Other
  if (resolutionOutcome === "unable_to_complete") return "other_outcome";
  // No longer needed = Other
  if (resolutionOutcome === "no_longer_needed") return "other_outcome";
  return "other_outcome";
}

export function formatSacOutcome(resolutionOutcome: string | null, callType?: string | null): string {
  const sacType = classifySacOutcome(resolutionOutcome, callType);
  return SAC_OUTCOME_LABELS[sacType] || "Other Outcome";
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
