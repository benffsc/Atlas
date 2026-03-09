/**
 * Zod Validation Schemas
 *
 * Central registry of Zod schemas for API request validation.
 * Uses enums from @/lib/enums to ensure consistency.
 *
 * Usage:
 *   import { UpdatePersonSchema, parseBody } from "@/lib/schemas";
 *
 *   const parsed = await parseBody(request, UpdatePersonSchema);
 *   if ("error" in parsed) return parsed.error;
 *   const body = parsed.data;
 *
 * @see docs/DEVELOPER_QUICK_START.md
 */

import { z } from "zod";
import {
  REQUEST_STATUS,
  REQUEST_PRIORITY,
  HOLD_REASON,
  NO_TRAPPER_REASON,
  PERSON_ENTITY_TYPE,
  TRAPPING_SKILL,
  PLACE_KIND,
  ALTERED_STATUS,
  CAT_SEX,
  PROPERTY_TYPE,
  COLONY_DURATION,
  COUNT_CONFIDENCE,
  FEEDING_FREQUENCY,
} from "@/lib/enums";

// =============================================================================
// PAGINATION
// =============================================================================

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationParams = z.infer<typeof PaginationSchema>;

// =============================================================================
// PERSON SCHEMAS
// =============================================================================

export const UpdatePersonSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  entity_type: z.enum(PERSON_ENTITY_TYPE).nullable().optional(),
  trapping_skill: z.enum(TRAPPING_SKILL).nullable().optional(),
  trapping_skill_notes: z.string().max(2000).nullable().optional(),
  // Audit info
  changed_by: z.string().optional(),
  change_reason: z.string().optional(),
});

export type UpdatePersonInput = z.infer<typeof UpdatePersonSchema>;

// =============================================================================
// CAT SCHEMAS
// =============================================================================

export const UpdateCatSchema = z.object({
  // Maps to display_name in DB
  name: z.string().min(1).max(100).optional(),
  sex: z.enum(CAT_SEX).optional(),
  // Boolean that converts to altered_status Yes/No in DB
  is_eartipped: z.boolean().optional(),
  is_deceased: z.boolean().optional(),
  microchip: z.string().max(50).nullable().optional(),
  // Maps to primary_color in DB
  color_pattern: z.string().max(100).nullable().optional(),
  breed: z.string().max(100).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  // Audit info
  changed_by: z.string().optional(),
  change_reason: z.string().optional(),
  change_notes: z.string().max(2000).nullable().optional(),
});

export type UpdateCatInput = z.infer<typeof UpdateCatSchema>;

// =============================================================================
// PLACE SCHEMAS
// =============================================================================

export const UpdatePlaceSchema = z.object({
  display_name: z.string().min(1).max(200).nullable().optional(),
  place_kind: z.enum(PLACE_KIND).optional(),
  // Address correction fields
  formatted_address: z.string().max(500).optional(),
  locality: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  state_province: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Audit info
  changed_by: z.string().optional(),
  change_reason: z.string().optional(),
  change_notes: z.string().max(2000).optional(),
});

export type UpdatePlaceInput = z.infer<typeof UpdatePlaceSchema>;

// =============================================================================
// REQUEST SCHEMAS
// =============================================================================

export const UpdateRequestSchema = z.object({
  status: z.enum(REQUEST_STATUS).optional(),
  priority: z.enum(REQUEST_PRIORITY).optional(),
  summary: z.string().max(500).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  estimated_cat_count: z.number().int().min(0).max(999).nullable().optional(),
  has_kittens: z.boolean().nullable().optional(),
  // Hold management
  hold_reason: z.enum(HOLD_REASON).nullable().optional(),
  hold_reason_notes: z.string().max(2000).nullable().optional(),
  // Assignment
  no_trapper_reason: z.enum(NO_TRAPPER_REASON).nullable().optional(),
  // Intake fields
  property_type: z.enum(PROPERTY_TYPE).nullable().optional(),
  colony_duration: z.enum(COLONY_DURATION).nullable().optional(),
  count_confidence: z.enum(COUNT_CONFIDENCE).nullable().optional(),
  access_notes: z.string().max(2000).nullable().optional(),
  kitten_count: z.number().int().min(0).max(99).nullable().optional(),
  is_being_fed: z.boolean().nullable().optional(),
  feeder_name: z.string().max(200).nullable().optional(),
  feeding_frequency: z.enum(FEEDING_FREQUENCY).nullable().optional(),
  // Medical
  is_emergency: z.boolean().nullable().optional(),
  has_medical_concerns: z.boolean().nullable().optional(),
  medical_description: z.string().max(2000).nullable().optional(),
  // Completion/closure flow (FFS-155)
  resolution_outcome: z.enum(["successful", "partial", "unable_to_complete", "no_longer_needed", "referred_out"]).nullable().optional(),
  resolution_reason: z.string().max(200).nullable().optional(),
  resolution_notes: z.string().max(2000).nullable().optional(),
  observation_cats_seen: z.number().int().min(0).nullable().optional(),
  observation_eartips_seen: z.number().int().min(0).nullable().optional(),
  observation_notes: z.string().max(2000).nullable().optional(),
  skip_trip_report_check: z.boolean().optional(),
}).passthrough(); // Allow additional fields (MIG_2531/2532 Beacon fields, etc.)

export type UpdateRequestInput = z.infer<typeof UpdateRequestSchema>;

// =============================================================================
// JOURNAL SCHEMAS
// =============================================================================

const JOURNAL_ENTRY_KINDS = ["note", "observation", "communication", "system"] as const;

export const UpdateJournalEntrySchema = z.object({
  body: z.string().min(1).max(50000).optional(),
  title: z.string().max(200).nullable().optional(),
  entry_kind: z.enum(JOURNAL_ENTRY_KINDS).optional(),
  occurred_at: z.string().datetime().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  is_pinned: z.boolean().optional(),
  updated_by: z.string().optional(),
});

export type UpdateJournalEntryInput = z.infer<typeof UpdateJournalEntrySchema>;

// =============================================================================
// APPOINTMENT SCHEMAS
// =============================================================================

export const UpdateAppointmentSchema = z.object({
  clinic_day_number: z.number().int().min(1).max(999).nullable().optional(),
});

export type UpdateAppointmentInput = z.infer<typeof UpdateAppointmentSchema>;
