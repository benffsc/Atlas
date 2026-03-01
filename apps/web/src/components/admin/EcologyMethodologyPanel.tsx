"use client";

import { useState } from "react";

interface EcologyStats {
  a_known: number;
  a_known_current: number;
  a_known_effective: number;
  cats_needing_tnr: number;
  n_recent_max: number;
  p_lower: number | null;
  p_lower_pct: number | null;
  estimation_method: string;
  has_eartip_data: boolean;
  total_eartips_seen: number;
  total_cats_seen: number;
  n_hat_chapman: number | null;
  p_hat_chapman_pct?: number | null;
  best_colony_estimate?: number | null;
  estimated_work_remaining?: number | null;
}

interface Props {
  ecology: EcologyStats;
  classification?: string;
}

const METHOD_INFO: Record<string, { name: string; description: string; formula?: string; accuracy: string }> = {
  mark_resight: {
    name: "Chapman Mark-Recapture",
    description: "Gold standard population estimation using eartip observations. Based on the proportion of marked (eartipped) cats observed.",
    formula: "N̂ = ((M + 1)(C + 1) / (R + 1)) - 1",
    accuracy: "High",
  },
  max_recent: {
    name: "Maximum Recent Report",
    description: "Uses the highest colony size reported within the last 180 days. Less precise than mark-recapture.",
    accuracy: "Medium",
  },
  verified_only: {
    name: "Verified Alterations Only",
    description: "Only FFSC clinic records available. This is a LOWER BOUND on the true population, not a complete estimate.",
    accuracy: "Lower bound only",
  },
  no_data: {
    name: "No Data",
    description: "No cat activity recorded at this location.",
    accuracy: "N/A",
  },
};

const THRESHOLD_INFO = [
  { min: 95, label: "Complete", color: "#10b981", description: "Colony effectively managed" },
  { min: 80, label: "High", color: "#22c55e", description: "Population stabilizing (80% threshold)" },
  { min: 50, label: "Medium", color: "#eab308", description: "Population reduction starting" },
  { min: 0, label: "Low", color: "#ef4444", description: "Minimal population impact" },
];

function getThresholdInfo(rate: number | null) {
  if (rate === null) return null;
  return THRESHOLD_INFO.find((t) => rate >= t.min) || THRESHOLD_INFO[THRESHOLD_INFO.length - 1];
}

