"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Dynamic Intake Form for Receptionist Use
 *
 * Routes to different question paths based on call type:
 * - Pet spay/neuter: Owned cat needs clinic appointment
 * - Wellness check: Fixed cat needs medical attention
 * - Single stray: One cat, may be friendly or need trapping
 * - Colony/TNR: Multiple outdoor cats need TNR
 * - Kitten rescue: Kittens found, foster assessment
 * - Medical concern: Urgent medical situation
 */

type CallType =
  | ""
  | "pet_spay_neuter"    // Owned cat needing surgery
  | "wellness_check"      // Fixed cat needing medical care
  | "single_stray"        // One unfamiliar cat
  | "colony_tnr"          // Multiple outdoor cats
  | "kitten_rescue"       // Kittens found
  | "medical_concern";    // Urgent medical situation

type Step = "call_type" | "contact" | "location" | "cat_details" | "situation" | "review";

interface CustomField {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  is_beacon_critical: boolean;
  display_order: number;
}

interface FormData {
  // Call routing
  call_type: CallType;

  // Contact
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  requester_address: string;
  requester_city: string;
  requester_zip: string;

  // Third-party report
  is_third_party_report: boolean;
  third_party_relationship: string;
  property_owner_name: string;
  property_owner_phone: string;
  property_owner_email: string;

  // Location
  cats_address: string;
  cats_city: string;
  cats_zip: string;
  county: string;
  same_as_requester: boolean;

  // Cat details (varies by call type)
  cat_name: string;  // For owned pets
  cat_description: string;  // Color, markings
  cat_count: string;
  fixed_status: string;

  // Handleability - key question for determining carrier vs trap
  handleability: string;  // friendly_carrier, shy_handleable, feral_trap, unknown

  // Colony-specific
  peak_count: string;
  eartip_count: string;
  feeding_situation: string;

  // Kitten-specific
  kitten_count: string;
  kitten_age: string;
  kitten_socialization: string;
  mom_present: string;

  // Medical
  has_medical_concerns: boolean;
  medical_description: string;
  is_emergency: boolean;
  emergency_acknowledged: boolean;

  // Property/Access
  is_property_owner: string;
  has_property_access: string;

  // Notes
  notes: string;
  referral_source: string;
}

const initialFormData: FormData = {
  call_type: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  requester_address: "",
  requester_city: "",
  requester_zip: "",
  is_third_party_report: false,
  third_party_relationship: "",
  property_owner_name: "",
  property_owner_phone: "",
  property_owner_email: "",
  cats_address: "",
  cats_city: "",
  cats_zip: "",
  county: "",
  same_as_requester: false,
  cat_name: "",
  cat_description: "",
  cat_count: "1",
  fixed_status: "",
  handleability: "",
  peak_count: "",
  eartip_count: "",
  feeding_situation: "",
  kitten_count: "",
  kitten_age: "",
  kitten_socialization: "",
  mom_present: "",
  has_medical_concerns: false,
  medical_description: "",
  is_emergency: false,
  emergency_acknowledged: false,
  is_property_owner: "",
  has_property_access: "",
  notes: "",
  referral_source: "",
};

const CALL_TYPE_OPTIONS = [
  {
    value: "pet_spay_neuter",
    label: "Pet Spay/Neuter",
    desc: "Caller's own cat needs to be fixed",
    icon: "🏠",
  },
  {
    value: "wellness_check",
    label: "Wellness / Already Fixed",
    desc: "Cat is already fixed, needs medical attention",
    icon: "💊",
  },
  {
    value: "single_stray",
    label: "Single Stray or Newcomer",
    desc: "One unfamiliar cat showed up recently",
    icon: "🐱",
  },
  {
    value: "colony_tnr",
    label: "Colony / TNR Request",
    desc: "Multiple outdoor cats needing TNR",
    icon: "🐈‍⬛",
  },
  {
    value: "kitten_rescue",
    label: "Kitten Situation",
    desc: "Kittens found, may need foster",
    icon: "🍼",
  },
  {
    value: "medical_concern",
    label: "Medical Concern / Injured",
    desc: "Cat appears injured or sick",
    icon: "🚨",
  },
];

const HANDLEABILITY_OPTIONS = [
  {
    value: "friendly_carrier",
    label: "Friendly - can use a carrier",
    desc: "Cat can be picked up or put in a carrier by caller",
  },
  {
    value: "shy_handleable",
    label: "Shy but handleable",
    desc: "Nervous but can be approached and contained with patience",
  },
  {
    value: "feral_trap",
    label: "Feral - will need a trap",
    desc: "Cannot be touched, runs away, will require humane trap",
  },
  {
    value: "unknown",
    label: "Unknown / Haven't tried",
    desc: "Caller doesn't know if cat is approachable",
  },
];

const DRAFT_KEY = "atlas_intake_draft";

