"use client";

import { useState } from "react";

interface ObservationFormProps {
  placeId?: string;
  placeName?: string;
  requestId?: string;
  requestAddress?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ObservationForm({
  placeId,
  placeName,
  requestId,
  requestAddress,
  onSuccess,
  onCancel,
}: ObservationFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Form state
  const [catsSeen, setCatsSeen] = useState<number | "">("");
  const [catsIsEstimate, setCatsIsEstimate] = useState(true);
  const [eartipped, setEartipped] = useState<number | "">("");
  const [eartippedIsEstimate, setEartippedIsEstimate] = useState(true);
  const [timeOfDay, setTimeOfDay] = useState<string>("");
  const [isAtFeedingStation, setIsAtFeedingStation] = useState<boolean | null>(null);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low">("medium");
  const [notes, setNotes] = useState("");

  // Optional detail fields
  const [femaleSeen, setFemaleSeen] = useState<number | "">("");
  const [maleSeen, setMaleSeen] = useState<number | "">("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (catsSeen === "" || catsSeen < 0) {
      setError("Please enter how many cats you saw");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: placeId || null,
          request_id: requestId || null,
          observation_date: new Date().toISOString().split("T")[0],
          observation_time: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
          time_of_day: timeOfDay || null,
          cats_seen_total: catsSeen,
          cats_seen_is_estimate: catsIsEstimate,
          eartipped_seen: eartipped === "" ? null : eartipped,
          eartipped_is_estimate: eartippedIsEstimate,
          female_seen: femaleSeen === "" ? null : femaleSeen,
          male_seen: maleSeen === "" ? null : maleSeen,
          is_at_feeding_station: isAtFeedingStation,
          confidence,
          notes: notes || null,
          observer_type: "trapper_field",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit observation");
      }

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit observation");
    } finally {
      setLoading(false);
    }
  };

  const locationName = placeName || requestAddress || "Unknown Location";

  return (
    <form onSubmit={handleSubmit} style={{ padding: "1rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem" }}>Log Observation</h2>
        <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
          {locationName}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "0.75rem",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            color: "#dc2626",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Main count - large touch target */}
      <div style={{ marginBottom: "1.5rem" }}>
        <label
          style={{
            display: "block",
            fontSize: "0.875rem",
            fontWeight: 500,
            marginBottom: "0.5rem",
          }}
        >
          How many cats did you see?
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={catsSeen}
          onChange={(e) => setCatsSeen(e.target.value === "" ? "" : parseInt(e.target.value))}
          min={0}
          style={{
            width: "100%",
            padding: "1rem",
            fontSize: "1.5rem",
            fontWeight: 700,
            textAlign: "center",
            border: "2px solid var(--card-border)",
            borderRadius: "8px",
          }}
          placeholder="0"
          autoFocus
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.5rem",
            fontSize: "0.875rem",
            color: "var(--text-muted)",
          }}
        >
          <input
            type="checkbox"
            checked={catsIsEstimate}
            onChange={(e) => setCatsIsEstimate(e.target.checked)}
          />
          This is an estimate (not exact count)
        </label>
      </div>

      {/* Eartipped count */}
      <div style={{ marginBottom: "1.5rem" }}>
        <label
          style={{
            display: "block",
            fontSize: "0.875rem",
            fontWeight: 500,
            marginBottom: "0.5rem",
          }}
        >
          How many had eartips?
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={eartipped}
          onChange={(e) => setEartipped(e.target.value === "" ? "" : parseInt(e.target.value))}
          min={0}
          style={{
            width: "100%",
            padding: "0.75rem",
            fontSize: "1.25rem",
            fontWeight: 600,
            textAlign: "center",
            border: "2px solid var(--card-border)",
            borderRadius: "8px",
          }}
          placeholder="0"
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.5rem",
            fontSize: "0.875rem",
            color: "var(--text-muted)",
          }}
        >
          <input
            type="checkbox"
            checked={eartippedIsEstimate}
            onChange={(e) => setEartippedIsEstimate(e.target.checked)}
          />
          This is an estimate
        </label>
      </div>

      {/* Time of day - quick select */}
      <div style={{ marginBottom: "1.5rem" }}>
        <label
          style={{
            display: "block",
            fontSize: "0.875rem",
            fontWeight: 500,
            marginBottom: "0.5rem",
          }}
        >
          Time of day
        </label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {["morning", "afternoon", "evening", "night"].map((time) => (
            <button
              key={time}
              type="button"
              onClick={() => setTimeOfDay(timeOfDay === time ? "" : time)}
              style={{
                flex: 1,
                minWidth: "70px",
                padding: "0.75rem",
                border: timeOfDay === time ? "2px solid #3b82f6" : "1px solid var(--card-border)",
                borderRadius: "6px",
                background: timeOfDay === time ? "#eff6ff" : "transparent",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: timeOfDay === time ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {time}
            </button>
          ))}
        </div>
      </div>

      {/* Feeding station */}
      <div style={{ marginBottom: "1.5rem" }}>
        <label
          style={{
            display: "block",
            fontSize: "0.875rem",
            fontWeight: 500,
            marginBottom: "0.5rem",
          }}
        >
          At feeding station?
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => setIsAtFeedingStation(isAtFeedingStation === true ? null : true)}
            style={{
              flex: 1,
              padding: "0.75rem",
              border: isAtFeedingStation === true ? "2px solid #16a34a" : "1px solid var(--card-border)",
              borderRadius: "6px",
              background: isAtFeedingStation === true ? "#f0fdf4" : "transparent",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: isAtFeedingStation === true ? 600 : 400,
            }}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setIsAtFeedingStation(isAtFeedingStation === false ? null : false)}
            style={{
              flex: 1,
              padding: "0.75rem",
              border: isAtFeedingStation === false ? "2px solid #6b7280" : "1px solid var(--card-border)",
              borderRadius: "6px",
              background: isAtFeedingStation === false ? "#f3f4f6" : "transparent",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: isAtFeedingStation === false ? 600 : 400,
            }}
          >
            No
          </button>
        </div>
      </div>

      {/* Confidence */}
      <div style={{ marginBottom: "1.5rem" }}>
        <label
          style={{
            display: "block",
            fontSize: "0.875rem",
            fontWeight: 500,
            marginBottom: "0.5rem",
          }}
        >
          How confident are you in this count?
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["high", "medium", "low"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setConfidence(c)}
              style={{
                flex: 1,
                padding: "0.75rem",
                border: confidence === c ? "2px solid #3b82f6" : "1px solid var(--card-border)",
                borderRadius: "6px",
                background: confidence === c ? "#eff6ff" : "transparent",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: confidence === c ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* More details toggle */}
      <button
        type="button"
        onClick={() => setShowDetails(!showDetails)}
        style={{
          width: "100%",
          padding: "0.75rem",
          marginBottom: "1rem",
          border: "1px solid var(--card-border)",
          borderRadius: "6px",
          background: "transparent",
          cursor: "pointer",
          fontSize: "0.875rem",
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
        }}
      >
        {showDetails ? "Hide" : "Show"} additional details
        <span style={{ fontSize: "0.7rem" }}>{showDetails ? "▲" : "▼"}</span>
      </button>

      {/* Optional details */}
      {showDetails && (
        <div
          style={{
            padding: "1rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--text-muted)" }}>
                Females seen
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={femaleSeen}
                onChange={(e) => setFemaleSeen(e.target.value === "" ? "" : parseInt(e.target.value))}
                min={0}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  fontSize: "1rem",
                  textAlign: "center",
                }}
                placeholder="-"
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--text-muted)" }}>
                Males seen
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={maleSeen}
                onChange={(e) => setMaleSeen(e.target.value === "" ? "" : parseInt(e.target.value))}
                min={0}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  fontSize: "1rem",
                  textAlign: "center",
                }}
                placeholder="-"
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--text-muted)" }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid var(--card-border)",
                borderRadius: "4px",
                fontSize: "0.875rem",
                resize: "vertical",
              }}
              placeholder="Any other observations..."
            />
          </div>
        </div>
      )}

      {/* Submit buttons */}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              flex: 1,
              padding: "1rem",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              background: "transparent",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "1rem",
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading || catsSeen === ""}
          style={{
            flex: onCancel ? 1 : undefined,
            width: onCancel ? undefined : "100%",
            padding: "1rem",
            border: "none",
            borderRadius: "8px",
            background: loading || catsSeen === "" ? "#94a3b8" : "#3b82f6",
            color: "white",
            cursor: loading || catsSeen === "" ? "not-allowed" : "pointer",
            fontSize: "1rem",
            fontWeight: 600,
          }}
        >
          {loading ? "Submitting..." : "Submit Observation"}
        </button>
      </div>
    </form>
  );
}
