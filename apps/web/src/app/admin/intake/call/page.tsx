"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PlaceResolver from "@/components/PlaceResolver";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { formatPhone } from "@/lib/formatters";

// Form state type
interface PhoneIntakeForm {
  // Step 1: Caller Info
  first_name: string;
  last_name: string;
  phone: string;
  email: string;

  // Step 2: Call Type
  call_type: string;
  ownership_status: string;

  // Step 3: Location
  cats_at_requester_address: boolean;
  cats_address: string;
  cats_city: string;
  cats_zip: string;
  selected_place_id: string | null;
  has_property_access: boolean;
  access_notes: string;

  // Step 3: Place Classification (Classification Engine)
  is_organization: boolean;
  organization_name: string;
  known_org_id: string | null;
  property_type: string;
  link_to_colony_id: string | null;

  // Step 4: Cat Details
  cat_count_estimate: string;
  count_confidence: string;
  fixed_status: string;
  eartip_count_observed: string;
  handleability: string;

  // Step 5: Special Situations
  has_kittens: boolean;
  kitten_count: string;
  kitten_age_estimate: string;
  has_medical_concerns: boolean;
  medical_description: string;
  is_emergency: boolean;

  // Step 6: Additional Info
  situation_description: string;
  feeds_cat: boolean;
  feeding_frequency: string;
  referral_source: string;
  staff_notes: string;
}

const INITIAL_FORM: PhoneIntakeForm = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  call_type: "",
  ownership_status: "",
  cats_at_requester_address: true,
  cats_address: "",
  cats_city: "",
  cats_zip: "",
  selected_place_id: null,
  has_property_access: true,
  access_notes: "",
  // Classification Engine fields
  is_organization: false,
  organization_name: "",
  known_org_id: null,
  property_type: "",
  link_to_colony_id: null,
  cat_count_estimate: "",
  count_confidence: "good_estimate",
  fixed_status: "unknown",
  eartip_count_observed: "",
  handleability: "unknown",
  has_kittens: false,
  kitten_count: "",
  kitten_age_estimate: "",
  has_medical_concerns: false,
  medical_description: "",
  is_emergency: false,
  situation_description: "",
  feeds_cat: false,
  feeding_frequency: "",
  referral_source: "",
  staff_notes: "",
};

const STEPS = [
  { id: 1, title: "Caller Info", icon: "1" },
  { id: 2, title: "Call Type", icon: "2" },
  { id: 3, title: "Location", icon: "3" },
  { id: 4, title: "Cat Details", icon: "4" },
  { id: 5, title: "Special Cases", icon: "5" },
  { id: 6, title: "Notes & Submit", icon: "6" },
];

const CALL_TYPES = [
  { value: "colony_tnr", label: "Multiple Outdoor Cats (Colony TNR)", description: "2+ cats need spay/neuter" },
  { value: "single_stray", label: "Single Stray Cat", description: "One unfamiliar cat" },
  { value: "kitten_rescue", label: "Kittens Found", description: "Kittens need help" },
  { value: "pet_spay_neuter", label: "Own Pet", description: "Caller's own cat needs spay/neuter" },
  { value: "wellness_check", label: "Wellness / Medical", description: "Already-fixed cat needs care" },
  { value: "medical_concern", label: "Medical Emergency", description: "Urgent medical situation" },
];

const OWNERSHIP_OPTIONS = [
  { value: "community_colony", label: "Community/Colony Cat", description: "Outdoor cat being fed by someone" },
  { value: "unknown_stray", label: "Stray (No Known Caretaker)", description: "No one claims or feeds this cat" },
  { value: "newcomer", label: "Newcomer", description: "Cat just appeared recently" },
  { value: "neighbors_cat", label: "Neighbor's Cat", description: "Belongs to a neighbor" },
  { value: "my_cat", label: "Caller's Own Pet", description: "Caller owns this cat" },
  { value: "unsure", label: "Unsure", description: "Caller doesn't know" },
];

