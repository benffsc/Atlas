"use client";

import { useState } from "react";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { kioskInputStyle, kioskLabelStyle } from "./kiosk-styles";

interface KioskLocationStepProps {
  place: ResolvedPlace | null;
  onPlaceChange: (place: ResolvedPlace | null) => void;
  freeformAddress: string;
  onFreeformChange: (address: string) => void;
}

/**
 * Simplified location step for kiosk help form.
 * Uses PlaceResolver for address lookup with a fallback to freeform input.
 */
export function KioskLocationStep({
  place,
  onPlaceChange,
  freeformAddress,
  onFreeformChange,
}: KioskLocationStepProps) {
  const [useDescribe, setUseDescribe] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h2
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 0.25rem",
          }}
        >
          Where is this cat?
        </h2>
        <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0 }}>
          Enter the address or cross streets where you see the cat.
        </p>
      </div>

      {!useDescribe ? (
        <>
          <PlaceResolver
            value={place}
            onChange={onPlaceChange}
            placeholder="Search for an address..."
            showDescribeLocation={false}
          />
          <button
            onClick={() => { setUseDescribe(true); onPlaceChange(null); }}
            style={{
              background: "none",
              border: "none",
              color: "var(--primary)",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
              padding: "0.5rem",
              fontFamily: "inherit",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            I don&apos;t know the exact address
          </button>
        </>
      ) : (
        <>
          <div>
            <label style={kioskLabelStyle}>Describe the location</label>
            <textarea
              value={freeformAddress}
              onChange={(e) => onFreeformChange(e.target.value)}
              placeholder="e.g., behind the Safeway on 4th Street, near the park entrance..."
              rows={3}
              style={{
                ...kioskInputStyle,
                minHeight: 100,
                resize: "vertical",
              }}
            />
          </div>
          <button
            onClick={() => { setUseDescribe(false); onFreeformChange(""); }}
            style={{
              background: "none",
              border: "none",
              color: "var(--primary)",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
              padding: "0.5rem",
              fontFamily: "inherit",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            Search for an address instead
          </button>
        </>
      )}
    </div>
  );
}
