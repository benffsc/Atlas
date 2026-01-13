"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string;
  match_strength: string;
}

interface GooglePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface PlaceDetails {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  locality: string | null;
  cat_count?: number;
  person_count?: number;
  cats?: Array<{ cat_id: string; display_name: string; microchip?: string }>;
  people?: Array<{ person_id: string; display_name: string; role: string }>;
}

interface PersonDetails {
  person_id: string;
  display_name: string;
}

const PLACE_TYPE_OPTIONS = [
  { value: "residential_house", label: "House", description: "Single family home" },
  { value: "apartment_unit", label: "Apartment", description: "Unit in apartment building" },
  { value: "business", label: "Business", description: "Store, restaurant, office" },
  { value: "outdoor_site", label: "Outdoor Site", description: "Park, lot, open area" },
  { value: "neighborhood", label: "Neighborhood", description: "General area, colony location" },
  { value: "unknown", label: "Other/Unknown", description: "Not sure or other type" },
];

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
  const [placeSearch, setPlaceSearch] = useState("");
  const [existingPlaces, setExistingPlaces] = useState<SearchResult[]>([]);
  const [googlePredictions, setGooglePredictions] = useState<GooglePrediction[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showPlaceTypeModal, setShowPlaceTypeModal] = useState(false);
  const [pendingGooglePlace, setPendingGooglePlace] = useState<GooglePrediction | null>(null);
  const [selectedPlaceType, setSelectedPlaceType] = useState("residential_house");
  const [creatingPlace, setCreatingPlace] = useState(false);
  const [showPlacePreview, setShowPlacePreview] = useState(false);
  const [previewPlace, setPreviewPlace] = useState<PlaceDetails | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [propertyType, setPropertyType] = useState("");
  const [locationDescription, setLocationDescription] = useState("");

  // Contact
  const [personSearch, setPersonSearch] = useState("");
  const [personResults, setPersonResults] = useState<SearchResult[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonDetails | null>(null);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [requesterLivesElsewhere, setRequesterLivesElsewhere] = useState(false);
  const [propertyOwnerContact, setPropertyOwnerContact] = useState("");
  const [bestContactTimes, setBestContactTimes] = useState("");

  // Permission & Access
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [accessNotes, setAccessNotes] = useState("");
  const [trapsOvernightSafe, setTrapsOvernightSafe] = useState<boolean | null>(null);
  const [accessWithoutContact, setAccessWithoutContact] = useState<boolean | null>(null);

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
  const [notes, setNotes] = useState("");

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

  // Debounced place search
  useEffect(() => {
    if (placeSearch.length < 3 || selectedPlace) {
      setExistingPlaces([]);
      setGooglePredictions([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingPlaces(true);
      setShowDropdown(true);

      try {
        const [existingRes, googleRes] = await Promise.all([
          fetch(`/api/search?q=${encodeURIComponent(placeSearch)}&type=place&limit=3`),
          fetch(`/api/places/autocomplete?input=${encodeURIComponent(placeSearch)}`),
        ]);

        if (existingRes.ok) {
          const data = await existingRes.json();
          setExistingPlaces(data.results || []);
        }

        if (googleRes.ok) {
          const data = await googleRes.json();
          setGooglePredictions(data.predictions || []);
        }
      } catch (err) {
        console.error("Place search error:", err);
      } finally {
        setSearchingPlaces(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [placeSearch, selectedPlace]);

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

  const previewExistingPlace = async (result: SearchResult) => {
    setLoadingPreview(true);
    setShowDropdown(false);
    try {
      const response = await fetch(`/api/places/${result.entity_id}`);
      if (response.ok) {
        const place = await response.json();
        setPreviewPlace({
          place_id: place.place_id,
          display_name: place.display_name,
          formatted_address: place.formatted_address,
          locality: place.locality,
          cat_count: place.cat_count,
          person_count: place.person_count,
          cats: place.cats,
          people: place.people,
        });
        setShowPlacePreview(true);
      }
    } catch (err) {
      console.error("Failed to fetch place details:", err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const confirmPlaceSelection = () => {
    if (previewPlace) {
      setSelectedPlace(previewPlace);
      setShowPlacePreview(false);
      setPreviewPlace(null);
      setPlaceSearch("");
    }
  };

  const selectGooglePlace = (prediction: GooglePrediction) => {
    setPendingGooglePlace(prediction);
    setShowPlaceTypeModal(true);
    setShowDropdown(false);
  };

  const createPlaceFromGoogle = async () => {
    if (!pendingGooglePlace) return;

    setCreatingPlace(true);
    try {
      const detailsRes = await fetch(
        `/api/places/details?place_id=${pendingGooglePlace.place_id}`
      );
      if (!detailsRes.ok) {
        throw new Error("Failed to get place details");
      }
      const { place: googleDetails } = await detailsRes.json();

      const createRes = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: pendingGooglePlace.structured_formatting.main_text,
          google_place_id: pendingGooglePlace.place_id,
          formatted_address: googleDetails.formatted_address,
          place_kind: selectedPlaceType,
          location: googleDetails.geometry?.location
            ? {
                lat: googleDetails.geometry.location.lat,
                lng: googleDetails.geometry.location.lng,
              }
            : null,
          address_components: googleDetails.address_components,
        }),
      });

      if (!createRes.ok) {
        const errData = await createRes.json();
        throw new Error(errData.error || "Failed to create place");
      }

      const newPlace = await createRes.json();
      setSelectedPlace({
        place_id: newPlace.place_id,
        display_name: newPlace.display_name,
        formatted_address: googleDetails.formatted_address,
        locality: null,
      });

      setShowPlaceTypeModal(false);
      setPendingGooglePlace(null);
      setPlaceSearch("");
    } catch (err) {
      console.error("Failed to create place:", err);
      setError(err instanceof Error ? err.message : "Failed to create place");
    } finally {
      setCreatingPlace(false);
    }
  };

  const selectPerson = async (result: SearchResult) => {
    try {
      const response = await fetch(`/api/people/${result.entity_id}`);
      if (response.ok) {
        const person = await response.json();
        setSelectedPerson({
          person_id: person.person_id,
          display_name: person.display_name,
        });
        setPersonSearch("");
        setPersonResults([]);
      }
    } catch (err) {
      console.error("Failed to fetch person details:", err);
    }
  };

  const clearPlace = () => {
    setSelectedPlace(null);
    setPlaceSearch("");
  };

  const clearPerson = () => {
    setSelectedPerson(null);
    setPersonSearch("");
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
      setError("Please select a location or provide a summary");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Location
          place_id: selectedPlace?.place_id || null,
          property_type: propertyType || null,
          location_description: locationDescription || null,
          // Contact
          requester_person_id: selectedPerson?.person_id || null,
          property_owner_contact: propertyOwnerContact || null,
          best_contact_times: bestContactTimes || null,
          // Permission & Access
          permission_status: permissionStatus,
          access_notes: accessNotes || null,
          traps_overnight_safe: trapsOvernightSafe,
          access_without_contact: accessWithoutContact,
          // About the Cats
          estimated_cat_count: estimatedCatCount || null,
          count_confidence: countConfidence,
          colony_duration: colonyDuration,
          eartip_count: showExactEartipCount ? (eartipCount || null) : null,
          eartip_estimate: !showExactEartipCount ? eartipEstimate : null,
          cats_are_friendly: catsAreFriendly,
          // Kittens
          has_kittens: hasKittens,
          kitten_count: hasKittens ? (kittenCount || null) : null,
          kitten_age_weeks: hasKittens ? (kittenAgeWeeks || null) : null,
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
      <a href="/requests">&larr; Back to requests</a>

      <h1 style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>New TNR Request</h1>

      {/* Place Type Selection Modal */}
      {showPlaceTypeModal && pendingGooglePlace && (
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
          onClick={() => setShowPlaceTypeModal(false)}
        >
          <div
            className="card"
            style={{
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
              maxHeight: "90vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "0.5rem" }}>What type of location is this?</h2>
            <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
              {pendingGooglePlace.description}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {PLACE_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem",
                    background: selectedPlaceType === opt.value ? "var(--primary)" : "transparent",
                    color: selectedPlaceType === opt.value ? "#fff" : "inherit",
                    borderRadius: "6px",
                    cursor: "pointer",
                    border: "1px solid var(--border)",
                  }}
                >
                  <input
                    type="radio"
                    name="placeType"
                    value={opt.value}
                    checked={selectedPlaceType === opt.value}
                    onChange={() => setSelectedPlaceType(opt.value)}
                    style={{ display: "none" }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{opt.label}</div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        opacity: selectedPlaceType === opt.value ? 0.9 : 0.6,
                      }}
                    >
                      {opt.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button onClick={createPlaceFromGoogle} disabled={creatingPlace}>
                {creatingPlace ? "Creating..." : "Create Location"}
              </button>
              <button
                type="button"
                onClick={() => setShowPlaceTypeModal(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Place Preview Modal */}
      {showPlacePreview && previewPlace && (
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
          onClick={() => setShowPlacePreview(false)}
        >
          <div
            className="card"
            style={{
              padding: "1.5rem",
              maxWidth: "550px",
              width: "90%",
              maxHeight: "90vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "0.25rem" }}>{previewPlace.display_name}</h2>
            {previewPlace.formatted_address && (
              <p className="text-muted" style={{ marginBottom: "1rem" }}>
                {previewPlace.formatted_address}
              </p>
            )}

            <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: "1.25rem" }}>
                  {previewPlace.cat_count || 0}
                </span>{" "}
                <span className="text-muted">cats</span>
              </div>
              <div>
                <span style={{ fontWeight: 600, fontSize: "1.25rem" }}>
                  {previewPlace.person_count || 0}
                </span>{" "}
                <span className="text-muted">people</span>
              </div>
            </div>

            {previewPlace.people && previewPlace.people.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Associated People
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {previewPlace.people.slice(0, 5).map((person) => (
                    <div key={person.person_id} style={{ fontSize: "0.9rem" }}>
                      {person.display_name}
                      {person.role && (
                        <span className="text-muted" style={{ marginLeft: "0.5rem" }}>
                          ({person.role})
                        </span>
                      )}
                    </div>
                  ))}
                  {previewPlace.people.length > 5 && (
                    <div className="text-muted text-sm">
                      +{previewPlace.people.length - 5} more
                    </div>
                  )}
                </div>
              </div>
            )}

            {previewPlace.cats && previewPlace.cats.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Recent Cats
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {previewPlace.cats.slice(0, 5).map((cat) => (
                    <div key={cat.cat_id} style={{ fontSize: "0.9rem" }}>
                      {cat.display_name}
                      {cat.microchip && (
                        <span className="text-muted" style={{ marginLeft: "0.5rem" }}>
                          {cat.microchip}
                        </span>
                      )}
                    </div>
                  ))}
                  {previewPlace.cats.length > 5 && (
                    <div className="text-muted text-sm">
                      +{previewPlace.cats.length - 5} more
                    </div>
                  )}
                </div>
              </div>
            )}

            {(!previewPlace.people || previewPlace.people.length === 0) &&
              (!previewPlace.cats || previewPlace.cats.length === 0) && (
                <p className="text-muted" style={{ marginBottom: "1rem" }}>
                  No cats or people associated with this location yet.
                </p>
              )}

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button type="button" onClick={confirmPlaceSelection}>
                Select This Location
              </button>
              <button
                type="button"
                onClick={() => setShowPlacePreview(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
          }}
        >
          <div className="card" style={{ padding: "1.5rem" }}>
            Loading place details...
          </div>
        </div>
      )}

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

          {selectedPlace ? (
            <div
              style={{
                padding: "1rem",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid var(--border)",
                marginBottom: "1rem",
              }}
            >
              <div>
                <strong>{selectedPlace.display_name}</strong>
                {selectedPlace.formatted_address && (
                  <p className="text-muted text-sm" style={{ margin: "0.25rem 0 0" }}>
                    {selectedPlace.formatted_address}
                  </p>
                )}
              </div>
              <button type="button" onClick={clearPlace} style={{ padding: "0.25rem 0.5rem" }}>
                Change
              </button>
            </div>
          ) : (
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input
                type="text"
                value={placeSearch}
                onChange={(e) => setPlaceSearch(e.target.value)}
                onFocus={() => placeSearch.length >= 3 && setShowDropdown(true)}
                placeholder="Type an address..."
                style={{ width: "100%" }}
              />

              {searchingPlaces && (
                <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                  Searching...
                </p>
              )}

              {showDropdown && (existingPlaces.length > 0 || googlePredictions.length > 0) && (
                <div className="dropdown-menu" style={{ marginTop: "0.25rem" }}>
                  {existingPlaces.length > 0 && (
                    <>
                      <div
                        style={{
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        Existing Locations
                      </div>
                      {existingPlaces.map((place) => (
                        <button
                          key={place.entity_id}
                          type="button"
                          onClick={() => previewExistingPlace(place)}
                          className="dropdown-item"
                        >
                          <div style={{ fontWeight: 500 }}>{place.display_name}</div>
                          {place.subtitle && (
                            <div className="text-muted text-sm">{place.subtitle}</div>
                          )}
                        </button>
                      ))}
                    </>
                  )}

                  {googlePredictions.length > 0 && (
                    <>
                      <div
                        style={{
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          borderBottom: "1px solid var(--border)",
                          borderTop:
                            existingPlaces.length > 0 ? "1px solid var(--border)" : "none",
                        }}
                      >
                        New Address
                      </div>
                      {googlePredictions.slice(0, 4).map((prediction) => (
                        <button
                          key={prediction.place_id}
                          type="button"
                          onClick={() => selectGooglePlace(prediction)}
                          className="dropdown-item"
                        >
                          <div style={{ fontWeight: 500 }}>
                            {prediction.structured_formatting.main_text}
                          </div>
                          <div className="text-muted text-sm">
                            {prediction.structured_formatting.secondary_text}
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

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

        {/* SECTION 2: Contact */}
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Contact Information</h2>

          {selectedPerson ? (
            <div
              style={{
                padding: "1rem",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid var(--border)",
                marginBottom: "1rem",
              }}
            >
              <strong>{selectedPerson.display_name}</strong>
              <button type="button" onClick={clearPerson} style={{ padding: "0.25rem 0.5rem" }}>
                Change
              </button>
            </div>
          ) : (
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input
                type="text"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search for requester..."
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
            </div>
          )}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={requesterLivesElsewhere}
              onChange={(e) => setRequesterLivesElsewhere(e.target.checked)}
            />
            Requester lives at a different address
          </label>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 250px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Property Owner/Manager Contact
              </label>
              <input
                type="text"
                value={propertyOwnerContact}
                onChange={(e) => setPropertyOwnerContact(e.target.value)}
                placeholder="Name and phone if different from requester"
                style={{ width: "100%" }}
              />
              <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                If requester is not the property owner
              </p>
            </div>

            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Best Times to Contact
              </label>
              <input
                type="text"
                value={bestContactTimes}
                onChange={(e) => setBestContactTimes(e.target.value)}
                placeholder="e.g., mornings, after 5pm..."
                style={{ width: "100%" }}
              />
            </div>
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

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div style={{ flex: "1 1 120px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                How many cats?
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

          {/* Smart ear-tip input */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Ear-tipped cats {showExactEartipCount ? "(exact count)" : "(estimate)"}
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
                  of {estimatedCatCount} cats are already ear-tipped
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
              Ear-tipped cats have already been spayed/neutered
            </p>
          </div>

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
                No, feral
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
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  How many kittens?
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

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Approximate age (weeks)
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
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  Kittens under 8 weeks need special care
                </p>
              </div>
            </div>
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
              Summary
            </label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief description of the request"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any other details, special circumstances, history with these cats..."
              rows={4}
              style={{ width: "100%", resize: "vertical" }}
            />
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
