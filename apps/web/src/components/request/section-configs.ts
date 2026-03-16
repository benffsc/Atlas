import type { RequestSectionConfig } from "./types";
import {
  COUNTY_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  HANDLEABILITY_OPTIONS,
  COLONY_DURATION_OPTIONS,
  FEEDING_FREQUENCY_OPTIONS,
  AWARENESS_DURATION_OPTIONS,
  CATS_FRIENDLY_OPTIONS,
  DOGS_ON_SITE_OPTIONS,
  TRAP_SAVVY_OPTIONS,
  PREVIOUS_TNR_OPTIONS,
  PERMISSION_STATUS_OPTIONS,
  KITTEN_AGE_OPTIONS,
  KITTEN_BEHAVIOR_OPTIONS,
  KITTEN_CONTAINED_OPTIONS,
  MOM_PRESENT_OPTIONS,
  MOM_FIXED_OPTIONS,
  CAN_BRING_IN_OPTIONS,
  URGENCY_REASON_OPTIONS,
  TRIAGE_CATEGORY_OPTIONS,
  COUNT_CONFIDENCE_OPTIONS,
} from "@/lib/form-options";

/**
 * 9 sections aligned with the intake call sheet order.
 *
 * Each section defines the fields it manages, their types, options, and help text.
 * The `key` on each field maps directly to the `RequestDetail` interface property
 * and the DB column on `ops.requests`.
 */
