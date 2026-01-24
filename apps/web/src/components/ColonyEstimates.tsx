"use client";

import { useState, useEffect } from "react";
import { ColonySourcesBreakdown } from "./ColonySourcesBreakdown";

interface ColonyEstimate {
  estimate_id: string;
  total_cats: number | null;
  adult_count: number | null;
  kitten_count: number | null;
  altered_count: number | null;
  unaltered_count: number | null;
  friendly_count: number | null;
  feral_count: number | null;
  source_type: string;
  source_label: string;
  observation_date: string | null;
  reported_at: string;
  is_firsthand: boolean;
  source_record_id: string | null;
  reporter_name: string | null;
  reporter_person_id: string | null;
  notes: string | null;
}

interface ColonyStatus {
  colony_size_estimate: number;
  verified_cat_count: number;
  verified_altered_count: number;
  final_confidence: number | null;
  estimate_count: number;
  primary_source: string | null;
  has_clinic_boost: boolean;
  is_multi_source_confirmed: boolean;
  estimated_work_remaining: number;
}

interface EcologyStats {
  a_known: number;
  n_recent_max: number;
  p_lower: number | null;
  p_lower_pct: number | null;
  estimation_method: string;
  has_eartip_data: boolean;
  total_eartips_seen: number;
  total_cats_seen: number;
  n_hat_chapman: number | null;
  p_hat_chapman_pct: number | null;
  best_colony_estimate: number | null;
  estimated_work_remaining: number | null;
}

interface ColonyEstimatesResponse {
  place_id: string;
  estimates: ColonyEstimate[];
  status: ColonyStatus;
  ecology: EcologyStats;
  has_data: boolean;
}

interface ColonyEstimatesProps {
  placeId: string;
}

// Generate link URL for a source record based on source type
function getSourceRecordUrl(estimate: ColonyEstimate): string | null {
  if (!estimate.source_record_id) return null;

  switch (estimate.source_type) {
    case "trapping_request":
      return `/requests/${estimate.source_record_id}`;
    case "intake_form":
      return `/intake/queue/${estimate.source_record_id}`;
    case "trapper_report":
      return `/admin/trapper-reports`;
    case "verified_cats":
      return null;
    case "post_clinic_survey":
    case "appointment_request":
      return estimate.source_record_id ? `/appointments/${estimate.source_record_id}` : null;
    default:
      return null;
  }
}

// Source type colors
const sourceColors: Record<string, string> = {
  post_clinic_survey: "#6f42c1", // Purple for P75
  trapper_site_visit: "#0d6efd", // Blue
  manual_observation: "#198754", // Green
  trapping_request: "#fd7e14", // Orange
  intake_form: "#20c997", // Teal
  appointment_request: "#6c757d", // Gray
  verified_cats: "#dc3545", // Red
  ai_parsed: "#17a2b8", // Cyan for AI-parsed data
  legacy_mymaps: "#e6a700", // Amber for Google Maps legacy
};

