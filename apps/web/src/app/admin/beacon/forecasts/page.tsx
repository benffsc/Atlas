"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api-client";

interface EcologyConfig {
  config_key: string;
  config_value: number;
  unit: string;
  description: string;
  config_category: string;
  scientific_reference: string | null;
}

interface PlaceForecast {
  place_id: string;
  display_name: string;
  formatted_address: string;
  service_zone: string;
  a_known: number;
  n_recent_max: number;
  n_hat_chapman: number | null;
  p_lower: number | null;
  estimation_method: string;
  estimated_remaining: number;
  current_tnr_intensity: string;
  estimated_cycles_to_complete: number | null;
  estimated_months_to_complete: number | null;
  forecast_confidence: string;
  cats_altered_last_6mo: number;
  cats_altered_last_12mo: number;
  last_altered_at: string | null;
}

interface ForecastSummary {
  total_places_with_data: number;
  total_population_estimate: number;
  total_altered: number;
  overall_alteration_rate: number;
  places_near_completion: number;
  places_needs_attention: number;
  avg_months_to_complete: number | null;
}

type ViewType = "forecasts" | "parameters";

const intensityColors: Record<string, { bg: string; color: string; label: string }> = {
  high: { bg: "#dcfce7", color: "#166534", label: "High" },
  low: { bg: "#fef9c3", color: "#854d0e", label: "Low" },
  minimal: { bg: "#fee2e2", color: "#991b1b", label: "Minimal" },
  none: { bg: "#f3f4f6", color: "#6b7280", label: "None" },
};

const confidenceColors: Record<string, { color: string; icon: string }> = {
  high: { color: "#16a34a", icon: "●" },
  medium: { color: "#ca8a04", icon: "◐" },
  low: { color: "#dc2626", icon: "○" },
};

const categoryLabels: Record<string, string> = {
  reproduction: "Reproduction",
  survival: "Survival Rates",
  tnr: "TNR Effectiveness",
  immigration: "Immigration",
  ffsc: "FFSC Settings",
  colony: "Colony Parameters",
  observation: "Observation Windows",
  general: "General",
};

