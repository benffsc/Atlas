/**
 * Intake Options — Re-export layer
 *
 * This file re-exports from the canonical form-options.ts registry.
 * Preserved for backward compatibility with:
 *   - Digital intake form (/intake/page.tsx)
 *   - Quick intake form (/intake/queue/new/page.tsx)
 *   - Print forms (/intake/print/*) — PROTECTED, Jami's daily workflow
 *   - Jotform (update manually to match)
 *
 * FFS-692: Converted from standalone definitions to re-exports.
 * @see form-options.ts for the single source of truth.
 */

import {
  CALL_TYPE_OPTIONS as _CALL_TYPE_OPTIONS,
  OWNERSHIP_OPTIONS as _OWNERSHIP_OPTIONS,
  FIXED_STATUS_OPTIONS as _FIXED_STATUS_OPTIONS,
  HANDLEABILITY_OPTIONS as _HANDLEABILITY_OPTIONS,
  AWARENESS_DURATION_OPTIONS as _AWARENESS_DURATION_OPTIONS,
  FEEDING_FREQUENCY_OPTIONS as _FEEDING_FREQUENCY_OPTIONS,
  FEEDING_DURATION_OPTIONS as _FEEDING_DURATION_OPTIONS,
  CAT_INSIDE_OPTIONS as _CAT_INSIDE_OPTIONS,
  KITTEN_AGE_OPTIONS as _KITTEN_AGE_OPTIONS,
  KITTEN_BEHAVIOR_OPTIONS as _KITTEN_BEHAVIOR_OPTIONS,
  MOM_PRESENT_OPTIONS as _MOM_PRESENT_OPTIONS,
  MOM_FIXED_OPTIONS as _MOM_FIXED_OPTIONS,
  COUNT_CONFIDENCE_OPTIONS as _COUNT_CONFIDENCE_OPTIONS,
  COLONY_DURATION_OPTIONS as _COLONY_DURATION_OPTIONS,
  REFERRAL_SOURCE_OPTIONS as _REFERRAL_SOURCE_OPTIONS,
  URGENT_SITUATION_EXAMPLES as _URGENT_SITUATION_EXAMPLES,
  URGENT_SITUATION_LABEL as _URGENT_SITUATION_LABEL,
  IMPORTANT_NOTE_OPTIONS as _IMPORTANT_NOTE_OPTIONS,
  URGENCY_REASON_OPTIONS as _URGENCY_REASON_OPTIONS,
  getLabel,
} from "./form-options";

// =============================================================================
// RE-EXPORTS (values from canonical form-options.ts)
// =============================================================================

export const CALL_TYPE_OPTIONS = _CALL_TYPE_OPTIONS;
export const OWNERSHIP_OPTIONS = _OWNERSHIP_OPTIONS;
export const FIXED_STATUS_OPTIONS = _FIXED_STATUS_OPTIONS;
export const HANDLEABILITY_OPTIONS = _HANDLEABILITY_OPTIONS;
export const AWARENESS_DURATION_OPTIONS = _AWARENESS_DURATION_OPTIONS;
export const FEEDING_FREQUENCY_OPTIONS = _FEEDING_FREQUENCY_OPTIONS;
export const FEEDING_DURATION_OPTIONS = _FEEDING_DURATION_OPTIONS;
export const CAT_INSIDE_OPTIONS = _CAT_INSIDE_OPTIONS;
export const KITTEN_AGE_OPTIONS = _KITTEN_AGE_OPTIONS;
export const KITTEN_BEHAVIOR_OPTIONS = _KITTEN_BEHAVIOR_OPTIONS;
export const MOM_PRESENT_OPTIONS = _MOM_PRESENT_OPTIONS;
export const MOM_FIXED_OPTIONS = _MOM_FIXED_OPTIONS;
export const COUNT_CONFIDENCE_OPTIONS = _COUNT_CONFIDENCE_OPTIONS;
export const COLONY_DURATION_OPTIONS = _COLONY_DURATION_OPTIONS;
export const REFERRAL_SOURCE_OPTIONS = _REFERRAL_SOURCE_OPTIONS;
export const URGENT_SITUATION_EXAMPLES = _URGENT_SITUATION_EXAMPLES;
export const URGENT_SITUATION_LABEL = _URGENT_SITUATION_LABEL;
export const IMPORTANT_NOTE_OPTIONS = _IMPORTANT_NOTE_OPTIONS;
export const URGENCY_REASON_OPTIONS = _URGENCY_REASON_OPTIONS;

// =============================================================================
// DERIVED TYPES (preserved for backward compatibility)
// =============================================================================

export type CallType = (typeof CALL_TYPE_OPTIONS)[number]["value"];
export type OwnershipStatus = (typeof OWNERSHIP_OPTIONS)[number]["value"];
export type FixedStatus = (typeof FIXED_STATUS_OPTIONS)[number]["value"];
export type Handleability = (typeof HANDLEABILITY_OPTIONS)[number]["value"];
export type CountConfidence = (typeof COUNT_CONFIDENCE_OPTIONS)[number]["value"];
export type ColonyDuration = (typeof COLONY_DURATION_OPTIONS)[number]["value"];
export type ImportantNote = (typeof IMPORTANT_NOTE_OPTIONS)[number]["value"];
export type UrgencyReason = (typeof URGENCY_REASON_OPTIONS)[number]["value"];

// =============================================================================
// LABEL HELPERS (thin wrappers around canonical getLabel)
// =============================================================================

export function getOwnershipLabel(value: string): string {
  return getLabel(OWNERSHIP_OPTIONS, value);
}

export function getFixedStatusLabel(value: string): string {
  return getLabel(FIXED_STATUS_OPTIONS, value);
}

export function getCountConfidenceLabel(value: string): string {
  return getLabel(COUNT_CONFIDENCE_OPTIONS, value);
}

export function getColonyDurationLabel(value: string): string {
  return getLabel(COLONY_DURATION_OPTIONS, value);
}

// =============================================================================
// LEGACY HELPER (preserved for backward compatibility)
// =============================================================================

export { callTypeToOwnership } from "./form-options";
