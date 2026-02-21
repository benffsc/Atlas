"use client";

interface DataQualityBadgeProps {
  source: string;
  confidence?: "high" | "medium" | "low";
  verified?: boolean;
  needsReview?: boolean;
  showLabel?: boolean;
}

const sourceLabels: Record<string, { label: string; color: string; bg: string }> = {
  // System sources
  clinichq: { label: "Clinic", color: "#0d6efd", bg: "#e7f1ff" },
  airtable: { label: "Airtable", color: "#6c757d", bg: "#f8f9fa" },
  web_intake: { label: "Web", color: "#198754", bg: "#d1e7dd" },
  web_app: { label: "App", color: "#198754", bg: "#d1e7dd" },

  // AI/parsed sources
  ai_parsed: { label: "AI Parsed", color: "#8b5cf6", bg: "#f5f3ff" },
  note_parser: { label: "Note Parser", color: "#8b5cf6", bg: "#f5f3ff" },
  beacon: { label: "Beacon", color: "#f97316", bg: "#fff7ed" },

  // Manual sources
  manual_entry: { label: "Manual", color: "#6c757d", bg: "#f8f9fa" },
  staff_verified: { label: "Verified", color: "#198754", bg: "#d1e7dd" },
  trapper_report: { label: "Trapper", color: "#0d6efd", bg: "#e7f1ff" },
  intake_form: { label: "Intake", color: "#0d6efd", bg: "#e7f1ff" },

  // Colony estimate sources
  post_clinic_survey: { label: "Survey", color: "#0d6efd", bg: "#e7f1ff" },
  trapping_request: { label: "Request", color: "#6c757d", bg: "#f8f9fa" },
  trapper_site_visit: { label: "Site Visit", color: "#198754", bg: "#d1e7dd" },
  verified_cats: { label: "Verified", color: "#198754", bg: "#d1e7dd" },
};

const confidenceColors: Record<string, { color: string; icon: string }> = {
  high: { color: "#198754", icon: "●" },
  medium: { color: "#fd7e14", icon: "◐" },
  low: { color: "#dc3545", icon: "○" },
};

export function DataQualityBadge({
  source,
  confidence,
  verified,
  needsReview,
  showLabel = true,
}: DataQualityBadgeProps) {
  const sourceConfig = sourceLabels[source] || {
    label: source,
    color: "#6c757d",
    bg: "#f8f9fa",
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
      {/* Source badge */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "3px",
          padding: "2px 6px",
          background: sourceConfig.bg,
          color: sourceConfig.color,
          borderRadius: "4px",
          fontSize: "0.65rem",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.3px",
        }}
        title={`Source: ${sourceConfig.label}`}
      >
        {showLabel && sourceConfig.label}
      </span>

      {/* Confidence indicator */}
      {confidence && (
        <span
          style={{
            color: confidenceColors[confidence].color,
            fontSize: "0.7rem",
            lineHeight: 1,
          }}
          title={`Confidence: ${confidence}`}
        >
          {confidenceColors[confidence].icon}
        </span>
      )}

      {/* Verified checkmark */}
      {verified && (
        <span
          style={{
            color: "#198754",
            fontSize: "0.7rem",
          }}
          title="Staff verified"
        >
          ✓
        </span>
      )}

      {/* Needs review flag */}
      {needsReview && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 4px",
            background: "#fff3cd",
            color: "#856404",
            borderRadius: "3px",
            fontSize: "0.6rem",
            fontWeight: 500,
          }}
          title="Needs review"
        >
          REVIEW
        </span>
      )}
    </span>
  );
}

// Convenience component for AI-parsed data
export function AIParsedBadge({ needsReview }: { needsReview?: boolean }) {
  return (
    <DataQualityBadge
      source="ai_parsed"
      confidence="medium"
      needsReview={needsReview}
    />
  );
}

// Convenience component for Beacon data
export function BeaconBadge({ confidence }: { confidence?: "high" | "medium" | "low" }) {
  return (
    <DataQualityBadge
      source="beacon"
      confidence={confidence || "medium"}
    />
  );
}

// Source system badge (for showing where data came from)
export function SourceBadge({ source }: { source: string }) {
  return <DataQualityBadge source={source} />;
}
