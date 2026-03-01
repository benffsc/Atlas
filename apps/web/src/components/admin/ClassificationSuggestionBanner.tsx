"use client";

import { useState } from "react";

interface ClassificationSignal {
  value: string | number | boolean;
  weight: number;
  toward: string;
  note?: string;
}

interface ClassificationSuggestion {
  suggested_classification: string | null;
  classification_confidence: number | null;
  classification_signals: Record<string, ClassificationSignal> | null;
  classification_disposition: string | null;
  classification_reviewed_by?: string | null;
  classification_reviewed_at?: string | null;
}

interface Props {
  requestId: string;
  placeId: string | null;
  suggestion: ClassificationSuggestion;
  currentPlaceClassification?: string | null;
  onUpdate: () => void;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  unknown: "Unknown",
  individual_cats: "Individual Cats",
  small_colony: "Small Colony (3-10)",
  large_colony: "Large Colony (10+)",
  feeding_station: "Feeding Station",
};

const CLASSIFICATION_DESCRIPTIONS: Record<string, string> = {
  individual_cats: "Specific known cats - use exact count, no ecology estimation",
  small_colony: "Established small group - light weighted estimation",
  large_colony: "Large established colony - full ecology estimation",
  feeding_station: "Known feeding location attracting cats from area",
};

