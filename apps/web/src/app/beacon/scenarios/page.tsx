"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";

interface ForecastPoint {
  month: number;
  date: string;
  population: number;
  altered: number;
  unaltered: number;
  alteration_rate: number;
  cumulative_procedures: number;
}

interface ScenarioData {
  label: string;
  description: string;
  points: ForecastPoint[];
  months_to_75: number | null;
  final_population: number;
  final_alteration_rate: number;
  total_procedures: number;
}

interface ForecastResponse {
  place_id: string;
  current: {
    population: number;
    altered: number;
    alteration_rate: number;
    monthly_alteration_rate: number;
    monthly_intake_rate: number;
  };
  scenarios: {
    baseline: ScenarioData;
    optimistic: ScenarioData;
    aggressive: ScenarioData;
  };
}

interface SearchResult {
  id: string;
  label: string;
  type: string;
  subtitle: string;
}

const SCENARIO_COLORS = {
  baseline: "#6b7280",
  optimistic: "#3b82f6",
  aggressive: "#16a34a",
};

export default function ScenariosPage() {
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Scenario toggles
  const [showBaseline, setShowBaseline] = useState(true);
  const [showOptimistic, setShowOptimistic] = useState(true);
  const [showAggressive, setShowAggressive] = useState(true);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const data = await fetchApi<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
      setSearchResults((data.results || []).filter(r => r.type === "place"));
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, []);

  const selectPlace = useCallback(async (id: string, name: string) => {
    setPlaceId(id);
    setPlaceName(name);
    setSearchQuery("");
    setSearchResults([]);
    setLoading(true);
    try {
      const data = await fetchApi<ForecastResponse>(`/api/beacon/forecast?place_id=${id}`);
      setForecast(data);
    } catch (err) {
      console.error("Forecast failed:", err);
      setForecast(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
            Population Forecast & Scenarios
          </h1>
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
            Project colony population 10 years forward under different TNR scenarios
          </p>
        </div>
        <a
          href="/beacon"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.5rem 1rem", background: "var(--foreground)", color: "var(--background)",
            borderRadius: "6px", textDecoration: "none", fontSize: "0.9rem", fontWeight: 500,
          }}
        >
          Back to Beacon
        </a>
      </div>

      {/* Place selector */}
      <div className="card" style={{ padding: "1.25rem", marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Select Location</span>
          <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); doSearch(e.target.value); }}
              placeholder="Search by address or name..."
              style={{
                width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px",
                border: "1px solid var(--border)", fontSize: "0.85rem",
              }}
            />
            {searchResults.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0,
                background: "var(--card-bg, white)", border: "1px solid var(--border)",
                borderRadius: "0 0 6px 6px", zIndex: 10, maxHeight: "250px", overflowY: "auto",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}>
                {searchResults.map(r => (
                  <button
                    key={r.id}
                    onClick={() => selectPlace(r.id, r.label)}
                    style={{
                      display: "block", width: "100%", padding: "0.5rem 0.75rem",
                      border: "none", background: "transparent", textAlign: "left", cursor: "pointer",
                      fontSize: "0.85rem", borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{r.label}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{r.subtitle}</div>
                  </button>
                ))}
              </div>
            )}
            {searching && (
              <div style={{
                position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
                fontSize: "0.75rem", color: "var(--text-muted)",
              }}>
                Searching...
              </div>
            )}
          </div>
          {placeName && (
            <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text)" }}>
              {placeName}
            </span>
          )}
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>Generating forecast...</div>}

      {forecast && !loading && (
        <>
          {/* Current state */}
          <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600 }}>Current State</h2>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "1rem",
            }}>
              <InfoStat label="Population" value={forecast.current.population} />
              <InfoStat label="Altered" value={forecast.current.altered} />
              <InfoStat
                label="Alteration Rate"
                value={`${forecast.current.alteration_rate}%`}
                color={forecast.current.alteration_rate >= 70 ? "#16a34a" : forecast.current.alteration_rate >= 50 ? "#f59e0b" : "#dc2626"}
              />
              <InfoStat label="Monthly Alt. Rate" value={`${forecast.current.monthly_alteration_rate}%`} />
              <InfoStat label="Monthly Intake" value={`${forecast.current.monthly_intake_rate} cats`} />
            </div>
          </div>

          {/* Scenario toggles */}
          <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Scenarios:</span>
              <ScenarioToggle
                label="Current Rate"
                color={SCENARIO_COLORS.baseline}
                active={showBaseline}
                onToggle={() => setShowBaseline(!showBaseline)}
              />
              <ScenarioToggle
                label="Double Effort"
                color={SCENARIO_COLORS.optimistic}
                active={showOptimistic}
                onToggle={() => setShowOptimistic(!showOptimistic)}
              />
              <ScenarioToggle
                label="Maximum Effort"
                color={SCENARIO_COLORS.aggressive}
                active={showAggressive}
                onToggle={() => setShowAggressive(!showAggressive)}
              />
            </div>
          </div>

          {/* Forecast chart */}
          <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600 }}>
              10-Year Population Projection
            </h2>
            <ForecastChart
              scenarios={forecast.scenarios}
              showBaseline={showBaseline}
              showOptimistic={showOptimistic}
              showAggressive={showAggressive}
            />
          </div>

          {/* Scenario comparison cards */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "2rem",
          }}>
            {showBaseline && (
              <ScenarioCard scenario={forecast.scenarios.baseline} color={SCENARIO_COLORS.baseline} />
            )}
            {showOptimistic && (
              <ScenarioCard scenario={forecast.scenarios.optimistic} color={SCENARIO_COLORS.optimistic} />
            )}
            {showAggressive && (
              <ScenarioCard scenario={forecast.scenarios.aggressive} color={SCENARIO_COLORS.aggressive} />
            )}
          </div>

          {/* Intervention Impact Comparison */}
          <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600 }}>
              Intervention Impact
            </h2>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Projected outcomes after 10 years under each scenario
            </p>

            {/* Delta cards: show savings vs baseline */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem",
            }}>
              {/* Baseline reference */}
              <div style={{
                padding: "1rem", borderRadius: "8px",
                background: "var(--border, #f3f4f6)",
              }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: SCENARIO_COLORS.baseline, marginBottom: "0.5rem" }}>
                  IF WE DO NOTHING
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                  {forecast.scenarios.baseline.description}
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#dc2626" }}>
                  {forecast.scenarios.baseline.final_population.toLocaleString()} cats
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {forecast.scenarios.baseline.final_alteration_rate}% alteration rate
                </div>
              </div>

              {/* Double Effort delta */}
              {(() => {
                const baseline = forecast.scenarios.baseline;
                const optimistic = forecast.scenarios.optimistic;
                const popDelta = baseline.final_population - optimistic.final_population;
                const rateDelta = optimistic.final_alteration_rate - baseline.final_alteration_rate;
                return (
                  <div style={{
                    padding: "1rem", borderRadius: "8px",
                    border: `2px solid ${SCENARIO_COLORS.optimistic}`,
                    background: `${SCENARIO_COLORS.optimistic}08`,
                  }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: SCENARIO_COLORS.optimistic, marginBottom: "0.5rem" }}>
                      DOUBLE EFFORT
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                      {optimistic.description}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Fewer Cats</div>
                        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#16a34a" }}>
                          {popDelta > 0 ? `-${popDelta.toLocaleString()}` : `+${Math.abs(popDelta).toLocaleString()}`}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Rate Gain</div>
                        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: SCENARIO_COLORS.optimistic }}>
                          +{rateDelta.toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Final Pop.</div>
                        <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                          {optimistic.final_population.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Time to 75%</div>
                        <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                          {optimistic.months_to_75 !== null ? `${optimistic.months_to_75} mo` : "N/A"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Aggressive delta */}
              {(() => {
                const baseline = forecast.scenarios.baseline;
                const aggressive = forecast.scenarios.aggressive;
                const popDelta = baseline.final_population - aggressive.final_population;
                const rateDelta = aggressive.final_alteration_rate - baseline.final_alteration_rate;
                return (
                  <div style={{
                    padding: "1rem", borderRadius: "8px",
                    border: `2px solid ${SCENARIO_COLORS.aggressive}`,
                    background: `${SCENARIO_COLORS.aggressive}08`,
                  }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: SCENARIO_COLORS.aggressive, marginBottom: "0.5rem" }}>
                      MAXIMUM EFFORT
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                      {aggressive.description}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Fewer Cats</div>
                        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#16a34a" }}>
                          {popDelta > 0 ? `-${popDelta.toLocaleString()}` : `+${Math.abs(popDelta).toLocaleString()}`}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Rate Gain</div>
                        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: SCENARIO_COLORS.aggressive }}>
                          +{rateDelta.toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Final Pop.</div>
                        <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                          {aggressive.final_population.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Time to 75%</div>
                        <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                          {aggressive.months_to_75 !== null ? `${aggressive.months_to_75} mo` : "N/A"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Total procedures comparison */}
            <div style={{
              marginTop: "1rem", paddingTop: "1rem",
              borderTop: "1px solid var(--border)",
              display: "flex", gap: "1.5rem", flexWrap: "wrap",
              fontSize: "0.8rem",
            }}>
              <span style={{ color: "var(--text-muted)" }}>
                Procedures needed:
              </span>
              <span>
                <span style={{ color: SCENARIO_COLORS.baseline, fontWeight: 600 }}>Current:</span>{" "}
                {forecast.scenarios.baseline.total_procedures.toLocaleString()}
              </span>
              <span>
                <span style={{ color: SCENARIO_COLORS.optimistic, fontWeight: 600 }}>Double:</span>{" "}
                {forecast.scenarios.optimistic.total_procedures.toLocaleString()}
              </span>
              <span>
                <span style={{ color: SCENARIO_COLORS.aggressive, fontWeight: 600 }}>Maximum:</span>{" "}
                {forecast.scenarios.aggressive.total_procedures.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Scientific context */}
          <div className="card" style={{ padding: "1.25rem" }}>
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem" }}>Model Assumptions</h3>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 0.5rem 0" }}>
                <strong>Attrition:</strong> ~15% annual natural attrition (mortality, emigration, adoption).
              </p>
              <p style={{ margin: "0 0 0.5rem 0" }}>
                <strong>Reproduction:</strong> ~1 surviving kitten per unaltered cat per year (accounting for kitten mortality).
              </p>
              <p style={{ margin: "0 0 0.5rem 0" }}>
                <strong>75% Threshold:</strong> Research indicates 70-75% sterilization coverage is needed for population stabilization
                (Levy et al., 2014; McCarthy et al., 2013).
              </p>
              <p style={{ margin: 0 }}>
                <strong>Intake:</strong> Monthly intake rate derived from new cats seen in the last 12 months.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!forecast && !loading && !placeId && (
        <div className="card" style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📈</div>
          <div style={{ fontSize: "1rem", fontWeight: 500, marginBottom: "0.5rem" }}>
            Select a location to begin
          </div>
          <div style={{ fontSize: "0.85rem" }}>
            Search for a colony site above to generate 10-year population projections under different TNR scenarios.
          </div>
        </div>
      )}
    </div>
  );
}

function InfoStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: color || "var(--text)" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function ScenarioToggle({ label, color, active, onToggle }: {
  label: string; color: string; active: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        padding: "0.35rem 0.75rem", borderRadius: "6px",
        border: `2px solid ${active ? color : "var(--border)"}`,
        background: active ? `${color}15` : "transparent",
        cursor: "pointer", fontSize: "0.8rem", fontWeight: 500,
        color: active ? color : "var(--text-muted)",
        transition: "all 0.15s",
      }}
    >
      <span style={{
        width: "10px", height: "3px", borderRadius: "2px",
        background: active ? color : "var(--border)", display: "inline-block",
      }} />
      {label}
    </button>
  );
}