function IntakeForm() {
  const searchParams = useSearchParams();
  const isPreview = searchParams.get("preview") === "true";
  const isTestMode = searchParams.get("test") === "true";

  const [currentStep, setCurrentStep] = useState<Step>("call_type");
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
    triage_category?: string;
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasDraft, setHasDraft] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  // Custom fields state
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string | boolean>>({});

  // Determine steps based on call type
  const getSteps = (): Step[] => {
    // All paths: call_type → contact → location → cat_details → review
    // Some paths skip situation step
    const baseSteps: Step[] = ["call_type", "contact", "location", "cat_details"];

    // Add situation step for colony/TNR requests (property access matters more)
    if (formData.call_type === "colony_tnr") {
      baseSteps.push("situation");
    }

    baseSteps.push("review");
    return baseSteps;
  };

  const steps = getSteps();
  const stepIndex = steps.indexOf(currentStep);
  const progress = ((stepIndex + 1) / steps.length) * 100;

  // Load draft from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          if (draft.formData) {
            setHasDraft(true);
          }
        } catch {
          // Invalid draft, ignore
        }
      }
    }
  }, []);

  // Fetch custom fields when call_type changes
  useEffect(() => {
    if (formData.call_type) {
      fetch(`/api/intake/custom-fields?call_type=${formData.call_type}`)
        .then(res => res.json())
        .then(data => setCustomFields(data.fields || []))
        .catch(() => setCustomFields([]));
    }
  }, [formData.call_type]);

  // Update custom field value
  const updateCustomField = (fieldKey: string, value: string | boolean) => {
    setCustomFieldValues(prev => ({ ...prev, [fieldKey]: value }));
  };

  // Render a single custom field
  const renderCustomField = (field: CustomField) => {
    const value = customFieldValues[field.field_key] || "";

    switch (field.field_type) {
      case "text":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label>
              {field.field_label}
              {field.is_required && " *"}
              {field.is_beacon_critical && (
                <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", background: "#0d6efd", color: "#fff", padding: "1px 4px", borderRadius: "3px" }}>Beacon</span>
              )}
            </label>
            <input
              type="text"
              value={value as string}
              onChange={(e) => updateCustomField(field.field_key, e.target.value)}
              placeholder={field.placeholder || undefined}
            />
            {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
          </div>
        );

      case "textarea":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label>
              {field.field_label}
              {field.is_required && " *"}
            </label>
            <textarea
              value={value as string}
              onChange={(e) => updateCustomField(field.field_key, e.target.value)}
              placeholder={field.placeholder || undefined}
              rows={3}
            />
            {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
          </div>
        );

      case "number":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label>
              {field.field_label}
              {field.is_required && " *"}
            </label>
            <input
              type="number"
              value={value as string}
              onChange={(e) => updateCustomField(field.field_key, e.target.value)}
              placeholder={field.placeholder || undefined}
              style={{ maxWidth: "150px" }}
            />
            {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
          </div>
        );

      case "select":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label>
              {field.field_label}
              {field.is_required && " *"}
            </label>
            <select
              value={value as string}
              onChange={(e) => updateCustomField(field.field_key, e.target.value)}
            >
              <option value="">Select...</option>
              {field.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
          </div>
        );

      case "checkbox":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!value}
                onChange={(e) => updateCustomField(field.field_key, e.target.checked)}
              />
              <span>
                {field.field_label}
                {field.help_text && (
                  <span style={{ display: "block", fontSize: "0.85rem", color: "#666" }}>{field.help_text}</span>
                )}
              </span>
            </label>
          </div>
        );

      case "date":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label>
              {field.field_label}
              {field.is_required && " *"}
            </label>
            <input
              type="date"
              value={value as string}
              onChange={(e) => updateCustomField(field.field_key, e.target.value)}
            />
            {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
          </div>
        );

      case "phone":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label>
              {field.field_label}
              {field.is_required && " *"}
            </label>
            <input
              type="tel"
              value={value as string}
              onChange={(e) => updateCustomField(field.field_key, e.target.value)}
              placeholder={field.placeholder || undefined}
            />
            {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
          </div>
        );

      case "email":
        return (
          <div key={field.field_id} style={{ marginBottom: "1rem" }}>
            <label>
              {field.field_label}
              {field.is_required && " *"}
            </label>
            <input
              type="email"
              value={value as string}
              onChange={(e) => updateCustomField(field.field_key, e.target.value)}
              placeholder={field.placeholder || undefined}
            />
            {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
          </div>
        );

      default:
        return null;
    }
  };

  const saveDraft = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        formData,
        currentStep,
        savedAt: new Date().toISOString(),
      }));
      alert("Draft saved!");
    }
  };

  const loadDraft = () => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          setFormData(draft.formData);
          setCurrentStep(draft.currentStep || "call_type");
          setHasDraft(false);
        } catch {
          alert("Could not load draft");
        }
      }
    }
  };

  const clearDraft = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(DRAFT_KEY);
      setHasDraft(false);
    }
  };

  const updateField = (field: keyof FormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: "" }));
  };

  const validateStep = (step: Step): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === "call_type") {
      if (!formData.call_type) newErrors.call_type = "Please select what this call is about";
    }

    if (step === "contact") {
      if (!formData.first_name.trim()) newErrors.first_name = "First name required";
      if (!formData.last_name.trim()) newErrors.last_name = "Last name required";
      if (!formData.email.trim() && !formData.phone.trim()) {
        newErrors.email = "Email or phone required";
      } else if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        newErrors.email = "Invalid email format";
      }
    }

    if (step === "location") {
      if (!formData.cats_address.trim()) newErrors.cats_address = "Address required";
    }

    if (step === "cat_details") {
      // For medical concerns, require explanation
      if (formData.has_medical_concerns && !formData.medical_description.trim()) {
        newErrors.medical_description = "Please describe the medical concerns";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const nextStep = () => {
    if (!isPreview && !validateStep(currentStep)) return;

    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
      window.scrollTo(0, 0);
    }
  };

  const prevStep = () => {
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
      window.scrollTo(0, 0);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Map form data to API format, deriving ownership_status from call_type
      const ownershipStatus =
        formData.call_type === "pet_spay_neuter" ? "my_cat" :
        formData.call_type === "colony_tnr" ? "community_colony" :
        formData.call_type === "single_stray" ? "unknown_stray" :
        formData.call_type === "kitten_rescue" ? "unknown_stray" :
        "unknown_stray";

      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Contact
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          requester_address: formData.requester_address || undefined,
          requester_city: formData.requester_city || undefined,
          requester_zip: formData.requester_zip || undefined,

          // Third-party
          is_third_party_report: formData.is_third_party_report,
          third_party_relationship: formData.third_party_relationship || undefined,
          property_owner_name: formData.property_owner_name || undefined,
          property_owner_phone: formData.property_owner_phone || undefined,
          property_owner_email: formData.property_owner_email || undefined,

          // Location
          cats_address: formData.cats_address,
          cats_city: formData.cats_city || undefined,
          cats_zip: formData.cats_zip || undefined,
          county: formData.county || undefined,

          // Cat info
          ownership_status: ownershipStatus,
          cat_count_estimate: parseInt(formData.cat_count) || 1,
          cat_count_text: formData.cat_count,
          peak_count: formData.peak_count ? parseInt(formData.peak_count) : undefined,
          eartip_count_observed: formData.eartip_count ? parseInt(formData.eartip_count) : undefined,
          fixed_status: formData.fixed_status || "unknown",

          // New handleability field
          handleability: formData.handleability || undefined,

          // Kittens
          has_kittens: formData.call_type === "kitten_rescue" || undefined,
          kitten_count: formData.kitten_count ? parseInt(formData.kitten_count) : undefined,
          kitten_age_estimate: formData.kitten_age || undefined,
          kitten_behavior: formData.kitten_socialization || undefined,
          mom_present: formData.mom_present || undefined,

          // Medical
          has_medical_concerns: formData.has_medical_concerns,
          medical_description: formData.medical_description || undefined,
          is_emergency: formData.is_emergency,
          emergency_acknowledged: formData.emergency_acknowledged,

          // Property
          is_property_owner: formData.is_property_owner === "yes",
          has_property_access: formData.has_property_access === "yes",

          // Notes (combine call type context + notes)
          situation_description: [
            `Call type: ${CALL_TYPE_OPTIONS.find(o => o.value === formData.call_type)?.label || formData.call_type}`,
            formData.cat_name ? `Cat name: ${formData.cat_name}` : null,
            formData.cat_description ? `Description: ${formData.cat_description}` : null,
            formData.feeding_situation ? `Feeding: ${formData.feeding_situation}` : null,
            formData.notes,
          ].filter(Boolean).join("\n"),

          referral_source: formData.referral_source || undefined,

          // Source tracking
          source_system: "web_intake_receptionist",

          // Custom fields (stored as JSON)
          custom_fields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,

          // Test mode flag
          is_test: isTestMode,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        clearDraft();
        setSubmitted(true);
        setSubmitResult({
          success: true,
          message: result.message,
          triage_category: result.triage_category,
        });
      } else {
        setSubmitResult({
          success: false,
          message: result.error || "Something went wrong",
        });
      }
    } catch (err) {
      console.error("Submit error:", err);
      setSubmitResult({
        success: false,
        message: "Network error. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Success screen
  if (submitted && submitResult?.success) {
    return (
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2rem" }}>
        <div
          style={{
            background: "#d4edda",
            border: "1px solid #c3e6cb",
            borderRadius: "8px",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "#155724", marginBottom: "1rem" }}>Request Submitted</h2>
          <p style={{ color: "#155724" }}>{submitResult.message}</p>
          {submitResult.triage_category && (
            <p style={{ fontSize: "0.9rem", color: "#666", marginTop: "1rem" }}>
              Triage: {submitResult.triage_category}
            </p>
          )}
          <button
            onClick={() => {
              setFormData(initialFormData);
              setCurrentStep("call_type");
              setSubmitted(false);
              setSubmitResult(null);
            }}
            style={{ marginTop: "1rem", padding: "0.75rem 1.5rem" }}
          >
            Start New Request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "1rem" }}>
      {/* Test Mode Banner */}
      {isTestMode && (
        <div style={{
          background: "#d1ecf1",
          border: "2px solid #0dcaf0",
          borderRadius: "8px",
          padding: "0.75rem",
          marginBottom: "1rem",
          textAlign: "center",
        }}>
          <strong>TEST MODE</strong> - Submissions will be marked as test data (not processed)
          <a href="/intake" style={{ marginLeft: "1rem", color: "#0dcaf0" }}>Exit Test Mode</a>
        </div>
      )}

      {/* Preview Mode Banner */}
      {isPreview && (
        <div style={{
          background: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "8px",
          padding: "0.75rem",
          marginBottom: "1rem",
          textAlign: "center",
        }}>
          <strong>Preview Mode</strong> - Validation disabled
          <a href="/intake" style={{ marginLeft: "1rem" }}>Exit Preview</a>
        </div>
      )}

      {/* Draft Banner */}
      {hasDraft && !isPreview && (
        <div style={{
          background: "#cce5ff",
          border: "1px solid #b8daff",
          borderRadius: "8px",
          padding: "0.75rem",
          marginBottom: "1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>Saved draft available</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={loadDraft} style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem" }}>
              Load
            </button>
            <button onClick={clearDraft} style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem", background: "transparent", border: "1px solid #ccc" }}>
              Discard
            </button>
          </div>
        </div>
      )}

      <h1 style={{ textAlign: "center", marginBottom: "0.5rem" }}>Intake Call</h1>
      <p style={{ textAlign: "center", color: "#666", marginBottom: "1.5rem" }}>
        Receptionist intake form
      </p>

      {/* Progress Bar */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ height: "6px", background: "#eee", borderRadius: "3px", overflow: "hidden" }}>
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: "#0066cc",
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.8rem", color: "#666" }}>
          <span>Step {stepIndex + 1} of {steps.length}</span>
          <span>{currentStep.replace(/_/g, " ").toUpperCase()}</span>
        </div>
      </div>

      {/* Error Banner */}
      {submitResult && !submitResult.success && (
        <div style={{
          background: "#f8d7da",
          border: "1px solid #f5c2c7",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1rem",
          color: "#842029",
        }}>
          {submitResult.message}
        </div>
      )}

      {/* Emergency Modal */}
      {showEmergencyModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={() => setShowEmergencyModal(false)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              maxWidth: "500px",
              width: "100%",
              padding: "1.5rem",
              boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ color: "#dc3545", marginTop: 0 }}>Emergency Services Notice</h2>
            <p>
              <strong>FFSC is a spay/neuter clinic, NOT a 24-hour emergency hospital.</strong>
            </p>
            <p>If this is a life-threatening emergency (severe injury, poisoning, hit by car), please direct caller to:</p>
            <div style={{ background: "#f8f9fa", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
              <strong>Pet Care Veterinary Hospital</strong><br />
              <span style={{ fontSize: "1.2rem", color: "#198754" }}>(707) 579-3900</span><br />
              <span style={{ color: "#666" }}>2425 Mendocino Ave, Santa Rosa - Open 24/7</span>
            </div>
            <label style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              padding: "1rem",
              background: formData.emergency_acknowledged ? "#d4edda" : "#fff3cd",
              border: `2px solid ${formData.emergency_acknowledged ? "#198754" : "#ffc107"}`,
              borderRadius: "8px",
              cursor: "pointer",
              marginBottom: "1rem",
            }}>
              <input
                type="checkbox"
                checked={formData.emergency_acknowledged}
                onChange={(e) => updateField("emergency_acknowledged", e.target.checked)}
              />
              <span>
                Caller understands this is NOT a life-threatening emergency and wants FFSC's help.
              </span>
            </label>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => {
                setShowEmergencyModal(false);
                updateField("is_emergency", false);
                updateField("emergency_acknowledged", false);
              }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  if (formData.emergency_acknowledged) {
                    updateField("is_emergency", true);
                    setShowEmergencyModal(false);
                  }
                }}
                disabled={!formData.emergency_acknowledged}
                style={{
                  background: formData.emergency_acknowledged ? "#dc3545" : "#ccc",
                  color: "#fff",
                  border: "none",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "6px",
                  cursor: formData.emergency_acknowledged ? "pointer" : "not-allowed",
                }}
              >
                Continue as Urgent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP: Call Type */}
      {currentStep === "call_type" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "0.5rem" }}>What is this call about?</h2>
          <p style={{ color: "#666", marginBottom: "1rem", fontSize: "0.9rem" }}>
            Select the option that best describes the caller's situation
          </p>

          <div style={{ display: "grid", gap: "0.75rem" }}>
            {CALL_TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  padding: "1rem",
                  border: `2px solid ${formData.call_type === opt.value ? "#0066cc" : "#ddd"}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                  background: formData.call_type === opt.value ? "#e7f1ff" : "#fff",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  name="call_type"
                  value={opt.value}
                  checked={formData.call_type === opt.value}
                  onChange={(e) => updateField("call_type", e.target.value as CallType)}
                  style={{ display: "none" }}
                />
                <span style={{ fontSize: "1.5rem" }}>{opt.icon}</span>
                <span>
                  <strong>{opt.label}</strong>
                  <span style={{ display: "block", fontSize: "0.85rem", color: "#666" }}>{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.call_type && <span style={{ color: "#dc3545", fontSize: "0.85rem" }}>{errors.call_type}</span>}
        </div>
      )}

      {/* STEP: Contact */}
      {currentStep === "contact" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Caller Information</h2>

          {/* Third-party toggle */}
          <div style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: formData.is_third_party_report ? "#fff3cd" : "#f8f9fa",
            border: `1px solid ${formData.is_third_party_report ? "#ffc107" : "#ddd"}`,
            borderRadius: "8px",
          }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.is_third_party_report}
                onChange={(e) => updateField("is_third_party_report", e.target.checked)}
              />
              <span>
                <strong>Third-party report</strong>
                <span style={{ display: "block", fontSize: "0.85rem", color: "#666" }}>
                  Caller is reporting about cats they've seen but don't care for
                </span>
              </span>
            </label>

            {formData.is_third_party_report && (
              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #ffc107" }}>
                <div style={{ marginBottom: "1rem" }}>
                  <label>Relationship</label>
                  <select
                    value={formData.third_party_relationship}
                    onChange={(e) => updateField("third_party_relationship", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="neighbor">Neighbor</option>
                    <option value="family_member">Family member</option>
                    <option value="concerned_citizen">Concerned citizen</option>
                    <option value="volunteer">FFSC Volunteer</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}><strong>Property owner (if known):</strong></p>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={formData.property_owner_name}
                    onChange={(e) => updateField("property_owner_name", e.target.value)}
                    placeholder="Owner's name"
                  />
                  <input
                    type="tel"
                    value={formData.property_owner_phone}
                    onChange={(e) => updateField("property_owner_phone", e.target.value)}
                    placeholder="Owner's phone"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Contact fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label>First Name *</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => updateField("first_name", e.target.value)}
                style={{ borderColor: errors.first_name ? "#dc3545" : undefined }}
              />
              {errors.first_name && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.first_name}</span>}
            </div>
            <div>
              <label>Last Name *</label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => updateField("last_name", e.target.value)}
                style={{ borderColor: errors.last_name ? "#dc3545" : undefined }}
              />
              {errors.last_name && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.last_name}</span>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
            <div>
              <label>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => updateField("email", e.target.value)}
                style={{ borderColor: errors.email ? "#dc3545" : undefined }}
              />
              {errors.email && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.email}</span>}
            </div>
            <div>
              <label>Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => updateField("phone", e.target.value)}
              />
            </div>
          </div>
          <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.5rem" }}>* Email or phone required</p>
        </div>
      )}

      {/* STEP: Location */}
      {currentStep === "location" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Cat Location</h2>

          <div>
            <label>Street Address *</label>
            <input
              type="text"
              value={formData.cats_address}
              onChange={(e) => updateField("cats_address", e.target.value)}
              placeholder="123 Main St"
              style={{ borderColor: errors.cats_address ? "#dc3545" : undefined }}
            />
            {errors.cats_address && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.cats_address}</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
            <input
              type="text"
              value={formData.cats_city}
              onChange={(e) => updateField("cats_city", e.target.value)}
              placeholder="City"
            />
            <input
              type="text"
              value={formData.cats_zip}
              onChange={(e) => updateField("cats_zip", e.target.value)}
              placeholder="ZIP"
            />
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>County</label>
            <select
              value={formData.county}
              onChange={(e) => updateField("county", e.target.value)}
            >
              <option value="">Select...</option>
              <option value="Sonoma">Sonoma</option>
              <option value="Marin">Marin</option>
              <option value="Napa">Napa</option>
              <option value="Mendocino">Mendocino</option>
              <option value="Lake">Lake</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Quick check: is caller at location? */}
          <div style={{ marginTop: "1.5rem", background: "#f8f9fa", padding: "1rem", borderRadius: "8px" }}>
            <div style={{ marginBottom: "1rem" }}>
              <label>Is caller the property owner?</label>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                {["yes", "no", "unsure"].map((v) => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="is_property_owner"
                      value={v}
                      checked={formData.is_property_owner === v}
                      onChange={(e) => updateField("is_property_owner", e.target.value)}
                    />
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label>Do they have access to trap/catch the cats?</label>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                {["yes", "no", "unsure"].map((v) => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="has_property_access"
                      value={v}
                      checked={formData.has_property_access === v}
                      onChange={(e) => updateField("has_property_access", e.target.value)}
                    />
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP: Cat Details - varies by call type */}
      {currentStep === "cat_details" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>
            {formData.call_type === "pet_spay_neuter" && "Pet Details"}
            {formData.call_type === "wellness_check" && "Cat Details"}
            {formData.call_type === "single_stray" && "Stray Cat Details"}
            {formData.call_type === "colony_tnr" && "Colony Details"}
            {formData.call_type === "kitten_rescue" && "Kitten Details"}
            {formData.call_type === "medical_concern" && "Medical Details"}
          </h2>

          {/* PET SPAY/NEUTER path */}
          {formData.call_type === "pet_spay_neuter" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label>Cat's Name</label>
                  <input
                    type="text"
                    value={formData.cat_name}
                    onChange={(e) => updateField("cat_name", e.target.value)}
                    placeholder="Fluffy"
                  />
                </div>
                <div>
                  <label>Description (color, markings)</label>
                  <input
                    type="text"
                    value={formData.cat_description}
                    onChange={(e) => updateField("cat_description", e.target.value)}
                    placeholder="Orange tabby"
                  />
                </div>
              </div>
              <p style={{ fontSize: "0.9rem", background: "#e7f1ff", padding: "0.75rem", borderRadius: "6px" }}>
                Direct caller to schedule spay/neuter appointment via regular booking process.
              </p>
            </>
          )}

          {/* WELLNESS CHECK path */}
          {formData.call_type === "wellness_check" && (
            <>
              <div style={{ marginBottom: "1rem" }}>
                <label>Cat's Name (if known)</label>
                <input
                  type="text"
                  value={formData.cat_name}
                  onChange={(e) => updateField("cat_name", e.target.value)}
                />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label>Description</label>
                <input
                  type="text"
                  value={formData.cat_description}
                  onChange={(e) => updateField("cat_description", e.target.value)}
                  placeholder="Color, markings, ear-tipped?"
                />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={formData.has_medical_concerns}
                    onChange={(e) => updateField("has_medical_concerns", e.target.checked)}
                  />
                  <strong>Cat has medical concerns</strong>
                </label>
              </div>
              {formData.has_medical_concerns && (
                <div style={{ marginBottom: "1rem" }}>
                  <label>Describe the medical concerns *</label>
                  <textarea
                    value={formData.medical_description}
                    onChange={(e) => updateField("medical_description", e.target.value)}
                    placeholder="What symptoms are they seeing? Injury? Illness?"
                    rows={3}
                    style={{ borderColor: errors.medical_description ? "#dc3545" : undefined }}
                  />
                  {errors.medical_description && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.medical_description}</span>}
                </div>
              )}
            </>
          )}

          {/* SINGLE STRAY path */}
          {formData.call_type === "single_stray" && (
            <>
              <div style={{ marginBottom: "1rem" }}>
                <label>Description</label>
                <input
                  type="text"
                  value={formData.cat_description}
                  onChange={(e) => updateField("cat_description", e.target.value)}
                  placeholder="Color, size, any markings"
                />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label>Fixed status</label>
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                  {[
                    { v: "yes_eartip", l: "Yes (ear-tipped)" },
                    { v: "no", l: "No / Not fixed" },
                    { v: "unknown", l: "Don't know" },
                  ].map(({ v, l }) => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="fixed_status"
                        value={v}
                        checked={formData.fixed_status === v}
                        onChange={(e) => updateField("fixed_status", e.target.value)}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>

              {/* HANDLEABILITY - key question */}
              <div style={{ marginBottom: "1rem", background: "#f0f9ff", padding: "1rem", borderRadius: "8px" }}>
                <label><strong>Can the caller handle this cat?</strong></label>
                <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.75rem" }}>
                  This determines if they can bring it in a carrier or if trapping is needed
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {HANDLEABILITY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        padding: "0.5rem",
                        border: `1px solid ${formData.handleability === opt.value ? "#0066cc" : "#ddd"}`,
                        borderRadius: "4px",
                        cursor: "pointer",
                        background: formData.handleability === opt.value ? "#e7f1ff" : "#fff",
                      }}
                    >
                      <input
                        type="radio"
                        name="handleability"
                        value={opt.value}
                        checked={formData.handleability === opt.value}
                        onChange={(e) => updateField("handleability", e.target.value)}
                      />
                      <span>
                        <strong>{opt.label}</strong>
                        <span style={{ display: "block", fontSize: "0.8rem", color: "#666" }}>{opt.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={formData.has_medical_concerns}
                    onChange={(e) => updateField("has_medical_concerns", e.target.checked)}
                  />
                  Cat appears injured or sick
                </label>
              </div>
              {formData.has_medical_concerns && (
                <div style={{ marginBottom: "1rem" }}>
                  <label>Describe the medical concerns</label>
                  <textarea
                    value={formData.medical_description}
                    onChange={(e) => updateField("medical_description", e.target.value)}
                    rows={2}
                  />
                </div>
              )}
            </>
          )}

          {/* COLONY/TNR path */}
          {formData.call_type === "colony_tnr" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label>How many cats?</label>
                  <input
                    type="text"
                    value={formData.cat_count}
                    onChange={(e) => updateField("cat_count", e.target.value)}
                    placeholder="e.g., 5 or 8-10"
                  />
                </div>
                <div>
                  <label>Most seen at once (last week)?</label>
                  <input
                    type="number"
                    value={formData.peak_count}
                    onChange={(e) => updateField("peak_count", e.target.value)}
                    placeholder="Peak count"
                  />
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>How many are already ear-tipped?</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="number"
                    value={formData.eartip_count}
                    onChange={(e) => updateField("eartip_count", e.target.value)}
                    placeholder="0"
                    style={{ maxWidth: "80px" }}
                  />
                  <span style={{ color: "#666" }}>cats with ear tips</span>
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>Feeding situation</label>
                <select
                  value={formData.feeding_situation}
                  onChange={(e) => updateField("feeding_situation", e.target.value)}
                >
                  <option value="">Select...</option>
                  <option value="caller_feeds_daily">Caller feeds daily</option>
                  <option value="caller_feeds_sometimes">Caller feeds sometimes</option>
                  <option value="someone_else_feeds">Someone else feeds them</option>
                  <option value="no_feeding">No regular feeding</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>

              {/* HANDLEABILITY for colony */}
              <div style={{ marginBottom: "1rem", background: "#f0f9ff", padding: "1rem", borderRadius: "8px" }}>
                <label><strong>Are any cats handleable?</strong></label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {[
                    { v: "some_friendly", l: "Some are friendly (can be carried)" },
                    { v: "all_feral", l: "All are feral (need traps)" },
                    { v: "unknown", l: "Unknown / varies" },
                  ].map(({ v, l }) => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="handleability"
                        value={v}
                        checked={formData.handleability === v}
                        onChange={(e) => updateField("handleability", e.target.value)}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={formData.has_medical_concerns}
                    onChange={(e) => updateField("has_medical_concerns", e.target.checked)}
                  />
                  Any cats appear injured or sick
                </label>
              </div>
              {formData.has_medical_concerns && (
                <div style={{ marginTop: "0.5rem" }}>
                  <textarea
                    value={formData.medical_description}
                    onChange={(e) => updateField("medical_description", e.target.value)}
                    placeholder="Describe which cats and what concerns..."
                    rows={2}
                  />
                </div>
              )}
            </>
          )}

          {/* KITTEN RESCUE path */}
          {formData.call_type === "kitten_rescue" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label>How many kittens?</label>
                  <input
                    type="number"
                    value={formData.kitten_count}
                    onChange={(e) => updateField("kitten_count", e.target.value)}
                    min="1"
                  />
                </div>
                <div>
                  <label>Approximate age</label>
                  <select
                    value={formData.kitten_age}
                    onChange={(e) => updateField("kitten_age", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="under_4_weeks">Under 4 weeks (bottle babies)</option>
                    <option value="4_to_8_weeks">4-8 weeks (weaning)</option>
                    <option value="8_to_12_weeks">8-12 weeks</option>
                    <option value="over_12_weeks">Over 12 weeks</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>Socialization</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {[
                    { v: "friendly", l: "Friendly - can be handled" },
                    { v: "shy_handleable", l: "Shy but handleable" },
                    { v: "feral", l: "Feral - hissy/scared, hard to handle" },
                    { v: "unknown", l: "Unknown" },
                  ].map(({ v, l }) => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="kitten_socialization"
                        value={v}
                        checked={formData.kitten_socialization === v}
                        onChange={(e) => updateField("kitten_socialization", e.target.value)}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>Is mom cat present?</label>
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                  {["yes", "no", "unsure"].map((v) => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="mom_present"
                        value={v}
                        checked={formData.mom_present === v}
                        onChange={(e) => updateField("mom_present", e.target.value)}
                      />
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ background: "#fff3cd", padding: "0.75rem", borderRadius: "6px", fontSize: "0.9rem" }}>
                <strong>Note:</strong> Foster space is limited. Assess age, socialization, and whether kittens are contained before promising foster placement.
              </div>
            </>
          )}

          {/* MEDICAL CONCERN path */}
          {formData.call_type === "medical_concern" && (
            <>
              {/* Emergency toggle */}
              <div
                onClick={() => {
                  if (!formData.is_emergency) {
                    setShowEmergencyModal(true);
                  } else {
                    updateField("is_emergency", false);
                    updateField("emergency_acknowledged", false);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "1rem",
                  background: formData.is_emergency ? "#f8d7da" : "#f8f9fa",
                  border: `2px solid ${formData.is_emergency ? "#dc3545" : "#ddd"}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                  marginBottom: "1rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.is_emergency}
                  onChange={() => {}}
                  style={{ pointerEvents: "none" }}
                />
                <span>
                  <strong>This is an urgent/emergency situation</strong>
                  <span style={{ display: "block", fontSize: "0.85rem", color: "#666" }}>
                    Severe injury, active labor, or immediate danger
                  </span>
                </span>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>Description of cat</label>
                <input
                  type="text"
                  value={formData.cat_description}
                  onChange={(e) => updateField("cat_description", e.target.value)}
                  placeholder="Color, markings, owned or stray?"
                />
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label><strong>Describe the medical concerns *</strong></label>
                <textarea
                  value={formData.medical_description}
                  onChange={(e) => {
                    updateField("medical_description", e.target.value);
                    updateField("has_medical_concerns", true);
                  }}
                  placeholder="What are they seeing? Injury? Illness symptoms? How long?"
                  rows={4}
                  style={{ borderColor: errors.medical_description ? "#dc3545" : undefined }}
                />
                {errors.medical_description && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.medical_description}</span>}
              </div>

              {/* Handleability */}
              <div style={{ background: "#f0f9ff", padding: "1rem", borderRadius: "8px" }}>
                <label><strong>Can the caller handle this cat?</strong></label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {HANDLEABILITY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="handleability"
                        value={opt.value}
                        checked={formData.handleability === opt.value}
                        onChange={(e) => updateField("handleability", e.target.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Custom Fields - rendered dynamically from admin config */}
          {customFields.length > 0 && (
            <div style={{
              marginTop: "1.5rem",
              padding: "1rem",
              background: "#f8f9fa",
              borderRadius: "8px",
              border: "1px solid #ddd",
            }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Additional Questions</h3>
              {customFields.map(field => renderCustomField(field))}
            </div>
          )}

          {/* Notes field - shown for all call types */}
          <div style={{ marginTop: "1.5rem" }}>
            <label>Additional Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Any other relevant details from the call..."
              rows={3}
            />
          </div>
        </div>
      )}

      {/* STEP: Situation (only for colony/TNR) */}
      {currentStep === "situation" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Property & Access</h2>

          <div style={{ marginBottom: "1rem" }}>
            <label>Is caller the property owner?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {["yes", "no"].map((v) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="is_property_owner_2"
                    value={v}
                    checked={formData.is_property_owner === v}
                    onChange={(e) => updateField("is_property_owner", e.target.value)}
                  />
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label>Do they have access to where cats congregate?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {["yes", "no", "need_permission"].map((v) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="has_property_access_2"
                    value={v}
                    checked={formData.has_property_access === v}
                    onChange={(e) => updateField("has_property_access", e.target.value)}
                  />
                  {v === "need_permission" ? "Need permission" : v.charAt(0).toUpperCase() + v.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label>How did they hear about us?</label>
            <select
              value={formData.referral_source}
              onChange={(e) => updateField("referral_source", e.target.value)}
            >
              <option value="">Select...</option>
              <option value="search">Online search</option>
              <option value="social">Social media</option>
              <option value="friend">Friend/family</option>
              <option value="shelter">Animal shelter</option>
              <option value="vet">Veterinarian</option>
              <option value="repeat">Previous experience</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      )}

      {/* STEP: Review */}
      {currentStep === "review" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Review & Submit</h2>

          {/* Call type badge */}
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "#e7f1ff",
            borderRadius: "20px",
            marginBottom: "1rem",
          }}>
            <span>{CALL_TYPE_OPTIONS.find(o => o.value === formData.call_type)?.icon}</span>
            <strong>{CALL_TYPE_OPTIONS.find(o => o.value === formData.call_type)?.label}</strong>
          </div>

          {/* Third-party warning */}
          {formData.is_third_party_report && (
            <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem" }}>
              <strong>THIRD-PARTY REPORT</strong> - Will need to contact property owner
            </div>
          )}

          {/* Emergency flag */}
          {formData.is_emergency && (
            <div style={{ background: "#f8d7da", border: "1px solid #dc3545", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem" }}>
              <strong>URGENT REQUEST</strong> - Prioritize follow-up
            </div>
          )}

          {/* Summary sections */}
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ background: "#f8f9fa", padding: "1rem", borderRadius: "8px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>CONTACT</h4>
              <p style={{ margin: 0 }}><strong>{formData.first_name} {formData.last_name}</strong></p>
              {formData.email && <p style={{ margin: 0 }}>{formData.email}</p>}
              {formData.phone && <p style={{ margin: 0 }}>{formData.phone}</p>}
            </div>

            <div style={{ background: "#f8f9fa", padding: "1rem", borderRadius: "8px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>LOCATION</h4>
              <p style={{ margin: 0 }}>{formData.cats_address}</p>
              {formData.cats_city && <p style={{ margin: 0 }}>{formData.cats_city}{formData.cats_zip && `, ${formData.cats_zip}`}</p>}
              {formData.county && <p style={{ margin: 0 }}>{formData.county} County</p>}
              {formData.is_property_owner && <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem", color: "#666" }}>Property owner: {formData.is_property_owner}</p>}
            </div>

            <div style={{ background: "#f8f9fa", padding: "1rem", borderRadius: "8px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>DETAILS</h4>
              {formData.cat_name && <p style={{ margin: 0 }}><strong>Name:</strong> {formData.cat_name}</p>}
              {formData.cat_description && <p style={{ margin: 0 }}><strong>Description:</strong> {formData.cat_description}</p>}
              {formData.call_type === "colony_tnr" && (
                <>
                  <p style={{ margin: 0 }}><strong>Count:</strong> {formData.cat_count || "Unknown"}</p>
                  {formData.peak_count && <p style={{ margin: 0 }}><strong>Peak seen:</strong> {formData.peak_count}</p>}
                  {formData.eartip_count && <p style={{ margin: 0 }}><strong>Ear-tipped:</strong> {formData.eartip_count}</p>}
                </>
              )}
              {formData.call_type === "kitten_rescue" && (
                <>
                  <p style={{ margin: 0 }}><strong>Kitten count:</strong> {formData.kitten_count || "Unknown"}</p>
                  {formData.kitten_age && <p style={{ margin: 0 }}><strong>Age:</strong> {formData.kitten_age.replace(/_/g, " ")}</p>}
                  {formData.kitten_socialization && <p style={{ margin: 0 }}><strong>Socialization:</strong> {formData.kitten_socialization}</p>}
                  {formData.mom_present && <p style={{ margin: 0 }}><strong>Mom present:</strong> {formData.mom_present}</p>}
                </>
              )}
              {formData.handleability && (
                <p style={{ margin: "0.5rem 0 0 0" }}>
                  <strong>Handleability:</strong> {HANDLEABILITY_OPTIONS.find(o => o.value === formData.handleability)?.label || formData.handleability}
                </p>
              )}
            </div>

            {(formData.has_medical_concerns || formData.medical_description) && (
              <div style={{ background: "#f8d7da", padding: "1rem", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#842029" }}>MEDICAL CONCERNS</h4>
                <p style={{ margin: 0 }}>{formData.medical_description || "Flagged as medical concern"}</p>
              </div>
            )}

            {formData.notes && (
              <div style={{ background: "#f8f9fa", padding: "1rem", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>NOTES</h4>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{formData.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {currentStep !== "call_type" && (
            <button onClick={prevStep} style={{ padding: "0.75rem 1.5rem" }}>
              Back
            </button>
          )}
          {!isPreview && currentStep !== "call_type" && (
            <button
              onClick={saveDraft}
              style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid #ddd", fontSize: "0.85rem" }}
            >
              Save Draft
            </button>
          )}
        </div>

        {currentStep !== "review" ? (
          <button
            onClick={nextStep}
            style={{
              padding: "0.75rem 1.5rem",
              background: "#0066cc",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
            }}
          >
            Continue
          </button>
        ) : isPreview ? (
          <span style={{ color: "#666", fontStyle: "italic" }}>Preview mode</span>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: "0.75rem 2rem",
              background: "#198754",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: submitting ? "wait" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function IntakePage() {
  return (
    <Suspense fallback={
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "1rem", textAlign: "center" }}>
        Loading...
      </div>
    }>
      <IntakeForm />
    </Suspense>
  );
}
