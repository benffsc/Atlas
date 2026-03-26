/**
 * Central Enum Registry
 *
 * Single source of truth for all enum values used in API routes.
 * See CLAUDE.md invariant 48: All enum validation MUST use this registry.
 *
 * DO NOT define VALID_* constants inline in routes - import from here.
 *
 * For comprehensive status logic (labels, colors, transitions, etc.),
 * see @/lib/request-status.ts which is the single source of truth.
 *
 * @example
 * import { ENTITY_ENUMS, type RequestStatus } from "@/lib/enums";
 *
 * const status = requireValidEnum(body.status, ENTITY_ENUMS.REQUEST_STATUS, "status");
 */

// =============================================================================
// REQUEST ENUMS
// =============================================================================

// Import from single source of truth
import { ALL_STATUSES, type RequestStatus as RequestStatusType } from "./request-status";
import {
  PROPERTY_TYPE_OPTIONS as _PROPERTY_TYPE_OPTIONS,
  COLONY_DURATION_OPTIONS as _COLONY_DURATION_OPTIONS,
  COUNT_CONFIDENCE_OPTIONS as _COUNT_CONFIDENCE_OPTIONS,
  EARTIP_ESTIMATE_OPTIONS as _EARTIP_ESTIMATE_OPTIONS,
  FEEDING_FREQUENCY_OPTIONS as _FEEDING_FREQUENCY_OPTIONS,
  PERMISSION_STATUS_OPTIONS as _PERMISSION_STATUS_OPTIONS,
  KITTEN_ASSESSMENT_OUTCOME_OPTIONS as _KITTEN_ASSESSMENT_OUTCOME_OPTIONS,
  PRIORITY_OPTIONS as _PRIORITY_OPTIONS,
  DEATH_CAUSE_OPTIONS as _DEATH_CAUSE_OPTIONS,
  KITTEN_ASSESSMENT_STATUS_OPTIONS as _KITTEN_ASSESSMENT_STATUS_OPTIONS,
  EQUIPMENT_CUSTODY_STATUS_OPTIONS as _EQUIPMENT_CUSTODY_STATUS_OPTIONS,
  EQUIPMENT_CONDITION_OPTIONS as _EQUIPMENT_CONDITION_OPTIONS,
  EQUIPMENT_EVENT_TYPE_OPTIONS as _EQUIPMENT_EVENT_TYPE_OPTIONS,
  EQUIPMENT_CATEGORY_OPTIONS as _EQUIPMENT_CATEGORY_OPTIONS,
  EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS as _EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS,
  EQUIPMENT_ITEM_TYPE_OPTIONS as _EQUIPMENT_ITEM_TYPE_OPTIONS,
  EQUIPMENT_SIZE_OPTIONS as _EQUIPMENT_SIZE_OPTIONS,
  EQUIPMENT_COLLECTION_STATUS_OPTIONS as _EQUIPMENT_COLLECTION_STATUS_OPTIONS,
  EQUIPMENT_CHECKOUT_TYPE_OPTIONS as _EQUIPMENT_CHECKOUT_TYPE_OPTIONS,
  EQUIPMENT_TRACKING_TIER_OPTIONS as _EQUIPMENT_TRACKING_TIER_OPTIONS,
  getValues,
} from "./form-options";

// Re-export for API validation
// See @/lib/request-status.ts for the full status system documentation
export const REQUEST_STATUS = ALL_STATUSES;

// Derived from centralized form-options.ts registry (FFS-692)
export const REQUEST_PRIORITY = getValues(_PRIORITY_OPTIONS) as unknown as readonly ["urgent", "high", "normal", "low"];

export const HOLD_REASON = [
  "weather",
  "callback_pending",
  "access_issue",
  "resource_constraint",
  "client_unavailable",
  "scheduling_conflict",
  "trap_shy",
  "other",
] as const;

