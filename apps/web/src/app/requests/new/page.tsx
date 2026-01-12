"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
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

function NewRequestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Form state
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [estimatedCatCount, setEstimatedCatCount] = useState<number | "">("");
  const [hasKittens, setHasKittens] = useState(false);
  const [catsAreFriendly, setCatsAreFriendly] = useState<boolean | null>(null);
  const [priority, setPriority] = useState("normal");

  // Place selection
  const [placeSearch, setPlaceSearch] = useState("");
  const [existingPlaces, setExistingPlaces] = useState<SearchResult[]>([]);
  const [googlePredictions, setGooglePredictions] = useState<GooglePrediction[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // New place creation modal
  const [showPlaceTypeModal, setShowPlaceTypeModal] = useState(false);
  const [pendingGooglePlace, setPendingGooglePlace] = useState<GooglePrediction | null>(null);
  const [selectedPlaceType, setSelectedPlaceType] = useState("residential_house");
  const [creatingPlace, setCreatingPlace] = useState(false);

  // Place preview modal
  const [showPlacePreview, setShowPlacePreview] = useState(false);
  const [previewPlace, setPreviewPlace] = useState<PlaceDetails | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Person selection
  const [personSearch, setPersonSearch] = useState("");
  const [personResults, setPersonResults] = useState<SearchResult[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonDetails | null>(null);
  const [searchingPeople, setSearchingPeople] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Debounced place search - searches both existing places AND Google
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
        // Search both in parallel
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
    // Show modal to select place type before creating
    setPendingGooglePlace(prediction);
    setShowPlaceTypeModal(true);
    setShowDropdown(false);
  };

  const createPlaceFromGoogle = async () => {
    if (!pendingGooglePlace) return;

    setCreatingPlace(true);
    try {
      // Get full details from Google
      const detailsRes = await fetch(
        `/api/places/details?place_id=${pendingGooglePlace.place_id}`
      );
      if (!detailsRes.ok) {
        throw new Error("Failed to get place details");
      }
      const { place: googleDetails } = await detailsRes.json();

      // Create the place in our system
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
          place_id: selectedPlace?.place_id || null,
          requester_person_id: selectedPerson?.person_id || null,
          summary: summary || null,
          notes: notes || null,
          estimated_cat_count: estimatedCatCount || null,
          has_kittens: hasKittens,
          cats_are_friendly: catsAreFriendly,
          priority,
          created_by: "app_user",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to create request");
        return;
      }

      router.push(`/requests/${result.request_id}`);
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

            {/* Stats row */}
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

            {/* Associated People */}
            {previewPlace.people && previewPlace.people.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Associated People
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {previewPlace.people.slice(0, 5).map((person: { person_id: string; display_name: string; role: string }) => (
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

            {/* Associated Cats */}
            {previewPlace.cats && previewPlace.cats.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Recent Cats
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {previewPlace.cats.slice(0, 5).map((cat: { cat_id: string; display_name: string; microchip?: string }) => (
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

            {/* No associations */}
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

      {/* Loading Preview Indicator */}
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

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Location</h2>

          {selectedPlace ? (
            <div
              className="selected-item"
              style={{
                padding: "1rem",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid var(--border)",
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
            <div style={{ position: "relative" }}>
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
                  {/* Existing places in our system */}
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

                  {/* Google suggestions for new addresses */}
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
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Requester (Optional)</h2>

          {selectedPerson ? (
            <div
              className="selected-item"
              style={{
                padding: "1rem",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid var(--border)",
              }}
            >
              <strong>{selectedPerson.display_name}</strong>
              <button type="button" onClick={clearPerson} style={{ padding: "0.25rem 0.5rem" }}>
                Change
              </button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                type="text"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search for a person..."
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
              <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                Link to an existing person in the system
              </p>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Request Details</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
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

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Estimated Cats
                </label>
                <input
                  type="number"
                  min="0"
                  value={estimatedCatCount}
                  onChange={(e) =>
                    setEstimatedCatCount(e.target.value ? parseInt(e.target.value) : "")
                  }
                  placeholder="0"
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <label
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={hasKittens}
                  onChange={(e) => setHasKittens(e.target.checked)}
                />
                Has kittens
              </label>

              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <span>Cats friendly?</span>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="friendly"
                    checked={catsAreFriendly === true}
                    onChange={() => setCatsAreFriendly(true)}
                  />
                  Yes
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="friendly"
                    checked={catsAreFriendly === false}
                    onChange={() => setCatsAreFriendly(false)}
                  />
                  No
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="friendly"
                    checked={catsAreFriendly === null}
                    onChange={() => setCatsAreFriendly(null)}
                  />
                  Unknown
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details, special instructions, etc."
                rows={4}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
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
