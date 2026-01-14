"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type Step = "contact" | "location" | "cats" | "situation" | "review";

interface FormData {
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

  // Cats
  ownership_status: string;
  cat_count_estimate: string;
  cat_count_text: string;
  fixed_status: string;
  has_kittens: string;
  kitten_count: string;
  kitten_age_estimate: string;
  kitten_age_weeks: string;
  kitten_mixed_ages: string;
  kitten_mixed_ages_description: string;
  kitten_behavior: string;
  kitten_contained: string;
  mom_present: string;
  mom_fixed: string;
  can_bring_in: string;
  kitten_notes: string;
  awareness_duration: string;

  // Situation
  has_medical_concerns: string;
  medical_description: string;
  is_emergency: boolean;
  cats_being_fed: string;
  feeder_info: string;
  has_property_access: string;
  access_notes: string;
  is_property_owner: string;
  situation_description: string;
  referral_source: string;
}

const initialFormData: FormData = {
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
  ownership_status: "",
  cat_count_estimate: "",
  cat_count_text: "",
  fixed_status: "",
  has_kittens: "",
  kitten_count: "",
  kitten_age_estimate: "",
  kitten_age_weeks: "",
  kitten_mixed_ages: "",
  kitten_mixed_ages_description: "",
  kitten_behavior: "",
  kitten_contained: "",
  mom_present: "",
  mom_fixed: "",
  can_bring_in: "",
  kitten_notes: "",
  awareness_duration: "",
  has_medical_concerns: "",
  medical_description: "",
  is_emergency: false,
  cats_being_fed: "",
  feeder_info: "",
  has_property_access: "",
  access_notes: "",
  is_property_owner: "",
  situation_description: "",
  referral_source: "",
};

const steps: Step[] = ["contact", "location", "cats", "situation", "review"];

const DRAFT_KEY = "atlas_intake_draft";