export const NO_TRAPPER_REASON = [
  "client_trapping",
  "has_community_help",
  "not_needed",
  "pending_assignment",
  "no_capacity",
] as const;

// Derived from centralized form-options.ts registry (FFS-486)
export const PERMISSION_STATUS = getValues(_PERMISSION_STATUS_OPTIONS) as unknown as readonly ["yes", "no", "pending", "not_needed", "unknown"];

export const COLONY_DURATION = getValues(_COLONY_DURATION_OPTIONS) as unknown as readonly ["under_1_month", "1_to_6_months", "6_to_24_months", "over_2_years", "unknown"];

export const COUNT_CONFIDENCE = getValues(_COUNT_CONFIDENCE_OPTIONS) as unknown as readonly ["exact", "good_estimate", "rough_guess", "unknown"];

export const EARTIP_ESTIMATE = getValues(_EARTIP_ESTIMATE_OPTIONS) as unknown as readonly ["none", "few", "some", "most", "all", "unknown"];

export const FEEDING_FREQUENCY = getValues(_FEEDING_FREQUENCY_OPTIONS) as unknown as readonly ["daily", "free_fed", "few_times_week", "occasionally", "rarely", "not_fed"];

export const PROPERTY_TYPE = getValues(_PROPERTY_TYPE_OPTIONS) as unknown as readonly ["private_home", "condo_townhome", "duplex_multiplex", "apartment_complex", "mobile_home_park", "farm_ranch", "rural_unincorporated", "business", "industrial", "public_park", "school_campus", "church_religious", "government_municipal", "vacant_lot", "other"];

export const KITTEN_ASSESSMENT_OUTCOME = getValues(_KITTEN_ASSESSMENT_OUTCOME_OPTIONS) as unknown as readonly ["taken_in", "tnr", "redirected", "temp_hold", "no_action"];

// =============================================================================
// HANDOFF ENUMS
// =============================================================================

export const HANDOFF_REASON = [
  "caretaker_moving",
  "new_caretaker",
  "cats_relocated",
  "neighbor_takeover",
  "health_reasons",
  "property_owner_found",
  "tenant_moved_owner_takeover",
  "property_management_change",
  "other",
] as const;

export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  caretaker_moving: "Original caretaker is moving",
  new_caretaker: "New person taking over colony care",
  cats_relocated: "Cats are being relocated to new site",
  neighbor_takeover: "Neighbor assuming responsibility",
  health_reasons: "Original caretaker cannot continue (health/personal)",
  property_owner_found: "Property owner identified and taking responsibility",
  tenant_moved_owner_takeover: "Tenant moved out, owner/manager assuming responsibility",
  property_management_change: "Property management change",
  other: "Other reason",
};

// =============================================================================
// PERSON ENUMS
// =============================================================================

export const PERSON_ENTITY_TYPE = [
  "individual",
  "household",
  "organization",
  "clinic",
  "rescue",
] as const;

export const TRAPPING_SKILL = [
  "novice",
  "intermediate",
  "experienced",
  "expert",
] as const;

export const TRAPPER_TYPE = [
  "coordinator",
  "head_trapper",
  "ffsc_trapper",
  "community_trapper",
  "volunteer",
] as const;

export const PERSON_PLACE_ROLE = [
  // Residence types
  "resident",
  "property_owner",
  // Colony caretaker hierarchy
  "colony_caretaker",
  "colony_supervisor",
  "feeder",
  // Transport/logistics
  "transporter",
  // Referral/contact
  "referrer",
  "neighbor",
  "site_contact",
  // Work/volunteer
  "works_at",
  "volunteers_at",
  // Automated/unverified
  "contact_address",
  // Legacy
  "owner",
  "manager",
  "caretaker",
  "requester",
  "trapper_at",
] as const;

// =============================================================================
// PLACE ENUMS
// =============================================================================

export const PLACE_KIND = [
  "unknown",
  "residential_house",
  "apartment_unit",
  "apartment_building",
  "business",
  "clinic",
  "neighborhood",
  "outdoor_site",
  "mobile_home_space",
  "internal_storage",
] as const;

