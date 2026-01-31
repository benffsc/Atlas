"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import PlaceResolver from "@/components/PlaceResolver";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string;
  match_strength: string;
}


interface PersonAddress {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  role: string;
  confidence: number | null;
}

interface PersonDetails {
  person_id: string;
  display_name: string;
  email?: string;
  phone?: string;
  addresses?: PersonAddress[];
}

interface EmailCheckResult {
  exists: boolean;
  person?: { person_id: string; display_name: string };
  normalizedEmail: string;
}

const PROPERTY_TYPE_OPTIONS = [
  { value: "private_home", label: "Private Home" },
  { value: "apartment_complex", label: "Apartment Complex" },
  { value: "mobile_home_park", label: "Mobile Home Park" },
  { value: "business", label: "Business" },
  { value: "farm_ranch", label: "Farm/Ranch" },
  { value: "public_park", label: "Public Park" },
  { value: "industrial", label: "Industrial" },
  { value: "other", label: "Other" },
];

const PERMISSION_OPTIONS = [
  { value: "yes", label: "Yes - Permission granted" },
  { value: "pending", label: "Pending - Waiting for response" },
  { value: "no", label: "No - Permission denied" },
  { value: "not_needed", label: "Not needed - Public property" },
  { value: "unknown", label: "Unknown" },
];

const COLONY_DURATION_OPTIONS = [
  { value: "under_1_month", label: "Less than 1 month" },
  { value: "1_to_6_months", label: "1-6 months" },
  { value: "6_to_24_months", label: "6 months - 2 years" },
  { value: "over_2_years", label: "More than 2 years" },
  { value: "unknown", label: "Unknown" },
];

const COUNT_CONFIDENCE_OPTIONS = [
  { value: "exact", label: "Exact count" },
  { value: "good_estimate", label: "Good estimate" },
  { value: "rough_guess", label: "Rough guess" },
  { value: "unknown", label: "Unknown" },
];

const EARTIP_ESTIMATE_OPTIONS = [
  { value: "none", label: "None ear-tipped" },
  { value: "few", label: "A few (less than 25%)" },
  { value: "some", label: "Some (25-50%)" },
  { value: "most", label: "Most (50-75%)" },
  { value: "all", label: "All or almost all (75%+)" },
  { value: "unknown", label: "Unknown" },
];

const URGENCY_REASONS = [
  { value: "kittens", label: "Young kittens present" },
  { value: "sick_injured", label: "Sick or injured cat(s)" },
  { value: "threat", label: "Cats at risk (neighbor threat, etc.)" },
  { value: "poison", label: "Poison risk" },
  { value: "eviction", label: "Eviction/property issue" },
  { value: "moving", label: "Requester moving soon" },
  { value: "pregnant", label: "Pregnant cat(s)" },
  { value: "weather", label: "Weather concerns" },
];

function NewRequestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Location
  const [selectedPlace, setSelectedPlace] = useState<ResolvedPlace | null>(null);
  const [propertyType, setPropertyType] = useState("");
  const [locationDescription, setLocationDescription] = useState("");

  // Contact - Requestor
  const [requestorMode, setRequestorMode] = useState<"search" | "create">("search");
  const [personSearch, setPersonSearch] = useState("");
  const [personResults, setPersonResults] = useState<SearchResult[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonDetails | null>(null);
  const [searchingPeople, setSearchingPeople] = useState(false);
  // Requestor fields (editable for both search and create modes)
  const [requestorFirstName, setRequestorFirstName] = useState("");
  const [requestorLastName, setRequestorLastName] = useState("");
  const [requestorPhone, setRequestorPhone] = useState("");
  const [requestorEmail, setRequestorEmail] = useState("");
  // Email duplicate warning
  const [emailWarning, setEmailWarning] = useState<EmailCheckResult | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  // Contact info editing (for existing person)
  const [editingContactInfo, setEditingContactInfo] = useState(false);
  const [originalContactInfo, setOriginalContactInfo] = useState<{ phone: string; email: string } | null>(null);
  // Property authority
  const [hasPropertyAuthority, setHasPropertyAuthority] = useState(true);
  const [propertyOwnerName, setPropertyOwnerName] = useState("");
  const [propertyOwnerPhone, setPropertyOwnerPhone] = useState("");
  const [authorizationPending, setAuthorizationPending] = useState(false);
  const [bestContactTimes, setBestContactTimes] = useState("");

  // Permission & Access
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [accessNotes, setAccessNotes] = useState("");
  const [trapsOvernightSafe, setTrapsOvernightSafe] = useState<boolean | null>(null);
  const [accessWithoutContact, setAccessWithoutContact] = useState<boolean | null>(null);

  // Request Purpose (multi-select)
  const [requestPurposes, setRequestPurposes] = useState<string[]>(["tnr"]);
  const [wellnessCatCount, setWellnessCatCount] = useState<number | "">("");

  // Helper to toggle purpose selection
  const togglePurpose = (purpose: string) => {
    setRequestPurposes(prev => {
      if (prev.includes(purpose)) {
        // Don't allow empty selection - keep at least one
        if (prev.length === 1) return prev;
        return prev.filter(p => p !== purpose);
      }
      return [...prev, purpose];
    });
  };

  // Computed: check if specific purposes are selected
  const hasTnr = requestPurposes.includes("tnr");
  const hasWellness = requestPurposes.includes("wellness");
  const hasRelocation = requestPurposes.includes("relocation");
  const hasRescue = requestPurposes.includes("rescue");

  // About the Cats
  const [estimatedCatCount, setEstimatedCatCount] = useState<number | "">("");
  const [countConfidence, setCountConfidence] = useState("unknown");
  const [colonyDuration, setColonyDuration] = useState("unknown");
  const [eartipCount, setEartipCount] = useState<number | "">("");
  const [eartipEstimate, setEartipEstimate] = useState("unknown");
  const [catsAreFriendly, setCatsAreFriendly] = useState<boolean | null>(null);

  // Kittens
  const [hasKittens, setHasKittens] = useState(false);
  const [kittenCount, setKittenCount] = useState<number | "">("");
  const [kittenAgeWeeks, setKittenAgeWeeks] = useState<number | "">("");
  const [kittenAgeEstimate, setKittenAgeEstimate] = useState("");
  const [kittenMixedAgesDescription, setKittenMixedAgesDescription] = useState("");
  const [kittenBehavior, setKittenBehavior] = useState("");
  const [kittenContained, setKittenContained] = useState("");
  const [momPresent, setMomPresent] = useState("");
  const [momFixed, setMomFixed] = useState("");
  const [canBringIn, setCanBringIn] = useState("");
  const [kittenNotes, setKittenNotes] = useState("");

  // Feeding
  const [isBeingFed, setIsBeingFed] = useState<boolean | null>(null);
  const [feederName, setFeederName] = useState("");
  const [feedingSchedule, setFeedingSchedule] = useState("");
  const [bestTimesSeen, setBestTimesSeen] = useState("");

  // Urgency
  const [urgencyReasons, setUrgencyReasons] = useState<string[]>([]);
  const [urgencyDeadline, setUrgencyDeadline] = useState("");
  const [urgencyNotes, setUrgencyNotes] = useState("");
  const [priority, setPriority] = useState("normal");

  // Additional Details
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState(""); // Case info - situation description
  const [internalNotes, setInternalNotes] = useState(""); // Staff working notes

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<{
    success: boolean;
    status: "promoted" | "needs_review" | "rejected" | "pending";
    request_id?: string;
    raw_id?: string;
    message?: string;
    review_reason?: string;
    errors?: Record<string, string>;
  } | null>(null);

  // Computed: should show exact ear-tip count vs estimate
  const showExactEartipCount = typeof estimatedCatCount === "number" && estimatedCatCount <= 5;

  // Pre-load place from query param
  useEffect(() => {
    const placeId = searchParams.get("place_id");
    if (placeId && !selectedPlace) {
      fetch(`/api/places/${placeId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((place) => {
          if (place) {
            setSelectedPlace({
              place_id: place.place_id,
              display_name: place.display_name,
              formatted_address: place.formatted_address,
              locality: place.locality,
            });
          }
        })
        .catch((err) => console.error("Failed to pre-load place:", err));
    }
  }, [searchParams, selectedPlace]);

  // Debounced person search
  useEffect(() => {
    if (personSearch.length < 2 || selectedPerson) {
      setPersonResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingPeople(true);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(personSearch)}&type=person&limit=5`
        );
        if (response.ok) {
          const data = await response.json();
          setPersonResults(data.results || []);
        }
      } catch (err) {
        console.error("Person search error:", err);
      } finally {
        setSearchingPeople(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [personSearch, selectedPerson]);

  // Debounced email duplicate check
  useEffect(() => {
    if (!requestorEmail || !requestorEmail.includes("@") || selectedPerson) {
      setEmailWarning(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingEmail(true);
      try {
        const response = await fetch(
          `/api/people/check-email?email=${encodeURIComponent(requestorEmail)}`
        );
        if (response.ok) {
          const data: EmailCheckResult = await response.json();
          if (data.exists) {
            setEmailWarning(data);
          } else {
            setEmailWarning(null);
          }
        }
      } catch (err) {
        console.error("Email check error:", err);
      } finally {
        setCheckingEmail(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [requestorEmail, selectedPerson]);

  // Auto-fill the title with requester name when a requester is selected/entered
  useEffect(() => {
    const requesterName = [requestorFirstName, requestorLastName].filter(Boolean).join(" ").trim();
    // Only auto-fill if summary is empty and we have a requester name
    if (requesterName && !summary) {
      setSummary(requesterName);
    }
  }, [requestorFirstName, requestorLastName]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPerson = async (result: SearchResult) => {
    try {
      // Fetch person details and addresses in parallel
      const [personResponse, addressResponse] = await Promise.all([
        fetch(`/api/people/${result.entity_id}`),
        fetch(`/api/people/${result.entity_id}/addresses`),
      ]);

      if (personResponse.ok) {
        const person = await personResponse.json();
        // Extract email and phone from identifiers (API returns id_value, not id_value_norm)
        const emailId = person.identifiers?.find((id: { id_type: string }) => id.id_type === "email");
        const phoneId = person.identifiers?.find((id: { id_type: string }) => id.id_type === "phone");

        const email = emailId?.id_value || "";
        const phone = phoneId?.id_value || "";

        // Get addresses if available
        let addresses: PersonAddress[] = [];
        if (addressResponse.ok) {
          const addressData = await addressResponse.json();
          addresses = addressData.addresses || [];
          console.log("[FFR] Fetched addresses for person:", person.display_name, addresses);
        } else {
          console.log("[FFR] Failed to fetch addresses:", addressResponse.status);
        }

        setSelectedPerson({
          person_id: person.person_id,
          display_name: person.display_name,
          email,
          phone,
          addresses,
        });
        // Pre-fill the fields
        const nameParts = person.display_name?.split(" ") || [];
        setRequestorFirstName(nameParts[0] || "");
        setRequestorLastName(nameParts.slice(1).join(" ") || "");
        setRequestorEmail(email);
        setRequestorPhone(phone);
        // Track original values for change detection
        setOriginalContactInfo({ phone, email });
        setEditingContactInfo(false);
        setPersonSearch("");
        setPersonResults([]);
        setEmailWarning(null);
      }
    } catch (err) {
      console.error("Failed to fetch person details:", err);
    }
  };

  const useExistingPerson = () => {
    if (emailWarning?.person) {
      // Fetch the existing person's details
      fetch(`/api/people/${emailWarning.person.person_id}`)
        .then((res) => res.ok ? res.json() : null)
        .then((person) => {
          if (person) {
            const emailId = person.identifiers?.find((id: { id_type: string }) => id.id_type === "email");
            const phoneId = person.identifiers?.find((id: { id_type: string }) => id.id_type === "phone");
            const email = emailId?.id_value || "";
            const phone = phoneId?.id_value || "";
            setSelectedPerson({
              person_id: person.person_id,
              display_name: person.display_name,
              email,
              phone,
            });
            const nameParts = person.display_name?.split(" ") || [];
            setRequestorFirstName(nameParts[0] || "");
            setRequestorLastName(nameParts.slice(1).join(" ") || "");
            setRequestorEmail(email || requestorEmail);
            setRequestorPhone(phone || requestorPhone);
            setOriginalContactInfo({ phone, email });
            setEditingContactInfo(false);
            setEmailWarning(null);
            setRequestorMode("search");
          }
        });
    }
  };

  const clearPlace = () => {
    setSelectedPlace(null);
  };

  const handlePlaceResolved = (place: ResolvedPlace | null) => {
    setSelectedPlace(place);
  };

  const clearPerson = () => {
    setSelectedPerson(null);
    setPersonSearch("");
    setRequestorFirstName("");
    setRequestorLastName("");
    setRequestorEmail("");
    setRequestorPhone("");
    setEmailWarning(null);
    setEditingContactInfo(false);
    setOriginalContactInfo(null);
  };

  // Use a known address from the selected person as the cat location
  const useKnownAddress = (address: PersonAddress) => {
    setSelectedPlace({
      place_id: address.place_id,
      display_name: address.display_name || address.formatted_address,
      formatted_address: address.formatted_address,
      locality: null,
    });
  };

  const toggleUrgencyReason = (reason: string) => {
    setUrgencyReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedPlace && !summary) {
      setError("Please select a location or provide a request title");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Request Purpose - send primary and all selected
          // Priority: tnr > relocation > rescue > wellness (for primary)
          request_purpose: hasTnr ? "tnr" : hasRelocation ? "relocation" : hasRescue ? "rescue" : "wellness",
          request_purposes: requestPurposes, // Full array for notes/future use
          // Location
          place_id: selectedPlace?.place_id || null,
          property_type: propertyType || null,
          location_description: locationDescription || null,
          // Contact - Requestor
          requester_person_id: selectedPerson?.person_id || null,
          raw_requester_name: !selectedPerson && (requestorFirstName || requestorLastName)
            ? `${requestorFirstName} ${requestorLastName}`.trim()
            : null,
          raw_requester_phone: requestorPhone || null,
          raw_requester_email: requestorEmail || null,
          // Property authority
          property_owner_name: !hasPropertyAuthority ? propertyOwnerName || null : null,
          property_owner_phone: !hasPropertyAuthority ? propertyOwnerPhone || null : null,
          authorization_pending: !hasPropertyAuthority ? authorizationPending : false,
          best_contact_times: bestContactTimes || null,
          // Permission & Access
          permission_status: permissionStatus,
          access_notes: accessNotes || null,
          traps_overnight_safe: trapsOvernightSafe,
          access_without_contact: accessWithoutContact,
          // About the Cats
          estimated_cat_count: estimatedCatCount || null,
          wellness_cat_count: hasWellness ? (wellnessCatCount || null) : null,
          count_confidence: countConfidence,
          colony_duration: colonyDuration,
          eartip_count: showExactEartipCount ? (eartipCount || null) : null,
          eartip_estimate: !showExactEartipCount ? eartipEstimate : null,
          cats_are_friendly: catsAreFriendly,
          // Kittens
          has_kittens: hasKittens,
          kitten_count: hasKittens ? (kittenCount || null) : null,
          kitten_age_weeks: hasKittens ? (kittenAgeWeeks || null) : null,
          kitten_age_estimate: hasKittens ? (kittenAgeEstimate || null) : null,
          kitten_mixed_ages_description: hasKittens && kittenAgeEstimate === "mixed" ? (kittenMixedAgesDescription || null) : null,
          kitten_behavior: hasKittens ? (kittenBehavior || null) : null,
          kitten_contained: hasKittens ? (kittenContained || null) : null,
          mom_present: hasKittens ? (momPresent || null) : null,
          mom_fixed: hasKittens && momPresent === "yes" ? (momFixed || null) : null,
          can_bring_in: hasKittens ? (canBringIn || null) : null,
          kitten_notes: hasKittens ? (kittenNotes || null) : null,
          // Feeding
          is_being_fed: isBeingFed,
          feeder_name: isBeingFed ? (feederName || null) : null,
          feeding_schedule: isBeingFed ? (feedingSchedule || null) : null,
          best_times_seen: bestTimesSeen || null,
          // Urgency
          urgency_reasons: urgencyReasons.length > 0 ? urgencyReasons : null,
          urgency_deadline: urgencyDeadline || null,
          urgency_notes: urgencyNotes || null,
          priority,
          // Additional
          summary: summary || null,
          notes: notes || null,
          internal_notes: internalNotes || null,
          created_by: "app_user",
        }),
      });

      const result = await response.json();

      if (!response.ok && !result.status) {
        setError(result.error || "Failed to create request");
        return;
      }

      // Handle the new pipeline response format
      setSubmissionResult({
        success: result.success,
        status: result.status,
        request_id: result.request_id,
        raw_id: result.raw_id,
        message: result.message,
        review_reason: result.review_reason,
        errors: result.errors,
      });

      // Only auto-redirect if successfully promoted
      if (result.status === "promoted" && result.request_id) {
        // Small delay to show success state
        setTimeout(() => {
          router.push(`/requests/${result.request_id}`);
        }, 1500);
      }
    } catch (err) {
      setError("Network error while creating request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <BackButton fallbackHref="/requests" />

      <h1 style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>New FFR Request</h1>

      {/* Submission Result Modal */}
      {submissionResult && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              padding: "2rem",
              maxWidth: "500px",
              width: "90%",
              textAlign: "center",
            }}
          >
            {/* Promoted - Success */}
            {submissionResult.status === "promoted" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "#28a745",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1rem",
                    color: "#fff",
                    fontSize: "2rem",
                  }}
                >
                  &#10003;
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Request Created</h2>
                <p className="text-muted" style={{ marginBottom: "1rem" }}>
                  Your request has been saved and is ready for review.
                </p>
                <p className="text-sm text-muted">Redirecting...</p>
              </>
            )}

            {/* Needs Review */}
            {submissionResult.status === "needs_review" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "#ffc107",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1rem",
                    color: "#000",
                    fontSize: "2rem",
                  }}
                >
                  !
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Request Saved - Needs Review</h2>
                <p className="text-muted" style={{ marginBottom: "1rem" }}>
                  {submissionResult.message || "Your request has been saved but requires human review before activation."}
                </p>
                {submissionResult.review_reason && (
                  <p
                    style={{
                      background: "var(--bg-muted)",
                      padding: "0.75rem",
                      borderRadius: "6px",
                      fontSize: "0.9rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <strong>Reason:</strong> {submissionResult.review_reason}
                  </p>
                )}
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
                  <button onClick={() => router.push("/requests")}>
                    View All Requests
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionResult(null)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "inherit",
                    }}
                  >
                    Create Another
                  </button>
                </div>
              </>
            )}

            {/* Rejected - Validation Failed */}
            {submissionResult.status === "rejected" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "#dc3545",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1rem",
                    color: "#fff",
                    fontSize: "2rem",
                  }}
                >
                  &#10005;
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Validation Failed</h2>
                <p className="text-muted" style={{ marginBottom: "1rem" }}>
                  {submissionResult.message || "The request failed validation and cannot be created."}
                </p>
                {submissionResult.errors && Object.keys(submissionResult.errors).length > 0 && (
                  <div
                    style={{
                      background: "var(--bg-muted)",
                      padding: "0.75rem",
                      borderRadius: "6px",
                      textAlign: "left",
                      marginBottom: "1rem",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: "0.5rem" }}>Errors:</strong>
                    <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                      {Object.entries(submissionResult.errors).map(([field, msg]) => (
                        <li key={field} style={{ fontSize: "0.9rem" }}>
                          <strong>{field}:</strong> {msg}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setSubmissionResult(null)}
                >
                  Fix and Retry
                </button>
              </>
            )}

            {/* Pending - Awaiting Processing */}
            {submissionResult.status === "pending" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "#17a2b8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1rem",
                    color: "#fff",
                    fontSize: "2rem",
                  }}
                >
                  &#8987;
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Request Saved</h2>
                <p className="text-muted" style={{ marginBottom: "1rem" }}>
                  {submissionResult.message || "Your request has been saved and is awaiting processing."}
                </p>
                <p className="text-sm text-muted" style={{ marginBottom: "1rem" }}>
                  Reference ID: {submissionResult.raw_id?.slice(0, 8)}...
                </p>
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
                  <button onClick={() => router.push("/requests")}>
                    View All Requests
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionResult(null)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "inherit",
                    }}
                  >
                    Create Another
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* SECTION 1: Location */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Cat Location</h2>

          {/* Known addresses from selected person */}
          {selectedPerson?.addresses && selectedPerson.addresses.length > 0 && !selectedPlace && (
            <div
              style={{
                marginBottom: "1rem",
                padding: "1rem",
                background: "var(--success-bg, #d4edda)",
                border: "2px solid var(--success, #28a745)",
                borderRadius: "8px",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontWeight: 600, color: "var(--success, #155724)" }}>
                📍 Quick fill from {selectedPerson.display_name}'s known addresses:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {selectedPerson.addresses.map((addr) => (
                  <button
                    key={addr.place_id}
                    type="button"
                    onClick={() => useKnownAddress(addr)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.75rem",
                      background: "var(--card-bg, #fff)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--foreground, #212529)",
                    }}
                  >
                    <span>
                      <span style={{ display: "block", color: "var(--foreground, #212529)" }}>{addr.formatted_address}</span>
                      {addr.role && (
                        <span style={{ color: "var(--muted, #6c757d)", fontSize: "0.85rem" }}>({addr.role})</span>
                      )}
                    </span>
                    <span style={{ color: "var(--primary)", fontWeight: 500, fontSize: "0.85rem" }}>
                      Use this address
                    </span>
                  </button>
                ))}
              </div>
              <p style={{ margin: "0.75rem 0 0", color: "var(--muted, #6c757d)", fontSize: "0.85rem" }}>
                Or search for a different address below
              </p>
            </div>
          )}

          <PlaceResolver
            value={selectedPlace}
            onChange={handlePlaceResolved}
            placeholder="Type an address..."
          />

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Property Type
              </label>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">Select...</option>
                {PROPERTY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "2 1 300px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Where on property?
              </label>
              <input
                type="text"
                value={locationDescription}
                onChange={(e) => setLocationDescription(e.target.value)}
                placeholder="e.g., behind dumpster, in barn, backyard..."
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>

        {/* SECTION 2: Requestor */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Requestor</h2>

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="requestorMode"
                checked={requestorMode === "search"}
                onChange={() => { setRequestorMode("search"); clearPerson(); }}
              />
              Search existing person
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="requestorMode"
                checked={requestorMode === "create"}
                onChange={() => { setRequestorMode("create"); setSelectedPerson(null); }}
              />
              Create new person
            </label>
          </div>

          {/* Search mode */}
          {requestorMode === "search" && !selectedPerson && (
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input
                type="text"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search by name, phone, or email..."
                style={{ width: "100%" }}
              />
              {searchingPeople && (
                <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                  Searching...
                </p>
              )}
              {personResults.length > 0 && (
                <div className="dropdown-menu">
                  {personResults.map((result) => (
                    <button
                      key={result.entity_id}
                      type="button"
                      onClick={() => selectPerson(result)}
                      className="dropdown-item"
                    >
                      <div>{result.display_name}</div>
                      {result.subtitle && (
                        <div className="text-muted text-sm">{result.subtitle}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {personSearch.length >= 2 && personResults.length === 0 && !searchingPeople && (
                <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                  No matching people found.{" "}
                  <button
                    type="button"
                    onClick={() => setRequestorMode("create")}
                    style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0 }}
                  >
                    Create new person
                  </button>
                </p>
              )}
            </div>
          )}

          {/* Selected person badge */}
          {selectedPerson && (
            <div
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid var(--primary)",
                background: "rgba(var(--primary-rgb), 0.05)",
                marginBottom: "1rem",
              }}
            >
              <div>
                <strong>{selectedPerson.display_name}</strong>
              </div>
              <button type="button" onClick={clearPerson} style={{ padding: "0.25rem 0.5rem" }}>
                Change Person
              </button>
            </div>
          )}

          {/* Contact fields - different display for existing vs new person */}
          {selectedPerson && !editingContactInfo ? (
            /* Read-only contact display for existing person */
            <div style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  padding: "1rem",
                  background: "var(--bg-muted)",
                  borderRadius: "8px",
                  marginBottom: "0.75rem",
                }}
              >
                <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                  <div>
                    <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Phone</div>
                    <div style={{ fontWeight: 500 }}>
                      {selectedPerson.phone || <span className="text-muted">Not on file</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Email</div>
                    <div style={{ fontWeight: 500 }}>
                      {selectedPerson.email || <span className="text-muted">Not on file</span>}
                    </div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingContactInfo(true)}
                style={{
                  padding: "0.4rem 0.75rem",
                  fontSize: "0.9rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "inherit",
                }}
              >
                Update Contact Info
              </button>
            </div>
          ) : (
            /* Editable contact fields for new person OR when editing existing */
            <>
              {selectedPerson && editingContactInfo && (
                <div
                  style={{
                    padding: "0.5rem 0.75rem",
                    background: "#e3f2fd",
                    borderRadius: "6px",
                    marginBottom: "0.75rem",
                    fontSize: "0.9rem",
                  }}
                >
                  Editing contact info for <strong>{selectedPerson.display_name}</strong>
                  {" "}&mdash; changes will be tracked
                </div>
              )}

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 180px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    First Name {requestorMode === "create" && "*"}
                  </label>
                  <input
                    type="text"
                    value={requestorFirstName}
                    onChange={(e) => setRequestorFirstName(e.target.value)}
                    placeholder="First name"
                    style={{ width: "100%" }}
                    disabled={selectedPerson !== null && !editingContactInfo}
                  />
                </div>
                <div style={{ flex: "1 1 180px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Last Name {requestorMode === "create" && "*"}
                  </label>
                  <input
                    type="text"
                    value={requestorLastName}
                    onChange={(e) => setRequestorLastName(e.target.value)}
                    placeholder="Last name"
                    style={{ width: "100%" }}
                    disabled={selectedPerson !== null && !editingContactInfo}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={requestorPhone}
                    onChange={(e) => setRequestorPhone(e.target.value)}
                    placeholder="(707) 555-1234"
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ flex: "1 1 250px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={requestorEmail}
                    onChange={(e) => setRequestorEmail(e.target.value)}
                    placeholder="email@example.com"
                    style={{ width: "100%" }}
                  />
                  {checkingEmail && !selectedPerson && (
                    <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                      Checking...
                    </p>
                  )}
                </div>
              </div>

              {/* Cancel edit button when editing existing person */}
              {selectedPerson && editingContactInfo && (
                <div style={{ marginBottom: "1rem" }}>
                  <button
                    type="button"
                    onClick={() => {
                      // Restore original values
                      if (originalContactInfo) {
                        setRequestorPhone(originalContactInfo.phone);
                        setRequestorEmail(originalContactInfo.email);
                      }
                      setEditingContactInfo(false);
                    }}
                    style={{
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.9rem",
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "inherit",
                    }}
                  >
                    Cancel Edit
                  </button>
                  {(requestorPhone !== originalContactInfo?.phone || requestorEmail !== originalContactInfo?.email) && (
                    <span className="text-sm" style={{ marginLeft: "0.75rem", color: "#28a745" }}>
                      Changes will be saved with request
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {/* Email duplicate warning */}
          {emailWarning && (
            <div
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                border: "2px solid #e65100",
                background: "#fff8f5",
                color: "#333",
                marginBottom: "1rem",
              }}
            >
              <div style={{ marginBottom: "0.5rem", color: "#c62828" }}>
                <strong>This email already exists</strong>
              </div>
              <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem", color: "#333" }}>
                {`"${requestorEmail}" is registered to `}
                <strong>{emailWarning.person?.display_name}</strong>.
                {" "}Is this the same person, or do they share an email (e.g., a couple)?
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={useExistingPerson}
                  style={{ padding: "0.4rem 0.75rem", fontSize: "0.9rem" }}
                >
                  Use Existing Person
                </button>
                <button
                  type="button"
                  onClick={() => setEmailWarning(null)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    fontSize: "0.9rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "inherit",
                  }}
                >
                  Create New Anyway (shared email)
                </button>
              </div>
            </div>
          )}

          {/* Property authority section */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "0.5rem" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                marginBottom: hasPropertyAuthority ? "0" : "1rem",
              }}
            >
              <input
                type="checkbox"
                checked={!hasPropertyAuthority}
                onChange={(e) => setHasPropertyAuthority(!e.target.checked)}
              />
              <span>Requestor does NOT have authority over property</span>
            </label>

            {!hasPropertyAuthority && (
              <div style={{ marginLeft: "1.5rem", marginTop: "0.75rem" }}>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Property Owner Name
                    </label>
                    <input
                      type="text"
                      value={propertyOwnerName}
                      onChange={(e) => setPropertyOwnerName(e.target.value)}
                      placeholder="Owner/manager name"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div style={{ flex: "1 1 180px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Property Owner Phone
                    </label>
                    <input
                      type="tel"
                      value={propertyOwnerPhone}
                      onChange={(e) => setPropertyOwnerPhone(e.target.value)}
                      placeholder="(707) 555-1234"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={authorizationPending}
                    onChange={(e) => setAuthorizationPending(e.target.checked)}
                  />
                  <span>Authorization pending (needs follow-up)</span>
                </label>
              </div>
            )}
          </div>

          {/* Best contact times */}
          <div style={{ marginTop: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Best Times to Contact
            </label>
            <input
              type="text"
              value={bestContactTimes}
              onChange={(e) => setBestContactTimes(e.target.value)}
              placeholder="e.g., mornings, after 5pm, weekends..."
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* SECTION 3: Permission & Access */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Permission & Access</h2>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div style={{ flex: "1 1 250px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Permission Status
              </label>
              <select
                value={permissionStatus}
                onChange={(e) => setPermissionStatus(e.target.value)}
                style={{ width: "100%" }}
              >
                {PERMISSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                Can traps be left overnight?
              </label>
              <div style={{ display: "flex", gap: "1rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="trapsOvernight"
                    checked={trapsOvernightSafe === true}
                    onChange={() => setTrapsOvernightSafe(true)}
                  />
                  Yes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="trapsOvernight"
                    checked={trapsOvernightSafe === false}
                    onChange={() => setTrapsOvernightSafe(false)}
                  />
                  No
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="trapsOvernight"
                    checked={trapsOvernightSafe === null}
                    onChange={() => setTrapsOvernightSafe(null)}
                  />
                  Unknown
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                Can trapper access without requester?
              </label>
              <div style={{ display: "flex", gap: "1rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="accessWithout"
                    checked={accessWithoutContact === true}
                    onChange={() => setAccessWithoutContact(true)}
                  />
                  Yes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="accessWithout"
                    checked={accessWithoutContact === false}
                    onChange={() => setAccessWithoutContact(false)}
                  />
                  No
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="accessWithout"
                    checked={accessWithoutContact === null}
                    onChange={() => setAccessWithoutContact(null)}
                  />
                  Unknown
                </label>
              </div>
            </div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Access Notes
            </label>
            <textarea
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
              placeholder="Gate codes, dogs on property, parking instructions, hazards..."
              rows={2}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        </div>

        {/* SECTION 4: About the Cats */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>About the Cats</h2>

          {/* Request Purpose Selector - Multi-select */}
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              What does this request involve? <span className="text-muted" style={{ fontWeight: 400 }}>(select all that apply)</span>
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {[
                { value: "tnr", label: "FFR", desc: "Cats need spay/neuter" },
                { value: "wellness", label: "Wellness", desc: "Check on altered cats" },
                { value: "relocation", label: "Relocation", desc: "Trapping to move cats" },
                { value: "rescue", label: "Rescue", desc: "Emergency assistance" },
              ].map((opt) => {
                const isSelected = requestPurposes.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: "0.6rem 1rem",
                      border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      background: isSelected ? "rgba(var(--primary-rgb), 0.05)" : "transparent",
                      minWidth: "110px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePurpose(opt.value)}
                      style={{ display: "none" }}
                    />
                    <span style={{ fontWeight: 600 }}>{opt.label}</span>
                    <span className="text-muted" style={{ fontSize: "0.75rem" }}>{opt.desc}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* TNR / Relocation / Rescue - Cats needing work */}
          {(hasTnr || hasRelocation || hasRescue) && (
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  {hasTnr ? "Cats needing FFR" : "Cats to trap"}
                </label>
                <input
                  type="number"
                  min="1"
                  value={estimatedCatCount}
                  onChange={(e) =>
                    setEstimatedCatCount(e.target.value ? parseInt(e.target.value) : "")
                  }
                  placeholder="0"
                  style={{ width: "100%" }}
                />
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  {hasTnr ? "Unfixed cats" : "Total to trap"}
                </p>
              </div>

              <div style={{ flex: "1 1 180px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  How confident is this count?
                </label>
                <select
                  value={countConfidence}
                  onChange={(e) => setCountConfidence(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {COUNT_CONFIDENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  How long have cats been here?
                </label>
                <select
                  value={colonyDuration}
                  onChange={(e) => setColonyDuration(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {COLONY_DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Wellness - Altered cats to check */}
          {hasWellness && (
            <div
              style={{
                padding: "1rem",
                background: "var(--bg-muted)",
                borderRadius: "8px",
                marginBottom: "1rem",
              }}
            >
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 160px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Altered cats for wellness
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={wellnessCatCount}
                    onChange={(e) =>
                      setWellnessCatCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ flex: "2 1 300px" }}>
                  <p className="text-muted text-sm" style={{ margin: 0 }}>
                    Already ear-tipped cats to check on. These won&apos;t count toward FFR work.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Smart ear-tip input - only for TNR (context for how many are already done) */}
          {hasTnr && (
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Ear-tipped at location {showExactEartipCount ? "(exact count)" : "(estimate)"}
              </label>
              {showExactEartipCount ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="number"
                    min="0"
                    max={typeof estimatedCatCount === "number" ? estimatedCatCount : undefined}
                    value={eartipCount}
                    onChange={(e) =>
                      setEartipCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "80px" }}
                  />
                  <span className="text-muted">
                    already fixed (context only, not part of this request)
                  </span>
                </div>
              ) : (
                <select
                  value={eartipEstimate}
                  onChange={(e) => setEartipEstimate(e.target.value)}
                  style={{ width: "100%", maxWidth: "300px" }}
                >
                  {EARTIP_ESTIMATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                For context only &mdash; these cats are already done and won&apos;t count toward this request
              </p>
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Are the cats friendly?
            </label>
            <div style={{ display: "flex", gap: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="friendly"
                  checked={catsAreFriendly === true}
                  onChange={() => setCatsAreFriendly(true)}
                />
                Yes, friendly
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="friendly"
                  checked={catsAreFriendly === false}
                  onChange={() => setCatsAreFriendly(false)}
                />
                No, unhandleable
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="friendly"
                  checked={catsAreFriendly === null}
                  onChange={() => setCatsAreFriendly(null)}
                />
                Mixed/Unknown
              </label>
            </div>
          </div>
        </div>

        {/* SECTION 5: Kittens */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Kittens</h2>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasKittens}
                onChange={(e) => setHasKittens(e.target.checked)}
              />
              Kittens present
            </label>
          </div>

          {hasKittens && (
            <>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 120px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    How many?
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={kittenCount}
                    onChange={(e) =>
                      setKittenCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ flex: "1 1 120px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Age (weeks)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="52"
                    value={kittenAgeWeeks}
                    onChange={(e) =>
                      setKittenAgeWeeks(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="e.g., 6"
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ flex: "2 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Age range
                  </label>
                  <select
                    value={kittenAgeEstimate}
                    onChange={(e) => setKittenAgeEstimate(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select...</option>
                    <option value="under_4_weeks">Under 4 weeks (bottle babies)</option>
                    <option value="4_to_8_weeks">4-8 weeks (weaning)</option>
                    <option value="8_to_12_weeks">8-12 weeks (ideal foster)</option>
                    <option value="12_to_16_weeks">12-16 weeks (socialization critical)</option>
                    <option value="over_16_weeks">Over 16 weeks / 4+ months</option>
                    <option value="mixed">Mixed ages</option>
                  </select>
                </div>
              </div>

              {kittenAgeEstimate === "mixed" && (
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Describe the ages
                  </label>
                  <input
                    type="text"
                    value={kittenMixedAgesDescription}
                    onChange={(e) => setKittenMixedAgesDescription(e.target.value)}
                    placeholder='e.g., "3 at ~8 weeks, 2 at ~6 months"'
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                  Kitten behavior/socialization
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    { value: "friendly", label: "Friendly - can be handled, approaches people" },
                    { value: "shy_handleable", label: "Shy but handleable - scared but can be picked up" },
                    { value: "shy_young", label: "Shy/hissy (young) - may be socializable" },
                    { value: "unhandleable_older", label: "Unhandleable (older) - very scared, hard to handle" },
                    { value: "unknown", label: "Unknown - haven't been able to assess" },
                  ].map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="kittenBehavior"
                        value={opt.value}
                        checked={kittenBehavior === opt.value}
                        onChange={(e) => setKittenBehavior(e.target.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Kittens contained/caught?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "some", label: "Some" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="kittenContained"
                          value={opt.value}
                          checked={kittenContained === opt.value}
                          onChange={(e) => setKittenContained(e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Mom cat present?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "unsure", label: "Unsure" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="momPresent"
                          value={opt.value}
                          checked={momPresent === opt.value}
                          onChange={(e) => setMomPresent(e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {momPresent === "yes" && (
                  <div>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                      Mom fixed (ear-tipped)?
                    </label>
                    <div style={{ display: "flex", gap: "1rem" }}>
                      {[
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                        { value: "unsure", label: "Unsure" },
                      ].map((opt) => (
                        <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="momFixed"
                            value={opt.value}
                            checked={momFixed === opt.value}
                            onChange={(e) => setMomFixed(e.target.value)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Can bring them in?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "need_help", label: "Need help" },
                      { value: "no", label: "No" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="canBringIn"
                          value={opt.value}
                          checked={canBringIn === opt.value}
                          onChange={(e) => setCanBringIn(e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Kitten notes
                </label>
                <textarea
                  value={kittenNotes}
                  onChange={(e) => setKittenNotes(e.target.value)}
                  placeholder="Colors, where they hide, feeding times, trap-savvy, etc..."
                  rows={2}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ background: "var(--warning-bg, #fffbeb)", border: "1px solid var(--warning-border, #ffc107)", borderRadius: "6px", padding: "0.75rem", marginTop: "1rem", fontSize: "0.85rem" }}>
                <strong>Foster triage factors:</strong>
                <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
                  <li>Age: Under 12 weeks ideal, 12+ weeks need socialization</li>
                  <li>Behavior: Friendly/handleable kittens prioritized</li>
                  <li>Mom: Spayed mom with kittens increases foster likelihood</li>
                  <li>Ease: Already contained = easier intake</li>
                </ul>
              </div>
            </>
          )}
        </div>

        {/* SECTION 6: Feeding */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Feeding</h2>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Are the cats being fed regularly?
            </label>
            <div style={{ display: "flex", gap: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="beingFed"
                  checked={isBeingFed === true}
                  onChange={() => setIsBeingFed(true)}
                />
                Yes
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="beingFed"
                  checked={isBeingFed === false}
                  onChange={() => setIsBeingFed(false)}
                />
                No
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="beingFed"
                  checked={isBeingFed === null}
                  onChange={() => setIsBeingFed(null)}
                />
                Unknown
              </label>
            </div>
          </div>

          {isBeingFed && (
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Who feeds them?
                </label>
                <input
                  type="text"
                  value={feederName}
                  onChange={(e) => setFeederName(e.target.value)}
                  placeholder="Name of feeder"
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Feeding schedule
                </label>
                <input
                  type="text"
                  value={feedingSchedule}
                  onChange={(e) => setFeedingSchedule(e.target.value)}
                  placeholder="e.g., 7am and 5pm daily"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Best times to see the cats
            </label>
            <input
              type="text"
              value={bestTimesSeen}
              onChange={(e) => setBestTimesSeen(e.target.value)}
              placeholder="e.g., early morning, dusk..."
              style={{ width: "100%" }}
            />
            <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Helps trappers plan visits
            </p>
          </div>
        </div>

        {/* SECTION 7: Urgency */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Urgency</h2>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Priority Level
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={{ width: "100%", maxWidth: "200px" }}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Urgency factors (select all that apply)
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {URGENCY_REASONS.map((reason) => (
                <label
                  key={reason.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    background: urgencyReasons.includes(reason.value)
                      ? "var(--primary)"
                      : "transparent",
                    color: urgencyReasons.includes(reason.value) ? "#fff" : "inherit",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={urgencyReasons.includes(reason.value)}
                    onChange={() => toggleUrgencyReason(reason.value)}
                    style={{ display: "none" }}
                  />
                  {reason.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Deadline (if any)
              </label>
              <input
                type="date"
                value={urgencyDeadline}
                onChange={(e) => setUrgencyDeadline(e.target.value)}
                style={{ width: "100%" }}
              />
              <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                Moving date, eviction, etc.
              </p>
            </div>

            <div style={{ flex: "2 1 300px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Urgency notes
              </label>
              <textarea
                value={urgencyNotes}
                onChange={(e) => setUrgencyNotes(e.target.value)}
                placeholder="Additional context about urgency..."
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
          </div>
        </div>

        {/* SECTION 8: Additional Details */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Additional Details</h2>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Request Title
            </label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g., '5 cats at Oak Street colony' or 'Rescue injured cat'"
              style={{ width: "100%" }}
            />
            <small style={{ color: "#666", fontSize: "0.8rem" }}>
              This will be the display name for this request
            </small>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Case Info
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detailed situation description, history with these cats, special circumstances..."
              rows={4}
              style={{ width: "100%", resize: "vertical" }}
            />
            <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Case details that can be shared with volunteers or referenced later
            </p>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Internal Notes
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Staff working notes, follow-up reminders, private observations..."
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
            <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Private notes for staff only &mdash; not shared with clients
            </p>
          </div>
        </div>

        {error && <div style={{ color: "#dc3545", marginBottom: "1rem" }}>{error}</div>}

        <div style={{ display: "flex", gap: "1rem" }}>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Request"}
          </button>
          <a
            href="/requests"
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}

export default function NewRequestPage() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <NewRequestForm />
    </Suspense>
  );
}
