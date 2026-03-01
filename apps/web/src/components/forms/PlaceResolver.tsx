"use client";

import { useState, useEffect, useRef } from "react";
import {
  usePlaceResolver,
  type ResolvedPlace,
  type UsePlaceResolverOptions,
} from "@/hooks/usePlaceResolver";

// ── Place kind options (union of requests/new + places/new) ──

const PLACE_KIND_OPTIONS = [
  { value: "residential_house", label: "House", description: "Single family home" },
  { value: "apartment_unit", label: "Apartment", description: "Unit in apartment building" },
  { value: "apartment_building", label: "Apt Building", description: "Multi-unit building" },
  { value: "business", label: "Business", description: "Store, restaurant, office" },
  { value: "outdoor_site", label: "Outdoor Site", description: "Park, lot, open area" },
  { value: "neighborhood", label: "Neighborhood", description: "General area, colony" },
  { value: "clinic", label: "Clinic/Vet", description: "Veterinary clinic or shelter" },
  { value: "unknown", label: "Other", description: "Not sure or other type" },
];

// ── Props ──

interface PlaceResolverProps {
  value: ResolvedPlace | null;
  onChange: (place: ResolvedPlace | null) => void;
  /** Called immediately when a Google address is selected (before place type modal) */
  onAddressPreview?: (address: string) => void;
  placeholder?: string;
  disabled?: boolean;
  showDescribeLocation?: boolean;
  allowCreate?: boolean;
  resolverOptions?: UsePlaceResolverOptions;
  className?: string;
}

// ── Component ──

