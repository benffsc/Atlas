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
  PERMISSION_STATUS,
  EARTIP_ESTIMATE,
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

export const CreatePersonSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(200).trim(),
  last_name: z.string().max(200).trim().optional().nullable(),
  email: z.string().email("Invalid email").max(200).trim().optional().nullable(),
  phone: z.string().max(30).trim().optional().nullable(),
  entity_type: z.enum(PERSON_ENTITY_TYPE).optional().nullable(),
}).refine(
  (data) => (data.email && data.email.trim()) || (data.phone && data.phone.replace(/\D/g, '').length >= 7),
  { message: "Email or phone required to create a person", path: ["email"] }
);

export type CreatePersonInput = z.infer<typeof CreatePersonSchema>;

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
  // Status change reason (FFS-636: stored in ops.request_status_history)
  status_change_reason: z.string().max(500).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // MIG_2532: Beacon-critical fields
  // ──────────────────────────────────────────────────────────────────────────
  peak_count: z.number().int().min(0).max(999).nullable().optional(),
  awareness_duration: z.string().max(100).nullable().optional(),
  county: z.string().max(100).nullable().optional(),
  cats_are_friendly: z.string().max(50).nullable().optional(),
  eartip_count: z.number().int().min(0).max(999).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // MIG_2531/2532: Kitten tracking
  // ──────────────────────────────────────────────────────────────────────────
  kitten_behavior: z.string().max(100).nullable().optional(),
  kitten_contained: z.string().max(50).nullable().optional(),
  mom_present: z.string().max(50).nullable().optional(),
  mom_fixed: z.string().max(50).nullable().optional(),
  can_bring_in: z.string().max(50).nullable().optional(),
  kitten_age_estimate: z.string().max(100).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // MIG_2522: Third-party reporter
  // ──────────────────────────────────────────────────────────────────────────
  is_third_party_report: z.boolean().nullable().optional(),
  third_party_relationship: z.string().max(200).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Trapping logistics
  // ──────────────────────────────────────────────────────────────────────────
  dogs_on_site: z.string().max(50).nullable().optional(),
  trap_savvy: z.string().max(50).nullable().optional(),
  previous_tnr: z.string().max(50).nullable().optional(),
  handleability: z.string().max(100).nullable().optional(),
  best_trapping_time: z.string().max(500).nullable().optional(),
  best_times_seen: z.string().max(500).nullable().optional(),
  traps_overnight_safe: z.boolean().nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Property & access
  // ──────────────────────────────────────────────────────────────────────────
  permission_status: z.enum(PERMISSION_STATUS).nullable().optional(),
  is_property_owner: z.boolean().nullable().optional(),
  has_property_access: z.string().max(50).nullable().optional(),
  property_owner_name: z.string().max(200).nullable().optional(),
  property_owner_phone: z.string().max(30).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Feeding
  // ──────────────────────────────────────────────────────────────────────────
  feeding_location: z.string().max(500).nullable().optional(),
  feeding_time: z.string().max(200).nullable().optional(),
  feeding_schedule: z.string().max(100).nullable().optional(), // Legacy alias for feeding_frequency
  // ──────────────────────────────────────────────────────────────────────────
  // Urgency
  // ──────────────────────────────────────────────────────────────────────────
  urgency_reasons: z.array(z.string().max(100)).max(20).nullable().optional(),
  urgency_notes: z.string().max(2000).nullable().optional(),
  urgency_deadline: z.string().max(100).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Triage
  // ──────────────────────────────────────────────────────────────────────────
  triage_category: z.string().max(50).nullable().optional(),
  important_notes: z.array(z.string().max(200)).max(20).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Cat description
  // ──────────────────────────────────────────────────────────────────────────
  cat_name: z.string().max(200).nullable().optional(),
  cat_description: z.string().max(2000).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Site contact (FFS-442)
  // ──────────────────────────────────────────────────────────────────────────
  site_contact_person_id: z.string().uuid().nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Location editing (FFS-1015)
  // ──────────────────────────────────────────────────────────────────────────
  place_id: z.string().uuid().nullable().optional(),
  location_description: z.string().max(2000).nullable().optional(),
  total_cats_reported: z.number().int().min(0).max(999).nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Staff/admin
  // ──────────────────────────────────────────────────────────────────────────
  received_by: z.string().uuid().nullable().optional(),
  // ──────────────────────────────────────────────────────────────────────────
  // Optimistic locking (FFS-1367)
  // ──────────────────────────────────────────────────────────────────────────
  updated_at: z.string().optional(),
});

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