// =============================================================================
// CAT ENUMS
// =============================================================================

// Derived from centralized form-options.ts registry (FFS-692)
export const DEATH_CAUSE = getValues(_DEATH_CAUSE_OPTIONS) as unknown as readonly ["unknown", "natural", "vehicle", "predator", "disease", "euthanasia", "injury", "starvation", "weather", "other"];

export const KITTEN_ASSESSMENT_STATUS = getValues(_KITTEN_ASSESSMENT_STATUS_OPTIONS) as unknown as readonly ["pending", "assessed", "follow_up", "not_assessing", "placed"];

export const DATE_PRECISION = [
  "exact",
  "week",
  "month",
  "season",
  "year",
  "estimated",
] as const;

export const SEASON = ["spring", "summer", "fall", "winter"] as const;

export const ALTERED_STATUS = [
  "altered",
  "intact",
  "unknown",
] as const;

export const CAT_SEX = ["male", "female", "unknown"] as const;

// =============================================================================
// EQUIPMENT ENUMS
// =============================================================================

export const EQUIPMENT_CUSTODY_STATUS = getValues(_EQUIPMENT_CUSTODY_STATUS_OPTIONS) as unknown as readonly ["available", "checked_out", "in_field", "maintenance", "missing", "retired"];
export const EQUIPMENT_CONDITION = getValues(_EQUIPMENT_CONDITION_OPTIONS) as unknown as readonly ["new", "good", "fair", "poor", "damaged", "decommissioned"];
export const EQUIPMENT_EVENT_TYPE = getValues(_EQUIPMENT_EVENT_TYPE_OPTIONS) as unknown as readonly ["check_out", "check_in", "transfer", "condition_change", "maintenance_start", "maintenance_end", "reported_missing", "found", "retired", "note"];
export const EQUIPMENT_CATEGORY = getValues(_EQUIPMENT_CATEGORY_OPTIONS) as unknown as readonly ["trap", "cage", "camera", "accessory"];
export const EQUIPMENT_FUNCTIONAL_STATUS = getValues(_EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS) as unknown as readonly ["functional", "needs_repair", "unknown"];
export const EQUIPMENT_ITEM_TYPE = getValues(_EQUIPMENT_ITEM_TYPE_OPTIONS) as unknown as readonly ["Trap", "Wire Cage", "Gadget"];
export const EQUIPMENT_SIZE = getValues(_EQUIPMENT_SIZE_OPTIONS) as unknown as readonly ["Small", "Large", "Extra Large"];
export const EQUIPMENT_COLLECTION_STATUS = getValues(_EQUIPMENT_COLLECTION_STATUS_OPTIONS) as unknown as readonly ["pending", "contacted", "will_return", "do_not_collect", "no_traps", "collected"];
export const EQUIPMENT_CHECKOUT_TYPE = getValues(_EQUIPMENT_CHECKOUT_TYPE_OPTIONS) as unknown as readonly ["client", "trapper", "internal", "foster"];
export const EQUIPMENT_TRACKING_TIER = getValues(_EQUIPMENT_TRACKING_TIER_OPTIONS) as unknown as readonly ["active", "passive", "untracked"];

// =============================================================================
// GENERAL ENUMS
// =============================================================================

export const ENTITY_TYPE = ["person", "cat", "place", "request"] as const;

// =============================================================================
// GROUPED EXPORT FOR CONVENIENCE
// =============================================================================