export default function PlaceResolver({
  value,
  onChange,
  onAddressPreview,
  placeholder = "Search for an address...",
  disabled = false,
  showDescribeLocation = false,
  allowCreate = true,
  resolverOptions,
  className,
}: PlaceResolverProps) {
  const resolver = usePlaceResolver(resolverOptions);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Place type modal state
  const [showPlaceTypeModal, setShowPlaceTypeModal] = useState(false);
  const [selectedPlaceKind, setSelectedPlaceKind] = useState("residential_house");

  // Duplicate modal state
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const [unitIdentifier, setUnitIdentifier] = useState("");

  // Describe location state
  const [showDescriptionMode, setShowDescriptionMode] = useState(false);
  const [locationDescription, setLocationDescription] = useState("");
  const [descPlaceKind, setDescPlaceKind] = useState("outdoor_site");

  // Sync external value → internal state
  useEffect(() => {
    if (value && (!resolver.selectedPlace || resolver.selectedPlace.place_id !== value.place_id)) {
      resolver.setPlace(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync internal state → external onChange
  useEffect(() => {
    if (resolver.selectedPlace?.place_id !== value?.place_id) {
      onChange(resolver.selectedPlace);
    }
  }, [resolver.selectedPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show duplicate modal when duplicate detected
  useEffect(() => {
    if (resolver.duplicateCheck) {
      setShowDuplicateModal(true);
    }
  }, [resolver.duplicateCheck]);

  // Show place type modal when Google place selected without duplicate
  useEffect(() => {
    if (resolver.pendingGoogle && !resolver.duplicateCheck && !resolver.checkingDuplicate) {
      setShowPlaceTypeModal(true);
    }
  }, [resolver.pendingGoogle, resolver.duplicateCheck, resolver.checkingDuplicate]);

  // Call onAddressPreview when a Google address is selected (before place type modal)
  useEffect(() => {
    if (resolver.pendingGoogle?.description && onAddressPreview) {
      onAddressPreview(resolver.pendingGoogle.description);
    }
  }, [resolver.pendingGoogle, onAddressPreview]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        resolver.setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──

  const handleCreateFromGoogle = async () => {
    await resolver.createFromGoogle(selectedPlaceKind);
    setShowPlaceTypeModal(false);
    setSelectedPlaceKind("residential_house");
  };

  const handleSelectExistingDuplicate = () => {
    resolver.selectExistingDuplicate();
    setShowDuplicateModal(false);
    setAddingUnit(false);
    setUnitIdentifier("");
  };

  const handleCreateUnit = async () => {
    if (!unitIdentifier.trim() || !resolver.duplicateCheck?.existingPlace) return;
    await resolver.createUnit(
      resolver.duplicateCheck.existingPlace.place_id,
      unitIdentifier.trim()
    );
    setShowDuplicateModal(false);
    setAddingUnit(false);
    setUnitIdentifier("");
  };

  const handleCancelDuplicate = () => {
    setShowDuplicateModal(false);
    setAddingUnit(false);
    setUnitIdentifier("");
    resolver.clearDuplicateCheck();
  };

  const handleCreateFromDescription = async () => {
    if (!locationDescription.trim()) return;
    await resolver.resolveDescription(locationDescription.trim(), descPlaceKind);
    setShowDescriptionMode(false);
    setLocationDescription("");
    setDescPlaceKind("outdoor_site");
  };

  const handleClear = () => {
    resolver.clearSelection();
    onChange(null);
  };

  // ── Render: Selected place chip ──

  if (resolver.selectedPlace) {
    return (
      <div className={className}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "var(--bg-secondary, #f8f9fa)",
            borderRadius: "6px",
            border: "1px solid var(--border, #dee2e6)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resolver.selectedPlace.display_name}
            </div>
            {resolver.selectedPlace.formatted_address && (
              <div style={{ fontSize: "0.8rem", color: "var(--muted, #6c757d)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {resolver.selectedPlace.formatted_address}
              </div>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0.25rem",
                color: "var(--muted, #6c757d)",
                fontSize: "1.1rem",
                lineHeight: 1,
                flexShrink: 0,
              }}
              title="Clear selection"
            >
              &times;
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Search mode ──

  return (
    <div className={className} style={{ position: "relative" }}>
      {/* Search input */}
      {!showDescriptionMode ? (
        <>
          <input
            ref={inputRef}
            type="text"
            value={resolver.query}
            onChange={(e) => resolver.setQuery(e.target.value)}
            onFocus={() => {
              if (resolver.atlasResults.length > 0 || resolver.googleResults.length > 0) {
                resolver.setShowDropdown(true);
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            style={{ width: "100%" }}
            autoComplete="off"
          />

          {/* Loading indicator */}
          {(resolver.searching || resolver.checkingDuplicate) && (
            <div
              style={{
                position: "absolute",
                right: "10px",
                top: "10px",
                fontSize: "0.75rem",
                color: "var(--muted, #6c757d)",
              }}
            >
              {resolver.checkingDuplicate ? "Checking..." : "..."}
            </div>
          )}

          {/* Describe location fallback */}
          {showDescribeLocation && (
            <p
              className="text-muted text-sm"
              style={{ marginTop: "0.5rem", cursor: "pointer" }}
              onClick={() => setShowDescriptionMode(true)}
            >
              Can&apos;t find the exact address?{" "}
              <span style={{ textDecoration: "underline" }}>Describe the location instead</span>
            </p>
          )}
        </>
      ) : (
        /* Describe location mode */
        <>
          <textarea
            value={locationDescription}
            onChange={(e) => setLocationDescription(e.target.value)}
            placeholder="Describe the location (e.g., 'corner of Main St and Oak Ave', 'behind the Safeway on Cleveland')"
            rows={3}
            style={{ width: "100%", resize: "vertical" }}
          />
          <div style={{ marginTop: "0.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Location type
            </label>
            <select
              value={descPlaceKind}
              onChange={(e) => setDescPlaceKind(e.target.value)}
              style={{ width: "100%", marginBottom: "0.5rem" }}
            >
              {PLACE_KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.description}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button
              type="button"
              onClick={handleCreateFromDescription}
              disabled={!locationDescription.trim() || resolver.creating}
            >
              {resolver.creating ? "Creating..." : "Create Location"}
            </button>
            <button
              type="button"
              onClick={() => setShowDescriptionMode(false)}
              style={{ background: "transparent", color: "var(--muted, #6c757d)", border: "none" }}
            >
              Use address search instead
            </button>
          </div>
        </>
      )}

      {/* Error display */}
      {resolver.error && (
        <div
          style={{
            background: "#fee2e2",
            color: "#dc2626",
            padding: "0.5rem 0.75rem",
            borderRadius: "4px",
            marginTop: "0.5rem",
            fontSize: "0.85rem",
            border: "1px solid #fca5a5",
          }}
        >
          {resolver.error}
        </div>
      )}

      {/* Dropdown results */}
      {resolver.showDropdown &&
        !showDescriptionMode &&
        (resolver.atlasResults.length > 0 || resolver.googleResults.length > 0) && (
          <div
            ref={dropdownRef}
            className="dropdown-menu"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              maxHeight: "300px",
              overflowY: "auto",
              zIndex: 1000,
              marginTop: "0.25rem",
            }}
          >
            {/* Atlas results */}
            {resolver.atlasResults.length > 0 && (
              <>
                <div
                  style={{
                    padding: "0.5rem 0.75rem",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--muted, #6c757d)",
                    textTransform: "uppercase",
                    borderBottom: "1px solid var(--border, #dee2e6)",
                  }}
                >
                  Existing Locations
                </div>
                {resolver.atlasResults.map((place) => (
                  <button
                    key={place.entity_id}
                    type="button"
                    onClick={() => resolver.selectAtlasPlace(place)}
                    className="dropdown-item"
                    style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 500 }}>{place.display_name}</div>
                    {place.subtitle && (
                      <div className="text-muted text-sm">{place.subtitle}</div>
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Google results */}
            {allowCreate && resolver.googleResults.length > 0 && (
              <>
                <div
                  style={{
                    padding: "0.5rem 0.75rem",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--muted, #6c757d)",
                    textTransform: "uppercase",
                    borderBottom: "1px solid var(--border, #dee2e6)",
                    borderTop:
                      resolver.atlasResults.length > 0
                        ? "1px solid var(--border, #dee2e6)"
                        : "none",
                  }}
                >
                  New Address
                </div>
                {resolver.googleResults.map((prediction) => (
                  <button
                    key={prediction.place_id}
                    type="button"
                    onClick={() => resolver.selectGooglePlace(prediction)}
                    className="dropdown-item"
                    style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer" }}
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

      {/* ── Place Type Modal ── */}
      {showPlaceTypeModal && resolver.pendingGoogle && (
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
          onClick={() => {
            setShowPlaceTypeModal(false);
            resolver.clearDuplicateCheck();
          }}
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
              {resolver.pendingGoogle.description}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {PLACE_KIND_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem",
                    background:
                      selectedPlaceKind === opt.value ? "var(--primary, #0d6efd)" : "transparent",
                    color: selectedPlaceKind === opt.value ? "#fff" : "inherit",
                    borderRadius: "6px",
                    cursor: "pointer",
                    border: "1px solid var(--border, #dee2e6)",
                  }}
                >
                  <input
                    type="radio"
                    name="placeKind"
                    value={opt.value}
                    checked={selectedPlaceKind === opt.value}
                    onChange={() => setSelectedPlaceKind(opt.value)}
                    style={{ display: "none" }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{opt.label}</div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        opacity: selectedPlaceKind === opt.value ? 0.9 : 0.6,
                      }}
                    >
                      {opt.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {resolver.error && (
              <div
                style={{
                  background: "#fee2e2",
                  color: "#dc2626",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  marginTop: "1rem",
                  fontSize: "0.9rem",
                  border: "1px solid #fca5a5",
                }}
              >
                {resolver.error}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button type="button" onClick={handleCreateFromGoogle} disabled={resolver.creating}>
                {resolver.creating ? "Creating..." : "Create Location"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPlaceTypeModal(false);
                  resolver.clearDuplicateCheck();
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border, #dee2e6)",
                  color: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate Address Modal ── */}
      {showDuplicateModal && resolver.duplicateCheck && resolver.pendingGoogle && (
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
          onClick={handleCancelDuplicate}
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
            {/* Warning icon */}
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "#ffc107",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1rem",
                color: "#000",
                fontSize: "1.5rem",
              }}
            >
              !
            </div>
            <h2 style={{ marginBottom: "0.5rem", textAlign: "center" }}>
              Address Already Exists
            </h2>
            <p className="text-muted" style={{ textAlign: "center", marginBottom: "1rem" }}>
              This address is already in our system.
            </p>

            {/* Existing place info */}
            <div
              style={{
                padding: "1rem",
                border: "1px solid var(--border, #dee2e6)",
                borderRadius: "8px",
                marginBottom: "1rem",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                {resolver.duplicateCheck.existingPlace?.display_name}
              </div>
              <div className="text-muted text-sm">
                {resolver.duplicateCheck.existingPlace?.formatted_address}
              </div>
            </div>

            {!addingUnit ? (
              <>
                <p style={{ marginBottom: "1rem", fontSize: "0.95rem" }}>
                  Would you like to use this existing location, or are you adding a new
                  unit/apartment at this address?
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <button type="button" onClick={handleSelectExistingDuplicate}>
                    Use Existing Location
                  </button>
                  {resolver.duplicateCheck.canAddUnit && (
                    <button
                      type="button"
                      onClick={() => setAddingUnit(true)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border, #dee2e6)",
                        color: "inherit",
                      }}
                    >
                      Add Unit to This Address
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCancelDuplicate}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted, #6c757d)",
                      fontSize: "0.9rem",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
                  Enter the unit identifier for this location:
                </p>
                <div style={{ marginBottom: "1rem" }}>
                  <input
                    type="text"
                    value={unitIdentifier}
                    onChange={(e) => setUnitIdentifier(e.target.value)}
                    placeholder="e.g., Apt 5, Unit B, #12, Space 101"
                    style={{ width: "100%" }}
                    autoFocus
                  />
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    type="button"
                    onClick={handleCreateUnit}
                    disabled={!unitIdentifier.trim() || resolver.creating}
                  >
                    {resolver.creating ? "Creating..." : "Create Unit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingUnit(false);
                      setUnitIdentifier("");
                    }}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border, #dee2e6)",
                      color: "inherit",
                    }}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export types for consumers
export type { ResolvedPlace, UsePlaceResolverOptions } from "@/hooks/usePlaceResolver";
