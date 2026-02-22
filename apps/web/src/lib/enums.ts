/**
 * Central Enum Registry
 *
 * Single source of truth for all enum values used in API routes.
 * See CLAUDE.md invariant 48: All enum validation MUST use this registry.
 *
 * DO NOT define VALID_* constants inline in routes - import from here.
 *
 * @example
 * import { ENTITY_ENUMS, type RequestStatus } from "@/lib/enums";
 *
 * const status = requireValidEnum(body.status, ENTITY_ENUMS.REQUEST_STATUS, "status");
 */

// =============================================================================
// REQUEST ENUMS
// =============================================================================

export const REQUEST_STATUS = [
  "new",
  "needs_review",
  "triaged",
  "scheduled",
  "in_progress",
  "active",
  "on_hold",
  "completed",
  "partial",
  "cancelled",
  "redirected",
] as const;

export const REQUEST_PRIORITY = ["urgent", "high", "normal", "low"] as const;

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

export const PERMISSION_STATUS = [
  "yes",
  "no",
  "pending",
  "not_needed",
  "unknown",
] as const;

export const COLONY_DURATION = [
  "under_1_month",
  "1_to_6_months",
  "6_to_24_months",
  "over_2_years",
  "unknown",
] as const;

export const COUNT_CONFIDENCE = [
  "exact",
  "good_estimate",
  "rough_guess",
  "unknown",
] as const;

export const EARTIP_ESTIMATE = [
  "none",
  "few",
  "some",
  "most",
  "all",
  "unknown",
] as const;

export const PROPERTY_TYPE = [
  "private_home",
  "apartment_complex",
  "mobile_home_park",
  "business",
  "farm_ranch",
  "public_park",
  "industrial",
  "other",
] as const;

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
  "owner",
  "resident",
  "landlord",
  "property_manager",
  "caretaker",
  "colony_caretaker",
  "feeder",
  "neighbor",
  "other",
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
] as const;

// =============================================================================
// CAT ENUMS
// =============================================================================

export const DEATH_CAUSE = [
  "natural",
  "illness",
  "injury",
  "euthanasia",
  "hit_by_car",
  "predator",
  "unknown",
  "other",
] as const;

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
  PROPERTY_TYPE,

  // Person
  PERSON_ENTITY_TYPE,
  TRAPPING_SKILL,
  TRAPPER_TYPE,
  PERSON_PLACE_ROLE,

  // Place
  PLACE_KIND,

  // Cat
  DEATH_CAUSE,
  DATE_PRECISION,
  SEASON,
  ALTERED_STATUS,
  CAT_SEX,

  // General
  ENTITY_TYPE,
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type RequestStatus = (typeof REQUEST_STATUS)[number];
export type RequestPriority = (typeof REQUEST_PRIORITY)[number];
export type HoldReason = (typeof HOLD_REASON)[number];
export type NoTrapperReason = (typeof NO_TRAPPER_REASON)[number];
export type PermissionStatus = (typeof PERMISSION_STATUS)[number];
export type ColonyDuration = (typeof COLONY_DURATION)[number];
export type CountConfidence = (typeof COUNT_CONFIDENCE)[number];
export type EartipEstimate = (typeof EARTIP_ESTIMATE)[number];
export type PropertyType = (typeof PROPERTY_TYPE)[number];

export type PersonEntityType = (typeof PERSON_ENTITY_TYPE)[number];
export type TrappingSkill = (typeof TRAPPING_SKILL)[number];
export type TrapperType = (typeof TRAPPER_TYPE)[number];
export type PersonPlaceRole = (typeof PERSON_PLACE_ROLE)[number];

export type PlaceKind = (typeof PLACE_KIND)[number];

export type DeathCause = (typeof DEATH_CAUSE)[number];
export type DatePrecision = (typeof DATE_PRECISION)[number];
export type Season = (typeof SEASON)[number];
export type AlteredStatus = (typeof ALTERED_STATUS)[number];
export type CatSex = (typeof CAT_SEX)[number];

export type EntityType = (typeof ENTITY_TYPE)[number];
