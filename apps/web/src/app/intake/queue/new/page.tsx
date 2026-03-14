"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlaceResolver } from "@/components/forms";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { BackButton } from "@/components/common";
import { postApi } from "@/lib/api-client";
import {
  PersonSection,
  KittenAssessmentSection,
} from "@/components/request-sections";
import type {
  PersonSectionValue,
  KittenAssessmentValue,
} from "@/components/request-sections";
import {
  OWNERSHIP_OPTIONS,
  FIXED_STATUS_OPTIONS,
  URGENT_SITUATION_EXAMPLES,
  COUNT_CONFIDENCE_OPTIONS,
  COLONY_DURATION_OPTIONS,
} from "@/lib/intake-options";
import { KITTEN_URGENCY_OPTIONS } from "@/lib/form-options";

// Maps to paper form fields exactly
interface IntakeFormData {
  // Source tracking
  source: "phone" | "paper" | "in_person";

  // Third-party report
  is_third_party_report: boolean;
  third_party_relationship: string;
  property_owner_name: string;
  property_owner_phone: string;

  // Section 1: Contact Info
  first_name: string;
  last_name: string;
  phone: string;
  email: string;

  // Section 2: Cat Location
  cats_address: string;
  cats_city: string;
  cats_zip: string;
  county: string;

  // Section 3: About the Cats
  ownership_status: string;
  cat_count_estimate: number | "";
  count_confidence: string;  // MIG_534: Is count exact or estimate?
  colony_duration: string;   // How long have cats been at location?
  fixed_status: string;
  has_kittens: boolean;
  kitten_count: number | "";
  is_emergency: boolean;

  // Feeding behavior (MIG_236)
  feeds_cat: boolean | null;
  feeding_frequency: string;
  feeding_duration: string;
  cat_comes_inside: string;

  // Section 4: Situation
  has_medical_concerns: boolean | null;
  others_feeding: boolean | null;
  has_property_access: boolean | null;
  is_property_owner: boolean | null;
  referral_source: string;

  // Section 5: Description
  situation_description: string;

  // Section 6: Kitten Details (if has_kittens)
  kitten_age_weeks: number | "";
  kitten_age_estimate: string;
  kitten_mixed_ages_description: string;
  kitten_behavior: string;
  kitten_contained: string;
  mom_present: string;
  mom_fixed: string;
  can_bring_in: string;
  kitten_notes: string;

  // Staff triage (Page 1)
  priority_override: string;
  final_category: string;
  reviewed_by: string;

  // Staff kitten assessment (Page 2)
  kitten_outcome: string;
  foster_readiness: string;
  kitten_urgency_factors: string[];
  review_notes: string;
}

const initialFormData: IntakeFormData = {
  source: "phone",
  is_third_party_report: false,
  third_party_relationship: "",
  property_owner_name: "",
  property_owner_phone: "",
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  cats_address: "",
  cats_city: "",
  cats_zip: "",
  county: "sonoma",
  ownership_status: "",
  cat_count_estimate: "",
  count_confidence: "",
  colony_duration: "",
  fixed_status: "",
  has_kittens: false,
  kitten_count: "",
  is_emergency: false,
  feeds_cat: null,
  feeding_frequency: "",
  feeding_duration: "",
  cat_comes_inside: "",
  has_medical_concerns: null,
  others_feeding: null,
  has_property_access: null,
  is_property_owner: null,
  referral_source: "",
  situation_description: "",
  kitten_age_weeks: "",
  kitten_age_estimate: "",
  kitten_mixed_ages_description: "",
  kitten_behavior: "",
  kitten_contained: "",
  mom_present: "",
  mom_fixed: "",
  can_bring_in: "",
  kitten_notes: "",
  priority_override: "normal",
  final_category: "",
  reviewed_by: "",
  kitten_outcome: "",
  foster_readiness: "",
  kitten_urgency_factors: [],
  review_notes: "",
};

