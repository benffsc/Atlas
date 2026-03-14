"use client";

import { useCallback } from "react";
import { PlaceResolver } from "@/components/forms";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import {
  PROPERTY_TYPE_OPTIONS,
  COUNTY_OPTIONS,
} from "@/lib/form-options";

// --- Types ---

export interface PlaceSectionValue {
  place: ResolvedPlace | null;
  propertyType: string;
  county: string;
  whereOnProperty: string;
}

interface KnownAddress {
  place_id: string;
  formatted_address: string;
  display_name?: string | null;
  role?: string;
}

export interface PlaceSectionProps {
  label?: string;
  value: PlaceSectionValue;
  onChange: (data: PlaceSectionValue) => void;
  /** Show property type dropdown. Default: true */
  showPropertyType?: boolean;
  /** Show county dropdown. Default: true */
  showCounty?: boolean;
  /** Show "where on property" text input. Default: true */
  showWhereOnProperty?: boolean;
  /** Known addresses for quick-fill (e.g., from selected person) */
  knownAddresses?: KnownAddress[];
  /** Label for known addresses banner (e.g., person name) */
  knownAddressesLabel?: string;
  /** Show PlaceResolver's "describe location" fallback. Default: true */
  showDescribeLocation?: boolean;
  compact?: boolean;
  required?: boolean;
}

// --- Constants ---

const EMPTY_VALUE: PlaceSectionValue = {
  place: null,
  propertyType: "",
  county: "Sonoma",
  whereOnProperty: "",
};

/** Map PlaceResolver place_kind to request form property_type */
function placeKindToPropertyType(placeKind: string): string {
  const map: Record<string, string> = {
    residential_house: "private_home",
    apartment_unit: "apartment_complex",
    apartment_building: "apartment_complex",
    mobile_home_space: "mobile_home_park",
    business: "business",
    outdoor_site: "public_park",
    neighborhood: "rural_unincorporated",
    clinic: "other",
    unknown: "",
  };
  return map[placeKind] || "";
}

// --- Component ---

