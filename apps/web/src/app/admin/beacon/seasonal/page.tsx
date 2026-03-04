"use client";

import { useState, useEffect } from "react";
import { DataQualityBadge } from "@/components/badges";
import { fetchApi } from "@/lib/api-client";

interface SeasonalDashboard {
  year: number;
  month: number;
  period: string;
  season: string;
  clinic_appointments: number;
  alterations: number;
  kitten_procedures: number;
  pregnant_cats: number;
  intake_requests: number;
  urgent_requests: number;
  kitten_intake_mentions: number;
  is_breeding_season: boolean;
  demand_supply_ratio: number | null;
}

interface BreedingIndicator {
  year: number;
  month: number;
  period: string;
  season: string;
  pregnant_count: number;
  lactating_count: number;
  in_heat_count: number;
  female_cats_spayed: number;
  breeding_active_pct: number;
  is_breeding_season: boolean;
}

interface KittenSurge {
  year: number;
  month: number;
  month_name: string;
  season: string;
  kitten_appointments: number;
  total_appointments: number;
  kitten_pct: number;
  historical_avg: number;
  z_score: number;
  is_surge_month: boolean;
}

interface SeasonalAlert {
  alert_type: string;
  severity: string;
  message: string;
  metric_name: string;
  current_value: number;
  threshold: number;
}

type ViewType = "dashboard" | "breeding" | "kittens" | "alerts";

const seasonColors: Record<string, { bg: string; color: string }> = {
  spring: { bg: "#d1fae5", color: "#065f46" },
  summer: { bg: "#fef3c7", color: "#92400e" },
  fall: { bg: "#fed7aa", color: "#9a3412" },
  winter: { bg: "#dbeafe", color: "#1e40af" },
};

const severityColors: Record<string, { bg: string; color: string }> = {
  high: { bg: "#fecaca", color: "#991b1b" },
  medium: { bg: "#fef3c7", color: "#92400e" },
  info: { bg: "#dbeafe", color: "#1e40af" },
};