export function ColonyEstimates({ placeId }: ColonyEstimatesProps) {
  const [data, setData] = useState<ColonyEstimatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllEstimates, setShowAllEstimates] = useState(false);
  const [showSourcesBreakdown, setShowSourcesBreakdown] = useState(false);

  // Override editing state
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideCount, setOverrideCount] = useState<number>(0);
  const [overrideAltered, setOverrideAltered] = useState<number>(0);
  const [overrideNote, setOverrideNote] = useState<string>("");
  const [savingOverride, setSavingOverride] = useState(false);

  const fetchEstimates = async () => {
    try {
      const response = await fetch(`/api/places/${placeId}/colony-estimates`);
      if (!response.ok) {
        throw new Error("Failed to load colony estimates");
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading estimates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEstimates();
  }, [placeId]);

  const handleSetOverride = async () => {
    setSavingOverride(true);
    try {
      const response = await fetch(`/api/places/${placeId}/colony-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: overrideCount,
          altered: overrideAltered,
          note: overrideNote || undefined,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to set override");
      }

      setShowOverrideForm(false);
      setLoading(true);
      await fetchEstimates();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error setting override");
    } finally {
      setSavingOverride(false);
    }
  };

  const handleClearOverride = async () => {
    if (!confirm("Clear the manual override and revert to computed estimates?")) {
      return;
    }

    setSavingOverride(true);
    try {
      const response = await fetch(`/api/places/${placeId}/colony-override`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to clear override");
      }

      setLoading(true);
      await fetchEstimates();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error clearing override");
    } finally {
      setSavingOverride(false);
    }
  };

  const openOverrideForm = () => {
    // Pre-fill with current values
    setOverrideCount(data?.ecology?.best_colony_estimate || data?.status?.colony_size_estimate || 0);
    setOverrideAltered(data?.ecology?.a_known || data?.status?.verified_altered_count || 0);
    setOverrideNote("");
    setShowOverrideForm(true);
  };

  if (loading) {
    return (
      <div style={{ padding: "1rem", color: "var(--text-secondary)" }}>
        Loading colony estimates...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem", background: "var(--warning-bg)", borderRadius: "6px", color: "var(--warning-text)" }}>
        Unable to load colony estimates
      </div>
    );
  }

  if (!data || !data.has_data) {
    return (
      <div style={{ padding: "1rem", color: "var(--text-secondary)" }}>
        No colony size estimates available for this location.
      </div>
    );
  }

  const { status, estimates, ecology } = data;

  // Use ecology-based alteration rate when available
  const alterationRate = ecology?.p_lower_pct ?? (
    status.colony_size_estimate > 0
      ? Math.round((status.verified_altered_count / status.colony_size_estimate) * 100)
      : null
  );

  // Use best colony estimate from ecology if available
  const colonySize = ecology?.best_colony_estimate ?? status.colony_size_estimate;

  // Color for alteration rate
  let rateColor = "#6c757d";
  if (alterationRate !== null) {
    if (alterationRate >= 80) rateColor = "#198754";
    else if (alterationRate >= 50) rateColor = "#fd7e14";
    else rateColor = "#dc3545";
  }

  // Confidence display
  const confidencePct = status.final_confidence
    ? Math.round(status.final_confidence * 100)
    : null;

  // Estimates to show
  const visibleEstimates = showAllEstimates ? estimates : estimates.slice(0, 3);

  return (
    <div>
      {/* Summary Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--foreground)" }}>
            {ecology?.estimation_method === "mark_resight" ? `~${colonySize}` : colonySize}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
            Colony Size
            {ecology?.estimation_method === "mark_resight" && " (est.)"}
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--success-text)" }}>
            {ecology?.a_known ?? status.verified_altered_count}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Verified Altered</div>
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: rateColor }}>
            {alterationRate !== null ? (
              ecology?.estimation_method === "max_recent" ? `≥${alterationRate}%` : `${alterationRate}%`
            ) : "--"}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
            Alteration Rate
            {ecology?.estimation_method === "max_recent" && " (min)"}
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--warning-text)" }}>
            {ecology?.estimated_work_remaining ?? status.estimated_work_remaining}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Work Remaining</div>
        </div>
      </div>

      {/* Manual Override Controls */}
      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {ecology?.estimation_method === "manual_override" ? (
          <>
            <span
              style={{
                padding: "0.25rem 0.5rem",
                background: "var(--warning-border)",
                color: "var(--text-primary)",
                borderRadius: "4px",
                fontSize: "0.8rem",
              }}
            >
              Manual Override Active
            </span>
            <button
              onClick={handleClearOverride}
              disabled={savingOverride}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                background: "var(--danger-bg)",
                color: "var(--danger-text)",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {savingOverride ? "..." : "Clear Override"}
            </button>
            <button
              onClick={openOverrideForm}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
                color: "var(--foreground)",
              }}
            >
              Edit
            </button>
          </>
        ) : (
          <button
            onClick={openOverrideForm}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.75rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              cursor: "pointer",
              color: "var(--foreground)",
            }}
          >
            Set Manual Override
          </button>
        )}
      </div>

      {/* Override Form */}
      {showOverrideForm && (
        <div
          style={{
            padding: "1rem",
            background: "var(--section-bg)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}
        >
          <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: "var(--foreground)" }}>Set Colony Override</h4>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
            Use this when you have confirmed data that differs from the estimates.
            The override will be used instead of computed values.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--foreground)" }}>
                Total Cats
              </label>
              <input
                type="number"
                min={0}
                value={overrideCount}
                onChange={(e) => setOverrideCount(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ width: "80px", padding: "0.25rem 0.5rem" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--foreground)" }}>
                Altered Cats
              </label>
              <input
                type="number"
                min={0}
                max={overrideCount}
                value={overrideAltered}
                onChange={(e) => setOverrideAltered(Math.min(overrideCount, Math.max(0, parseInt(e.target.value) || 0)))}
                style={{ width: "80px", padding: "0.25rem 0.5rem" }}
              />
            </div>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--foreground)" }}>
              Notes (reason for override)
            </label>
            <textarea
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              placeholder="e.g., Confirmed via site visit on 2025-01-14"
              rows={2}
              style={{ width: "100%", padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleSetOverride}
              disabled={savingOverride || overrideCount < 0}
              style={{
                padding: "0.5rem 1rem",
                background: "var(--success-bg)",
                color: "var(--success-text)",
                border: "1px solid var(--success-border)",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              {savingOverride ? "Saving..." : "Save Override"}
            </button>
            <button
              onClick={() => setShowOverrideForm(false)}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
                color: "var(--foreground)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Ecology-Based Estimation Info */}
      {ecology && ecology.a_known > 0 && (
        <div
          style={{
            background: "var(--info-bg)",
            border: "1px solid var(--info-border)",
            borderRadius: "8px",
            padding: "0.75rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            color: "var(--info-text)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <strong>Ecology Estimate</strong>
            {ecology.estimation_method === "mark_resight" && (
              <span
                style={{
                  padding: "0.15rem 0.4rem",
                  background: "var(--success-bg)",
                  color: "var(--success-text)",
                  borderRadius: "4px",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                }}
              >
                Ecology Grade
              </span>
            )}
            {ecology.estimation_method === "max_recent" && (
              <span
                style={{
                  padding: "0.15rem 0.4rem",
                  background: "var(--primary)",
                  color: "var(--primary-foreground)",
                  borderRadius: "4px",
                  fontSize: "0.7rem",
                }}
              >
                Lower Bound
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            <span>
              <strong>{ecology.a_known}</strong> verified altered (A)
            </span>
            {ecology.n_recent_max > 0 && (
              <span>
                <strong>{ecology.n_recent_max}</strong> max reported (N)
              </span>
            )}
            {ecology.p_lower_pct !== null && (
              <span>
                Rate: <strong>≥{ecology.p_lower_pct}%</strong> (A/max(A,N))
              </span>
            )}
          </div>
          {ecology.has_eartip_data && ecology.n_hat_chapman && (
            <div style={{ marginTop: "0.5rem", color: "var(--success-text)" }}>
              Mark-resight estimate: <strong>~{ecology.n_hat_chapman} cats</strong>
              {ecology.p_hat_chapman_pct && ` (${ecology.p_hat_chapman_pct}% altered)`}
            </div>
          )}
        </div>
      )}

      {/* Confidence & Source Info */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
          fontSize: "0.8rem",
        }}
      >
        {confidencePct !== null && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: confidencePct >= 70 ? "var(--success-bg)" : confidencePct >= 40 ? "var(--warning-bg)" : "var(--danger-bg)",
              color: confidencePct >= 70 ? "var(--success-text)" : confidencePct >= 40 ? "var(--warning-text)" : "var(--danger-text)",
              borderRadius: "4px",
            }}
          >
            Confidence: {confidencePct}%
          </span>
        )}
        {status.has_clinic_boost && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: "var(--info-bg)",
              borderRadius: "4px",
              color: "var(--info-text)",
            }}
          >
            Clinic Verified
          </span>
        )}
        {status.is_multi_source_confirmed && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: "var(--success-bg)",
              borderRadius: "4px",
              color: "var(--success-text)",
            }}
          >
            Multi-Source Confirmed
          </span>
        )}
        <span style={{ color: "var(--text-secondary)" }}>
          {status.estimate_count} estimate{status.estimate_count !== 1 ? "s" : ""}
        </span>
      </div>

      {/* View Sources Toggle */}
      <button
        onClick={() => setShowSourcesBreakdown(!showSourcesBreakdown)}
        style={{
          width: "100%",
          padding: "0.75rem",
          marginBottom: "1rem",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          background: showSourcesBreakdown ? "var(--section-bg)" : "transparent",
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: 500,
          color: "var(--foreground)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
        }}
      >
        <span>{showSourcesBreakdown ? "Hide" : "View"} Source Breakdown</span>
        <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
          {showSourcesBreakdown ? "▲" : "▼"}
        </span>
      </button>

      {/* Source Breakdown Expansion */}
      {showSourcesBreakdown && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
            background: "var(--background)",
          }}
        >
          <ColonySourcesBreakdown placeId={placeId} />
        </div>
      )}

      {/* Individual Estimates */}
      {estimates.length > 0 && (
        <div>
          <h4 style={{ margin: "1rem 0 0.5rem", fontSize: "0.9rem", fontWeight: 600, color: "var(--foreground)" }}>
            Survey Responses
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {visibleEstimates.map((est) => {
              const sourceUrl = getSourceRecordUrl(est);
              const isClickable = !!sourceUrl;

              return (
                <div
                  key={est.estimate_id}
                  onClick={isClickable ? () => window.location.href = sourceUrl : undefined}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.75rem",
                    padding: "0.75rem",
                    background: "var(--section-bg)",
                    borderRadius: "8px",
                    borderLeft: `3px solid ${sourceColors[est.source_type] || "#6c757d"}`,
                    cursor: isClickable ? "pointer" : "default",
                    transition: "background 0.15s, transform 0.15s",
                  }}
                  onMouseOver={isClickable ? (e) => {
                    e.currentTarget.style.background = "var(--hover-bg)";
                    e.currentTarget.style.transform = "translateX(2px)";
                  } : undefined}
                  onMouseOut={isClickable ? (e) => {
                    e.currentTarget.style.background = "var(--section-bg)";
                    e.currentTarget.style.transform = "none";
                  } : undefined}
                >
                  {/* Source Badge */}
                  <span
                    style={{
                      padding: "0.2rem 0.5rem",
                      background: sourceColors[est.source_type] || "#6c757d",
                      color: "#fff",
                      borderRadius: "4px",
                      fontSize: "0.7rem",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {est.source_label}
                  </span>

                  {/* Details */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.85rem", color: "var(--foreground)" }}>
                      {est.total_cats !== null && (
                        <span>
                          <strong>{est.total_cats}</strong> cats
                        </span>
                      )}
                      {est.adult_count !== null && (
                        <span style={{ color: "var(--text-secondary)" }}>{est.adult_count} adults</span>
                      )}
                      {est.kitten_count !== null && (
                        <span style={{ color: "var(--text-secondary)" }}>{est.kitten_count} kittens</span>
                      )}
                      {est.altered_count !== null && (
                        <span style={{ color: "var(--success-text)" }}>{est.altered_count} altered</span>
                      )}
                      {est.unaltered_count !== null && (
                        <span style={{ color: "var(--danger-text)" }}>{est.unaltered_count} unaltered</span>
                      )}
                      {est.friendly_count !== null && (
                        <span style={{ color: "var(--primary)" }}>{est.friendly_count} friendly</span>
                      )}
                      {est.feral_count !== null && (
                        <span style={{ color: "var(--warning-text)" }}>{est.feral_count} feral</span>
                      )}
                    </div>

                    {/* Reporter and Date */}
                    <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      {est.reporter_name && (
                        <span>
                          Reported by{" "}
                          {est.reporter_person_id ? (
                            <a
                              href={`/people/${est.reporter_person_id}`}
                              style={{ color: "var(--primary)" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {est.reporter_name}
                            </a>
                          ) : (
                            est.reporter_name
                          )}
                          {" "}
                        </span>
                      )}
                      {est.observation_date && (
                        <span>
                          on {new Date(est.observation_date).toLocaleDateString()}
                        </span>
                      )}
                      {!est.observation_date && est.reported_at && (
                        <span>
                          on {new Date(est.reported_at).toLocaleDateString()}
                        </span>
                      )}
                      {est.is_firsthand && (
                        <span
                          style={{
                            marginLeft: "0.5rem",
                            padding: "0.1rem 0.3rem",
                            background: "var(--success-bg)",
                            color: "var(--success-text)",
                            borderRadius: "3px",
                            fontSize: "0.65rem",
                          }}
                        >
                          Firsthand
                        </span>
                      )}
                    </div>

                    {/* Notes */}
                    {est.notes && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", fontStyle: "italic", color: "var(--text-secondary)" }}>
                        {est.notes}
                      </div>
                    )}
                  </div>

                  {/* Link indicator */}
                  {isClickable && (
                    <span style={{ color: "var(--primary)", fontSize: "0.85rem", alignSelf: "center" }}>→</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Show More/Less */}
          {estimates.length > 3 && (
            <button
              onClick={() => setShowAllEstimates(!showAllEstimates)}
              style={{
                marginTop: "0.5rem",
                background: "transparent",
                border: "none",
                color: "var(--primary)",
                cursor: "pointer",
                fontSize: "0.8rem",
              }}
            >
              {showAllEstimates
                ? "Show less"
                : `Show ${estimates.length - 3} more estimate${estimates.length - 3 !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
