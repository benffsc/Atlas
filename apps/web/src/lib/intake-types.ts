/**
 * Shared types and constants for the intake queue system.
 * Extracted from queue/page.tsx for reuse across intake components.
 */

export interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  first_name?: string;
  last_name?: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  cats_zip: string | null;
  ownership_status: string;
  cat_count_estimate: number | null;
  fixed_status: string;
  has_kittens: boolean | null;
  kitten_count: number | null;
  has_property_access: boolean | null;
  has_medical_concerns: boolean | null;
  is_emergency: boolean;
  situation_description: string | null;
  triage_category: string | null;
  triage_score: number | null;
  triage_reasons: string[] | null;
  // Unified status (primary)
  submission_status: string | null;
  appointment_date: string | null;
  priority_override: string | null;
  // Native status (kept for transition)
  native_status: string;
  final_category: string | null;
  created_request_id: string | null;
  age: string;
  overdue: boolean;
  is_third_party_report: boolean | null;
  third_party_relationship: string | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  property_owner_email: string | null;
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  legacy_notes: string | null;
  legacy_source_id: string | null;
  review_notes: string | null;
  matched_person_id: string | null;
  place_id: string | null;
  intake_source: string | null;
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_confidence: string | null;
  last_contacted_at: string | null;
  contact_attempt_count: number | null;
  is_test: boolean;
  // MIG_2531/2532: Additional intake fields for request conversion
  county: string | null;
  peak_count: number | null;
  awareness_duration: string | null;
  medical_description: string | null;
  feeding_location: string | null;
  feeding_time: string | null;
  dogs_on_site: boolean | null;
  preferred_appointment_time: string | null;
  trap_savvy: boolean | null;
  cats_captured_before: boolean | null;
  how_long_feeding: string | null;
  previous_tnr: boolean | null;
  kitten_age_estimate: string | null;
  kitten_behavior: string | null;
}

export interface CommunicationLog {
  log_id: string;
  submission_id: string;
  contact_method: string;
  contact_result: string;
  notes: string | null;
  contacted_at: string;
  contacted_by: string | null;
  entry_kind?: string;
  created_by_staff_name?: string | null;
  created_by_staff_role?: string | null;
}

export interface StaffMember {
  staff_id: string;
  display_name: string;
  role: string;
}

// Contact method options
export const CONTACT_METHODS = [
  { value: "phone", label: "Phone Call" },
  { value: "email", label: "Email" },
  { value: "text", label: "Text Message" },
  { value: "voicemail", label: "Voicemail" },
  { value: "in_person", label: "In Person" },
];

// Contact result options
export const CONTACT_RESULTS = [
  { value: "answered", label: "Answered / Spoke" },
  { value: "no_answer", label: "No Answer" },
  { value: "left_voicemail", label: "Left Voicemail" },
  { value: "sent", label: "Sent (email/text)" },
  { value: "scheduled", label: "Scheduled Appointment" },
  { value: "other", label: "Other" },
];

// Contact status options (for tracking outreach)
export const CONTACT_STATUSES = [
  { value: "", label: "(none)" },
  { value: "Contacted", label: "Contacted" },
  { value: "Contacted multiple times", label: "Contacted multiple times" },
  { value: "Call/Email/No response", label: "No response" },
  { value: "An appointment has been booked", label: "Appointment booked" },
  { value: "Out of County - no appts avail", label: "Out of County" },
  { value: "Sent to Diane/Out of County", label: "Sent to Diane" },
];

// Submission status options (legacy workflow state)
export const SUBMISSION_STATUSES = [
  { value: "", label: "(none)" },
  { value: "Pending Review", label: "Pending Review" },
  { value: "Booked", label: "Booked" },
  { value: "Declined", label: "Declined" },
  { value: "Complete", label: "Complete" },
];

// Unified submission status options (new workflow)
export const UNIFIED_STATUSES = [
  { value: "new", label: "New", description: "Just submitted, needs attention" },
  { value: "in_progress", label: "In Progress", description: "Being worked on" },
  { value: "scheduled", label: "Scheduled", description: "Appointment booked" },
  { value: "complete", label: "Complete", description: "Done" },
  { value: "archived", label: "Archived", description: "Hidden from queue" },
];

// Priority override options
export const PRIORITY_OPTIONS = [
  { value: "", label: "Auto", description: "Use triage score" },
  { value: "high", label: "High", description: "Prioritize this request" },
  { value: "normal", label: "Normal", description: "Standard priority" },
  { value: "low", label: "Low", description: "Lower priority" },
];

// Reasons for removing urgent/emergency flag
export const URGENT_DOWNGRADE_REASONS = [
  {
    value: "not_tnr_related",
    label: "Not TNR-related",
    description: "Request is for services outside our spay/neuter mission (parasite treatment, vaccines, general vet care)",
  },
  {
    value: "needs_emergency_vet",
    label: "Needs emergency vet",
    description: "True emergency (injury, illness, poisoning) - referred to pet hospital",
  },
  {
    value: "stable_situation",
    label: "Situation is stable",
    description: "Cats are being fed, no immediate danger - can be scheduled normally",
  },
  {
    value: "routine_spay_neuter",
    label: "Routine spay/neuter",
    description: "Owned pet or single cat needing standard scheduling, not urgent",
  },
  {
    value: "already_altered",
    label: "Cat(s) already altered",
    description: "Cat is already fixed - no TNR needed, may need other services",
  },
  {
    value: "duplicate_request",
    label: "Duplicate request",
    description: "Same cats/location already being handled in another submission",
  },
  {
    value: "misunderstood_form",
    label: "Form misunderstanding",
    description: "Requester misunderstood what 'urgent' means - normal priority is fine",
  },
];

export type TabType = "active" | "scheduled" | "completed" | "all";