export function PlaceSection({
  label = "Cat Location",
  value,
  onChange,
  showPropertyType = true,
  showCounty = true,
  showWhereOnProperty = true,
  knownAddresses,
  knownAddressesLabel,
  showDescribeLocation = true,
  compact = false,
  required = false,
}: PlaceSectionProps) {
  // Handle PlaceResolver selection
  const handlePlaceResolved = useCallback(
    (place: ResolvedPlace | null) => {
      const updated = { ...value, place };
      // Auto-sync property type from Atlas place_kind when not already set
      if (place?.place_kind && !value.propertyType) {
        updated.propertyType = placeKindToPropertyType(place.place_kind);
      }
      onChange(updated);
    },
    [value, onChange]
  );

  // Handle place_kind resolution callback (fires when place_kind determined separately)
  const handlePlaceKindResolved = useCallback(
    (placeKind: string) => {
      if (!value.propertyType) {
        onChange({ ...value, propertyType: placeKindToPropertyType(placeKind) });
      }
    },
    [value, onChange]
  );

  // Handle known address quick-fill
  const handleUseKnownAddress = useCallback(
    (addr: KnownAddress) => {
      onChange({
        ...value,
        place: {
          place_id: addr.place_id,
          display_name: addr.display_name || addr.formatted_address,
          formatted_address: addr.formatted_address,
          locality: null,
        },
      });
    },
    [value, onChange]
  );

  // Field change helpers
  const handleFieldChange = useCallback(
    (field: keyof PlaceSectionValue, fieldValue: string) => {
      onChange({ ...value, [field]: fieldValue });
    },
    [value, onChange]
  );

  // --- Styles ---

  const sectionStyle: React.CSSProperties = compact
    ? { marginBottom: "12px" }
    : {
        marginBottom: "20px",
        padding: "16px",
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "10px",
        background: "var(--card-bg, #fff)",
      };

  const headerStyle: React.CSSProperties = {
    fontSize: compact ? "0.85rem" : "0.95rem",
    fontWeight: 600,
    marginBottom: compact ? "8px" : "12px",
    ...(compact
      ? {}
      : {
          paddingBottom: "8px",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
        }),
  };

  const fieldRowStyle: React.CSSProperties = {
    display: "flex",
    gap: compact ? "8px" : "1rem",
    flexWrap: "wrap",
    marginTop: compact ? "8px" : "1rem",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: compact ? "6px 10px" : "10px 12px",
    border: "1px solid var(--card-border, #e5e7eb)",
    borderRadius: "8px",
    fontSize: compact ? "0.85rem" : "0.9rem",
    background: "var(--background, #fff)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: compact ? "6px 10px" : "10px 12px",
    border: "1px solid var(--card-border, #e5e7eb)",
    borderRadius: "8px",
    fontSize: compact ? "0.85rem" : "0.9rem",
    background: "var(--background, #fff)",
  };

  const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "0.25rem",
    fontWeight: 500,
    fontSize: compact ? "0.8rem" : "0.9rem",
  };

  // --- Render ---

  const showKnownAddresses =
    knownAddresses && knownAddresses.length > 0 && !value.place;

  // Determine which context fields to render
  const hasContextFields = showPropertyType || showCounty || showWhereOnProperty;

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>
        {label}
        {required && (
          <span style={{ color: "#dc3545", marginLeft: "2px" }}>*</span>
        )}
      </div>

      {/* Known address quick-fill */}
      {showKnownAddresses && (
        <div
          style={{
            marginBottom: "1rem",
            padding: compact ? "0.75rem" : "1rem",
            background: "var(--success-bg, #d4edda)",
            border: "2px solid var(--success, #28a745)",
            borderRadius: "8px",
          }}
        >
          <p
            style={{
              margin: "0 0 0.75rem",
              fontWeight: 600,
              color: "var(--success, #155724)",
              fontSize: compact ? "0.8rem" : "0.9rem",
            }}
          >
            Quick fill from{" "}
            {knownAddressesLabel
              ? `${knownAddressesLabel}'s known addresses`
              : "known addresses"}
            :
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {knownAddresses!.map((addr) => (
              <button
                key={addr.place_id}
                type="button"
                onClick={() => handleUseKnownAddress(addr)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: compact ? "0.5rem" : "0.75rem",
                  background: "var(--card-bg, #fff)",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--foreground, #212529)",
                  fontSize: compact ? "0.85rem" : "0.9rem",
                }}
              >
                <span>
                  <span
                    style={{
                      display: "block",
                      color: "var(--foreground, #212529)",
                    }}
                  >
                    {addr.formatted_address}
                  </span>
                  {addr.role && (
                    <span
                      style={{
                        color: "var(--muted, #6c757d)",
                        fontSize: "0.85rem",
                      }}
                    >
                      ({addr.role})
                    </span>
                  )}
                </span>
                <span
                  style={{
                    color: "var(--primary)",
                    fontWeight: 500,
                    fontSize: "0.85rem",
                  }}
                >
                  Use this address
                </span>
              </button>
            ))}
          </div>
          <p
            style={{
              margin: "0.75rem 0 0",
              color: "var(--muted, #6c757d)",
              fontSize: "0.85rem",
            }}
          >
            Or search for a different address below
          </p>
        </div>
      )}

      {/* PlaceResolver — core address search/selection */}
      <PlaceResolver
        value={value.place}
        onChange={handlePlaceResolved}
        onPlaceKindResolved={handlePlaceKindResolved}
        placeholder="Type an address..."
        showDescribeLocation={showDescribeLocation}
      />

      {/* Context fields: County, Property Type, Where on property */}
      {hasContextFields && (
        <div style={fieldRowStyle}>
          {showCounty && (
            <div style={{ flex: "1 1 150px" }}>
              <label style={fieldLabelStyle}>County</label>
              <select
                value={value.county}
                onChange={(e) => handleFieldChange("county", e.target.value)}
                style={selectStyle}
              >
                {COUNTY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showPropertyType && (
            <div style={{ flex: "1 1 200px" }}>
              <label style={fieldLabelStyle}>Property Type</label>
              <select
                value={value.propertyType}
                onChange={(e) =>
                  handleFieldChange("propertyType", e.target.value)
                }
                style={selectStyle}
              >
                <option value="">Select...</option>
                {PROPERTY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showWhereOnProperty && (
            <div style={{ flex: "2 1 300px" }}>
              <label style={fieldLabelStyle}>Where on property?</label>
              <input
                type="text"
                value={value.whereOnProperty}
                onChange={(e) =>
                  handleFieldChange("whereOnProperty", e.target.value)
                }
                placeholder="e.g., behind dumpster, in barn, backyard..."
                style={inputStyle}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { EMPTY_VALUE as EMPTY_PLACE_VALUE };