export default function ForecastsPage() {
  const [view, setView] = useState<ViewType>("forecasts");
  const [loading, setLoading] = useState(true);
  const [forecasts, setForecasts] = useState<PlaceForecast[]>([]);
  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [parameters, setParameters] = useState<Record<string, EcologyConfig[]>>({});

  useEffect(() => {
    fetchData();
  }, [view]);

  async function fetchData() {
    setLoading(true);
    try {
      const data = await fetchApi<{
        forecasts?: PlaceForecast[];
        summary?: ForecastSummary;
        parameters?: Record<string, EcologyConfig[]>;
      }>(`/api/admin/beacon/forecasts?view=${view}`);

      if (view === "forecasts") {
        setForecasts(data.forecasts || []);
        setSummary(data.summary || null);
      } else if (view === "parameters") {
        setParameters(data.parameters || {});
      }
    } catch (err) {
      console.error("Error fetching forecast data:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1>Population Forecasts</h1>
          <p className="text-muted">Vortex model predictions and TNR progress</p>
        </div>
      </div>

      {/* View Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <button
          onClick={() => setView("forecasts")}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "6px",
            border: "none",
            background: view === "forecasts" ? "var(--foreground)" : "var(--card-bg)",
            color: view === "forecasts" ? "var(--background)" : "var(--foreground)",
            cursor: "pointer",
            fontWeight: view === "forecasts" ? 600 : 400,
          }}
        >
          Site Forecasts
        </button>
        <button
          onClick={() => setView("parameters")}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "6px",
            border: "none",
            background: view === "parameters" ? "var(--foreground)" : "var(--card-bg)",
            color: view === "parameters" ? "var(--background)" : "var(--foreground)",
            cursor: "pointer",
            fontWeight: view === "parameters" ? 600 : 400,
          }}
        >
          Model Parameters
        </button>
      </div>

      {loading ? (
        <div className="text-muted">Loading forecast data...</div>
      ) : (
        <>
          {/* Forecasts View */}
          {view === "forecasts" && (
            <div>
              {/* Summary Cards */}
              {summary && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "1rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "#0d6efd" }}>
                      {summary.total_places_with_data}
                    </div>
                    <div className="text-muted text-sm">Sites with Data</div>
                  </div>
                  <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "#6c757d" }}>
                      {summary.total_population_estimate.toLocaleString()}
                    </div>
                    <div className="text-muted text-sm">Est. Population</div>
                  </div>
                  <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "#198754" }}>
                      {(summary.overall_alteration_rate * 100).toFixed(1)}%
                    </div>
                    <div className="text-muted text-sm">Overall Altered</div>
                  </div>
                  <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "#198754" }}>
                      {summary.places_near_completion}
                    </div>
                    <div className="text-muted text-sm">Near Completion</div>
                  </div>
                  <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "#dc3545" }}>
                      {summary.places_needs_attention}
                    </div>
                    <div className="text-muted text-sm">Needs Attention</div>
                  </div>
                  <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "#6c757d" }}>
                      {summary.avg_months_to_complete
                        ? `${Math.round(summary.avg_months_to_complete)}mo`
                        : "—"}
                    </div>
                    <div className="text-muted text-sm">Avg Time Left</div>
                  </div>
                </div>
              )}

              {/* Forecasts Table */}
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th style={{ textAlign: "right" }}>Population</th>
                      <th style={{ textAlign: "right" }}>Altered</th>
                      <th style={{ textAlign: "right" }}>Remaining</th>
                      <th>Intensity</th>
                      <th style={{ textAlign: "right" }}>Est. Completion</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecasts.map((f) => (
                      <tr key={f.place_id}>
                        <td>
                          <Link
                            href={`/places/${f.place_id}`}
                            style={{ fontWeight: 500, color: "#0d6efd" }}
                          >
                            {f.display_name || f.formatted_address?.split(",")[0] || "Unknown"}
                          </Link>
                          {f.service_zone && (
                            <div className="text-muted text-sm">{f.service_zone}</div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 500 }}>
                            {f.n_hat_chapman || f.n_recent_max || f.a_known}
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                            {f.estimation_method === "mark_resight"
                              ? "Chapman"
                              : f.estimation_method === "max_recent"
                              ? "Survey"
                              : "Verified"}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div>{f.a_known}</div>
                          {f.p_lower !== null && (
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color:
                                  f.p_lower >= 0.75
                                    ? "#16a34a"
                                    : f.p_lower >= 0.5
                                    ? "#ca8a04"
                                    : "#dc2626",
                              }}
                            >
                              {(f.p_lower * 100).toFixed(0)}%
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span
                            style={{
                              fontWeight: f.estimated_remaining > 10 ? 600 : 400,
                              color: f.estimated_remaining > 10 ? "#dc3545" : undefined,
                            }}
                          >
                            {f.estimated_remaining}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.2rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              background: intensityColors[f.current_tnr_intensity]?.bg,
                              color: intensityColors[f.current_tnr_intensity]?.color,
                            }}
                          >
                            {intensityColors[f.current_tnr_intensity]?.label}
                          </span>
                          {f.cats_altered_last_6mo > 0 && (
                            <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                              {f.cats_altered_last_6mo} in 6mo
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {f.estimated_months_to_complete !== null ? (
                            <span>
                              {f.estimated_months_to_complete < 12
                                ? `${f.estimated_months_to_complete}mo`
                                : `${(f.estimated_months_to_complete / 12).toFixed(1)}yr`}
                            </span>
                          ) : f.estimated_remaining === 0 ? (
                            <span style={{ color: "#16a34a", fontWeight: 600 }}>Complete</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <span
                            style={{ color: confidenceColors[f.forecast_confidence]?.color }}
                            title={`Confidence: ${f.forecast_confidence}`}
                          >
                            {confidenceColors[f.forecast_confidence]?.icon}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {forecasts.length === 0 && (
                <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
                  <p className="text-muted">No forecast data available</p>
                </div>
              )}
            </div>
          )}

          {/* Parameters View */}
          {view === "parameters" && (
            <div>
              <div
                className="card"
                style={{ marginBottom: "1.5rem", padding: "1rem", background: "#eff6ff" }}
              >
                <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                  Vortex Population Model Parameters
                </div>
                <p className="text-muted text-sm" style={{ margin: 0 }}>
                  Based on Boone et al. 2019 "A Long-Term Lens: Cumulative Impacts of Free-Roaming
                  Cat Management Strategy and Intensity on Preventable Cat Mortalities"
                </p>
              </div>

              {Object.entries(parameters).map(([category, configs]) => (
                <div key={category} style={{ marginBottom: "2rem" }}>
                  <h3 style={{ marginBottom: "0.75rem" }}>
                    {categoryLabels[category] || category}
                  </h3>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Parameter</th>
                          <th style={{ textAlign: "right" }}>Value</th>
                          <th>Unit</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {configs.map((config) => (
                          <tr key={config.config_key}>
                            <td>
                              <code style={{ fontSize: "0.8rem" }}>{config.config_key}</code>
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>
                              {config.unit === "proportion"
                                ? `${(config.config_value * 100).toFixed(0)}%`
                                : config.config_value}
                            </td>
                            <td className="text-muted text-sm">
                              {config.unit === "proportion" ? "" : config.unit}
                            </td>
                            <td>
                              <div style={{ maxWidth: "400px", fontSize: "0.85rem" }}>
                                {config.description}
                              </div>
                              {config.scientific_reference && (
                                <div
                                  className="text-muted"
                                  style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}
                                >
                                  Source: {config.scientific_reference}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {Object.keys(parameters).length === 0 && (
                <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
                  <p className="text-muted">No parameters configured</p>
                  <p className="text-sm text-muted">
                    Run MIG_288 to add Vortex model parameters
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Legend */}
      <div className="card" style={{ marginTop: "1.5rem", padding: "1rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Legend</div>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
          <div>
            <strong>TNR Intensity:</strong> High (75%+), Low (50-75%), Minimal (&lt;50%), None (0)
          </div>
          <div>
            <strong>Confidence:</strong> ● High (Chapman), ◐ Medium (Survey+Clinic), ○ Low (Clinic
            only)
          </div>
          <div>
            <strong>Est. Completion:</strong> At current TNR rate, months until 100% altered
          </div>
        </div>
      </div>
    </div>
  );
}