// Kitten option overrides — match intake form values (different from KittenAssessmentSection defaults)
const INTAKE_KITTEN_AGE_OPTIONS = [
  { value: "under_4_weeks", label: "Under 4 wks" },
  { value: "4_to_8_weeks", label: "4-8 wks" },
  { value: "8_to_12_weeks", label: "8-12 wks" },
  { value: "12_to_16_weeks", label: "12-16 wks" },
  { value: "over_16_weeks", label: "4+ months" },
  { value: "mixed", label: "Mixed ages" },
] as const;

const INTAKE_KITTEN_BEHAVIOR_OPTIONS = [
  { value: "friendly", label: "Friendly (handleable)" },
  { value: "shy_handleable", label: "Shy but can pick up" },
  { value: "shy_young", label: "Shy/hissy (young)" },
  { value: "unhandleable_older", label: "Unhandleable (older)" },
  { value: "unknown", label: "Unknown" },
] as const;

export default function NewIntakeEntryPage() {
  const router = useRouter();
  const [form, setForm] = useState<IntakeFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Place selection state
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);

  const updateForm = (updates: Partial<IntakeFormData>) => {
    setForm(prev => ({ ...prev, ...updates }));
  };

  // --- Person section adapter ---
  const personValue: PersonSectionValue = {
    person_id: null,
    display_name: [form.first_name, form.last_name].filter(Boolean).join(" "),
    is_resolved: false,
    first_name: form.first_name,
    last_name: form.last_name,
    email: form.email,
    phone: form.phone,
  };

  const handlePersonChange = (newValue: PersonSectionValue) => {
    updateForm({
      first_name: newValue.first_name,
      last_name: newValue.last_name,
      email: newValue.email,
      phone: newValue.phone,
    });
  };

  // --- Kitten assessment adapter ---
  const kittenValue: KittenAssessmentValue = {
    hasKittens: form.has_kittens,
    kittenCount: form.kitten_count,
    kittenAgeWeeks: form.kitten_age_weeks,
    kittenAgeEstimate: form.kitten_age_estimate,
    kittenMixedAgesDescription: form.kitten_mixed_ages_description,
    kittenBehavior: form.kitten_behavior,
    kittenContained: form.kitten_contained,
    momPresent: form.mom_present,
    momFixed: form.mom_fixed,
    canBringIn: form.can_bring_in,
    kittenNotes: form.kitten_notes,
  };

  const handleKittenChange = (newValue: KittenAssessmentValue) => {
    updateForm({
      has_kittens: newValue.hasKittens,
      kitten_count: newValue.kittenCount,
      kitten_age_weeks: newValue.kittenAgeWeeks,
      kitten_age_estimate: newValue.kittenAgeEstimate,
      kitten_mixed_ages_description: newValue.kittenMixedAgesDescription,
      kitten_behavior: newValue.kittenBehavior,
      kitten_contained: newValue.kittenContained,
      mom_present: newValue.momPresent,
      mom_fixed: newValue.momFixed,
      can_bring_in: newValue.canBringIn,
      kitten_notes: newValue.kittenNotes,
    });
  };

  // Handle place resolved from PlaceResolver
  const handlePlaceResolved = (place: ResolvedPlace | null) => {
    setResolvedPlace(place);
    setSelectedPlaceId(place?.place_id || null);
    if (place) {
      updateForm({
        cats_address: place.formatted_address || place.display_name || "",
      });
    }
  };

  const toggleUrgencyFactor = (factor: string) => {
    setForm(prev => ({
      ...prev,
      kitten_urgency_factors: prev.kitten_urgency_factors.includes(factor)
        ? prev.kitten_urgency_factors.filter(f => f !== factor)
        : [...prev.kitten_urgency_factors, factor]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    // Validate required fields
    if (!form.first_name || !form.last_name || !form.email) {
      setError("First name, last name, and email are required");
      setSubmitting(false);
      return;
    }
    if (!form.cats_address) {
      setError("Cat location address is required");
      setSubmitting(false);
      return;
    }
    if (!form.ownership_status || !form.fixed_status) {
      setError("Ownership status and fixed status are required");
      setSubmitting(false);
      return;
    }

    try {
      const data = await postApi<{ submission_id: string }>("/api/intake", {
        source: form.source,
        is_third_party_report: form.is_third_party_report,
        third_party_relationship: form.third_party_relationship || null,
        property_owner_name: form.property_owner_name || null,
        property_owner_phone: form.property_owner_phone || null,
        property_owner_email: null,
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone || null,
        email: form.email,
        cats_address: form.cats_address,
        cats_city: form.cats_city || null,
        cats_zip: form.cats_zip || null,
        county: form.county || null,
        ownership_status: form.ownership_status,
        cat_count_estimate: form.cat_count_estimate || null,
        count_confidence: form.count_confidence || null,
        colony_duration: form.colony_duration || null,
        fixed_status: form.fixed_status,
        // Feeding behavior (MIG_236)
        feeds_cat: form.feeds_cat,
        feeding_frequency: form.feeding_frequency || null,
        feeding_duration: form.feeding_duration || null,
        cat_comes_inside: form.cat_comes_inside || null,
        has_kittens: form.has_kittens,
        kitten_count: form.has_kittens ? (form.kitten_count || null) : null,
        is_emergency: form.is_emergency,
        has_medical_concerns: form.has_medical_concerns,
        cats_being_fed: form.others_feeding,
        has_property_access: form.has_property_access,
        is_property_owner: form.is_property_owner,
        referral_source: form.referral_source || null,
        situation_description: form.situation_description || null,
        // Kitten details
        kitten_age_estimate: form.has_kittens ? (form.kitten_age_estimate || null) : null,
        kitten_mixed_ages_description: form.has_kittens && form.kitten_age_estimate === "mixed" ? (form.kitten_mixed_ages_description || null) : null,
        kitten_behavior: form.has_kittens ? (form.kitten_behavior || null) : null,
        kitten_contained: form.has_kittens ? (form.kitten_contained || null) : null,
        mom_present: form.has_kittens ? (form.mom_present || null) : null,
        mom_fixed: form.has_kittens && form.mom_present === "yes" ? (form.mom_fixed || null) : null,
        can_bring_in: form.has_kittens ? (form.can_bring_in || null) : null,
        kitten_notes: form.has_kittens ? (form.kitten_notes || null) : null,
        // Staff fields
        priority_override: form.priority_override || null,
        kitten_outcome: form.has_kittens ? (form.kitten_outcome || null) : null,
        foster_readiness: form.has_kittens ? (form.foster_readiness || null) : null,
        kitten_urgency_factors: form.has_kittens && form.kitten_urgency_factors.length > 0 ? form.kitten_urgency_factors : null,
        reviewed_by: form.reviewed_by || null,
      });

      router.push(`/intake/queue/${data.submission_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <BackButton fallbackHref="/intake/queue" />
        <h1 style={{ margin: "0.5rem 0 0 0" }}>New Intake Entry</h1>
        <p className="text-muted">Enter data from phone call, paper form, or walk-in</p>
      </div>

      {error && (
        <div style={{ background: "#f8d7da", color: "#721c24", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Source Selection */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <label style={{ fontWeight: "bold", marginBottom: "0.5rem", display: "block" }}>Source *</label>
          <div style={{ display: "flex", gap: "1rem" }}>
            {[
              { value: "phone", label: "Phone Call" },
              { value: "paper", label: "Paper Form" },
              { value: "in_person", label: "Walk-in" },
            ].map(opt => (
              <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="source"
                  value={opt.value}
                  checked={form.source === opt.value}
                  onChange={() => updateForm({ source: opt.value as "phone" | "paper" | "in_person" })}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Third-Party Report */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem", background: form.is_third_party_report ? "var(--warning-bg)" : undefined, border: form.is_third_party_report ? "2px solid #ffc107" : undefined }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontWeight: "bold" }}>
            <input
              type="checkbox"
              checked={form.is_third_party_report}
              onChange={(e) => updateForm({ is_third_party_report: e.target.checked })}
            />
            I am reporting on behalf of someone else
          </label>
          {form.is_third_party_report && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
              <div>
                <label className="text-sm">Relationship</label>
                <input
                  type="text"
                  value={form.third_party_relationship}
                  onChange={(e) => updateForm({ third_party_relationship: e.target.value })}
                  placeholder="e.g., neighbor, volunteer"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label className="text-sm">Property Owner Name</label>
                <input
                  type="text"
                  value={form.property_owner_name}
                  onChange={(e) => updateForm({ property_owner_name: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label className="text-sm">Owner Phone/Email</label>
                <input
                  type="text"
                  value={form.property_owner_phone}
                  onChange={(e) => updateForm({ property_owner_phone: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Section 1: Contact Info */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h3 style={{ margin: "0 0 1rem 0" }}>1. Contact Info</h3>
          <PersonSection
            role="requestor"
            value={personValue}
            onChange={handlePersonChange}
            allowCreate
            compact
            required
          />
        </div>

        {/* Section 2: Cat Location */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h3 style={{ margin: "0 0 1rem 0" }}>2. Cat Location</h3>
          <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="text-sm">Street Address *</label>
              <PlaceResolver
                value={resolvedPlace}
                onChange={handlePlaceResolved}
                placeholder="Start typing address..."
              />
              {selectedPlaceId && (
                <span style={{ fontSize: "0.7rem", color: "#198754", marginTop: "0.25rem", display: "block" }}>
                  Address verified
                </span>
              )}
            </div>
            <div>
              <label className="text-sm">City</label>
              <input
                type="text"
                value={form.cats_city}
                onChange={(e) => updateForm({ cats_city: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label className="text-sm">ZIP</label>
              <input
                type="text"
                value={form.cats_zip}
                onChange={(e) => updateForm({ cats_zip: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div>
            <label className="text-sm" style={{ marginRight: "1rem" }}>County:</label>
            {["sonoma", "marin", "napa", "other"].map(c => (
              <label key={c} style={{ marginRight: "1rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="county"
                  value={c}
                  checked={form.county === c}
                  onChange={() => updateForm({ county: c })}
                />
                {" "}{c.charAt(0).toUpperCase() + c.slice(1)}
              </label>
            ))}
          </div>
        </div>

        {/* Section 3: About the Cats */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h3 style={{ margin: "0 0 1rem 0" }}>3. About the Cats</h3>

          <div style={{ marginBottom: "1rem" }}>
            <label className="text-sm" style={{ display: "block", marginBottom: "0.5rem" }}>Cat type? *</label>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {OWNERSHIP_OPTIONS.map(opt => (
                <label key={opt.value} style={{ cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="ownership"
                    value={opt.value}
                    checked={form.ownership_status === opt.value}
                    onChange={() => updateForm({ ownership_status: opt.value })}
                  />
                  {" "}{opt.shortLabel}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "2rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <div>
              <label className="text-sm">How many?</label>
              <input
                type="number"
                min="1"
                value={form.cat_count_estimate}
                onChange={(e) => updateForm({ cat_count_estimate: e.target.value ? parseInt(e.target.value) : "" })}
                style={{ width: "80px", marginLeft: "0.5rem" }}
              />
            </div>
            {form.cat_count_estimate && (
              <div>
                <label className="text-sm" style={{ marginRight: "0.5rem" }}>Is this count...</label>
                {COUNT_CONFIDENCE_OPTIONS.slice(0, 3).map(opt => (
                  <label key={opt.value} style={{ marginRight: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="count_confidence"
                      value={opt.value}
                      checked={form.count_confidence === opt.value}
                      onChange={() => updateForm({ count_confidence: opt.value })}
                    />
                    {" "}{opt.value === "exact" ? "Exact" : opt.value === "good_estimate" ? "Estimate" : "Guess"}
                  </label>
                ))}
              </div>
            )}
            <div>
              <label className="text-sm" style={{ marginRight: "0.5rem" }}>Fixed (ear-tip)? *</label>
              {FIXED_STATUS_OPTIONS.map(opt => (
                <label key={opt.value} style={{ marginRight: "0.75rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="fixed"
                    value={opt.value}
                    checked={form.fixed_status === opt.value}
                    onChange={() => updateForm({ fixed_status: opt.value })}
                  />
                  {" "}{opt.shortLabel}
                </label>
              ))}
            </div>
          </div>

          {/* Feeding Behavior Section */}
          <div style={{ background: "var(--background-secondary)", padding: "0.75rem", marginBottom: "1rem", border: "1px solid var(--border)", borderRadius: "6px" }}>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <div>
                <label className="text-sm" style={{ marginRight: "0.5rem" }}>Do you feed?</label>
                {[
                  { value: true, label: "Yes" },
                  { value: false, label: "No" },
                ].map((opt, i) => (
                  <label key={i} style={{ marginRight: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="feeds_cat"
                      checked={form.feeds_cat === opt.value}
                      onChange={() => updateForm({ feeds_cat: opt.value })}
                    />
                    {" "}{opt.label}
                  </label>
                ))}
              </div>
              {form.feeds_cat && (
                <div>
                  <label className="text-sm" style={{ marginRight: "0.5rem" }}>How often?</label>
                  {[
                    { value: "daily", label: "Daily" },
                    { value: "few_times_week", label: "Few times/wk" },
                    { value: "occasionally", label: "Occasionally" },
                  ].map(opt => (
                    <label key={opt.value} style={{ marginRight: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="feeding_freq"
                        value={opt.value}
                        checked={form.feeding_frequency === opt.value}
                        onChange={() => updateForm({ feeding_frequency: opt.value })}
                      />
                      {" "}{opt.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <label className="text-sm" style={{ marginRight: "0.5rem" }}>How long aware?</label>
                {[
                  { value: "just_started", label: "<2 wks" },
                  { value: "few_weeks", label: "Few weeks" },
                  { value: "few_months", label: "Few months" },
                  { value: "over_year", label: "1+ year" },
                ].map(opt => (
                  <label key={opt.value} style={{ marginRight: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="feeding_duration"
                      value={opt.value}
                      checked={form.feeding_duration === opt.value}
                      onChange={() => updateForm({ feeding_duration: opt.value })}
                    />
                    {" "}{opt.label}
                  </label>
                ))}
              </div>
              <div>
                <label className="text-sm" style={{ marginRight: "0.5rem" }}>Cats here how long?</label>
                {COLONY_DURATION_OPTIONS.slice(0, 4).map(opt => (
                  <label key={opt.value} style={{ marginRight: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="colony_duration"
                      value={opt.value}
                      checked={form.colony_duration === opt.value}
                      onChange={() => updateForm({ colony_duration: opt.value })}
                    />
                    {" "}{opt.value === "under_1_month" ? "<1 mo" : opt.value === "1_to_6_months" ? "1-6 mo" : opt.value === "6_to_24_months" ? "6mo-2yr" : "2+ yrs"}
                  </label>
                ))}
              </div>
              <div>
                <label className="text-sm" style={{ marginRight: "0.5rem" }}>Comes inside?</label>
                {[
                  { value: "yes_regularly", label: "Yes" },
                  { value: "sometimes", label: "Sometimes" },
                  { value: "never", label: "Never" },
                ].map(opt => (
                  <label key={opt.value} style={{ marginRight: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="comes_inside"
                      value={opt.value}
                      checked={form.cat_comes_inside === opt.value}
                      onChange={() => updateForm({ cat_comes_inside: opt.value })}
                    />
                    {" "}{opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
            <label style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.has_kittens}
                onChange={(e) => updateForm({ has_kittens: e.target.checked })}
              />
              {" "}Kittens present?
            </label>
            {form.has_kittens && (
              <div>
                <label className="text-sm">How many?</label>
                <input
                  type="number"
                  min="1"
                  value={form.kitten_count}
                  onChange={(e) => updateForm({ kitten_count: e.target.value ? parseInt(e.target.value) : "" })}
                  style={{ width: "60px", marginLeft: "0.5rem" }}
                />
              </div>
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", color: "#dc3545", fontWeight: "bold" }}>
            <input
              type="checkbox"
              checked={form.is_emergency}
              onChange={(e) => updateForm({ is_emergency: e.target.checked })}
            />
            URGENT ({URGENT_SITUATION_EXAMPLES})
          </label>
        </div>

        {/* Section 4: Situation */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h3 style={{ margin: "0 0 1rem 0" }}>4. Situation</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="text-sm" style={{ marginRight: "0.5rem" }}>Medical concerns?</label>
              {[
                { value: true, label: "Yes" },
                { value: false, label: "No" },
                { value: null, label: "Unsure" },
              ].map((opt, i) => (
                <label key={i} style={{ marginRight: "0.75rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="medical"
                    checked={form.has_medical_concerns === opt.value}
                    onChange={() => updateForm({ has_medical_concerns: opt.value })}
                  />
                  {" "}{opt.label}
                </label>
              ))}
            </div>
            <div>
              <label className="text-sm" style={{ marginRight: "0.5rem" }}>Property access?</label>
              {[
                { value: true, label: "Yes" },
                { value: false, label: "No" },
                { value: null, label: "Need to check" },
              ].map((opt, i) => (
                <label key={i} style={{ marginRight: "0.75rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="access"
                    checked={form.has_property_access === opt.value}
                    onChange={() => updateForm({ has_property_access: opt.value })}
                  />
                  {" "}{opt.label}
                </label>
              ))}
            </div>
            <div>
              <label className="text-sm" style={{ marginRight: "0.5rem" }}>Property owner?</label>
              {[
                { value: true, label: "Yes" },
                { value: false, label: "No (renter)" },
              ].map((opt, i) => (
                <label key={i} style={{ marginRight: "0.75rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="owner"
                    checked={form.is_property_owner === opt.value}
                    onChange={() => updateForm({ is_property_owner: opt.value })}
                  />
                  {" "}{opt.label}
                </label>
              ))}
            </div>
            <div>
              <label className="text-sm" style={{ marginRight: "0.5rem" }}>Others feeding?</label>
              {[
                { value: true, label: "Yes" },
                { value: false, label: "No" },
                { value: null, label: "Unsure" },
              ].map((opt, i) => (
                <label key={i} style={{ marginRight: "0.75rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="others_feeding"
                    checked={form.others_feeding === opt.value}
                    onChange={() => updateForm({ others_feeding: opt.value })}
                  />
                  {" "}{opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm" style={{ marginRight: "0.5rem" }}>How heard about us?</label>
            {[
              { value: "website", label: "Website" },
              { value: "social_media", label: "Social media" },
              { value: "friend_family", label: "Friend/family" },
              { value: "vet_shelter", label: "Vet/shelter" },
              { value: "other", label: "Other" },
            ].map(opt => (
              <label key={opt.value} style={{ marginRight: "0.75rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="referral"
                  value={opt.value}
                  checked={form.referral_source === opt.value}
                  onChange={() => updateForm({ referral_source: opt.value })}
                />
                {" "}{opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Section 5: Description */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h3 style={{ margin: "0 0 1rem 0" }}>5. Describe the Situation</h3>
          <textarea
            value={form.situation_description}
            onChange={(e) => updateForm({ situation_description: e.target.value })}
            placeholder="Medical concerns, cat descriptions, best contact times, feeding schedule, access notes..."
            rows={4}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>

        {/* Section 6: Kitten Details (conditional) */}
        {form.has_kittens && (
          <div className="card" style={{ marginBottom: "1rem", padding: "1rem", background: "#e3f2fd", border: "2px solid #2196f3" }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "#1565c0" }}>6. Kitten Details</h3>
            <KittenAssessmentSection
              value={kittenValue}
              onChange={handleKittenChange}
              ageOptions={INTAKE_KITTEN_AGE_OPTIONS}
              behaviorOptions={INTAKE_KITTEN_BEHAVIOR_OPTIONS}
              compact
            />
          </div>
        )}

        {/* Staff Section: Triage */}
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem", background: "#f5f5f5", border: "1px solid #999" }}>
          <h3 style={{ margin: "0 0 1rem 0", color: "#333" }}>Staff Triage</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem" }}>Received by</label>
              <input
                type="text"
                value={form.reviewed_by}
                onChange={(e) => updateForm({ reviewed_by: e.target.value })}
                placeholder="Staff name"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem" }}>Priority</label>
              <select
                value={form.priority_override}
                onChange={(e) => updateForm({ priority_override: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem" }}>Triage Category</label>
              <select
                value={form.final_category}
                onChange={(e) => updateForm({ final_category: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="">Auto-compute</option>
                <option value="high_priority_tnr">FFR - High Priority</option>
                <option value="standard_tnr">FFR - Standard</option>
                <option value="wellness_only">Wellness Only</option>
                <option value="owned_cat_low">Owned Cat - Redirect</option>
                <option value="out_of_county">Out of Area</option>
                <option value="needs_review">Needs Review</option>
              </select>
            </div>
          </div>
        </div>

        {/* Staff Section: Kitten Assessment (conditional) */}
        {form.has_kittens && (
          <div className="card" style={{ marginBottom: "1rem", padding: "1rem", background: "#f5f5f5", border: "1px solid #999" }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "#333" }}>Staff Kitten Assessment</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label className="text-sm" style={{ display: "block", marginBottom: "0.5rem" }}>Kitten Outcome</label>
                {[
                  { value: "foster_intake", label: "Foster intake" },
                  { value: "tnr_candidate", label: "FFR candidate" },
                  { value: "pending_space", label: "Pending space" },
                  { value: "declined", label: "Declined" },
                ].map(opt => (
                  <label key={opt.value} style={{ display: "block", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="outcome"
                      value={opt.value}
                      checked={form.kitten_outcome === opt.value}
                      onChange={() => updateForm({ kitten_outcome: opt.value })}
                    />
                    {" "}{opt.label}
                  </label>
                ))}
              </div>
              <div>
                <label className="text-sm" style={{ display: "block", marginBottom: "0.5rem" }}>Foster Readiness</label>
                {[
                  { value: "high", label: "High (friendly, ideal age)" },
                  { value: "medium", label: "Medium (needs work)" },
                  { value: "low", label: "Low (FFR likely)" },
                ].map(opt => (
                  <label key={opt.value} style={{ display: "block", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="readiness"
                      value={opt.value}
                      checked={form.foster_readiness === opt.value}
                      onChange={() => updateForm({ foster_readiness: opt.value })}
                    />
                    {" "}{opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.5rem" }}>Urgency Factors (check all that apply)</label>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                {KITTEN_URGENCY_OPTIONS.map(opt => (
                  <label key={opt.value} style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.kitten_urgency_factors.includes(opt.value)}
                      onChange={() => toggleUrgencyFactor(opt.value)}
                    />
                    {" "}{opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm">Staff notes (foster contact, follow-up needed, trapping plan):</label>
              <textarea
                value={form.review_notes}
                onChange={(e) => updateForm({ review_notes: e.target.value })}
                rows={3}
                style={{ width: "100%", marginTop: "0.25rem", resize: "vertical" }}
              />
            </div>
          </div>
        )}

        {/* Submit */}
        <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
          <button type="submit" disabled={submitting} style={{ padding: "0.75rem 2rem" }}>
            {submitting ? "Submitting..." : "Submit Intake"}
          </button>
          <a href="/intake/queue" style={{ padding: "0.75rem 1.5rem", background: "#f0f0f0", color: "#333", borderRadius: "6px", textDecoration: "none" }}>
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
