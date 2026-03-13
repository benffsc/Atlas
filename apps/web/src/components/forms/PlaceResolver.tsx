"use client";

import { useState, useEffect, useRef } from "react";
import {
  usePlaceResolver,
  type ResolvedPlace,
  type UsePlaceResolverOptions,
} from "@/hooks/usePlaceResolver";
import { formatPlaceKind } from "@/lib/display-labels";

// ── Place kind options (for "describe location" fallback only) ──

const DESCRIBE_PLACE_KIND_OPTIONS = [
  { value: "outdoor_site", label: "Outdoor Site", description: "Park, lot, open area" },
  { value: "neighborhood", label: "Neighborhood", description: "General area, colony" },
  { value: "residential_house", label: "House", description: "Single family home" },
  { value: "business", label: "Business", description: "Store, restaurant, office" },
  { value: "unknown", label: "Other", description: "Not sure or other type" },
];

// ── Props ──

interface PlaceResolverProps {
  value: ResolvedPlace | null;
  onChange: (place: ResolvedPlace | null) => void;
  /** Called immediately when a Google address is selected (before resolution completes) */
  onAddressPreview?: (address: string) => void;
  /** Called when a place_kind is determined (from existing place match) */
  onPlaceKindResolved?: (placeKind: string) => void;
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
  onPlaceKindResolved,
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

  // Unit creation state (for inline duplicate handling)
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

  const handleSelectGoogle = async (prediction: Parameters<typeof resolver.selectGooglePlace>[0]) => {
    // Notify parent immediately with the address text
    onAddressPreview?.(prediction.description);

    // Resolve inline — no modal
    const placeKind = await resolver.selectGooglePlace(prediction);
    if (placeKind) {
      onPlaceKindResolved?.(placeKind);
    }
  };

  const handleSelectExistingDuplicate = () => {
    // Already selected by the resolver — just dismiss the info banner
    resolver.dismissDuplicate();
    setAddingUnit(false);
    setUnitIdentifier("");
  };

  const handleCreateUnit = async () => {
    if (!unitIdentifier.trim() || !resolver.duplicateInfo?.existingPlace) return;
    await resolver.createUnit(
      resolver.duplicateInfo.existingPlace.place_id,
      unitIdentifier.trim()
    );
    setAddingUnit(false);
    setUnitIdentifier("");
  };

  const handleDismissDuplicate = () => {
    resolver.dismissDuplicate();
    setAddingUnit(false);
    setUnitIdentifier("");
  };

  const handleCreateFromDescription = async () => {
    if (!locationDescription.trim()) return;
    await resolver.resolveDescription(locationDescription.trim(), descPlaceKind);
    onPlaceKindResolved?.(descPlaceKind);
    setShowDescriptionMode(false);
    setLocationDescription("");
    setDescPlaceKind("outdoor_site");
  };

  const handleClear = () => {
    resolver.clearSelection();
    onChange(null);
  };

  // ── Render: Resolving state (inline spinner while creating place) ──

  if (resolver.resolving) {
    return (
      <div className={className}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem",
            background: "var(--bg-secondary, #f8f9fa)",
            borderRadius: "6px",
            border: "1px solid var(--border, #dee2e6)",
          }}
        >
          <div
            style={{
              width: "16px",
              height: "16px",
              border: "2px solid var(--border, #dee2e6)",
              borderTopColor: "var(--primary, #0d6efd)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resolver.resolvingAddress || "Resolving address..."}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted, #6c757d)" }}>
              Setting up location...
            </div>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

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

