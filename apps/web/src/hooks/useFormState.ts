/**
 * useFormState — Config-aware state management for request forms (FFS-496).
 *
 * Creates section state + change handlers based on a FormConfig. Each configured
 * section gets its own state slice initialized to EMPTY_* defaults. The hook also
 * provides a toRequestBody() method that assembles all section values into a
 * CreateRequestBody for submission.
 *
 * Usage:
 *   const { sections, toRequestBody, reset } = useFormState(FFR_NEW_CONFIG);
 *   <RequestForm config={FFR_NEW_CONFIG} sections={sections} />
 *   const body = toRequestBody(); // submit
 */

import { useState, useCallback, useMemo } from "react";
import type { FormConfig, SectionComponent } from "@/lib/form-configs";
import type {
  PersonSectionValue,
  PlaceSectionValue,
  CatDetailsSectionValue,
  KittenAssessmentValue,
  PropertyAccessValue,
  UrgencyNotesValue,
} from "@/components/request-sections";
import {
  EMPTY_PLACE_VALUE,
  EMPTY_CAT_DETAILS,
  EMPTY_KITTEN_ASSESSMENT,
  EMPTY_PROPERTY_ACCESS,
  EMPTY_URGENCY_NOTES,
} from "@/components/request-sections";
import type { CreateRequestBody } from "@/lib/types/request-contracts";

// ── Empty person value ──────────────────────────────────────────────

const EMPTY_PERSON: PersonSectionValue = {
  person_id: null,
  display_name: "",
  is_resolved: false,
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
};

// ── Section state map type ──────────────────────────────────────────

export interface SectionStates {
  person: PersonSectionValue;
  place: PlaceSectionValue;
  catDetails: CatDetailsSectionValue;
  kittens: KittenAssessmentValue;
  propertyAccess: PropertyAccessValue;
  urgencyNotes: UrgencyNotesValue;
}

type SectionStateKey = keyof SectionStates;

const EMPTY_STATES: SectionStates = {
  person: EMPTY_PERSON,
  place: EMPTY_PLACE_VALUE,
  catDetails: EMPTY_CAT_DETAILS,
  kittens: EMPTY_KITTEN_ASSESSMENT,
  propertyAccess: EMPTY_PROPERTY_ACCESS,
  urgencyNotes: EMPTY_URGENCY_NOTES,
};

// ── Section state entry (for rendering) ─────────────────────────────