function ScenarioCard({ scenario, color }: { scenario: ScenarioData; color: string }) {
  return (
    <div className="card" style={{ padding: "1.25rem", borderTop: `3px solid ${color}` }}>
      <div style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.25rem", color }}>
        {scenario.label}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
        {scenario.description}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Final Population</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{scenario.final_population.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Final Rate</div>
          <div style={{
            fontSize: "1.1rem", fontWeight: 700,
            color: scenario.final_alteration_rate >= 75 ? "#16a34a" : scenario.final_alteration_rate >= 50 ? "#f59e0b" : "#dc2626",
          }}>
            {scenario.final_alteration_rate}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Months to 75%</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
            {scenario.months_to_75 !== null ? `${scenario.months_to_75} mo` : "Not reached"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Total Procedures</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{scenario.total_procedures.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

/** SVG line chart for population forecasts */
function ForecastChart({ scenarios, showBaseline, showOptimistic, showAggressive }: {
  scenarios: { baseline: ScenarioData; optimistic: ScenarioData; aggressive: ScenarioData };
  showBaseline: boolean;
  showOptimistic: boolean;
  showAggressive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Collect all visible points to determine scale
  const allPoints: ForecastPoint[] = [];
  if (showBaseline) allPoints.push(...scenarios.baseline.points);
  if (showOptimistic) allPoints.push(...scenarios.optimistic.points);
  if (showAggressive) allPoints.push(...scenarios.aggressive.points);

  if (allPoints.length === 0) {
    return <div style={{ color: "var(--text-muted)", padding: "2rem", textAlign: "center" }}>Select at least one scenario to display</div>;
  }

  const maxMonth = Math.max(...allPoints.map(p => p.month));
  const maxPop = Math.max(...allPoints.map(p => p.population), 1);

  const toX = (month: number) => padding.left + (month / maxMonth) * chartW;
  const toY = (pop: number) => padding.top + (1 - pop / maxPop) * chartH;

  const buildPath = (points: ForecastPoint[]) => {
    // Sample every 3rd point to reduce SVG path complexity
    const sampled = points.filter((_, i) => i % 3 === 0 || i === points.length - 1);
    return sampled.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.month).toFixed(1)} ${toY(p.population).toFixed(1)}`).join(" ");
  };

  // 75% threshold line
  const threshold75Y = toY(maxPop * 0.75);

  // Year markers
  const yearLabels: { month: number; label: string }[] = [];
  const basePoints = scenarios.baseline.points;
  for (let i = 0; i < basePoints.length; i += 12) {
    yearLabels.push({ month: basePoints[i].month, label: basePoints[i].date.slice(0, 4) });
  }

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: `${height}px` }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = padding.top + (1 - frac) * chartH;
          return (
            <g key={frac}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y}
                stroke="var(--border, #e5e7eb)" strokeWidth="1" strokeDasharray={frac === 0 ? undefined : "4 4"} />
              <text x={padding.left - 5} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted, #9ca3af)">
                {Math.round(maxPop * frac)}
              </text>
            </g>
          );
        })}

        {/* Year labels */}
        {yearLabels.map(yl => (
          <g key={yl.month}>
            <line x1={toX(yl.month)} x2={toX(yl.month)} y1={padding.top} y2={height - padding.bottom}
              stroke="var(--border, #e5e7eb)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={toX(yl.month)} y={height - padding.bottom + 16}
              textAnchor="middle" fontSize="10" fill="var(--text-muted, #9ca3af)">
              {yl.label}
            </text>
          </g>
        ))}

        {/* 75% threshold reference line */}
        <line x1={padding.left} x2={width - padding.right}
          y1={threshold75Y} y2={threshold75Y}
          stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3" />
        <text x={width - padding.right - 5} y={threshold75Y - 5}
          textAnchor="end" fontSize="9" fill="#f59e0b" fontWeight="600">
          75% target
        </text>

        {/* Scenario lines */}
        {showBaseline && (
          <path d={buildPath(scenarios.baseline.points)}
            fill="none" stroke={SCENARIO_COLORS.baseline} strokeWidth="2" />
        )}
        {showOptimistic && (
          <path d={buildPath(scenarios.optimistic.points)}
            fill="none" stroke={SCENARIO_COLORS.optimistic} strokeWidth="2" />
        )}
        {showAggressive && (
          <path d={buildPath(scenarios.aggressive.points)}
            fill="none" stroke={SCENARIO_COLORS.aggressive} strokeWidth="2" />
        )}

        {/* X-axis label */}
        <text x={width / 2} y={height - 5}
          textAnchor="middle" fontSize="11" fill="var(--text-muted, #9ca3af)">
          Year
        </text>

        {/* Y-axis label */}
        <text x={12} y={height / 2}
          textAnchor="middle" fontSize="11" fill="var(--text-muted, #9ca3af)"
          transform={`rotate(-90, 12, ${height / 2})`}>
          Population
        </text>
      </svg>
    </div>
  );
}
