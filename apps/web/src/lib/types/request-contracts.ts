/**
 * Request Creation Contract (FFS-148)
 *
 * Single source of truth for the shape of a request creation payload.
 * Both the form and the API import from here — type drift is caught at compile time.
 *
 * All string/number fields accept null because the form explicitly sends null
 * for absent values (as opposed to omitting the field).
 *
 * @see /apps/web/src/app/api/requests/route.ts  — API consumer
 * @see /apps/web/src/app/requests/new/page.tsx  — Form producer
 */

import { z } from "zod";

// Helper: optional + nullable (form sends null for absent values)
const optStr = (max = 500) => z.string().max(max).optional().nullable();
const optBool = () => z.boolean().optional().nullable();
const optInt = (max = 999) => z.number().int().min(0).max(max).optional().nullable();

// =============================================================================
// Zod Schema — runtime validation
//
// Enum fields use optStr() rather than z.enum() because the form state uses
// plain strings. The API route validates enum values against @/lib/enums
// before database insertion (CHECK constraint catches the rest).
// =============================================================================

export const createRequestSchema = z.object({
  // Status & Priority
  status: optStr(50),
  priority: optStr(20),
  initial_status: optStr(50),

  // Request Purpose (MIG_2817)
  request_purpose: optStr(100),
  request_purposes: z.array(z.string().max(100)).optional().nullable(),

  // Location
  place_id: optStr(50),
  property_type: optStr(50),
  location_description: optStr(2000),

  // Contact - Requester
  requester_person_id: optStr(50),
  site_contact_person_id: optStr(50),
  requester_is_site_contact: optBool(),
  requester_role_at_submission: optStr(100),

  // Raw contact fallbacks (FFS-146)
  raw_requester_name: optStr(200),
  raw_requester_phone: optStr(30),
  raw_requester_email: optStr(200),

  // Cat Info
  estimated_cat_count: optInt(),
  total_cats_reported: optInt(),
  peak_count: optInt(),
  count_confidence: optStr(50),
  colony_duration: optStr(50),
  awareness_duration: optStr(100),
  eartip_count: optInt(),
  eartip_estimate: optStr(50),
  cats_are_friendly: optBool(),
  fixed_status: optStr(100),
  cat_name: optStr(200),
  cat_description: optStr(2000),
  handleability: optStr(100),
  wellness_cat_count: optInt(),

  // Kittens
  has_kittens: optBool(),
  kitten_count: optInt(99),
  kitten_age_estimate: optStr(100),
  kitten_age_weeks: optInt(52),
  kitten_mixed_ages_description: optStr(),
  kitten_behavior: optStr(200),
  kitten_notes: optStr(2000),
  mom_present: optStr(100),
  kitten_contained: optStr(100),
  mom_fixed: optStr(100),
  can_bring_in: optStr(100),

  // Feeding
  is_being_fed: optBool(),
  feeder_name: optStr(200),
  feeding_frequency: optStr(200),
  feeding_location: optStr(),
  feeding_time: optStr(200),
  best_times_seen: optStr(),

  // Medical
  has_medical_concerns: optBool(),
  medical_description: optStr(2000),

  // Property & Access
  is_property_owner: optBool(),
  has_property_access: optBool(),
  access_notes: optStr(2000),
  permission_status: optStr(50),
  traps_overnight_safe: optBool(),
  access_without_contact: optBool(),
  property_owner_name: optStr(200),
  property_owner_phone: optStr(30),
  authorization_pending: optBool(),
  best_contact_times: optStr(),
  dogs_on_site: optStr(100),
  trap_savvy: optStr(100),
  previous_tnr: optStr(100),

  // Third Party
  is_third_party_report: optBool(),
  third_party_relationship: optStr(200),

  // Raw site contact fallbacks (FFS-443)
  raw_site_contact_name: optStr(200),
  raw_site_contact_phone: optStr(30),
  raw_site_contact_email: optStr(200),

  // Property owner person link (FFS-443b)
  property_owner_person_id: optStr(50),
  raw_property_owner_email: optStr(200),

  // Location Meta
  county: optStr(100),
  is_emergency: optBool(),

  // Urgency (MIG_2817)
  urgency_reasons: z.array(z.string().max(200)).optional().nullable(),
  urgency_deadline: optStr(100),
  urgency_notes: optStr(2000),

  // Triage
  triage_category: optStr(100),
  received_by: optStr(200),

  // Notes
  summary: optStr(),
  notes: optStr(10000),
  internal_notes: optStr(10000),
  important_notes: z.array(z.string().max(200)).optional().nullable(),

  // Trapping logistics (FFS-151)
  best_trapping_time: optStr(200),
  ownership_status: optStr(100),

  // Entry Metadata (MIG_2817)
  entry_mode: optStr(50),
  completion_data: z.record(z.string(), z.unknown()).optional().nullable(),

  // Language
  preferred_language: optStr(10),

  // Related people
  related_people: z.array(z.object({
    person_id: z.string().uuid().optional().nullable(),
    raw_name: optStr(200),
    raw_phone: optStr(30),
    raw_email: optStr(200),
    relationship_type: z.string().max(50).default("other"),
    relationship_notes: optStr(500),
    notify_before_release: z.boolean().optional(),
    preferred_language: optStr(10),
  })).optional().nullable(),

  // Provenance
  created_by: optStr(200),
}).passthrough(); // Allow additional fields not yet in contract

// =============================================================================
// TypeScript Types — compile-time checking
// =============================================================================

export type CreateRequestBody = z.infer<typeof createRequestSchema>;
