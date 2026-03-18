"use client";

import { useState, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";

interface ComparisonPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  lat: number;
  lng: number;
  service_zone: string | null;
  total_cats: number;
  altered_cats: number;
  intact_cats: number;
  unknown_status_cats: number;
  alteration_rate_pct: number | null;
  colony_status: string;
  total_requests: number;
  active_requests: number;
  total_appointments: number;
  last_appointment_date: string | null;
  first_appointment_date: string | null;
  estimated_population: number | null;
  ci_lower: number | null;
  ci_upper: number | null;
  sample_adequate: boolean | null;
  people_count: number;
  days_since_last_activity: number | null;
}

interface ComparisonSummary {
  places_compared: number;
  combined_cats: number;
  combined_altered: number;
  combined_alteration_rate: number | null;
  best_performing: { place_id: string; name: string | null; alteration_rate: number | null } | null;
  worst_performing: { place_id: string; name: string | null; alteration_rate: number | null } | null;
}

interface SearchResult {
  id: string;
  label: string;
  type: string;
  subtitle: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  managed: { bg: "#dcfce7", text: "#166534", label: "Managed" },
  in_progress: { bg: "#fef3c7", text: "#92400e", label: "In Progress" },
  needs_work: { bg: "#fed7aa", text: "#9a3412", label: "Needs Work" },
  needs_attention: { bg: "#fecaca", text: "#991b1b", label: "Needs Attention" },
  no_data: { bg: "#f3f4f6", text: "#6b7280", label: "No Data" },
};