export interface SectionEntry<K extends SectionStateKey = SectionStateKey> {
  component: K;
  label?: string;
  props?: Record<string, unknown>;
  value: SectionStates[K];
  onChange: (v: SectionStates[K]) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────

export interface FormStateResult {
  /** Array of section entries matching config order, ready for rendering */
  sections: SectionEntry[];
  /** Direct access to any section's state */
  get: <K extends SectionStateKey>(key: K) => SectionStates[K];
  /** Direct setter for any section's state */
  set: <K extends SectionStateKey>(key: K, value: SectionStates[K]) => void;
  /** Assemble all section values into a CreateRequestBody */
  toRequestBody: () => Partial<CreateRequestBody>;
  /** Reset all state to empty defaults */
  reset: () => void;
}

export function useFormState(config: FormConfig): FormStateResult {
  // Single state object holding all section values
  const [state, setState] = useState<SectionStates>(() => ({ ...EMPTY_STATES }));

  const get = useCallback(
    <K extends SectionStateKey>(key: K): SectionStates[K] => state[key],
    [state]
  );

  const set = useCallback(
    <K extends SectionStateKey>(key: K, value: SectionStates[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const reset = useCallback(() => {
    setState({ ...EMPTY_STATES });
  }, []);

  // Build section entries from config
  const sections: SectionEntry[] = useMemo(() => {
    return config.sections.map((sec) => {
      const key = sec.component as SectionStateKey;
      return {
        component: key,
        label: sec.label,
        props: sec.props,
        value: state[key],
        onChange: (v: SectionStates[typeof key]) => set(key, v),
      } as SectionEntry;
    });
  }, [config.sections, state, set]);

  // Assemble all section state into CreateRequestBody
  const toRequestBody = useCallback((): Partial<CreateRequestBody> => {
    const body: Partial<CreateRequestBody> = {};

    // Which sections are in the config?
    const active = new Set(config.sections.map((s) => s.component));

    // Person
    if (active.has("person")) {
      const p = state.person;
      if (p.is_resolved && p.person_id) {
        body.requester_person_id = p.person_id;
      } else if (p.first_name || p.last_name) {
        body.raw_requester_name = `${p.first_name} ${p.last_name}`.trim() || null;
      }
      if (p.phone) body.raw_requester_phone = p.phone;
      if (p.email) body.raw_requester_email = p.email;
    }

    // Place
    if (active.has("place")) {
      const pl = state.place;
      body.place_id = pl.place?.place_id || null;
      if (pl.propertyType) body.property_type = pl.propertyType;
      if (pl.county) body.county = pl.county;
      if (pl.whereOnProperty) body.location_description = pl.whereOnProperty;
    }

    // Cat details
    if (active.has("catDetails")) {
      const c = state.catDetails;
      if (c.estimatedCatCount !== "") body.estimated_cat_count = c.estimatedCatCount as number;
      if (c.totalCatsReported !== "") body.total_cats_reported = c.totalCatsReported as number;
      if (c.peakCount !== "") body.peak_count = c.peakCount as number;
      if (c.wellnessCatCount !== "") body.wellness_cat_count = c.wellnessCatCount as number;
      body.count_confidence = c.countConfidence;
      body.colony_duration = c.colonyDuration;
      body.awareness_duration = c.awarenessDuration;
      body.cats_are_friendly = c.catsAreFriendly;
      if (c.catName) body.cat_name = c.catName;
      if (c.catDescription) body.cat_description = c.catDescription;

      // Request purpose
      const purposes = c.requestPurposes;
      if (purposes.length > 0) {
        body.request_purposes = purposes;
        body.request_purpose = purposes.includes("tnr")
          ? "tnr"
          : purposes.includes("relocation")
            ? "relocation"
            : purposes.includes("rescue")
              ? "rescue"
              : "wellness";
      }

      // Eartip handling
      const showExact = typeof c.estimatedCatCount === "number" && c.estimatedCatCount <= 5;
      if (showExact && c.eartipCount !== "") {
        body.eartip_count = c.eartipCount as number;
      } else if (!showExact && c.eartipEstimate) {
        body.eartip_estimate = c.eartipEstimate;
      }
    }

    // Kittens
    if (active.has("kittens")) {
      const k = state.kittens;
      body.has_kittens = k.hasKittens;
      if (k.hasKittens) {
        if (k.kittenCount !== "") body.kitten_count = k.kittenCount as number;
        if (k.kittenAgeWeeks !== "") body.kitten_age_weeks = k.kittenAgeWeeks as number;
        if (k.kittenAgeEstimate) body.kitten_age_estimate = k.kittenAgeEstimate;
        if (k.kittenMixedAgesDescription) body.kitten_mixed_ages_description = k.kittenMixedAgesDescription;
        if (k.kittenBehavior) body.kitten_behavior = k.kittenBehavior;
        if (k.kittenContained) body.kitten_contained = k.kittenContained;
        if (k.momPresent) body.mom_present = k.momPresent;
        if (k.momFixed) body.mom_fixed = k.momFixed;
        if (k.canBringIn) body.can_bring_in = k.canBringIn;
        if (k.kittenNotes) body.kitten_notes = k.kittenNotes;
      }
    }

    // Property access
    if (active.has("propertyAccess")) {
      const a = state.propertyAccess;
      body.permission_status = a.permissionStatus;
      body.has_property_access = a.hasPropertyAccess;
      body.traps_overnight_safe = a.trapsOvernightSafe;
      body.access_without_contact = a.accessWithoutContact;
      if (a.accessNotes) body.access_notes = a.accessNotes;
    }

    // Urgency & notes
    if (active.has("urgencyNotes")) {
      const u = state.urgencyNotes;
      body.priority = u.priority;
      if (u.urgencyReasons.length > 0) body.urgency_reasons = u.urgencyReasons;
      if (u.urgencyDeadline) body.urgency_deadline = u.urgencyDeadline;
      if (u.urgencyNotes) body.urgency_notes = u.urgencyNotes;
      if (u.summary) body.summary = u.summary;
      if (u.notes) body.notes = u.notes;
      if (u.internalNotes) body.internal_notes = u.internalNotes;
    }

    return body;
  }, [config.sections, state]);

  return { sections, get, set, toRequestBody, reset };
}
