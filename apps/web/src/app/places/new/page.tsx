"use client";

import { useState } from "react";
import PlaceResolver from "@/components/PlaceResolver";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { BackButton } from "@/components/BackButton";

export default function NewPlacePage() {
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);

  // Optional details to add after place is resolved
  const [placeName, setPlaceName] = useState("");
  const [placeNotes, setPlaceNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlaceResolved = (place: ResolvedPlace | null) => {
    setResolvedPlace(place);
    setError(null);
    if (place) {
      setPlaceName(place.display_name || "");
    } else {
      setPlaceName("");
      setPlaceNotes("");
    }
  };

  const handleSaveAndView = async () => {
    if (!resolvedPlace) return;

    // If user added a name or notes, update the place
    const hasUpdates = (placeName && placeName !== resolvedPlace.display_name) || placeNotes;

    if (hasUpdates) {
      setSaving(true);
      setError(null);
      try {
        const body: Record<string, string | null> = {};
        if (placeName && placeName !== resolvedPlace.display_name) {
          body.display_name = placeName;
        }
        if (placeNotes) {
          body.change_notes = placeNotes;
        }

        const res = await fetch(`/api/places/${resolvedPlace.place_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update place");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update place");
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    window.location.href = `/places/${resolvedPlace.place_id}`;
  };

  return (
    <div>
      <BackButton fallbackHref="/places" />
      <h1 style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>New Place</h1>

      {/* Step 1: Find or create a place */}
      <div>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
          Where is this place?
        </h2>
        <PlaceResolver
          value={resolvedPlace}
          onChange={handlePlaceResolved}
          placeholder="Start typing an address..."
          showDescribeLocation={true}
        />
      </div>

      {/* Step 2: Optional name/notes after place is resolved */}
      {resolvedPlace && (
        <div style={{ marginTop: "1.5rem" }}>
          <div
            style={{
              background: "#d4edda",
              padding: "1rem",
              borderRadius: "8px",
              marginBottom: "1.5rem",
              border: "1px solid #c3e6cb",
            }}
          >
            <div style={{ fontWeight: 500 }}>
              {resolvedPlace.display_name || resolvedPlace.formatted_address}
            </div>
            {resolvedPlace.display_name && resolvedPlace.formatted_address && (
              <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                {resolvedPlace.formatted_address}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Place Name (optional)
              </label>
              <input
                type="text"
                value={placeName}
                onChange={(e) => setPlaceName(e.target.value)}
                placeholder="e.g., Smith Residence, Old Stony Point Colony"
                style={{ width: "100%" }}
              />
              <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                Give this place a memorable name, or leave blank to use the address.
              </div>
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
            <button onClick={handleSaveAndView} disabled={saving}>
              {saving ? "Saving..." : "View Place"}
            </button>
            <a href="/places/new" style={{ alignSelf: "center", color: "#6c757d" }}>
              Create Another
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