const FIXED_STATUS_OPTIONS = [
  { value: "none_fixed", label: "None have ear tips", description: "No cats appear to be fixed" },
  { value: "some_fixed", label: "Some have ear tips", description: "A few cats are already fixed" },
  { value: "most_fixed", label: "Most have ear tips", description: "Majority are already fixed" },
  { value: "all_fixed", label: "All have ear tips", description: "All cats appear fixed" },
  { value: "unknown", label: "Unknown / Can't Tell", description: "Caller can't see ear tips" },
];

const HANDLEABILITY_OPTIONS = [
  { value: "friendly_carrier", label: "Friendly - Can use carrier", description: "Cat approaches people, can be picked up" },
  { value: "shy_handleable", label: "Shy but handleable", description: "Nervous but can be caught with patience" },
  { value: "unhandleable_trap", label: "Feral - Needs trap", description: "Runs away, hisses, needs humane trap" },
  { value: "some_friendly", label: "Mixed (some friendly)", description: "Some cats friendly, some feral" },
  { value: "unknown", label: "Unknown", description: "Caller hasn't tried to approach" },
];

const KITTEN_AGE_OPTIONS = [
  { value: "newborn", label: "Newborn (eyes closed)" },
  { value: "2_3_weeks", label: "2-3 weeks (eyes open, wobbly)" },
  { value: "4_5_weeks", label: "4-5 weeks (walking, playing)" },
  { value: "6_8_weeks", label: "6-8 weeks (weaning age)" },
  { value: "8_12_weeks", label: "8-12 weeks (adoption ready)" },
  { value: "over_12_weeks", label: "Over 12 weeks (older kittens)" },
  { value: "mixed_ages", label: "Mixed ages" },
  { value: "unknown", label: "Unknown" },
];

const REFERRAL_OPTIONS = [
  { value: "google", label: "Google Search" },
  { value: "website", label: "FFSC Website" },
  { value: "facebook", label: "Facebook" },
  { value: "nextdoor", label: "Nextdoor" },
  { value: "friend_family", label: "Friend/Family" },
  { value: "vet", label: "Vet Referral" },
  { value: "shelter", label: "Shelter Referral" },
  { value: "repeat_caller", label: "Repeat Caller" },
  { value: "other", label: "Other" },
];

// Instruction box component
function InstructionBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
      borderRadius: 8,
      padding: "12px 16px",
      marginBottom: 20,
    }}>
      <div style={{ fontWeight: 600, color: "#1e40af", marginBottom: 4, fontSize: 13 }}>
        {title}
      </div>
      <div style={{ color: "#1e3a8a", fontSize: 13, lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  );
}

// Form field wrapper
function FormField({ label, required, hint, children }: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
        {label}
        {required && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}
      </label>
      {hint && (
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{hint}</div>
      )}
      {children}
    </div>
  );
}

// Radio option card
function OptionCard({
  selected,
  onClick,
  label,
  description
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  description?: string;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 16px",
        border: selected ? "2px solid #3b82f6" : "1px solid #d1d5db",
        borderRadius: 8,
        cursor: "pointer",
        background: selected ? "#eff6ff" : "white",
        marginBottom: 8,
      }}
    >
      <div style={{ fontWeight: 500, color: selected ? "#1d4ed8" : "#374151" }}>
        {label}
      </div>
      {description && (
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          {description}
        </div>
      )}
    </div>
  );
}