export default function ComparisonPage() {
  const [placeIds, setPlaceIds] = useState<string[]>([]);
  const [places, setPlaces] = useState<ComparisonPlace[]>([]);
  const [summary, setSummary] = useState<ComparisonSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await fetchApi<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
      // Filter to places only
      setSearchResults((data.results || []).filter(r => r.type === "place"));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const addPlace = useCallback(async (id: string) => {
    if (placeIds.includes(id) || placeIds.length >= 10) return;

    const newIds = [...placeIds, id];
    setPlaceIds(newIds);
    setSearchQuery("");
    setSearchResults([]);

    // Fetch comparison
    setLoading(true);
    try {
      const data = await fetchApi<{ places: ComparisonPlace[]; summary: ComparisonSummary }>(
        `/api/beacon/compare?places=${newIds.join(",")}`
      );
      setPlaces(data.places);
      setSummary(data.summary);
    } catch (err) {
      console.error("Comparison failed:", err);
    } finally {
      setLoading(false);
    }
  }, [placeIds]);

  const removePlace = useCallback(async (id: string) => {
    const newIds = placeIds.filter(p => p !== id);
    setPlaceIds(newIds);

    if (newIds.length === 0) {
      setPlaces([]);
      setSummary(null);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchApi<{ places: ComparisonPlace[]; summary: ComparisonSummary }>(
        `/api/beacon/compare?places=${newIds.join(",")}`
      );
      setPlaces(data.places);
      setSummary(data.summary);
    } catch (err) {
      console.error("Comparison failed:", err);
    } finally {
      setLoading(false);
    }
  }, [placeIds]);

  const clearAll = useCallback(() => {
    setPlaceIds([]);
    setPlaces([]);
    setSummary(null);
  }, []);

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "0 1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
            Location Comparison
          </h1>
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
            Compare TNR metrics across up to 10 locations side-by-side
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

      {/* Search to add places */}
      <div className="card" style={{ padding: "1.25rem", marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Add Location</span>
          <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                doSearch(e.target.value);
              }}
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
                    onClick={() => addPlace(r.id)}
                    disabled={placeIds.includes(r.id)}
                    style={{
                      display: "block", width: "100%", padding: "0.5rem 0.75rem",
                      border: "none", background: "transparent", textAlign: "left", cursor: "pointer",
                      fontSize: "0.85rem", borderBottom: "1px solid var(--border)",
                      opacity: placeIds.includes(r.id) ? 0.5 : 1,
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
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {placeIds.length}/10 selected
          </span>
          {placeIds.length > 0 && (
            <button
              onClick={clearAll}
              style={{
                padding: "0.4rem 0.75rem", borderRadius: "4px", border: "1px solid var(--border)",
                background: "transparent", cursor: "pointer", fontSize: "0.85rem", color: "var(--text-muted)",
              }}
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div
          className="card"
          style={{
            padding: "1.25rem", marginBottom: "2rem",
            background: "linear-gradient(135deg, var(--success-bg) 0%, #dcfce7 100%)",
            border: "1px solid var(--success-border)",
          }}
        >
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem",
          }}>
            <SummaryStat label="Locations" value={summary.places_compared} />
            <SummaryStat label="Combined Cats" value={summary.combined_cats} />
            <SummaryStat label="Combined Altered" value={summary.combined_altered} />
            <SummaryStat
              label="Combined Rate"
              value={summary.combined_alteration_rate !== null ? `${summary.combined_alteration_rate}%` : "N/A"}
              color={
                summary.combined_alteration_rate !== null
                  ? summary.combined_alteration_rate >= 70 ? "#16a34a" : summary.combined_alteration_rate >= 50 ? "#f59e0b" : "#dc2626"
                  : undefined
              }
            />
            {summary.best_performing && (
              <SummaryStat
                label="Best Performing"
                value={`${summary.best_performing.alteration_rate ?? 0}%`}
                subtitle={summary.best_performing.name || "Unknown"}
                color="#16a34a"
              />
            )}
            {summary.worst_performing && (
              <SummaryStat
                label="Needs Most Work"
                value={`${summary.worst_performing.alteration_rate ?? 0}%`}
                subtitle={summary.worst_performing.name || "Unknown"}
                color="#dc2626"
              />
            )}
          </div>
        </div>
      )}

      {/* Comparison Table */}
      {loading && <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>Loading comparison...</div>}

      {!loading && places.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", position: "sticky", left: 0, background: "var(--card-bg, white)", minWidth: "180px" }}>Location</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Cats</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Altered</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Rate</th>
                <th style={{ textAlign: "center", padding: "0.5rem 0.75rem" }}>Status</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Est. Pop</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Requests</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>People</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Days Idle</th>
                <th style={{ textAlign: "center", padding: "0.5rem 0.75rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {places.map(p => {
                const isBest = summary?.best_performing?.place_id === p.place_id;
                const isWorst = summary?.worst_performing?.place_id === p.place_id;
                const statusCfg = STATUS_COLORS[p.colony_status] || STATUS_COLORS.no_data;

                return (
                  <tr
                    key={p.place_id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: isBest ? "var(--success-bg)" : isWorst ? "var(--danger-bg)" : undefined,
                    }}
                  >
                    <td style={{ padding: "0.5rem 0.75rem", position: "sticky", left: 0, background: isBest ? "var(--success-bg)" : isWorst ? "var(--danger-bg)" : "var(--card-bg, white)" }}>
                      <a href={`/places/${p.place_id}`} style={{ fontWeight: 500, color: "inherit", textDecoration: "none" }}>
                        {p.display_name || p.formatted_address}
                      </a>
                      {p.service_zone && (
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{p.service_zone}</div>
                      )}
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{p.total_cats}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{p.altered_cats}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem", fontWeight: 600 }}>
                      {p.alteration_rate_pct !== null ? `${p.alteration_rate_pct}%` : "—"}
                    </td>
                    <td style={{ textAlign: "center", padding: "0.5rem 0.75rem" }}>
                      <span style={{
                        display: "inline-block", padding: "0.1rem 0.5rem", borderRadius: "9999px",
                        fontSize: "0.7rem", fontWeight: 500, background: statusCfg.bg, color: statusCfg.text,
                      }}>
                        {statusCfg.label}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
                      {p.estimated_population !== null ? (
                        <span title={p.sample_adequate ? "Adequate sample" : "Low sample"}>
                          {p.estimated_population}
                          {p.ci_lower !== null && p.ci_upper !== null && (
                            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                              {" "}({p.ci_lower}–{p.ci_upper})
                            </span>
                          )}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
                      {p.total_requests}
                      {p.active_requests > 0 && (
                        <span style={{ fontSize: "0.7rem", color: "#dc2626" }}> ({p.active_requests} active)</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{p.people_count}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
                      {p.days_since_last_activity !== null ? p.days_since_last_activity : "—"}
                    </td>
                    <td style={{ textAlign: "center", padding: "0.5rem 0.75rem" }}>
                      <button
                        onClick={() => removePlace(p.place_id)}
                        style={{
                          border: "none", background: "transparent", cursor: "pointer",
                          color: "var(--text-muted)", fontSize: "1rem",
                        }}
                        title="Remove from comparison"
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {!loading && places.length === 0 && (
        <div className="card" style={{
          padding: "3rem", textAlign: "center", color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📊</div>
          <div style={{ fontSize: "1rem", fontWeight: 500, marginBottom: "0.5rem" }}>
            No locations selected
          </div>
          <div style={{ fontSize: "0.85rem" }}>
            Search for locations above to start comparing TNR metrics side-by-side.
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, subtitle, color }: {
  label: string; value: string | number; subtitle?: string; color?: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: color || "var(--text)" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
