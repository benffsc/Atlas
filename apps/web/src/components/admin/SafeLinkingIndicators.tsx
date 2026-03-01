"use client";

interface SafeLinkingIndicatorsProps {
  matchReason: "explicit_link" | "place_and_requester" | "place_match" | "requester_match" | string;
  confidence: number;
  showLabel?: boolean;
}

const MATCH_LABELS: Record<string, { label: string; color: string; description: string }> = {
  explicit_link: {
    label: "Verified",
    color: "#198754",
    description: "Explicitly linked to this request",
  },
  place_and_requester: {
    label: "Strong Match",
    color: "#0d6efd",
    description: "Cat at same place AND linked to requester",
  },
  place_match: {
    label: "Place Match",
    color: "#6610f2",
    description: "Cat has appointment history at this location",
  },
  requester_match: {
    label: "Requester Match",
    color: "#fd7e14",
    description: "Cat linked to the requester",
  },
  unknown: {
    label: "Inferred",
    color: "#6c757d",
    description: "Matched via booking person",
  },
};

export function SafeLinkingIndicator({ matchReason, confidence, showLabel = true }: SafeLinkingIndicatorsProps) {
  const match = MATCH_LABELS[matchReason] || MATCH_LABELS.unknown;
  const confidencePct = Math.round(confidence * 100);

  return (
    <span
      title={`${match.description} (${confidencePct}% confidence)`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.15rem 0.5rem",
        background: match.color,
        color: "#fff",
        borderRadius: "4px",
        fontSize: "0.7rem",
        fontWeight: 500,
      }}
    >
      {showLabel && <span>{match.label}</span>}
      <span style={{ opacity: 0.8 }}>{confidencePct}%</span>
    </span>
  );
}

export function ConfidenceMeter({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let color = "#198754"; // green
  if (pct < 80) color = "#fd7e14"; // orange
  if (pct < 70) color = "#dc3545"; // red

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      <div
        style={{
          width: "60px",
          height: "6px",
          background: "#e9ecef",
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width 0.3s",
          }}
        />
      </div>
      <span style={{ fontSize: "0.75rem", color: "#666" }}>{pct}%</span>
    </div>
  );
}

export function MatchReasonBadge({ reason }: { reason: string }) {
  const match = MATCH_LABELS[reason] || MATCH_LABELS.unknown;

  return (
    <span
      title={match.description}
      style={{
        display: "inline-block",
        padding: "0.15rem 0.4rem",
        background: `${match.color}20`,
        color: match.color,
        borderRadius: "4px",
        fontSize: "0.7rem",
        fontWeight: 500,
        border: `1px solid ${match.color}40`,
      }}
    >
      {match.label}
    </span>
  );
}