export const REQUEST_SECTIONS: RequestSectionConfig[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Status & Triage
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "status-triage",
    title: "Status & Triage",
    icon: "📋",
    color: "#3b82f6",
    guidanceText: "Status, priority, and triage category control how this request is routed and prioritized.",
    fields: [
      {
        key: "priority",
        label: "Priority",
        type: "select",
        options: [
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "normal", label: "Normal" },
          { value: "low", label: "Low" },
        ],
      },
      {
        key: "triage_category",
        label: "Triage Category",
        type: "select",
        options: TRIAGE_CATEGORY_OPTIONS,
        helpText: "Staff categorization for routing",
      },
      {
        key: "summary",
        label: "Title",
        type: "text",
        fullWidth: true,
        helpText: "Brief description of the request",
      },
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
        fullWidth: true,
        helpText: "Additional details about the situation",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Colony Assessment
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "colony-assessment",
    title: "Colony Assessment",
    icon: "🐱",
    color: "#f59e0b",
    guidanceText: "These counts feed the Chapman mark-recapture population estimate. Peak count is the most important field for Beacon projections.",
    fields: [
      {
        key: "estimated_cat_count",
        label: "Adult Cats Needing TNR",
        type: "number",
        helpText: "Number of unfixed adult cats at this location",
      },
      {
        key: "peak_count",
        label: "Peak Count Observed",
        type: "number",
        helpText: "Most cats seen at one time — critical for population estimation",
      },
      {
        key: "eartip_count",
        label: "Eartipped Count",
        type: "number",
        helpText: "Number of cats with ear tips (already fixed)",
      },
      {
        key: "count_confidence",
        label: "Count Confidence",
        type: "select",
        options: COUNT_CONFIDENCE_OPTIONS,
      },
      {
        key: "cats_are_friendly",
        label: "Cats Are Friendly",
        type: "select",
        options: CATS_FRIENDLY_OPTIONS,
      },
      {
        key: "handleability",
        label: "Handleability",
        type: "select",
        options: HANDLEABILITY_OPTIONS,
        helpText: "How approachable are the cats?",
      },
      {
        key: "colony_duration",
        label: "Colony Duration",
        type: "select",
        options: COLONY_DURATION_OPTIONS,
        helpText: "How long cats have been at this location",
      },
      {
        key: "awareness_duration",
        label: "Awareness Duration",
        type: "select",
        options: AWARENESS_DURATION_OPTIONS,
        helpText: "How long the requester has known about these cats",
      },
      {
        key: "county",
        label: "County",
        type: "select",
        options: COUNTY_OPTIONS,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Kitten Details
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "kitten-details",
    title: "Kitten Details",
    icon: "🐾",
    color: "#ec4899",
    fields: [
      {
        key: "has_kittens",
        label: "Has Kittens",
        type: "boolean",
      },
      {
        key: "kitten_count",
        label: "Kitten Count",
        type: "number",
        conditional: { field: "has_kittens", value: true },
      },
      {
        key: "kitten_age_estimate",
        label: "Kitten Age Estimate",
        type: "select",
        options: KITTEN_AGE_OPTIONS,
        conditional: { field: "has_kittens", value: true },
      },
      {
        key: "kitten_behavior",
        label: "Kitten Behavior",
        type: "select",
        options: KITTEN_BEHAVIOR_OPTIONS,
        conditional: { field: "has_kittens", value: true },
      },
      {
        key: "mom_present",
        label: "Mom Present",
        type: "select",
        options: MOM_PRESENT_OPTIONS,
        conditional: { field: "has_kittens", value: true },
      },
      {
        key: "mom_fixed",
        label: "Mom Fixed",
        type: "select",
        options: MOM_FIXED_OPTIONS,
        conditional: { field: "has_kittens", value: true },
      },
      {
        key: "can_bring_in",
        label: "Can Bring In",
        type: "select",
        options: CAN_BRING_IN_OPTIONS,
        conditional: { field: "has_kittens", value: true },
        helpText: "Can the requester bring kittens to the clinic?",
      },
      {
        key: "kitten_contained",
        label: "Kittens Contained",
        type: "select",
        options: KITTEN_CONTAINED_OPTIONS,
        conditional: { field: "has_kittens", value: true },
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Medical & Urgency
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "medical-urgency",
    title: "Medical & Urgency",
    icon: "🏥",
    color: "#ef4444",
    fields: [
      {
        key: "is_emergency",
        label: "Emergency Situation",
        type: "boolean",
      },
      {
        key: "has_medical_concerns",
        label: "Medical Concerns",
        type: "boolean",
      },
      {
        key: "medical_description",
        label: "Medical Description",
        type: "textarea",
        conditional: { field: "has_medical_concerns", value: true },
        fullWidth: true,
      },
      {
        key: "urgency_reasons",
        label: "Urgency Reasons",
        type: "checkbox-group",
        options: URGENCY_REASON_OPTIONS,
        fullWidth: true,
      },
      {
        key: "urgency_notes",
        label: "Urgency Notes",
        type: "textarea",
        fullWidth: true,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Property & Access
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "property-access",
    title: "Property & Access",
    icon: "🏠",
    color: "#8b5cf6",
    fields: [
      {
        key: "permission_status",
        label: "Permission Status",
        type: "select",
        options: PERMISSION_STATUS_OPTIONS,
      },
      {
        key: "property_type",
        label: "Property Type",
        type: "select",
        options: PROPERTY_TYPE_OPTIONS,
      },
      {
        key: "is_property_owner",
        label: "Is Property Owner",
        type: "boolean",
      },
      {
        key: "property_owner_name",
        label: "Property Owner Name",
        type: "text",
        conditional: { field: "is_property_owner", value: false },
      },
      {
        key: "property_owner_phone",
        label: "Property Owner Phone",
        type: "text",
        conditional: { field: "is_property_owner", value: false },
      },
      {
        key: "access_notes",
        label: "Access Notes",
        type: "textarea",
        fullWidth: true,
        helpText: "Gate codes, parking, hazards, special instructions",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Trapping Logistics
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "trapping-logistics",
    title: "Trapping Logistics",
    icon: "🪤",
    color: "#166534",
    fields: [
      {
        key: "dogs_on_site",
        label: "Dogs on Site",
        type: "select",
        options: DOGS_ON_SITE_OPTIONS,
      },
      {
        key: "trap_savvy",
        label: "Trap-Savvy Cats",
        type: "select",
        options: TRAP_SAVVY_OPTIONS,
        helpText: "Have cats learned to avoid traps?",
      },
      {
        key: "previous_tnr",
        label: "Previous TNR",
        type: "select",
        options: PREVIOUS_TNR_OPTIONS,
      },
      {
        key: "traps_overnight_safe",
        label: "Traps Safe Overnight",
        type: "boolean",
      },
      {
        key: "best_times_seen",
        label: "Best Times Seen",
        type: "text",
        helpText: "When cats are most visible (e.g., early morning, dusk)",
      },
      {
        key: "best_trapping_time",
        label: "Best Trapping Time",
        type: "text",
        helpText: "Preferred trapping schedule (e.g., weekday mornings)",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Feeding Information
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "feeding-info",
    title: "Feeding Information",
    icon: "🍽️",
    color: "#6366f1",
    fields: [
      {
        key: "is_being_fed",
        label: "Being Fed",
        type: "boolean",
      },
      {
        key: "feeder_name",
        label: "Feeder Name",
        type: "text",
        conditional: { field: "is_being_fed", value: true },
      },
      {
        key: "feeding_frequency",
        label: "Feeding Frequency",
        type: "select",
        options: FEEDING_FREQUENCY_OPTIONS,
        conditional: { field: "is_being_fed", value: true },
      },
      {
        key: "feeding_time",
        label: "Feeding Time",
        type: "text",
        conditional: { field: "is_being_fed", value: true },
      },
      {
        key: "feeding_location",
        label: "Feeding Location",
        type: "text",
        conditional: { field: "is_being_fed", value: true },
        helpText: "Where cats are fed (e.g., back porch, garage)",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Third-Party Report
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "third-party",
    title: "Third-Party Report",
    icon: "👥",
    color: "#0891b2",
    fields: [
      {
        key: "is_third_party_report",
        label: "Is Third-Party Report",
        type: "boolean",
        helpText: "Is this reported by someone other than the site contact?",
      },
      {
        key: "third_party_relationship",
        label: "Reporter Relationship",
        type: "text",
        conditional: { field: "is_third_party_report", value: true },
        helpText: "e.g., neighbor, friend, concerned citizen",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Resolution (only when completed)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "resolution",
    title: "Resolution",
    icon: "✅",
    color: "#059669",
    statusVisibility: ["completed", "cancelled", "partial"],
    fields: [
      {
        key: "resolution_outcome",
        label: "Outcome",
        type: "select",
        options: [
          { value: "successful", label: "Successful" },
          { value: "partial", label: "Partial" },
          { value: "unable_to_complete", label: "Unable to Complete" },
          { value: "no_longer_needed", label: "No Longer Needed" },
          { value: "referred_out", label: "Referred Out" },
        ],
      },
      {
        key: "resolution_reason",
        label: "Reason",
        type: "text",
      },
      {
        key: "resolution_notes",
        label: "Resolution Notes",
        type: "textarea",
        fullWidth: true,
      },
    ],
  },
];

/**
 * Look up a section config by ID.
 */
export function getSectionConfig(sectionId: string): RequestSectionConfig | undefined {
  return REQUEST_SECTIONS.find((s) => s.id === sectionId);
}
