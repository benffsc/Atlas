/**
 * Maps ops.requests API response data to FormData field keys.
 *
 * Wired into admin form preview (/admin/forms/preview/[key]?request_id=UUID)
 * to pre-fill TemplateRenderer from an existing request. The mapping handles
 * column name differences between the request table and the form field registry.
 *
 * Pipeline: /api/requests/:id → requestToFormData() → TemplateRenderer data prop
 */

import type { FormData, FieldKey } from "./form-field-types";

/**
 * Shape of the request API response (subset of RequestDetailRow
 * that we actually map to form fields).
 */
interface RequestLike {
  // Contact
  requester_name?: string | null;
  requester_phone?: string | null;
  requester_email?: string | null;
  preferred_contact_method?: string | null;
  best_contact_times?: string | null;
  is_third_party_report?: boolean | null;
  third_party_relationship?: string | null;
  property_owner_name?: string | null;
  property_owner_contact?: string | null;

  // Location
  place_address?: string | null;
  place_city?: string | null;
  place_postal_code?: string | null;
  county?: string | null;
  property_type?: string | null;
  ownership_status?: string | null;
  location_description?: string | null;
  access_notes?: string | null;
  is_property_owner?: boolean | null;
  permission_status?: string | null;

  // Cat info
  estimated_cat_count?: number | null;
  total_cats_reported?: number | null;
  eartip_count?: number | null;
  count_confidence?: string | null;
  cats_are_friendly?: boolean | null;
  handleability?: string | null;
  fixed_status?: string | null;
  colony_duration?: string | null;
  is_being_fed?: boolean | null;
  feeding_frequency?: string | null;
  feeder_name?: string | null;

  // Logistics
  dogs_on_site?: string | null;
  trap_savvy?: string | null;
  previous_tnr?: string | null;
  traps_overnight_safe?: boolean | null;
  feeding_time?: string | null;
  feeding_location?: string | null;
  best_times_seen?: string | null;
  important_notes?: string[] | null;

  // Kitten
  has_kittens?: boolean | null;
  kitten_count?: number | null;
  kitten_age_weeks?: number | null;
  kitten_age_estimate?: string | null;
  kitten_behavior?: string | null;
  kitten_contained?: string | null;
  mom_present?: string | null;
  mom_fixed?: string | null;
  can_bring_in?: string | null;
  kitten_notes?: string | null;

  // Medical
  has_medical_concerns?: boolean | null;
  medical_description?: string | null;
  is_emergency?: boolean | null;
  urgency_reasons?: string[] | null;
  urgency_notes?: string | null;

  // Staff
  created_at?: string | null;
  created_by?: string | null;
  data_source?: string | null;
  priority?: string | null;
  notes?: string | null;
  scheduled_date?: string | null;

  // Allow extra fields
  [key: string]: unknown;
}

/**
 * Convert a request API response into FormData keyed by FieldKey.
 *
 * Handles:
 * - Direct 1:1 mappings (e.g. request.county → form.county)
 * - Name splits (requester_name → first_name + last_name)
 * - Boolean coercion (traps_overnight_safe → true/false)
 * - Kitten age weeks → age estimate bucket
 */
export function requestToFormData(req: RequestLike): FormData {
  const data: Partial<Record<FieldKey, unknown>> = {};

  // ── Contact ──
  if (req.requester_name) {
    const parts = req.requester_name.split(" ");
    data.first_name = parts[0];
    data.last_name = parts.slice(1).join(" ") || null;
  }
  set(data, "phone", req.requester_phone);
  set(data, "email", req.requester_email);
  set(data, "preferred_contact_method", req.preferred_contact_method);
  set(data, "best_contact_times", req.best_contact_times);
  set(data, "is_third_party_report", req.is_third_party_report);
  set(data, "third_party_relationship", req.third_party_relationship);
  set(data, "property_owner_name", req.property_owner_name);
  set(data, "property_owner_contact", req.property_owner_contact);

  // ── Location ──
  set(data, "address", req.place_address);
  set(data, "city", req.place_city);
  set(data, "zip", req.place_postal_code);
  set(data, "county", req.county);
  set(data, "property_type", req.property_type);
  set(data, "ownership_status", req.ownership_status);
  set(data, "location_description", req.location_description);
  set(data, "access_notes", req.access_notes);
  set(data, "is_property_owner", req.is_property_owner);
  set(data, "has_property_access", req.permission_status);

  // ── Cat Info ──
  set(data, "cat_count", req.estimated_cat_count);
  set(data, "peak_count", req.total_cats_reported);
  set(data, "eartip_count", req.eartip_count);
  set(data, "count_confidence", req.count_confidence);
  set(data, "cats_friendly", req.cats_are_friendly);
  set(data, "handleability", req.handleability);
  set(data, "fixed_status", req.fixed_status);
  set(data, "colony_duration", req.colony_duration);
  set(data, "is_being_fed", req.is_being_fed);
  set(data, "feeding_frequency", req.feeding_frequency);
  set(data, "feeder_name", req.feeder_name);

  // ── Logistics ──
  set(data, "dogs_on_site", req.dogs_on_site);
  set(data, "trap_savvy", req.trap_savvy);
  set(data, "previous_tnr", req.previous_tnr);
  set(data, "traps_overnight_safe", req.traps_overnight_safe);
  set(data, "permission_status", req.permission_status);
  set(data, "feeding_time", req.feeding_time);
  set(data, "feeding_location", req.feeding_location);
  set(data, "best_trapping_time", req.best_times_seen);
  set(data, "important_notes", req.important_notes);

  // ── Kitten ──
  set(data, "has_kittens", req.has_kittens);
  set(data, "kitten_count", req.kitten_count);
  if (req.kitten_age_estimate) {
    set(data, "kitten_age_estimate", req.kitten_age_estimate);
  } else if (req.kitten_age_weeks) {
    set(data, "kitten_age_estimate", weeksToAgeBucket(req.kitten_age_weeks));
  }
  set(data, "kitten_behavior", req.kitten_behavior);
  set(data, "kitten_contained", req.kitten_contained);
  set(data, "mom_present", req.mom_present);
  set(data, "mom_fixed", req.mom_fixed);
  set(data, "can_bring_in", req.can_bring_in);
  set(data, "kitten_notes", req.kitten_notes);

  // ── Medical ──
  set(data, "has_medical_concerns", req.has_medical_concerns);
  set(data, "medical_description", req.medical_description);
  set(data, "is_emergency", req.is_emergency);
  set(data, "urgency_reasons", req.urgency_reasons);
  set(data, "urgency_notes", req.urgency_notes);

  // ── Staff ──
  set(data, "date_received", req.created_at);
  set(data, "received_by", req.created_by);
  set(data, "intake_source", req.data_source);
  set(data, "priority", req.priority);
  set(data, "staff_notes", req.notes);
  set(data, "scheduled_date", req.scheduled_date);

  return data;
}

/** Set a form data key only if the value is non-null/undefined. */
function set(
  data: Partial<Record<FieldKey, unknown>>,
  key: FieldKey,
  value: unknown
) {
  if (value !== null && value !== undefined) {
    data[key] = value;
  }
}

/** Convert kitten age in weeks to the age estimate bucket. */
function weeksToAgeBucket(weeks: number): string {
  if (weeks < 4) return "Under 4 wks";
  if (weeks < 8) return "4-8 wks";
  if (weeks < 12) return "8-12 wks";
  if (weeks < 16) return "12-16 wks";
  return "4+ months";
}