export function ClassificationSuggestionBanner({
  requestId,
  placeId,
  suggestion,
  currentPlaceClassification,
  onUpdate,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideValue, setOverrideValue] = useState("individual_cats");
  const [overrideReason, setOverrideReason] = useState("");
  const [authoritativeCount, setAuthoritativeCount] = useState<number | "">("");
  const [loading, setLoading] = useState(false);

  // Don't show if no suggestion or already processed
  if (!suggestion.suggested_classification) {
    return null;
  }

  // Don't show if already accepted/overridden/dismissed
  if (suggestion.classification_disposition && suggestion.classification_disposition !== "pending") {
    return null;
  }

  // Don't show if place already has matching classification
  if (currentPlaceClassification &&
      currentPlaceClassification !== "unknown" &&
      currentPlaceClassification === suggestion.suggested_classification) {
    return null;
  }

  const confidence = suggestion.classification_confidence || 0;
  const confidencePct = Math.round(confidence * 100);

  // Color based on confidence
  const bannerColor = confidence >= 0.8
    ? { bg: "#d1fae5", border: "#10b981", text: "#065f46" }  // Green for high confidence
    : confidence >= 0.6
    ? { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" }  // Yellow for medium
    : { bg: "#f3f4f6", border: "#9ca3af", text: "#374151" }; // Gray for low

  const handleAccept = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/classification-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      if (!res.ok) throw new Error("Failed to accept suggestion");
      onUpdate();
    } catch (err) {
      console.error("Error accepting suggestion:", err);
      alert("Failed to accept suggestion");
    } finally {
      setLoading(false);
    }
  };

  const handleOverride = async () => {
    if (!overrideReason.trim()) {
      alert("Please provide a reason for the override");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/classification-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "override",
          override_classification: overrideValue,
          reason: overrideReason,
          authoritative_count: overrideValue === "individual_cats" && authoritativeCount ? authoritativeCount : null,
        }),
      });
      if (!res.ok) throw new Error("Failed to override suggestion");
      onUpdate();
    } catch (err) {
      console.error("Error overriding suggestion:", err);
      alert("Failed to override suggestion");
    } finally {
      setLoading(false);
      setShowOverride(false);
    }
  };

  const handleDismiss = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/classification-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!res.ok) throw new Error("Failed to dismiss suggestion");
      onUpdate();
    } catch (err) {
      console.error("Error dismissing suggestion:", err);
      alert("Failed to dismiss suggestion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        background: bannerColor.bg,
        border: `1px solid ${bannerColor.border}`,
        borderRadius: "8px",
        padding: "1rem",
        marginBottom: "1rem",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <span style={{ fontWeight: 600, color: bannerColor.text }}>
              Classification Suggestion
            </span>
            <span
              className="badge"
              style={{
                background: confidence >= 0.8 ? "#10b981" : confidence >= 0.6 ? "#f59e0b" : "#9ca3af",
                color: "#fff",
                fontSize: "0.7rem",
              }}
            >
              {confidencePct}% confidence
            </span>
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 500, color: bannerColor.text }}>
            {CLASSIFICATION_LABELS[suggestion.suggested_classification] || suggestion.suggested_classification}
          </div>
          <div style={{ fontSize: "0.85rem", color: bannerColor.text, opacity: 0.8, marginTop: "0.25rem" }}>
            {CLASSIFICATION_DESCRIPTIONS[suggestion.suggested_classification] || ""}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
          <button
            onClick={handleAccept}
            disabled={loading}
            className="btn btn-sm"
            style={{
              background: "#10b981",
              color: "#fff",
              border: "none",
              padding: "0.4rem 0.75rem",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            Accept
          </button>
          <button
            onClick={() => setShowOverride(!showOverride)}
            disabled={loading}
            className="btn btn-sm"
            style={{
              background: "#fff",
              color: "#374151",
              border: "1px solid #d1d5db",
              padding: "0.4rem 0.75rem",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            Override...
          </button>
          <button
            onClick={handleDismiss}
            disabled={loading}
            className="btn btn-sm"
            style={{
              background: "transparent",
              color: "#6b7280",
              border: "none",
              padding: "0.4rem 0.5rem",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "0.85rem",
            }}
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Expandable signals */}
      {suggestion.classification_signals && (
        <div style={{ marginTop: "0.75rem" }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              color: bannerColor.text,
              cursor: "pointer",
              fontSize: "0.85rem",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            {expanded ? "Hide signals" : "Show contributing signals"}
          </button>

          {expanded && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.5)",
                borderRadius: "4px",
                fontSize: "0.85rem",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.1)" }}>
                    <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Signal</th>
                    <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Value</th>
                    <th style={{ textAlign: "right", padding: "0.25rem 0.5rem" }}>Weight</th>
                    <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Toward</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(suggestion.classification_signals)
                    .filter(([key]) => !["individual_score", "colony_score"].includes(key))
                    .map(([key, signal]) => (
                      <tr key={key} style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{key.replace(/_/g, " ")}</td>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{String(signal.value)}</td>
                        <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>
                          {signal.weight > 0 ? `+${signal.weight}` : signal.weight}
                        </td>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{signal.toward || signal.note || ""}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 500 }}>
                    <td colSpan={2} style={{ padding: "0.25rem 0.5rem" }}>Total Scores</td>
                    <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>
                      Individual: {String((suggestion.classification_signals as Record<string, unknown>).individual_score ?? 0)}
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      Colony: {String((suggestion.classification_signals as Record<string, unknown>).colony_score ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Override form */}
      {showOverride && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "1rem",
            background: "#fff",
            borderRadius: "4px",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: "0.75rem" }}>Override Classification</div>

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
              Classification
            </label>
            <select
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
              }}
            >
              <option value="individual_cats">Individual Cats</option>
              <option value="small_colony">Small Colony (3-10)</option>
              <option value="large_colony">Large Colony (10+)</option>
              <option value="feeding_station">Feeding Station</option>
            </select>
          </div>

          {overrideValue === "individual_cats" && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                Authoritative Cat Count (optional)
              </label>
              <input
                type="number"
                min="1"
                value={authoritativeCount}
                onChange={(e) => setAuthoritativeCount(e.target.value ? parseInt(e.target.value) : "")}
                placeholder="Exact number of cats"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                }}
              />
              <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>
                Set this if you know the exact number of cats (e.g., from a site visit)
              </div>
            </div>
          )}

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
              Reason for Override *
            </label>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g., Site visit confirmed exactly 2 cats that Crystal knows by name"
              rows={2}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                resize: "vertical",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowOverride(false)}
              style={{
                background: "#fff",
                color: "#374151",
                border: "1px solid #d1d5db",
                padding: "0.4rem 0.75rem",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleOverride}
              disabled={loading || !overrideReason.trim()}
              style={{
                background: "#3b82f6",
                color: "#fff",
                border: "none",
                padding: "0.4rem 0.75rem",
                borderRadius: "4px",
                cursor: loading || !overrideReason.trim() ? "not-allowed" : "pointer",
                opacity: loading || !overrideReason.trim() ? 0.6 : 1,
              }}
            >
              Apply Override
            </button>
          </div>
        </div>
      )}

      {/* Current place classification note */}
      {currentPlaceClassification && currentPlaceClassification !== "unknown" && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: bannerColor.text, opacity: 0.7 }}>
          Note: Place is currently classified as "{CLASSIFICATION_LABELS[currentPlaceClassification] || currentPlaceClassification}"
        </div>
      )}
    </div>
  );
}
