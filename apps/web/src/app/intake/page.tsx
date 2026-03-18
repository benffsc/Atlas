"use client";

import { useState, useEffect, Suspense, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { usePersonSuggestion } from "@/hooks/usePersonSuggestion";
import { formatPhoneAsYouType } from "@/lib/formatters";
import { shouldBePerson } from "@/lib/guards";
import { fetchApi, postApi } from "@/lib/api-client";
import {
  CALL_TYPE_OPTIONS as BASE_CALL_TYPE_OPTIONS,
  callTypeToOwnership,
} from "@/lib/intake-options";
import {
  CallTypeStep,
  ContactStep,
  LocationStep,
  CatDetailsStep,
  SituationStep,
  ReviewStep,
  CALL_TYPE_OPTIONS,
} from "@/components/intake-form";
import type {
  FormData,
  FormCallType,
  Step,
  CustomField,
  PersonSuggestion,
  PersonAddress,
} from "@/components/intake-form";
import { initialFormData } from "@/components/intake-form";

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
 *
 * Step components extracted to @/components/intake-form/ (FFS-113).
 */

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

  // Person search state
  const [personSuggestions, setPersonSuggestions] = useState<PersonSuggestion[]>([]);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [personSearchLoading, setPersonSearchLoading] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const personSearchTimeout = useRef<NodeJS.Timeout>();
  const personDropdownRef = useRef<HTMLDivElement>(null);

  // Person suggestion by email/phone (duplicate prevention)
  const identitySuggestion = usePersonSuggestion({
    email: formData.email,
    phone: formData.phone,
    enabled: !selectedPersonId,
  });

  // Place selection state
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [resolvedCatPlace, setResolvedCatPlace] = useState<ResolvedPlace | null>(null);
  const [resolvedRequesterPlace, setResolvedRequesterPlace] = useState<ResolvedPlace | null>(null);

  // Address selection state (for known person addresses)
  const [personAddresses, setPersonAddresses] = useState<PersonAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [catsAtMyAddress, setCatsAtMyAddress] = useState(true);
  const [showAddressSelection, setShowAddressSelection] = useState(false);

  // Determine steps based on call type
  const getSteps = (): Step[] => {
    const baseSteps: Step[] = ["call_type", "contact", "location", "cat_details"];
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
      fetchApi<{ fields: CustomField[] }>(`/api/intake/custom-fields?call_type=${formData.call_type}`)
        .then((data) => {
          setCustomFields(data.fields || []);
        })
        .catch(() => setCustomFields([]));
    }
  }, [formData.call_type]);

  // Update custom field value
  const updateCustomField = (fieldKey: string, value: string | boolean) => {
    setCustomFieldValues(prev => ({ ...prev, [fieldKey]: value }));
  };

  // Person search - debounced
  const searchPeople = useCallback(async (query: string) => {
    if (query.length < 2) {
      setPersonSuggestions([]);
      setShowPersonDropdown(false);
      return;
    }

    setPersonSearchLoading(true);
    try {
      const data = await fetchApi<{ people: PersonSuggestion[] }>(`/api/people/search?q=${encodeURIComponent(query)}&limit=5`);
      setPersonSuggestions(data.people || []);
      setShowPersonDropdown(data.people?.length > 0);
    } catch (err) {
      console.error("Person search error:", err);
    } finally {
      setPersonSearchLoading(false);
    }
  }, []);

  // Handle name/email/phone input with person search
  const handleContactFieldChange = (field: keyof FormData, value: string) => {
    const processedValue = field === "phone" ? formatPhoneAsYouType(value) : value;
    updateField(field, processedValue);
    setSelectedPersonId(null);

    if (field === "first_name" || field === "last_name" || field === "email" || field === "phone") {
      if (personSearchTimeout.current) {
        clearTimeout(personSearchTimeout.current);
      }
      const searchQuery = field === "email" || field === "phone"
        ? processedValue
        : `${formData.first_name} ${formData.last_name}`.trim() || processedValue;

      personSearchTimeout.current = setTimeout(() => {
        searchPeople(searchQuery);
      }, 300);
    }
  };

  // Select an existing person from suggestions
  const selectPerson = (person: PersonSuggestion) => {
    const nameParts = person.display_name.split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    setFormData(prev => ({
      ...prev,
      first_name: firstName,
      last_name: lastName,
      email: person.emails?.split(", ")[0] || prev.email,
      phone: person.phones?.split(", ")[0] || prev.phone,
    }));
    setSelectedPersonId(person.person_id);
    setShowPersonDropdown(false);
    setPersonSuggestions([]);

    if (person.addresses && person.addresses.length > 0) {
      setPersonAddresses(person.addresses);
      setShowAddressSelection(true);
    } else {
      fetchApi<{ addresses: PersonAddress[] }>(`/api/people/${person.person_id}/addresses`)
        .then((data) => {
          if (data.addresses && data.addresses.length > 0) {
            setPersonAddresses(data.addresses);
            setShowAddressSelection(true);
          } else {
            setPersonAddresses([]);
            setShowAddressSelection(false);
          }
        })
        .catch(() => {
          setPersonAddresses([]);
          setShowAddressSelection(false);
        });
    }
  };

  // Handle selecting a person from identity suggestion banner
  const handleIdentitySuggestionSelect = (person: Parameters<typeof identitySuggestion.selectPerson>[0]) => {
    // Map to the shape selectPerson expects and reuse the same logic
    selectPerson({
      person_id: person.person_id,
      display_name: person.display_name,
      emails: person.email,
      phones: person.phone,
      cat_count: person.cat_count,
      addresses: person.addresses?.map(a => ({
        place_id: a.place_id,
        formatted_address: a.formatted_address,
        display_name: null,
        role: a.role,
        confidence: null,
      })) || null,
    });
    identitySuggestion.selectPerson(person);
  };

  // Handle selecting a known address from person's addresses
  const handleKnownAddressSelect = (address: PersonAddress) => {
    setSelectedAddressId(address.place_id);
    setFormData(prev => ({
      ...prev,
      cats_address: address.formatted_address || "",
    }));
    setSelectedPlaceId(address.place_id);
  };

  // Handle "Enter a different address" selection
  const handleSelectNewAddress = () => {
    setSelectedAddressId("new");
    setFormData(prev => ({ ...prev, cats_address: "" }));
    setSelectedPlaceId(null);
  };

  // Handle requester home address resolved from PlaceResolver
  const handleRequesterPlaceResolved = (place: ResolvedPlace | null) => {
    setResolvedRequesterPlace(place);
    if (place) {
      setFormData(prev => ({
        ...prev,
        requester_address: place.formatted_address || place.display_name || "",
        requester_city: place.locality || prev.requester_city,
      }));
    }
  };

  // Handle cat address resolved from PlaceResolver
  const handleCatPlaceResolved = (place: ResolvedPlace | null) => {
    setResolvedCatPlace(place);
    setSelectedPlaceId(place?.place_id || null);
    if (place) {
      setFormData(prev => ({
        ...prev,
        cats_address: place.formatted_address || place.display_name || "",
      }));
    }
  };

  // Close person dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) {
        setShowPersonDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

      const personCheck = shouldBePerson(
        formData.first_name.trim(),
        formData.last_name.trim(),
        formData.email.trim() || null,
        formData.phone.trim() || null
      );

      if (!personCheck.valid) {
        if (personCheck.reason.includes("organization") || personCheck.reason.includes("business")) {
          newErrors.first_name = personCheck.reason;
        } else if (personCheck.reason.includes("address") || personCheck.reason.includes("site")) {
          newErrors.first_name = personCheck.reason;
        } else if (personCheck.reason.includes("email")) {
          newErrors.email = personCheck.reason;
        } else if (personCheck.reason.includes("phone")) {
          newErrors.phone = personCheck.reason;
        } else if (personCheck.reason.includes("placeholder") || personCheck.reason.includes("not valid")) {
          newErrors.first_name = personCheck.reason;
        }
      }
    }

    if (step === "location") {
      if (!formData.cats_address.trim()) newErrors.cats_address = "Address required";
    }

    if (step === "cat_details") {
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
      const ownershipStatus = callTypeToOwnership(formData.call_type);

      const result = await postApi<{ message: string; triage_category?: string }>("/api/intake", {
        // Contact
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        requester_address: formData.requester_address || undefined,
        requester_city: formData.requester_city || undefined,
        requester_zip: formData.requester_zip || undefined,

        // Person/Address linking (MIG_538)
        existing_person_id: selectedPersonId || undefined,
        selected_address_place_id: (selectedAddressId && selectedAddressId !== "new") ? selectedAddressId : undefined,
        cats_at_requester_address: catsAtMyAddress,

        // Third-party & relationship
        is_third_party_report: formData.is_third_party_report,
        third_party_relationship: formData.third_party_relationship || undefined,
        requester_relationship: formData.requester_relationship || "resident",
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
        cats_needing_tnr: formData.cats_needing_tnr ? parseInt(formData.cats_needing_tnr) : undefined,
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

        // Structured fields (stored in their own columns)
        call_type: formData.call_type || undefined,
        cat_name: formData.cat_name || undefined,
        cat_description: formData.cat_description || undefined,
        feeding_situation: formData.feeding_situation || undefined,

        // Notes (combine call type context + notes as human-readable summary)
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
      });

      clearDraft();
      setSubmitted(true);
      setSubmitResult({
        success: true,
        message: result.message,
        triage_category: result.triage_category,
      });
    } catch (err) {
      console.error("Submit error:", err);
      setSubmitResult({
        success: false,
        message: err instanceof Error ? err.message : "Network error. Please try again.",
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
            <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginTop: "1rem" }}>
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
            <button onClick={clearDraft} style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border-light)" }}>
              Discard
            </button>
          </div>
        </div>
      )}

      <h1 style={{ textAlign: "center", marginBottom: "0.5rem" }}>Intake Call</h1>
      <p style={{ textAlign: "center", color: "var(--muted)", marginBottom: "1.5rem" }}>
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
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
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
              background: "var(--background)",
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
            <div style={{ background: "var(--section-bg)", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
              <strong>Pet Care Veterinary Hospital</strong><br />
              <span style={{ fontSize: "1.2rem", color: "#198754" }}>(707) 579-3900</span><br />
              <span style={{ color: "var(--muted)" }}>2425 Mendocino Ave, Santa Rosa - Open 24/7</span>
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

      {/* Step Components */}
      {currentStep === "call_type" && (
        <CallTypeStep formData={formData} updateField={updateField} errors={errors} />
      )}

      {currentStep === "contact" && (
        <ContactStep
          formData={formData}
          updateField={updateField}
          errors={errors}
          handleContactFieldChange={handleContactFieldChange}
          selectedPersonId={selectedPersonId}
          setSelectedPersonId={setSelectedPersonId}
          showPersonDropdown={showPersonDropdown}
          personSuggestions={personSuggestions}
          personSearchLoading={personSearchLoading}
          personDropdownRef={personDropdownRef}
          selectPerson={selectPerson}
          identitySuggestions={identitySuggestion.suggestions}
          identitySuggestionLoading={identitySuggestion.loading}
          identitySuggestionDismissed={identitySuggestion.dismissed}
          onDismissIdentitySuggestion={identitySuggestion.dismiss}
          onSelectIdentitySuggestion={handleIdentitySuggestionSelect}
        />
      )}

      {currentStep === "location" && (
        <LocationStep
          formData={formData}
          updateField={updateField}
          errors={errors}
          showAddressSelection={showAddressSelection}
          personAddresses={personAddresses}
          selectedAddressId={selectedAddressId}
          handleKnownAddressSelect={handleKnownAddressSelect}
          onSelectNewAddress={handleSelectNewAddress}
          resolvedCatPlace={resolvedCatPlace}
          handleCatPlaceResolved={handleCatPlaceResolved}
          selectedPlaceId={selectedPlaceId}
          catsAtMyAddress={catsAtMyAddress}
          setCatsAtMyAddress={setCatsAtMyAddress}
          resolvedRequesterPlace={resolvedRequesterPlace}
          handleRequesterPlaceResolved={handleRequesterPlaceResolved}
          selectedPersonId={selectedPersonId}
        />
      )}

      {currentStep === "cat_details" && (
        <CatDetailsStep
          formData={formData}
          updateField={updateField}
          errors={errors}
          customFields={customFields}
          customFieldValues={customFieldValues}
          updateCustomField={updateCustomField}
          setShowEmergencyModal={setShowEmergencyModal}
        />
      )}

      {currentStep === "situation" && (
        <SituationStep formData={formData} updateField={updateField} errors={errors} />
      )}

      {currentStep === "review" && (
        <ReviewStep formData={formData} updateField={updateField} errors={errors} />
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
              style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid var(--border)", fontSize: "0.85rem" }}
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
          <span style={{ color: "var(--muted)", fontStyle: "italic" }}>Preview mode</span>
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