export function EcologyMethodologyPanel({ ecology, classification }: Props) {
  const [expanded, setExpanded] = useState(false);

  const methodInfo = METHOD_INFO[ecology.estimation_method] || METHOD_INFO.no_data;
  const thresholdInfo = getThresholdInfo(ecology.p_lower_pct);

  // Calculate derived values for display
  const populationEstimate = ecology.n_hat_chapman ?? ecology.n_recent_max ?? ecology.a_known_effective;
  const isVerifiedOnly = ecology.estimation_method === "verified_only";
  const hasDataQualityIssue = isVerifiedOnly && ecology.a_known > 0;

  return (
    <div
      style={{
        backgroundColor: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: "0.5rem",
        marginTop: "1rem",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.75rem 1rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontWeight: 500, color: "#374151" }}>
            Methodology: {methodInfo.name}
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.125rem 0.5rem",
              borderRadius: "9999px",
              backgroundColor: methodInfo.accuracy === "High" ? "#d1fae5" : methodInfo.accuracy === "Medium" ? "#fef3c7" : "#f3f4f6",
              color: methodInfo.accuracy === "High" ? "#065f46" : methodInfo.accuracy === "Medium" ? "#92400e" : "#6b7280",
            }}
          >
            {methodInfo.accuracy}
          </span>
        </div>
        <span style={{ color: "#9ca3af" }}>{expanded ? "−" : "+"}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "0 1rem 1rem", borderTop: "1px solid #e5e7eb" }}>
          {/* Method description */}
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
              {methodInfo.description}
            </p>
          </div>

          {/* Data quality warning */}
          {hasDataQualityIssue && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                backgroundColor: "#fef3c7",
                border: "1px solid #f59e0b",
                borderRadius: "0.375rem",
              }}
            >
              <p style={{ fontSize: "0.875rem", color: "#92400e", margin: 0 }}>
                <strong>Note:</strong> This place has {ecology.a_known} verified altered cat(s) but no colony size estimate.
                The alteration rate shown ({ecology.p_lower_pct}%) may appear inflated because we cannot estimate unaltered cats.
              </p>
            </div>
          )}

          {/* Chapman details */}
          {ecology.estimation_method === "mark_resight" && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                backgroundColor: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "0.375rem",
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: "0.5rem", color: "#374151" }}>
                Chapman Estimator Derivation
              </div>
              <code
                style={{
                  display: "block",
                  padding: "0.5rem",
                  backgroundColor: "#f3f4f6",
                  borderRadius: "0.25rem",
                  fontSize: "0.8rem",
                  fontFamily: "monospace",
                }}
              >
                N̂ = ((M + 1)(C + 1) / (R + 1)) - 1
              </code>
              <div style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#4b5563" }}>
                <div><strong>M</strong> (Marked/Altered): {ecology.a_known} cats</div>
                <div><strong>C</strong> (Total Observed): {ecology.total_cats_seen} cats</div>
                <div><strong>R</strong> (Eartips Observed): {ecology.total_eartips_seen} cats</div>
                <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #e5e7eb" }}>
                  <strong>N̂</strong> (Estimated Population): <strong>{ecology.n_hat_chapman}</strong> cats
                </div>
              </div>
              <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                Reference: Chapman, D.G. (1951). Bias-corrected Lincoln-Petersen estimator.
              </div>
            </div>
          )}

          {/* Alteration rate interpretation */}
          {thresholdInfo && ecology.p_lower_pct !== null && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontWeight: 500, marginBottom: "0.5rem", color: "#374151" }}>
                TNR Progress Interpretation
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  backgroundColor: thresholdInfo.color + "20",
                  borderRadius: "0.375rem",
                }}
              >
                <div
                  style={{
                    width: "0.75rem",
                    height: "0.75rem",
                    borderRadius: "50%",
                    backgroundColor: thresholdInfo.color,
                  }}
                />
                <span style={{ fontWeight: 500, color: thresholdInfo.color }}>
                  {thresholdInfo.label} ({ecology.p_lower_pct}%)
                </span>
                <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>
                  {thresholdInfo.description}
                </span>
              </div>

              {/* Threshold scale */}
              <div style={{ marginTop: "0.75rem" }}>
                <div style={{ display: "flex", fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.25rem" }}>
                  <span>0%</span>
                  <span style={{ flex: 1, textAlign: "center" }}>50%</span>
                  <span style={{ flex: 1, textAlign: "center" }}>80%</span>
                  <span style={{ textAlign: "right" }}>100%</span>
                </div>
                <div
                  style={{
                    height: "0.5rem",
                    borderRadius: "9999px",
                    background: "linear-gradient(to right, #ef4444 0%, #eab308 50%, #22c55e 80%, #10b981 100%)",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: `${Math.min(ecology.p_lower_pct, 100)}%`,
                      top: "-0.25rem",
                      transform: "translateX(-50%)",
                      width: "1rem",
                      height: "1rem",
                      borderRadius: "50%",
                      backgroundColor: "white",
                      border: "2px solid #374151",
                    }}
                  />
                </div>
              </div>

              {/* Scientific thresholds explanation */}
              <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#6b7280" }}>
                <div><strong>Scientific Thresholds:</strong></div>
                <ul style={{ margin: "0.25rem 0", paddingLeft: "1.25rem" }}>
                  <li><strong>75%+</strong>: Population decreases, preventable deaths reduced 30x (Levy et al.)</li>
                  <li><strong>80%+</strong>: Population stabilization (Córdoba TNR Study)</li>
                  <li><strong>71-94%</strong>: Required for closed population decline (Andersen et al.)</li>
                </ul>
              </div>
            </div>
          )}

          {/* Classification impact */}
          {classification && classification !== "unknown" && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontWeight: 500, marginBottom: "0.5rem", color: "#374151" }}>
                Classification Impact
              </div>
              <div style={{ fontSize: "0.875rem", color: "#4b5563" }}>
                {classification === "individual_cats" ? (
                  <>
                    <p style={{ margin: 0 }}>
                      <strong>Individual Cats</strong>: Using only <em>current</em> cats ({ecology.a_known_current} of {ecology.a_known} total).
                      Departed historical cats are excluded from calculations.
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ margin: 0 }}>
                      <strong>{classification.replace("_", " ")}</strong>: Using all historical altered cats ({ecology.a_known} total).
                      For colonies, historical data helps estimate total population through mark-recapture.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Cats needing TNR */}
          {ecology.cats_needing_tnr > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontWeight: 500, marginBottom: "0.5rem", color: "#374151" }}>
                Active Request Impact
              </div>
              <p style={{ fontSize: "0.875rem", color: "#4b5563", margin: 0 }}>
                {ecology.cats_needing_tnr} cat(s) from active request(s) are included in population but not yet altered.
                Current population estimate: <strong>{populationEstimate + ecology.cats_needing_tnr}</strong> cats
                ({populationEstimate} historical + {ecology.cats_needing_tnr} from active requests).
              </p>
            </div>
          )}

          {/* Documentation link */}
          <div
            style={{
              marginTop: "1rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid #e5e7eb",
              fontSize: "0.75rem",
              color: "#9ca3af",
            }}
          >
            Full methodology documentation:{" "}
            <a
              href="https://github.com/atlas-ffsc/docs/ECOLOGY_METHODOLOGY.md"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#6366f1" }}
            >
              ECOLOGY_METHODOLOGY.md
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
