"use client";

import { useState, useEffect } from "react";
import AddressAutocomplete from "@/components/AddressAutocomplete";

interface PlaceDetails {
  place_id: string;
  formatted_address: string;
  name: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

interface ExistingPlace {
  place_id: string;
  display_name: string;
  place_kind: string | null;
  formatted_address: string;
  cat_count: number;
  person_count: number;
}

interface NearbyResult {
  existing_places: ExistingPlace[];
  existing_address: boolean;
  address_id: string | null;
}

const PLACE_KINDS = [
  { value: "residential_house", label: "Residence (House)" },
  { value: "apartment_unit", label: "Apartment Unit" },
  { value: "apartment_building", label: "Apartment Building" },
  { value: "outdoor_site", label: "Outdoor Site / Colony" },
  { value: "business", label: "Business" },
  { value: "clinic", label: "Clinic / Vet / Shelter" },
  { value: "neighborhood", label: "Neighborhood / Area" },
  { value: "unknown", label: "Other / Unknown" },
];

export default function NewPlacePage() {
  // Step tracking
  const [step, setStep] = useState<"address" | "confirm" | "details">("address");

  // Address input
  const [addressInput, setAddressInput] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [showDescriptionMode, setShowDescriptionMode] = useState(false);
  const [locationDescription, setLocationDescription] = useState("");

  // Nearby results
  const [nearbyResults, setNearbyResults] = useState<NearbyResult | null>(null);
  const [loadingNearby, setLoadingNearby] = useState(false);

  // Place details form
  const [placeName, setPlaceName] = useState("");
  const [placeKind, setPlaceKind] = useState("");
  const [placeNotes, setPlaceNotes] = useState("");

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPlaceId, setCreatedPlaceId] = useState<string | null>(null);

  // Handle place selection from autocomplete
  const handlePlaceSelect = async (place: PlaceDetails) => {
    setSelectedPlace(place);
    setError(null);

    // Check for existing places nearby
    setLoadingNearby(true);
    try {
      const response = await fetch(
        `/api/places/nearby?lat=${place.geometry.location.lat}&lng=${place.geometry.location.lng}&google_place_id=${place.place_id}`
      );
      if (response.ok) {
        const data = await response.json();
        setNearbyResults(data);
      }
    } catch (err) {
      console.error("Error checking nearby:", err);
    } finally {
      setLoadingNearby(false);
      setStep("confirm");
    }
  };

  // Create the place
  const handleCreate = async () => {
    if (!selectedPlace && !locationDescription) {
      setError("Please enter an address or location description");
      return;
    }

    if (!placeKind) {
      setError("Please select a place type");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_place_id: selectedPlace?.place_id,
          formatted_address: selectedPlace?.formatted_address,
          lat: selectedPlace?.geometry.location.lat,
          lng: selectedPlace?.geometry.location.lng,
          display_name: placeName || selectedPlace?.name || locationDescription,
          place_kind: placeKind,
          notes: placeNotes || null,
          location_type: selectedPlace ? "geocoded" : "described",
          location_description: locationDescription || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create place");
      }

      const data = await response.json();
      setCreatedPlaceId(data.place_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create place");
    } finally {
      setSubmitting(false);
    }
  };