function IntakeForm() {
  const searchParams = useSearchParams();
  const isPreview = searchParams.get("preview") === "true";

  const [currentStep, setCurrentStep] = useState<Step>("contact");
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

  // Save draft to localStorage
  const saveDraft = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        formData,
        currentStep,
        savedAt: new Date().toISOString(),
      }));
      alert("Draft saved! You can return later to complete your submission.");
    }
  };

  // Load draft from localStorage
  const loadDraft = () => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          setFormData(draft.formData);
          setCurrentStep(draft.currentStep || "contact");
          setHasDraft(false);
          alert("Draft loaded!");
        } catch {
          alert("Could not load draft");
        }
      }
    }
  };

  // Clear draft
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

    if (step === "contact") {
      if (!formData.first_name.trim()) newErrors.first_name = "First name is required";
      if (!formData.last_name.trim()) newErrors.last_name = "Last name is required";
      if (!formData.email.trim()) newErrors.email = "Email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        newErrors.email = "Please enter a valid email address";
      }
    }

    if (step === "location") {
      if (!formData.cats_address.trim()) newErrors.cats_address = "Cat location address is required";
    }

    if (step === "cats") {
      if (!formData.ownership_status) newErrors.ownership_status = "Please select the cat's ownership status";
      if (!formData.fixed_status) newErrors.fixed_status = "Please indicate if the cats are fixed";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const nextStep = () => {
    // Skip validation in preview mode
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
    if (!validateStep("review")) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
          phone: formData.phone || undefined,
          requester_address: formData.requester_address || undefined,
          requester_city: formData.requester_city || undefined,
          requester_zip: formData.requester_zip || undefined,
          // Third-party report fields
          is_third_party_report: formData.is_third_party_report,
          third_party_relationship: formData.third_party_relationship || undefined,
          property_owner_name: formData.property_owner_name || undefined,
          property_owner_phone: formData.property_owner_phone || undefined,
          property_owner_email: formData.property_owner_email || undefined,
          cats_address: formData.cats_address,
          cats_city: formData.cats_city || undefined,
          cats_zip: formData.cats_zip || undefined,
          county: formData.county || undefined,
          ownership_status: formData.ownership_status,
          cat_count_estimate: formData.cat_count_estimate ? parseInt(formData.cat_count_estimate) : undefined,
          cat_count_text: formData.cat_count_text || undefined,
          fixed_status: formData.fixed_status,
          has_kittens: formData.has_kittens === "yes" ? true : formData.has_kittens === "no" ? false : undefined,
          kitten_count: formData.kitten_count ? parseInt(formData.kitten_count) : undefined,
          kitten_age_estimate: formData.kitten_age_estimate || undefined,
          kitten_mixed_ages_description: formData.kitten_mixed_ages_description || undefined,
          kitten_behavior: formData.kitten_behavior || undefined,
          kitten_contained: formData.kitten_contained || undefined,
          mom_present: formData.mom_present || undefined,
          mom_fixed: formData.mom_fixed || undefined,
          can_bring_in: formData.can_bring_in || undefined,
          kitten_notes: formData.kitten_notes || undefined,
          awareness_duration: formData.awareness_duration || undefined,
          has_medical_concerns: formData.has_medical_concerns === "yes" ? true : formData.has_medical_concerns === "no" ? false : undefined,
          medical_description: formData.medical_description || undefined,
          is_emergency: formData.is_emergency,
          cats_being_fed: formData.cats_being_fed === "yes" ? true : formData.cats_being_fed === "no" ? false : undefined,
          feeder_info: formData.feeder_info || undefined,
          has_property_access: formData.has_property_access === "yes" ? true : formData.has_property_access === "no" ? false : undefined,
          access_notes: formData.access_notes || undefined,
          is_property_owner: formData.is_property_owner === "yes" ? true : formData.is_property_owner === "no" ? false : undefined,
          situation_description: formData.situation_description || undefined,
          referral_source: formData.referral_source || undefined,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSubmitted(true);
        setSubmitResult({
          success: true,
          message: result.message,
          triage_category: result.triage_category,
        });
      } else {
        setSubmitResult({
          success: false,
          message: result.error || "Something went wrong. Please try again.",
        });
      }
    } catch (err) {
      console.error("Submit error:", err);
      setSubmitResult({
        success: false,
        message: "Network error. Please check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Show success message after submission
  if (submitted && submitResult?.success) {
    return (
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2rem" }}>
        <div
          style={{
            background: "var(--success-bg)",
            border: "1px solid var(--success-border)",
            borderRadius: "8px",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "var(--success-text)", marginBottom: "1rem" }}>Request Submitted!</h2>
          <p style={{ color: "var(--success-text)", marginBottom: "1.5rem" }}>{submitResult.message}</p>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            A confirmation email has been sent to <strong>{formData.email}</strong>
          </p>
        </div>
      </div>
    );
  }

  const stepIndex = steps.indexOf(currentStep);
  const progress = ((stepIndex + 1) / steps.length) * 100;

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "1rem" }}>
      {/* Preview Mode Banner */}
      {isPreview && (
        <div style={{
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          borderRadius: "8px",
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          textAlign: "center",
          color: "var(--warning-text)",
        }}>
          <strong>Preview Mode</strong> - Validation disabled. Form will not submit.
          <a href="/intake" style={{ marginLeft: "1rem" }}>Exit Preview</a>
        </div>
      )}

      {/* Draft Available Banner */}
      {hasDraft && !isPreview && (
        <div style={{
          background: "var(--info-bg)",
          border: "1px solid var(--info-border)",
          borderRadius: "8px",
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "var(--info-text)",
        }}>
          <span>You have a saved draft.</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={loadDraft} style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem" }}>
              Load Draft
            </button>
            <button onClick={clearDraft} style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)" }}>
              Discard
            </button>
          </div>
        </div>
      )}

      <h1 style={{ textAlign: "center", marginBottom: "0.5rem" }}>Request Services</h1>
      <p style={{ textAlign: "center", color: "var(--muted)", marginBottom: "2rem" }}>
        Help us help the cats in your community
      </p>

      {/* Progress Bar */}
      <div style={{ marginBottom: "2rem" }}>
        <div
          style={{
            height: "8px",
            background: "var(--border)",
            borderRadius: "4px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: "var(--primary)",
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          <span>Step {stepIndex + 1} of {steps.length}</span>
          <span>{currentStep.charAt(0).toUpperCase() + currentStep.slice(1)}</span>
        </div>
      </div>

      {/* Error message */}
      {submitResult && !submitResult.success && (
        <div
          style={{
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
            color: "var(--danger-text)",
          }}
        >
          {submitResult.message}
        </div>
      )}

      {/* Step: Contact */}
      {currentStep === "contact" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Your Contact Information</h2>

          {/* Third-party report option */}
          <div style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: formData.is_third_party_report ? "var(--warning-bg)" : "var(--section-bg)",
            border: formData.is_third_party_report ? "2px solid var(--warning-border)" : "1px solid var(--card-border)",
            borderRadius: "8px",
            color: formData.is_third_party_report ? "var(--warning-text)" : "var(--foreground)",
          }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.is_third_party_report}
                onChange={(e) => updateField("is_third_party_report", e.target.checked)}
                style={{ marginTop: "0.25rem" }}
              />
              <span>
                <strong>I'm reporting on behalf of someone else</strong>
                <span style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  Check this if you're a volunteer, neighbor, or concerned citizen reporting about cats you've heard about.
                  We'll need to contact the property owner to get permission before proceeding.
                </span>
              </span>
            </label>

            {formData.is_third_party_report && (
              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #ffc107" }}>
                <p style={{ color: "var(--warning-text)", marginBottom: "1rem", fontSize: "0.9rem" }}>
                  <strong>Note:</strong> Third-party reports require follow-up with the property owner before we can schedule services.
                </p>

                <div style={{ marginBottom: "1rem" }}>
                  <label>Your relationship to this situation</label>
                  <select
                    value={formData.third_party_relationship}
                    onChange={(e) => updateField("third_party_relationship", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="volunteer">FFSC Volunteer</option>
                    <option value="neighbor">Neighbor</option>
                    <option value="family_member">Family member of property owner</option>
                    <option value="concerned_citizen">Concerned citizen</option>
                    <option value="rescue_worker">Rescue/animal welfare worker</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div style={{ background: "var(--card-bg)", padding: "1rem", borderRadius: "6px", marginTop: "1rem" }}>
                  <p style={{ fontWeight: "bold", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
                    Property owner contact (if known)
                  </p>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <input
                      type="text"
                      value={formData.property_owner_name}
                      onChange={(e) => updateField("property_owner_name", e.target.value)}
                      placeholder="Property owner's name"
                    />
                    <input
                      type="tel"
                      value={formData.property_owner_phone}
                      onChange={(e) => updateField("property_owner_phone", e.target.value)}
                      placeholder="Property owner's phone"
                    />
                    <input
                      type="email"
                      value={formData.property_owner_email}
                      onChange={(e) => updateField("property_owner_email", e.target.value)}
                      placeholder="Property owner's email"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label>First Name *</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => updateField("first_name", e.target.value)}
                placeholder="First name"
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
                placeholder="Last name"
                style={{ borderColor: errors.last_name ? "#dc3545" : undefined }}
              />
              {errors.last_name && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.last_name}</span>}
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Email Address *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="your.email@example.com"
              style={{ borderColor: errors.email ? "#dc3545" : undefined }}
            />
            {errors.email && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.email}</span>}
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Phone Number (optional but recommended)</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>Your Address (optional)</label>
            <input
              type="text"
              value={formData.requester_address}
              onChange={(e) => updateField("requester_address", e.target.value)}
              placeholder="123 Main St"
            />
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
              <input
                type="text"
                value={formData.requester_city}
                onChange={(e) => updateField("requester_city", e.target.value)}
                placeholder="City"
              />
              <input
                type="text"
                value={formData.requester_zip}
                onChange={(e) => updateField("requester_zip", e.target.value)}
                placeholder="ZIP"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step: Location */}
      {currentStep === "location" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Where Are the Cats Located?</h2>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.same_as_requester}
                onChange={(e) => {
                  updateField("same_as_requester", e.target.checked);
                  if (e.target.checked) {
                    updateField("cats_address", formData.requester_address);
                    updateField("cats_city", formData.requester_city);
                    updateField("cats_zip", formData.requester_zip);
                  }
                }}
              />
              Same as my address
            </label>
          </div>

          <div>
            <label>Street Address Where Cats Are *</label>
            <input
              type="text"
              value={formData.cats_address}
              onChange={(e) => updateField("cats_address", e.target.value)}
              placeholder="123 Cat Colony Lane"
              disabled={formData.same_as_requester}
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
              disabled={formData.same_as_requester}
            />
            <input
              type="text"
              value={formData.cats_zip}
              onChange={(e) => updateField("cats_zip", e.target.value)}
              placeholder="ZIP"
              disabled={formData.same_as_requester}
            />
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label>County</label>
            <select
              value={formData.county}
              onChange={(e) => updateField("county", e.target.value)}
            >
              <option value="">Select county...</option>
              <option value="Sonoma">Sonoma County</option>
              <option value="Marin">Marin County</option>
              <option value="Napa">Napa County</option>
              <option value="Mendocino">Mendocino County</option>
              <option value="Lake">Lake County</option>
              <option value="other">Other</option>
            </select>
            {formData.county && formData.county !== "Sonoma" && (
              <p style={{ color: "var(--warning-text)", background: "var(--warning-bg)", padding: "0.75rem", borderRadius: "4px", marginTop: "0.5rem", fontSize: "0.9rem" }}>
                Note: Our primary service area is Sonoma County. We may have limited availability for other areas.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step: Cats */}
      {currentStep === "cats" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Tell Us About the Cats</h2>

          <div style={{ marginBottom: "1.5rem" }}>
            <label>What best describes these cats? *</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              {[
                { value: "unknown_stray", label: "Unknown/stray cats I've been seeing in the area" },
                { value: "community_colony", label: "Community cats that someone feeds" },
                { value: "my_cat", label: "My own pet cat(s)" },
                { value: "neighbors_cat", label: "A neighbor's cat(s)" },
                { value: "unsure", label: "I'm not sure" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.75rem",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: formData.ownership_status === opt.value ? "#e7f1ff" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="ownership_status"
                    value={opt.value}
                    checked={formData.ownership_status === opt.value}
                    onChange={(e) => updateField("ownership_status", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {errors.ownership_status && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.ownership_status}</span>}
          </div>

          {/* Show owned cat notice */}
          {formData.ownership_status === "my_cat" && (
            <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderRadius: "8px", padding: "1rem", marginBottom: "1.5rem" }}>
              <strong>For Owned Cats:</strong>
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                Our organization primarily focuses on community (unowned) cats. For owned pets, we recommend:
              </p>
              <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
                <li>Your regular veterinarian</li>
                <li>Sonoma County low-cost spay/neuter clinics</li>
                <li>SNAP Spay Neuter Assistance Program</li>
              </ul>
              <p style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.9rem" }}>
                You may continue this form if you'd like us to follow up, but please note response times may be longer.
              </p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <label>How many cats?</label>
              <input
                type="number"
                min="1"
                value={formData.cat_count_estimate}
                onChange={(e) => updateField("cat_count_estimate", e.target.value)}
                placeholder="Number of cats"
              />
            </div>
            <div>
              <label>Or describe if unsure</label>
              <input
                type="text"
                value={formData.cat_count_text}
                onChange={(e) => updateField("cat_count_text", e.target.value)}
                placeholder='e.g., "5-10" or "too many to count"'
              />
            </div>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label>Are any of the cats already fixed (ear-tipped)? *</label>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              Fixed cats usually have a small notch in their left ear (ear-tip)
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {[
                { value: "none_fixed", label: "None appear to be fixed (no ear tips visible)" },
                { value: "some_fixed", label: "Some have ear tips, some don't" },
                { value: "most_fixed", label: "Most/all have ear tips" },
                { value: "all_fixed", label: "All are ear-tipped (just need wellness care)" },
                { value: "unknown", label: "I can't tell / haven't checked" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="fixed_status"
                    value={opt.value}
                    checked={formData.fixed_status === opt.value}
                    onChange={(e) => updateField("fixed_status", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {errors.fixed_status && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.fixed_status}</span>}
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label>Are there any kittens?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
                { value: "unsure", label: "Not sure" },
              ].map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="has_kittens"
                    value={opt.value}
                    checked={formData.has_kittens === opt.value}
                    onChange={(e) => updateField("has_kittens", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {formData.has_kittens === "yes" && (
            <div style={{ background: "var(--section-bg)", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
              <h4 style={{ marginTop: 0, marginBottom: "1rem" }}>Kitten Details</h4>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label>How many kittens?</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.kitten_count}
                    onChange={(e) => updateField("kitten_count", e.target.value)}
                    placeholder="Number"
                  />
                </div>
                <div>
                  <label>Approximate age</label>
                  <select
                    value={formData.kitten_age_estimate}
                    onChange={(e) => updateField("kitten_age_estimate", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="under_4_weeks">Under 4 weeks (bottle babies)</option>
                    <option value="4_to_8_weeks">4-8 weeks (weaning)</option>
                    <option value="8_to_12_weeks">8-12 weeks (ideal foster age)</option>
                    <option value="12_to_16_weeks">12-16 weeks (socialization critical)</option>
                    <option value="over_16_weeks">Over 16 weeks / 4+ months</option>
                    <option value="mixed">Mixed ages (different litters)</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>

              {formData.kitten_age_estimate === "mixed" && (
                <div style={{ marginBottom: "1rem" }}>
                  <label>Describe the ages (e.g., "3 at ~8 weeks, 2 at ~6 months")</label>
                  <input
                    type="text"
                    value={formData.kitten_mixed_ages_description}
                    onChange={(e) => updateField("kitten_mixed_ages_description", e.target.value)}
                    placeholder="Describe the different ages..."
                  />
                </div>
              )}

              <div style={{ marginBottom: "1rem" }}>
                <label>Kitten behavior/socialization</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {[
                    { value: "friendly", label: "Friendly - can be handled, approaches people" },
                    { value: "shy_handleable", label: "Shy but handleable - scared but can be picked up" },
                    { value: "feral_young", label: "Feral but young - hissy/scared, may be socializable" },
                    { value: "feral_older", label: "Feral and older - very scared, hard to handle" },
                    { value: "unknown", label: "Unknown - haven't been able to assess" },
                  ].map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="kitten_behavior"
                        value={opt.value}
                        checked={formData.kitten_behavior === opt.value}
                        onChange={(e) => updateField("kitten_behavior", e.target.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label>Are the kittens contained/caught?</label>
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "some", label: "Some" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="kitten_contained"
                          value={opt.value}
                          checked={formData.kitten_contained === opt.value}
                          onChange={(e) => updateField("kitten_contained", e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label>Is the mom cat present?</label>
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "unsure", label: "Unsure" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="mom_present"
                          value={opt.value}
                          checked={formData.mom_present === opt.value}
                          onChange={(e) => updateField("mom_present", e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {formData.mom_present === "yes" && (
                <div style={{ marginBottom: "1rem" }}>
                  <label>Is the mom cat fixed (ear-tipped)?</label>
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "unsure", label: "Unsure" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="mom_fixed"
                          value={opt.value}
                          checked={formData.mom_fixed === opt.value}
                          onChange={(e) => updateField("mom_fixed", e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "1rem" }}>
                <label>Can you bring the kittens (and mom if present) to us for assessment?</label>
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                  {[
                    { value: "yes", label: "Yes" },
                    { value: "need_help", label: "Need help trapping" },
                    { value: "no", label: "No" },
                  ].map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="can_bring_in"
                        value={opt.value}
                        checked={formData.can_bring_in === opt.value}
                        onChange={(e) => updateField("can_bring_in", e.target.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label>Any other details about the kittens?</label>
                <textarea
                  value={formData.kitten_notes}
                  onChange={(e) => updateField("kitten_notes", e.target.value)}
                  placeholder="Colors, where they hide, feeding schedule, trap-savvy, etc..."
                  rows={2}
                />
              </div>

              <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderRadius: "6px", padding: "0.75rem", marginTop: "1rem", fontSize: "0.85rem" }}>
                <strong style={{ color: "var(--warning-text)" }}>Note about kittens:</strong>
                <p style={{ margin: "0.5rem 0 0 0", color: "var(--warning-text)" }}>
                  Our foster program prioritizes kittens based on age, socialization, and ease of intake.
                  Kittens under 12 weeks with friendly behavior and a spayed mom are ideal.
                  Foster space is limited and not guaranteed until day of assessment.
                </p>
              </div>
            </div>
          )}

          <div>
            <label>How long have you been aware of these cats?</label>
            <select
              value={formData.awareness_duration}
              onChange={(e) => updateField("awareness_duration", e.target.value)}
            >
              <option value="">Select...</option>
              <option value="under_1_week">Less than a week</option>
              <option value="under_1_month">Less than a month</option>
              <option value="1_to_6_months">1-6 months</option>
              <option value="6_to_12_months">6-12 months</option>
              <option value="over_1_year">Over a year</option>
              <option value="unknown">Not sure</option>
            </select>
          </div>
        </div>
      )}

      {/* Step: Situation */}
      {currentStep === "situation" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Situation Details</h2>

          {/* Emergency flag */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "1rem",
                background: formData.is_emergency ? "#f8d7da" : "#f8f9fa",
                border: formData.is_emergency ? "2px solid #dc3545" : "1px solid var(--card-border)",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={formData.is_emergency}
                onChange={(e) => updateField("is_emergency", e.target.checked)}
              />
              <span>
                <strong>This is an emergency</strong>
                <span style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)" }}>
                  Injured cat, active labor, or immediate danger
                </span>
              </span>
            </label>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label>Do any of the cats appear injured or sick?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
                { value: "unsure", label: "Not sure" },
              ].map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="has_medical_concerns"
                    value={opt.value}
                    checked={formData.has_medical_concerns === opt.value}
                    onChange={(e) => updateField("has_medical_concerns", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {formData.has_medical_concerns === "yes" && (
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Please describe the medical concerns</label>
              <textarea
                value={formData.medical_description}
                onChange={(e) => updateField("medical_description", e.target.value)}
                placeholder="Describe any injuries, illness symptoms, or concerns..."
                rows={3}
              />
            </div>
          )}

          <div style={{ marginBottom: "1.5rem" }}>
            <label>Are the cats being fed by someone?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
                { value: "unsure", label: "Not sure" },
              ].map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="cats_being_fed"
                    value={opt.value}
                    checked={formData.cats_being_fed === opt.value}
                    onChange={(e) => updateField("cats_being_fed", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {formData.cats_being_fed === "yes" && (
            <div style={{ marginBottom: "1.5rem" }}>
              <label>Who feeds them and when?</label>
              <input
                type="text"
                value={formData.feeder_info}
                onChange={(e) => updateField("feeder_info", e.target.value)}
                placeholder='e.g., "I feed them every morning" or "Neighbor feeds at dusk"'
              />
            </div>
          )}

          <div style={{ marginBottom: "1.5rem" }}>
            <label>Do you have permission to access the property where the cats are?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
                { value: "unsure", label: "Need to check" },
              ].map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="has_property_access"
                    value={opt.value}
                    checked={formData.has_property_access === opt.value}
                    onChange={(e) => updateField("has_property_access", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label>Are you the property owner?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ].map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="is_property_owner"
                    value={opt.value}
                    checked={formData.is_property_owner === opt.value}
                    onChange={(e) => updateField("is_property_owner", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label>Please describe the situation (optional)</label>
            <textarea
              value={formData.situation_description}
              onChange={(e) => updateField("situation_description", e.target.value)}
              placeholder="Any additional details that would help us understand the situation..."
              rows={4}
            />
          </div>

          <div>
            <label>How did you hear about us?</label>
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
              <option value="repeat">Previous experience with us</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      )}

      {/* Step: Review */}
      {currentStep === "review" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Review Your Request</h2>

          {/* Third-party report warning banner */}
          {formData.is_third_party_report && (
            <div style={{
              background: "var(--warning-bg)",
              border: "2px solid #ffc107",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1rem",
            }}>
              <strong style={{ color: "var(--warning-text)" }}>THIRD-PARTY REPORT</strong>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem", color: "var(--warning-text)" }}>
                You are reporting on behalf of someone else
                {formData.third_party_relationship && ` (${formData.third_party_relationship.replace(/_/g, " ")})`}.
                Staff will need to contact the property owner before scheduling services.
              </p>
              {(formData.property_owner_name || formData.property_owner_phone || formData.property_owner_email) && (
                <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #ffc107" }}>
                  <strong style={{ fontSize: "0.85rem" }}>Property owner contact:</strong>
                  <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.9rem" }}>
                    {formData.property_owner_name && <span>{formData.property_owner_name}<br /></span>}
                    {formData.property_owner_phone && <span>{formData.property_owner_phone}<br /></span>}
                    {formData.property_owner_email && <span>{formData.property_owner_email}</span>}
                  </p>
                </div>
              )}
            </div>
          )}

          <div style={{ background: "var(--section-bg)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>Contact</h3>
            <p><strong>{formData.first_name} {formData.last_name}</strong></p>
            <p>{formData.email}</p>
            {formData.phone && <p>{formData.phone}</p>}
          </div>

          <div style={{ background: "var(--section-bg)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>Cat Location</h3>
            <p>{formData.cats_address}</p>
            {formData.cats_city && <p>{formData.cats_city}{formData.cats_zip && `, ${formData.cats_zip}`}</p>}
            {formData.county && <p>{formData.county} County</p>}
          </div>

          <div style={{ background: "var(--section-bg)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>About the Cats</h3>
            <p><strong>Type:</strong> {formData.ownership_status.replace(/_/g, " ")}</p>
            <p><strong>Count:</strong> {formData.cat_count_estimate || formData.cat_count_text || "Not specified"}</p>
            <p><strong>Fixed status:</strong> {formData.fixed_status.replace(/_/g, " ")}</p>
            {formData.has_kittens === "yes" && (
              <p><strong>Kittens:</strong> Yes ({formData.kitten_count || "count unknown"})</p>
            )}
          </div>

          {formData.situation_description && (
            <div style={{ background: "var(--section-bg)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>Additional Details</h3>
              <p>{formData.situation_description}</p>
            </div>
          )}

          {formData.is_emergency && (
            <div style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem", color: "var(--danger-text)" }}>
              <strong>EMERGENCY REQUEST</strong>
              <p style={{ margin: 0 }}>We will prioritize your request.</p>
            </div>
          )}

          <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginTop: "1rem" }}>
            By submitting this request, you agree to be contacted by Forgotten Felines of Sonoma County regarding our services.
          </p>
        </div>
      )}

      {/* Navigation Buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {currentStep !== "contact" && (
            <button onClick={prevStep} style={{ padding: "0.75rem 1.5rem" }}>
              Back
            </button>
          )}
          {!isPreview && (
            <button
              onClick={saveDraft}
              style={{
                padding: "0.75rem 1rem",
                background: "transparent",
                border: "1px solid var(--card-border)",
                fontSize: "0.85rem",
              }}
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
              background: "var(--foreground)",
              color: "var(--background)",
            }}
          >
            Continue
          </button>
        ) : isPreview ? (
          <div style={{ color: "var(--muted)", fontStyle: "italic" }}>
            Preview mode - submit disabled
          </div>
        ) : (
          <button
            onClick={() => {
              clearDraft(); // Clear draft on successful submit
              handleSubmit();
            }}
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

// Wrapper component to handle Suspense for useSearchParams
export default function IntakePage() {
  return (
    <Suspense fallback={
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "1rem", textAlign: "center" }}>
        <div>Loading form...</div>
      </div>
    }>
      <IntakeForm />
    </Suspense>
  );
}