export default function PhoneIntakePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<PhoneIntakeForm>(INITIAL_FORM);
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ submission_id: string; triage_category: string } | null>(null);

  const updateForm = useCallback((updates: Partial<PhoneIntakeForm>) => {
    setForm(prev => ({ ...prev, ...updates }));
  }, []);

  const canProceed = () => {
    switch (step) {
      case 1:
        return form.first_name && form.last_name && (form.phone || form.email);
      case 2:
        return form.call_type && form.ownership_status;
      case 3:
        return form.cats_address;
      case 4:
        return form.cat_count_estimate;
      case 5:
        return true; // Optional step
      case 6:
        return true;
      default:
        return true;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      // Build the submission payload
      const payload = {
        // Source tracking
        intake_source: "phone",
        source_system: "atlas_phone_intake",

        // Contact info
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone || null,
        email: form.email || null,

        // Cat location
        cats_address: form.cats_address,
        cats_city: form.cats_city || null,
        cats_zip: form.cats_zip || null,
        cats_at_requester_address: form.cats_at_requester_address,
        selected_address_place_id: form.selected_place_id,

        // Access
        has_property_access: form.has_property_access,
        access_notes: form.access_notes || null,

        // Place Classification (Classification Engine)
        property_type: form.property_type || null,
        place_contexts: [
          // Add organization context if marked as org
          ...(form.is_organization ? [{
            context_type: "organization",
            organization_name: form.organization_name || null,
            known_org_id: form.known_org_id || null,
          }] : []),
          // Add property type as context if specified
          ...(form.property_type && form.property_type !== "residential" ? [{
            context_type: form.property_type,
          }] : []),
        ].filter(c => c.context_type), // Filter out empty contexts

        // Cat details
        ownership_status: form.ownership_status,
        cat_count_estimate: parseInt(form.cat_count_estimate) || 1,
        count_confidence: form.count_confidence,
        fixed_status: form.fixed_status,
        eartip_count_observed: form.eartip_count_observed ? parseInt(form.eartip_count_observed) : null,
        handleability: form.handleability,

        // Kittens
        has_kittens: form.has_kittens,
        kitten_count: form.kitten_count ? parseInt(form.kitten_count) : null,
        kitten_age_estimate: form.kitten_age_estimate || null,

        // Medical
        has_medical_concerns: form.has_medical_concerns,
        medical_description: form.medical_description || null,
        is_emergency: form.is_emergency,
        emergency_acknowledged: form.is_emergency,

        // Notes
        situation_description: form.situation_description || null,
        feeds_cat: form.feeds_cat,
        feeding_frequency: form.feeds_cat ? form.feeding_frequency : null,
        referral_source: form.referral_source || null,

        // Staff assessment
        custom_fields: {
          call_type: form.call_type,
          staff_notes: form.staff_notes,
          intake_method: "phone_call",
        },
      };

      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to submit intake");
      }

      const data = await response.json();
      setResult({
        submission_id: data.submission_id,
        triage_category: data.triage_category,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  // Success screen
  if (result) {
    const categoryLabels: Record<string, { label: string; color: string }> = {
      high_priority_tnr: { label: "High Priority TNR", color: "#dc2626" },
      standard_tnr: { label: "Standard TNR", color: "#2563eb" },
      wellness_only: { label: "Wellness Only", color: "#059669" },
      owned_cat_low: { label: "Owned Cat (Redirect)", color: "#6b7280" },
      out_of_county: { label: "Out of County", color: "#9333ea" },
      needs_review: { label: "Needs Review", color: "#d97706" },
    };

    const category = categoryLabels[result.triage_category] || { label: result.triage_category, color: "#6b7280" };

    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: 20 }}>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <h1 style={{ margin: "0 0 8px 0", color: "#059669" }}>Intake Submitted</h1>
          <p style={{ color: "#6b7280", marginBottom: 24 }}>
            The intake has been added to the queue for processing.
          </p>

          <div style={{
            background: "#f9fafb",
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
          }}>
            <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 8 }}>Triage Category</div>
            <div style={{
              display: "inline-block",
              padding: "6px 16px",
              background: `${category.color}15`,
              color: category.color,
              borderRadius: 20,
              fontWeight: 600,
            }}>
              {category.label}
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 12 }}>
              ID: {result.submission_id.slice(0, 8)}...
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => {
                setForm(INITIAL_FORM);
                setStep(1);
                setResult(null);
              }}
              style={{
                padding: "12px 24px",
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              New Intake
            </button>
            <button
              onClick={() => router.push("/intake/queue")}
              style={{
                padding: "12px 24px",
                background: "white",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              View Queue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 20 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Phone Intake Form</h1>
        <p style={{ color: "#6b7280", margin: "4px 0 0 0" }}>
          Enter information from a phone call to add to the intake queue
        </p>
      </div>

      {/* Progress Steps */}
      <div style={{
        display: "flex",
        gap: 4,
        marginBottom: 24,
        overflowX: "auto",
        paddingBottom: 4,
      }}>
        {STEPS.map((s) => (
          <div
            key={s.id}
            onClick={() => s.id < step && setStep(s.id)}
            style={{
              flex: 1,
              minWidth: 80,
              padding: "10px 8px",
              textAlign: "center",
              borderRadius: 8,
              background: step === s.id ? "#3b82f6" : step > s.id ? "#10b981" : "#f3f4f6",
              color: step >= s.id ? "white" : "#6b7280",
              cursor: s.id < step ? "pointer" : "default",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <div>{s.icon}</div>
            <div style={{ marginTop: 2 }}>{s.title}</div>
          </div>
        ))}
      </div>

      {/* Form Content */}
      <div style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 24,
        minHeight: 400,
      }}>
        {/* Step 1: Caller Info */}
        {step === 1 && (
          <>
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Step 1: Caller Information</h2>

            <InstructionBox title="Ask the Caller">
              "May I have your name and the best way to reach you?"
            </InstructionBox>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <FormField label="First Name" required>
                <input
                  type="text"
                  value={form.first_name}
                  onChange={(e) => updateForm({ first_name: e.target.value })}
                  placeholder="First name"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                />
              </FormField>
              <FormField label="Last Name" required>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={(e) => updateForm({ last_name: e.target.value })}
                  placeholder="Last name"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                />
              </FormField>
            </div>

            <FormField label="Phone Number" required hint="At least phone or email is required">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => updateForm({ phone: e.target.value })}
                placeholder="(707) 555-1234"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
              />
            </FormField>

            <FormField label="Email Address" hint="Optional but helpful for follow-up">
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateForm({ email: e.target.value })}
                placeholder="email@example.com"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
              />
            </FormField>
          </>
        )}

        {/* Step 2: Call Type */}
        {step === 2 && (
          <>
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Step 2: What is the call about?</h2>

            <InstructionBox title="Ask the Caller">
              "How can we help you today? Are you calling about outdoor cats, your own pet, or something else?"
            </InstructionBox>

            <FormField label="Type of Call" required>
              {CALL_TYPES.map((type) => (
                <OptionCard
                  key={type.value}
                  selected={form.call_type === type.value}
                  onClick={() => updateForm({ call_type: type.value })}
                  label={type.label}
                  description={type.description}
                />
              ))}
            </FormField>

            <FormField label="Who does the cat belong to?" required>
              {OWNERSHIP_OPTIONS.map((opt) => (
                <OptionCard
                  key={opt.value}
                  selected={form.ownership_status === opt.value}
                  onClick={() => updateForm({ ownership_status: opt.value })}
                  label={opt.label}
                  description={opt.description}
                />
              ))}
            </FormField>
          </>
        )}

        {/* Step 3: Location */}
        {step === 3 && (
          <>
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Step 3: Where are the cats?</h2>

            <InstructionBox title="Ask the Caller">
              "What is the address where the cats are located? Is that your home address or somewhere else?"
            </InstructionBox>

            <FormField label="Are the cats at the caller's home?" required>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => updateForm({ cats_at_requester_address: true })}
                  style={{
                    flex: 1,
                    padding: "12px",
                    border: form.cats_at_requester_address ? "2px solid #3b82f6" : "1px solid #d1d5db",
                    borderRadius: 8,
                    background: form.cats_at_requester_address ? "#eff6ff" : "white",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Yes, at their home
                </button>
                <button
                  type="button"
                  onClick={() => updateForm({ cats_at_requester_address: false })}
                  style={{
                    flex: 1,
                    padding: "12px",
                    border: !form.cats_at_requester_address ? "2px solid #3b82f6" : "1px solid #d1d5db",
                    borderRadius: 8,
                    background: !form.cats_at_requester_address ? "#eff6ff" : "white",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  No, different location
                </button>
              </div>
            </FormField>

            <FormField label="Address where cats are located" required>
              <PlaceResolver
                value={resolvedPlace}
                onChange={(place) => {
                  setResolvedPlace(place);
                  updateForm({
                    cats_address: place?.formatted_address || place?.display_name || "",
                    selected_place_id: place?.place_id || null,
                  });
                }}
                placeholder="Start typing the address..."
              />
              {form.selected_place_id && (
                <div style={{ marginTop: 8, padding: 8, background: "#f0fdf4", borderRadius: 6, fontSize: 13 }}>
                  Address linked to existing place
                </div>
              )}
            </FormField>

            <FormField label="Does the caller have access to the property?">
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => updateForm({ has_property_access: true })}
                  style={{
                    flex: 1,
                    padding: "10px",
                    border: form.has_property_access ? "2px solid #3b82f6" : "1px solid #d1d5db",
                    borderRadius: 8,
                    background: form.has_property_access ? "#eff6ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => updateForm({ has_property_access: false })}
                  style={{
                    flex: 1,
                    padding: "10px",
                    border: !form.has_property_access ? "2px solid #3b82f6" : "1px solid #d1d5db",
                    borderRadius: 8,
                    background: !form.has_property_access ? "#eff6ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  No
                </button>
              </div>
            </FormField>

            {!form.has_property_access && (
              <FormField label="Access notes" hint="Who needs to be contacted for access?">
                <textarea
                  value={form.access_notes}
                  onChange={(e) => updateForm({ access_notes: e.target.value })}
                  placeholder="e.g., Need to contact property manager at..."
                  rows={2}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", resize: "vertical" }}
                />
              </FormField>
            )}

            {/* Place Classification - visible when address is entered */}
            {form.cats_address && (
              <div
                style={{
                  marginTop: "1.5rem",
                  padding: "1rem",
                  background: "#f0f9ff",
                  borderRadius: 8,
                  border: "1px solid #bae6fd",
                }}
              >
                <h3 style={{ margin: "0 0 0.5rem 0", fontSize: 14, color: "#0369a1" }}>
                  Place Classification
                </h3>
                <p style={{ margin: "0 0 1rem 0", fontSize: 13, color: "#6b7280" }}>
                  Multiple options can be selected (e.g., a business can also be a colony site)
                </p>

                {/* Is this an organization/business? */}
                <FormField label="Is this an organization or business?">
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => updateForm({ is_organization: true })}
                      style={{
                        flex: 1,
                        padding: "10px",
                        border: form.is_organization ? "2px solid #3b82f6" : "1px solid #d1d5db",
                        borderRadius: 8,
                        background: form.is_organization ? "#eff6ff" : "white",
                        cursor: "pointer",
                      }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => updateForm({ is_organization: false, organization_name: "", known_org_id: null })}
                      style={{
                        flex: 1,
                        padding: "10px",
                        border: !form.is_organization ? "2px solid #3b82f6" : "1px solid #d1d5db",
                        borderRadius: 8,
                        background: !form.is_organization ? "#eff6ff" : "white",
                        cursor: "pointer",
                      }}
                    >
                      No (Residential)
                    </button>
                  </div>
                </FormField>

                {form.is_organization && (
                  <FormField label="Organization name" hint="e.g., SMART Park N Ride, Costco, City Hall">
                    <input
                      type="text"
                      value={form.organization_name}
                      onChange={(e) => updateForm({ organization_name: e.target.value })}
                      placeholder="Enter organization name..."
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                    />
                  </FormField>
                )}

                {/* Property type */}
                <FormField label="Property type">
                  <select
                    value={form.property_type}
                    onChange={(e) => updateForm({ property_type: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                  >
                    <option value="">Not specified</option>
                    <option value="residential">Residential (single home)</option>
                    <option value="multi_unit">Multi-unit (apartments, mobile home park)</option>
                    <option value="business">Business / Commercial</option>
                    <option value="public_space">Public space (park, parking lot)</option>
                    <option value="farm_ranch">Farm / Ranch</option>
                  </select>
                </FormField>
              </div>
            )}
          </>
        )}

        {/* Step 4: Cat Details */}
        {step === 4 && (
          <>
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Step 4: Cat Details</h2>

            <InstructionBox title="Ask the Caller">
              "About how many cats are there? Have any of them been fixed already - do you see any with ear tips?
              Are the cats friendly enough to put in a carrier, or are they feral?"
            </InstructionBox>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <FormField label="How many cats?" required>
                <input
                  type="number"
                  value={form.cat_count_estimate}
                  onChange={(e) => updateForm({ cat_count_estimate: e.target.value })}
                  placeholder="Number of cats"
                  min="1"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                />
              </FormField>
              <FormField label="Count confidence">
                <select
                  value={form.count_confidence}
                  onChange={(e) => updateForm({ count_confidence: e.target.value })}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                >
                  <option value="exact">Exact count</option>
                  <option value="good_estimate">Good estimate</option>
                  <option value="rough_guess">Rough guess</option>
                  <option value="unknown">Unknown</option>
                </select>
              </FormField>
            </div>

            <FormField label="How many are already fixed (ear-tipped)?">
              {FIXED_STATUS_OPTIONS.map((opt) => (
                <OptionCard
                  key={opt.value}
                  selected={form.fixed_status === opt.value}
                  onClick={() => updateForm({ fixed_status: opt.value })}
                  label={opt.label}
                  description={opt.description}
                />
              ))}
            </FormField>

            {(form.fixed_status === "some_fixed" || form.fixed_status === "most_fixed") && (
              <FormField label="Approximately how many have ear tips?">
                <input
                  type="number"
                  value={form.eartip_count_observed}
                  onChange={(e) => updateForm({ eartip_count_observed: e.target.value })}
                  placeholder="Number with ear tips"
                  min="0"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                />
              </FormField>
            )}

            <FormField label="How handleable are the cats?">
              {HANDLEABILITY_OPTIONS.map((opt) => (
                <OptionCard
                  key={opt.value}
                  selected={form.handleability === opt.value}
                  onClick={() => updateForm({ handleability: opt.value })}
                  label={opt.label}
                  description={opt.description}
                />
              ))}
            </FormField>
          </>
        )}

        {/* Step 5: Special Situations */}
        {step === 5 && (
          <>
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Step 5: Special Situations</h2>

            <InstructionBox title="Ask the Caller">
              "Are there any kittens? Is any cat injured or sick? Is this an emergency situation?"
            </InstructionBox>

            {/* Kittens Section */}
            <div style={{
              padding: 16,
              background: form.has_kittens ? "#fef3c7" : "#f9fafb",
              borderRadius: 8,
              marginBottom: 16,
              border: form.has_kittens ? "1px solid #fcd34d" : "1px solid #e5e7eb",
            }}>
              <FormField label="Are there kittens?">
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => updateForm({ has_kittens: true })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: form.has_kittens ? "2px solid #d97706" : "1px solid #d1d5db",
                      borderRadius: 8,
                      background: form.has_kittens ? "#fef3c7" : "white",
                      cursor: "pointer",
                      fontWeight: form.has_kittens ? 600 : 400,
                    }}
                  >
                    Yes, kittens present
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm({ has_kittens: false, kitten_count: "", kitten_age_estimate: "" })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: !form.has_kittens ? "2px solid #3b82f6" : "1px solid #d1d5db",
                      borderRadius: 8,
                      background: !form.has_kittens ? "#eff6ff" : "white",
                      cursor: "pointer",
                    }}
                  >
                    No kittens
                  </button>
                </div>
              </FormField>

              {form.has_kittens && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <FormField label="How many kittens?">
                      <input
                        type="number"
                        value={form.kitten_count}
                        onChange={(e) => updateForm({ kitten_count: e.target.value })}
                        placeholder="Number"
                        min="1"
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                      />
                    </FormField>
                    <FormField label="Kitten age estimate">
                      <select
                        value={form.kitten_age_estimate}
                        onChange={(e) => updateForm({ kitten_age_estimate: e.target.value })}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                      >
                        <option value="">Select age...</option>
                        {KITTEN_AGE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                </>
              )}
            </div>

            {/* Medical Concerns */}
            <div style={{
              padding: 16,
              background: form.has_medical_concerns ? "#fef2f2" : "#f9fafb",
              borderRadius: 8,
              marginBottom: 16,
              border: form.has_medical_concerns ? "1px solid #fecaca" : "1px solid #e5e7eb",
            }}>
              <FormField label="Any medical concerns?">
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => updateForm({ has_medical_concerns: true })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: form.has_medical_concerns ? "2px solid #dc2626" : "1px solid #d1d5db",
                      borderRadius: 8,
                      background: form.has_medical_concerns ? "#fef2f2" : "white",
                      cursor: "pointer",
                      fontWeight: form.has_medical_concerns ? 600 : 400,
                    }}
                  >
                    Yes, medical issue
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm({ has_medical_concerns: false, medical_description: "" })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: !form.has_medical_concerns ? "2px solid #3b82f6" : "1px solid #d1d5db",
                      borderRadius: 8,
                      background: !form.has_medical_concerns ? "#eff6ff" : "white",
                      cursor: "pointer",
                    }}
                  >
                    No medical issues
                  </button>
                </div>
              </FormField>

              {form.has_medical_concerns && (
                <FormField label="Describe the medical concern">
                  <textarea
                    value={form.medical_description}
                    onChange={(e) => updateForm({ medical_description: e.target.value })}
                    placeholder="What is wrong with the cat? Any injuries, illness symptoms?"
                    rows={2}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", resize: "vertical" }}
                  />
                </FormField>
              )}
            </div>

            {/* Emergency */}
            <div style={{
              padding: 16,
              background: form.is_emergency ? "#dc2626" : "#f9fafb",
              borderRadius: 8,
              border: form.is_emergency ? "1px solid #b91c1c" : "1px solid #e5e7eb",
            }}>
              <FormField label="Is this an emergency?">
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => updateForm({ is_emergency: true })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: form.is_emergency ? "2px solid white" : "1px solid #d1d5db",
                      borderRadius: 8,
                      background: form.is_emergency ? "#b91c1c" : "white",
                      color: form.is_emergency ? "white" : "#374151",
                      cursor: "pointer",
                      fontWeight: form.is_emergency ? 600 : 400,
                    }}
                  >
                    YES - Emergency
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm({ is_emergency: false })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: !form.is_emergency ? "2px solid #3b82f6" : "1px solid white",
                      borderRadius: 8,
                      background: !form.is_emergency ? "#eff6ff" : "transparent",
                      color: form.is_emergency ? "white" : "#374151",
                      cursor: "pointer",
                    }}
                  >
                    Not an emergency
                  </button>
                </div>
              </FormField>
              {form.is_emergency && (
                <div style={{ color: "white", fontSize: 13, marginTop: 8 }}>
                  <strong>Reminder:</strong> FFSC is not a 24-hour emergency hospital.
                  For life-threatening emergencies, refer to emergency vet clinics.
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 6: Notes & Submit */}
        {step === 6 && (
          <>
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Step 6: Additional Info & Submit</h2>

            <InstructionBox title="Wrap Up the Call">
              Ask if there's anything else they'd like to add. Thank them for calling and let them know
              someone will follow up with next steps.
            </InstructionBox>

            <FormField label="Caller's description of the situation">
              <textarea
                value={form.situation_description}
                onChange={(e) => updateForm({ situation_description: e.target.value })}
                placeholder="Any additional details the caller mentioned..."
                rows={3}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", resize: "vertical" }}
              />
            </FormField>

            <FormField label="Does the caller feed these cats?">
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => updateForm({ feeds_cat: true })}
                  style={{
                    flex: 1,
                    padding: "10px",
                    border: form.feeds_cat ? "2px solid #3b82f6" : "1px solid #d1d5db",
                    borderRadius: 8,
                    background: form.feeds_cat ? "#eff6ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => updateForm({ feeds_cat: false, feeding_frequency: "" })}
                  style={{
                    flex: 1,
                    padding: "10px",
                    border: !form.feeds_cat ? "2px solid #3b82f6" : "1px solid #d1d5db",
                    borderRadius: 8,
                    background: !form.feeds_cat ? "#eff6ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  No
                </button>
              </div>
            </FormField>

            {form.feeds_cat && (
              <FormField label="How often do they feed?">
                <select
                  value={form.feeding_frequency}
                  onChange={(e) => updateForm({ feeding_frequency: e.target.value })}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                >
                  <option value="">Select...</option>
                  <option value="daily">Daily</option>
                  <option value="few_times_week">A few times a week</option>
                  <option value="occasionally">Occasionally</option>
                  <option value="rarely">Rarely</option>
                </select>
              </FormField>
            )}

            <FormField label="How did they hear about FFSC?">
              <select
                value={form.referral_source}
                onChange={(e) => updateForm({ referral_source: e.target.value })}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
              >
                <option value="">Select...</option>
                {REFERRAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FormField>

            <FormField label="Staff Notes (internal)">
              <textarea
                value={form.staff_notes}
                onChange={(e) => updateForm({ staff_notes: e.target.value })}
                placeholder="Any notes for staff reviewing this intake..."
                rows={2}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", resize: "vertical" }}
              />
            </FormField>

            {/* Summary */}
            <div style={{
              background: "#f9fafb",
              borderRadius: 8,
              padding: 16,
              marginTop: 20,
            }}>
              <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>Summary</h3>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <div><strong>Caller:</strong> {form.first_name} {form.last_name}</div>
                <div><strong>Contact:</strong> {form.phone ? formatPhone(form.phone) : form.email}</div>
                <div><strong>Location:</strong> {form.cats_address || "Not entered"}</div>
                <div><strong>Cats:</strong> {form.cat_count_estimate || "?"} ({form.ownership_status || "?"})</div>
                <div><strong>Fixed Status:</strong> {form.fixed_status}</div>
                {form.has_kittens && <div style={{ color: "#d97706" }}><strong>Kittens:</strong> {form.kitten_count || "Yes"}</div>}
                {form.has_medical_concerns && <div style={{ color: "#dc2626" }}><strong>Medical:</strong> {form.medical_description || "Yes"}</div>}
                {form.is_emergency && <div style={{ color: "#dc2626", fontWeight: 600 }}>EMERGENCY</div>}
              </div>
            </div>
          </>
        )}

        {/* Error Display */}
        {error && (
          <div style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: 12,
            marginTop: 16,
            color: "#dc2626",
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: 20,
      }}>
        <button
          onClick={() => step > 1 && setStep(step - 1)}
          disabled={step === 1}
          style={{
            padding: "12px 24px",
            background: step === 1 ? "#f3f4f6" : "white",
            color: step === 1 ? "#9ca3af" : "#374151",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            cursor: step === 1 ? "not-allowed" : "pointer",
            fontWeight: 500,
          }}
        >
          ← Back
        </button>

        {step < 6 ? (
          <button
            onClick={() => canProceed() && setStep(step + 1)}
            disabled={!canProceed()}
            style={{
              padding: "12px 24px",
              background: canProceed() ? "#3b82f6" : "#9ca3af",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor: canProceed() ? "pointer" : "not-allowed",
              fontWeight: 500,
            }}
          >
            Continue →
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: "12px 32px",
              background: submitting ? "#9ca3af" : "#059669",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            {submitting ? "Submitting..." : "Submit Intake"}
          </button>
        )}
      </div>
    </div>
  );
}