  // Success - redirect
  if (createdPlaceId) {
    return (
      <div>
        <a href="/places">&larr; Back to places</a>
        <div style={{ marginTop: "2rem", textAlign: "center" }}>
          <h2 style={{ color: "#28a745" }}>Place Created!</h2>
          <p style={{ marginTop: "1rem" }}>
            <a href={`/places/${createdPlaceId}`}>View Place Details</a>
          </p>
          <p style={{ marginTop: "0.5rem" }}>
            <a href="/places/new">Create Another Place</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <a href="/places">&larr; Back to places</a>
      <h1 style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>New Place</h1>

      {/* Step 1: Address */}
      {step === "address" && (
        <div>
          <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
            Where is this place?
          </h2>

          {!showDescriptionMode ? (
            <>
              <AddressAutocomplete
                value={addressInput}
                onChange={setAddressInput}
                onPlaceSelect={handlePlaceSelect}
                placeholder="Start typing an address..."
              />
              <p
                className="text-muted text-sm"
                style={{ marginTop: "0.5rem", cursor: "pointer" }}
                onClick={() => setShowDescriptionMode(true)}
              >
                Can&apos;t find the exact address?{" "}
                <span style={{ textDecoration: "underline" }}>
                  Describe the location instead
                </span>
              </p>
            </>
          ) : (
            <>
              <textarea
                value={locationDescription}
                onChange={(e) => setLocationDescription(e.target.value)}
                placeholder="Describe the location (e.g., 'corner of Main St and Oak Ave', 'behind the Safeway on Cleveland')"
                rows={3}
                style={{ width: "100%", resize: "vertical" }}
              />
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "1rem" }}>
                <button
                  onClick={() => {
                    if (locationDescription.trim()) {
                      setStep("details");
                    }
                  }}
                  disabled={!locationDescription.trim()}
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => setShowDescriptionMode(false)}
                  style={{ background: "transparent", color: "#6c757d" }}
                >
                  Use address search instead
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 2: Confirm / Check Existing */}
      {step === "confirm" && selectedPlace && (
        <div>
          <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
            Confirm Location
          </h2>

          <div
            style={{
              background: "#f8f9fa",
              padding: "1rem",
              borderRadius: "8px",
              marginBottom: "1.5rem",
            }}
          >
            <div style={{ fontWeight: 500 }}>{selectedPlace.formatted_address}</div>
            <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Google Place ID: {selectedPlace.place_id.substring(0, 20)}...
            </div>
          </div>

          {loadingNearby ? (
            <div className="loading">Checking for existing places...</div>
          ) : nearbyResults && nearbyResults.existing_places.length > 0 ? (
            <div>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#ffc107" }}>
                Existing places at or near this location:
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {nearbyResults.existing_places.map((place) => (
                  <div
                    key={place.place_id}
                    style={{
                      background: "#fff3cd",
                      padding: "1rem",
                      borderRadius: "4px",
                      border: "1px solid #ffc107",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{place.display_name}</div>
                        <div className="text-sm text-muted">
                          {place.place_kind || "place"} · {place.cat_count} cats · {place.person_count} people
                        </div>
                      </div>
                      <a
                        href={`/places/${place.place_id}`}
                        className="badge badge-primary"
                        style={{ alignSelf: "center" }}
                      >
                        View
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-muted text-sm" style={{ marginTop: "1rem" }}>
                If this is the same location, consider using the existing place instead.
              </p>
            </div>
          ) : (
            <div style={{ color: "#28a745", marginBottom: "1rem" }}>
              No existing places found at this location.
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button onClick={() => setStep("details")}>
              Create New Place Here
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("address");
                setSelectedPlace(null);
                setNearbyResults(null);
              }}
              style={{ background: "transparent", color: "#6c757d" }}
            >
              Choose Different Address
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Place Details */}
      {step === "details" && (
        <div>
          <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
            Place Details
          </h2>

          {selectedPlace && (
            <div
              style={{
                background: "#e9ecef",
                padding: "0.75rem",
                borderRadius: "4px",
                marginBottom: "1.5rem",
                fontSize: "0.875rem",
              }}
            >
              {selectedPlace.formatted_address}
            </div>
          )}

          {locationDescription && !selectedPlace && (
            <div
              style={{
                background: "#fff3cd",
                padding: "0.75rem",
                borderRadius: "4px",
                marginBottom: "1.5rem",
                fontSize: "0.875rem",
              }}
            >
              <strong>Approximate location:</strong> {locationDescription}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Place Name (optional)
              </label>
              <input
                type="text"
                value={placeName}
                onChange={(e) => setPlaceName(e.target.value)}
                placeholder={selectedPlace?.name || "e.g., Smith Residence, Old Stony Point, OSP Colony"}
                style={{ width: "100%" }}
              />
              <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                Give this place a memorable name, or leave blank to use the address.
                You can rename it later.
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Place Type *
              </label>
              <select
                value={placeKind}
                onChange={(e) => setPlaceKind(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">Select type...</option>
                {PLACE_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Notes (optional)
              </label>
              <textarea
                value={placeNotes}
                onChange={(e) => setPlaceNotes(e.target.value)}
                placeholder="Any additional details about this location..."
                rows={3}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
          </div>

          {error && (
            <div style={{ color: "#dc3545", marginTop: "1rem" }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create Place"}
            </button>
            <button
              type="button"
              onClick={() => setStep(selectedPlace ? "confirm" : "address")}
              style={{ background: "transparent", color: "#6c757d" }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