export default function SeasonalAnalysisPage() {
  const [view, setView] = useState<ViewType>("dashboard");
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<SeasonalDashboard[]>([]);
  const [breedingData, setBreedingData] = useState<BreedingIndicator[]>([]);
  const [kittenData, setKittenData] = useState<KittenSurge[]>([]);
  const [alerts, setAlerts] = useState<SeasonalAlert[]>([]);
  const [yearFilter, setYearFilter] = useState<string>("");

  useEffect(() => {
    fetchData();
  }, [view, yearFilter]);

  async function fetchData() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ view });
      if (yearFilter) params.set("year", yearFilter);

      const result = await fetchApi<{
        data: SeasonalDashboard[] | BreedingIndicator[] | KittenSurge[] | SeasonalAlert[];
      }>(`/api/admin/beacon/seasonal?${params}`);

      if (view === "dashboard") {
        setDashboardData(result.data as SeasonalDashboard[]);
      } else if (view === "breeding") {
        setBreedingData(result.data as BreedingIndicator[]);
      } else if (view === "kittens") {
        setKittenData(result.data as KittenSurge[]);
      } else if (view === "alerts") {
        setAlerts(result.data as SeasonalAlert[]);
      }
    } catch (err) {
      console.error("Error fetching seasonal data:", err);
    } finally {
      setLoading(false);
    }
  }

  // Get unique years from data
  const years = [
    ...new Set(
      (dashboardData.length > 0
        ? dashboardData
        : breedingData.length > 0
        ? breedingData
        : kittenData
      ).map((d) => d.year)
    ),
  ].sort((a, b) => b - a);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1>Seasonal Analysis</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            style={{
              padding: "0.5rem",
              borderRadius: "6px",
              border: "1px solid var(--card-border)",
              background: "var(--card-bg)",
            }}
          >
            <option value="">All Years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* View Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {(["dashboard", "breeding", "kittens", "alerts"] as ViewType[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "none",
              background: view === v ? "var(--foreground)" : "var(--card-bg)",
              color: view === v ? "var(--background)" : "var(--foreground)",
              cursor: "pointer",
              fontWeight: view === v ? 600 : 400,
            }}
          >
            {v === "dashboard" && "Overview"}
            {v === "breeding" && "Breeding Indicators"}
            {v === "kittens" && "Kitten Surges"}
            {v === "alerts" && `Alerts ${alerts.length > 0 ? `(${alerts.length})` : ""}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-muted">Loading seasonal data...</div>
      ) : (
        <>
          {/* Alerts View */}
          {view === "alerts" && (
            <div>
              {alerts.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
                  <p className="text-muted">No active seasonal alerts</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {alerts.map((alert, i) => (
                    <div
                      key={i}
                      className="card"
                      style={{
                        background: severityColors[alert.severity]?.bg || "#f8f9fa",
                        borderLeft: `4px solid ${severityColors[alert.severity]?.color || "#6c757d"}`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                            {alert.alert_type.replace(/_/g, " ").toUpperCase()}
                          </div>
                          <div>{alert.message}</div>
                        </div>
                        <span
                          style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: severityColors[alert.severity]?.color || "#6c757d",
                            color: "#fff",
                          }}
                        >
                          {alert.severity.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                        Current: {alert.current_value} | Threshold: {alert.threshold}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dashboard View */}
          {view === "dashboard" && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Season</th>
                    <th style={{ textAlign: "right" }}>Appointments</th>
                    <th style={{ textAlign: "right" }}>Alterations</th>
                    <th style={{ textAlign: "right" }}>Kittens</th>
                    <th style={{ textAlign: "right" }}>Pregnant</th>
                    <th style={{ textAlign: "right" }}>Requests</th>
                    <th style={{ textAlign: "right" }}>Demand Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardData.map((row, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{row.period}</td>
                      <td>
                        <span
                          style={{
                            padding: "0.15rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            background: seasonColors[row.season]?.bg,
                            color: seasonColors[row.season]?.color,
                          }}
                        >
                          {row.season}
                        </span>
                        {row.is_breeding_season && (
                          <span
                            style={{
                              marginLeft: "0.25rem",
                              fontSize: "0.65rem",
                              color: "#dc3545",
                            }}
                            title="Active breeding season"
                          >
                            *
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{row.clinic_appointments}</td>
                      <td style={{ textAlign: "right" }}>{row.alterations}</td>
                      <td style={{ textAlign: "right" }}>
                        {row.kitten_procedures}
                        {row.kitten_intake_mentions > 0 && (
                          <span className="text-muted" style={{ fontSize: "0.75rem" }}>
                            {" "}(+{row.kitten_intake_mentions})
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{row.pregnant_cats}</td>
                      <td style={{ textAlign: "right" }}>
                        {row.intake_requests}
                        {row.urgent_requests > 0 && (
                          <span style={{ color: "#dc3545", fontSize: "0.75rem" }}>
                            {" "}({row.urgent_requests} urgent)
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {row.demand_supply_ratio !== null ? (
                          <span
                            style={{
                              color: row.demand_supply_ratio > 1.5 ? "#dc3545" : row.demand_supply_ratio > 1 ? "#fd7e14" : "#198754",
                            }}
                          >
                            {row.demand_supply_ratio.toFixed(2)}x
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Breeding Indicators View */}
          {view === "breeding" && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Season</th>
                    <th style={{ textAlign: "right" }}>Pregnant</th>
                    <th style={{ textAlign: "right" }}>Lactating</th>
                    <th style={{ textAlign: "right" }}>In Heat</th>
                    <th style={{ textAlign: "right" }}>Total Spayed</th>
                    <th style={{ textAlign: "right" }}>Breeding Active %</th>
                  </tr>
                </thead>
                <tbody>
                  {breedingData.map((row, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{row.period}</td>
                      <td>
                        <span
                          style={{
                            padding: "0.15rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            background: seasonColors[row.season]?.bg,
                            color: seasonColors[row.season]?.color,
                          }}
                        >
                          {row.season}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: row.pregnant_count > 0 ? "#dc3545" : undefined }}>
                          {row.pregnant_count}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: row.lactating_count > 0 ? "#fd7e14" : undefined }}>
                          {row.lactating_count}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: row.in_heat_count > 0 ? "#e91e63" : undefined }}>
                          {row.in_heat_count}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>{row.female_cats_spayed}</td>
                      <td style={{ textAlign: "right" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                          }}
                        >
                          <span
                            style={{
                              width: `${Math.min(row.breeding_active_pct, 100)}%`,
                              maxWidth: "60px",
                              height: "8px",
                              background: row.breeding_active_pct > 30 ? "#dc3545" : row.breeding_active_pct > 15 ? "#fd7e14" : "#198754",
                              borderRadius: "4px",
                              display: "inline-block",
                            }}
                          />
                          {row.breeding_active_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Kitten Surges View */}
          {view === "kittens" && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Season</th>
                    <th style={{ textAlign: "right" }}>Kitten Appts</th>
                    <th style={{ textAlign: "right" }}>Total Appts</th>
                    <th style={{ textAlign: "right" }}>Kitten %</th>
                    <th style={{ textAlign: "right" }}>Historical Avg</th>
                    <th style={{ textAlign: "right" }}>Z-Score</th>
                    <th>Surge?</th>
                  </tr>
                </thead>
                <tbody>
                  {kittenData.map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        background: row.is_surge_month ? "rgba(220, 53, 69, 0.1)" : undefined,
                      }}
                    >
                      <td style={{ fontWeight: 500 }}>
                        {row.month_name} {row.year}
                      </td>
                      <td>
                        <span
                          style={{
                            padding: "0.15rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            background: seasonColors[row.season]?.bg,
                            color: seasonColors[row.season]?.color,
                          }}
                        >
                          {row.season}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: row.is_surge_month ? 600 : 400 }}>
                        {row.kitten_appointments}
                      </td>
                      <td style={{ textAlign: "right" }}>{row.total_appointments}</td>
                      <td style={{ textAlign: "right" }}>{row.kitten_pct}%</td>
                      <td style={{ textAlign: "right" }} className="text-muted">
                        {row.historical_avg}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span
                          style={{
                            color: row.z_score > 2 ? "#dc3545" : row.z_score > 1 ? "#fd7e14" : row.z_score < -1 ? "#198754" : undefined,
                          }}
                        >
                          {row.z_score > 0 ? "+" : ""}
                          {row.z_score}
                        </span>
                      </td>
                      <td>
                        {row.is_surge_month && (
                          <span
                            style={{
                              padding: "0.15rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              background: "#dc3545",
                              color: "#fff",
                            }}
                          >
                            SURGE
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Legend */}
      <div className="card" style={{ marginTop: "1.5rem", padding: "1rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Legend
        </div>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
          <div>
            <span style={{ color: "#dc3545" }}>*</span> = Breeding Season (Feb-Nov)
          </div>
          <div>
            <strong>Demand Ratio</strong> = Requests / Alterations (high = capacity pressure)
          </div>
          <div>
            <strong>Z-Score</strong> = Standard deviations from historical mean
          </div>
          <div>
            <strong>Breeding %</strong> = (Pregnant + Lactating + Heat) / Spayed females
          </div>
        </div>
      </div>
    </div>
  );
}