        {/* Inline duplicate info banner */}
        {resolver.duplicateInfo && resolver.duplicateInfo.existingPlace && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.75rem",
              background: "#fff8e1",
              border: "1px solid #ffe082",
              borderRadius: "6px",
              fontSize: "0.9rem",
            }}
          >
            {!addingUnit ? (
              <>
                <div style={{ marginBottom: "0.5rem", fontWeight: 500 }}>
                  This address already exists in Atlas
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted, #6c757d)", marginBottom: "0.5rem" }}>
                  {resolver.duplicateInfo.existingPlace.display_name}
                  {resolver.duplicateInfo.existingPlace.cat_count > 0 && ` — ${resolver.duplicateInfo.existingPlace.cat_count} cats`}
                  {resolver.duplicateInfo.existingPlace.request_count > 0 && ` — ${resolver.duplicateInfo.existingPlace.request_count} requests`}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleSelectExistingDuplicate}
                    style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem" }}
                  >
                    Use Existing
                  </button>
                  {resolver.duplicateInfo.canAddUnit && (
                    <button
                      type="button"
                      onClick={() => setAddingUnit(true)}
                      style={{
                        fontSize: "0.85rem",
                        padding: "0.3rem 0.75rem",
                        background: "transparent",
                        border: "1px solid var(--border, #dee2e6)",
                        color: "inherit",
                      }}
                    >
                      Add Unit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDismissDuplicate}
                    style={{
                      fontSize: "0.85rem",
                      padding: "0.3rem 0.75rem",
                      background: "transparent",
                      border: "none",
                      color: "var(--muted, #6c757d)",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: "0.5rem", fontWeight: 500 }}>
                  Add unit to {resolver.duplicateInfo.existingPlace.display_name}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="text"
                    value={unitIdentifier}
                    onChange={(e) => setUnitIdentifier(e.target.value)}
                    placeholder="e.g., Apt 5, Unit B, #12"
                    style={{ flex: 1, fontSize: "0.9rem" }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleCreateUnit}
                    disabled={!unitIdentifier.trim() || resolver.creating}
                    style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem", whiteSpace: "nowrap" }}
                  >
                    {resolver.creating ? "Creating..." : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingUnit(false); setUnitIdentifier(""); }}
                    style={{
                      fontSize: "0.85rem",
                      padding: "0.3rem 0.75rem",
                      background: "transparent",
                      border: "1px solid var(--border, #dee2e6)",
                      color: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        )}
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
          {resolver.searching && (
            <div
              style={{
                position: "absolute",
                right: "10px",
                top: "10px",
                fontSize: "0.75rem",
                color: "var(--muted, #6c757d)",
              }}
            >
              ...
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
              {DESCRIBE_PLACE_KIND_OPTIONS.map((opt) => (
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
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 500 }}>{place.display_name}</span>
                      {place.metadata?.place_kind && (
                        <span
                          style={{
                            fontSize: "0.65rem",
                            padding: "0.1rem 0.4rem",
                            borderRadius: "9999px",
                            background: "var(--bg-secondary, #f3f4f6)",
                            color: "var(--muted, #6c757d)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatPlaceKind(place.metadata.place_kind)}
                        </span>
                      )}
                    </div>
                    {place.subtitle && (
                      <div className="text-muted text-sm">{place.subtitle}</div>
                    )}
                    {(place.metadata?.cat_count != null && place.metadata.cat_count > 0 || place.metadata?.person_count != null && place.metadata.person_count > 0) && (
                      <div style={{ fontSize: "0.7rem", color: "var(--muted, #6c757d)" }}>
                        {place.metadata?.cat_count != null && place.metadata.cat_count > 0 && `${place.metadata.cat_count} cats`}
                        {place.metadata?.cat_count != null && place.metadata.cat_count > 0 && place.metadata?.person_count != null && place.metadata.person_count > 0 && " · "}
                        {place.metadata?.person_count != null && place.metadata.person_count > 0 && `${place.metadata.person_count} people`}
                      </div>
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
                    onClick={() => handleSelectGoogle(prediction)}
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
    </div>
  );
}

// Re-export types for consumers
export type { ResolvedPlace, UsePlaceResolverOptions } from "@/hooks/usePlaceResolver";