export const ENTITY_ENUMS = {
  // Request
  REQUEST_STATUS,
  REQUEST_PRIORITY,
  HOLD_REASON,
  NO_TRAPPER_REASON,
  PERMISSION_STATUS,
  COLONY_DURATION,
  COUNT_CONFIDENCE,
  EARTIP_ESTIMATE,
  FEEDING_FREQUENCY,
  PROPERTY_TYPE,
  KITTEN_ASSESSMENT_OUTCOME,

  // Handoff
  HANDOFF_REASON,

  // Person
  PERSON_ENTITY_TYPE,
  TRAPPING_SKILL,
  TRAPPER_TYPE,
  PERSON_PLACE_ROLE,

  // Place
  PLACE_KIND,

  // Cat
  DEATH_CAUSE,
  KITTEN_ASSESSMENT_STATUS,
  DATE_PRECISION,
  SEASON,
  ALTERED_STATUS,
  CAT_SEX,

  // Equipment
  EQUIPMENT_CUSTODY_STATUS,
  EQUIPMENT_CONDITION,
  EQUIPMENT_EVENT_TYPE,
  EQUIPMENT_CATEGORY,
  EQUIPMENT_FUNCTIONAL_STATUS,
  EQUIPMENT_ITEM_TYPE,
  EQUIPMENT_SIZE,
  EQUIPMENT_COLLECTION_STATUS,
  EQUIPMENT_CHECKOUT_TYPE,
  EQUIPMENT_TRACKING_TIER,

  // General
  ENTITY_TYPE,
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

// Re-export RequestStatus from single source of truth
export type { RequestStatus } from "./request-status";
export type RequestPriority = (typeof REQUEST_PRIORITY)[number];
export type HoldReason = (typeof HOLD_REASON)[number];
export type NoTrapperReason = (typeof NO_TRAPPER_REASON)[number];
export type PermissionStatus = (typeof PERMISSION_STATUS)[number];
export type ColonyDuration = (typeof COLONY_DURATION)[number];
export type CountConfidence = (typeof COUNT_CONFIDENCE)[number];
export type EartipEstimate = (typeof EARTIP_ESTIMATE)[number];
export type FeedingFrequency = (typeof FEEDING_FREQUENCY)[number];
export type PropertyType = (typeof PROPERTY_TYPE)[number];
export type KittenAssessmentOutcome = (typeof KITTEN_ASSESSMENT_OUTCOME)[number];

export type HandoffReason = (typeof HANDOFF_REASON)[number];

export type PersonEntityType = (typeof PERSON_ENTITY_TYPE)[number];
export type TrappingSkill = (typeof TRAPPING_SKILL)[number];
export type TrapperType = (typeof TRAPPER_TYPE)[number];
export type PersonPlaceRole = (typeof PERSON_PLACE_ROLE)[number];

export type PlaceKind = (typeof PLACE_KIND)[number];

export type DeathCause = (typeof DEATH_CAUSE)[number];
export type KittenAssessmentStatus = (typeof KITTEN_ASSESSMENT_STATUS)[number];
export type DatePrecision = (typeof DATE_PRECISION)[number];
export type Season = (typeof SEASON)[number];
export type AlteredStatus = (typeof ALTERED_STATUS)[number];
export type CatSex = (typeof CAT_SEX)[number];

export type EquipmentCustodyStatus = (typeof EQUIPMENT_CUSTODY_STATUS)[number];
export type EquipmentCondition = (typeof EQUIPMENT_CONDITION)[number];
export type EquipmentEventType = (typeof EQUIPMENT_EVENT_TYPE)[number];
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORY)[number];
export type EquipmentFunctionalStatus = (typeof EQUIPMENT_FUNCTIONAL_STATUS)[number];
export type EquipmentItemType = (typeof EQUIPMENT_ITEM_TYPE)[number];
export type EquipmentSize = (typeof EQUIPMENT_SIZE)[number];
export type EquipmentCollectionStatus = (typeof EQUIPMENT_COLLECTION_STATUS)[number];
export type EquipmentCheckoutType = (typeof EQUIPMENT_CHECKOUT_TYPE)[number];
export type EquipmentTrackingTier = (typeof EQUIPMENT_TRACKING_TIER)[number];

export type EntityType = (typeof ENTITY_TYPE)[number];
