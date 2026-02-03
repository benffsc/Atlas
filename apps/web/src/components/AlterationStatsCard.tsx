"use client";

import { useState, useEffect } from "react";
import { SafeLinkingIndicator, MatchReasonBadge, ConfidenceMeter } from "./SafeLinkingIndicators";

interface LinkedCat {
  cat_id: string;
  cat_name: string;
  microchip: string | null;
  sex: string | null;
  match_reason: string;
  confidence: number;
  procedure_date: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  altered_after_request: boolean;
  in_window: boolean; // Whether this cat was caught for THIS request
}

interface AlterationStats {
  request_id: string;
  effective_request_date: string;
  window_start: string;
  window_end: string;
  window_type?: "active" | "resolved" | "redirected_closed" | "handoff_closed" | "redirect_child" | "handoff_child";
  cats_caught: number;
  cats_for_request: number; // Cats caught specifically for THIS request
  cats_altered: number;
  already_altered_before: number;
  males: number;
  females: number;
  alteration_rate_pct: number | null;
  avg_match_confidence: number;
  linked_cats: LinkedCat[];
  is_legacy_request: boolean;
  can_upgrade: boolean;
  estimated_cat_count: number | null;
}

interface AlterationStatsCardProps {
  requestId: string;
  onUpgradeClick?: () => void;
}

export function AlterationStatsCard({ requestId, onUpgradeClick }: AlterationStatsCardProps) {
  const [stats, setStats] = useState<AlterationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCats, setShowCats] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch(`/api/requests/${requestId}/alteration-stats`);
        if (!response.ok) {
          throw new Error("Failed to load alteration stats");
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading stats");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [requestId]);

  if (loading) {
    return (
      <div className="card" style={{ padding: "1rem" }}>
        <div className="text-muted">Loading clinic statistics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: "1rem", background: "#fff3cd" }}>
        <div style={{ color: "#856404" }}>Unable to load clinic statistics</div>
      </div>
    );
  }

  if (!stats) return null;

  // Determine rate color
  let rateColor = "#6c757d"; // gray for no data
  if (stats.alteration_rate_pct !== null) {
    if (stats.alteration_rate_pct >= 80) rateColor = "#198754"; // green
    else if (stats.alteration_rate_pct >= 50) rateColor = "#fd7e14"; // orange
    else rateColor = "#dc3545"; // red
  }

  const eligibleForAlteration = stats.cats_caught - stats.already_altered_before;

  return (
    <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
          Clinic Statistics
          {stats.is_legacy_request && (
            <span
              style={{
                marginLeft: "0.5rem",
                padding: "0.15rem 0.4rem",
                background: "#6c757d",
                color: "#fff",
                borderRadius: "4px",
                fontSize: "0.7rem",
              }}
            >
              Legacy
            </span>
          )}
        </h3>
        {stats.is_legacy_request && stats.can_upgrade && onUpgradeClick && (
          <button
            onClick={onUpgradeClick}
            style={{
              padding: "0.25rem 0.75rem",
              fontSize: "0.875rem",
              background: "#0d6efd",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Upgrade to Atlas
          </button>
        )}
      </div>

      {/* Time Window Info */}
      <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span>
          Data window: {new Date(stats.window_start).toLocaleDateString()} to{" "}
          {new Date(stats.window_end).toLocaleDateString()}
        </span>
        {stats.window_type && (
          <span
            style={{
              padding: "0.15rem 0.4rem",
              borderRadius: "4px",
              fontSize: "0.65rem",
              fontWeight: 500,
              background: stats.window_type === "active" ? "#198754" : "#6c757d",
              color: "#fff",
            }}
            title={
              stats.window_type === "active"
                ? "Request is active — all cats from clinic count"
                : "Request resolved — cats within 6 months of creation or while active"
            }
          >
            {stats.window_type === "active" ? "Active" : "Resolved"}
          </span>
        )}
      </div>

      {/* Main Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
        {/* Alteration Rate */}
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8f9fa", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: rateColor }}>
            {stats.alteration_rate_pct !== null ? `${stats.alteration_rate_pct}%` : "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Place Progress</div>
        </div>

        {/* Cats For This Request - Primary metric */}
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#e7f5ff", borderRadius: "8px", border: "1px solid #0d6efd" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#0d6efd" }}>
            {stats.cats_for_request}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#0d6efd" }}>For This Request</div>
        </div>

        {/* Total At Place */}
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8f9fa", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#212529" }}>
            {stats.cats_caught}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Total at Place</div>
        </div>

        {/* Historical (Pre-Request) */}
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8f9fa", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#6c757d" }}>
            {stats.already_altered_before}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Historical</div>
        </div>
      </div>

      {/* Sex Breakdown */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.875rem", color: "#666" }}>Males:</span>
          <span style={{ fontWeight: 600 }}>{stats.males}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.875rem", color: "#666" }}>Females:</span>
          <span style={{ fontWeight: 600 }}>{stats.females}</span>
        </div>
        {stats.estimated_cat_count && (
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}
            title="Cats still needing TNR at this location (not total colony size)"
          >
            <span style={{ fontSize: "0.875rem", color: "#666" }}>TNR Target:</span>
            <span style={{ fontWeight: 600 }}>{stats.estimated_cat_count}</span>
          </div>
        )}
      </div>

      {/* Match Confidence */}
      {stats.cats_caught > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.875rem", color: "#666" }}>Match Confidence:</span>
          <ConfidenceMeter confidence={stats.avg_match_confidence} />
        </div>
      )}

      {/* Linked Cats (expandable) */}
      {stats.linked_cats.length > 0 && (
        <div>
          <button
            onClick={() => setShowCats(!showCats)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: "#0d6efd",
              cursor: "pointer",
              fontSize: "0.875rem",
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            {showCats ? "▼" : "▶"} View {stats.linked_cats.length} linked cat{stats.linked_cats.length !== 1 ? "s" : ""}
            {stats.cats_for_request > 0 && (
              <span style={{ color: "#0d6efd", fontWeight: 600 }}>
                ({stats.cats_for_request} for this request)
              </span>
            )}
          </button>

          {showCats && (
            <div style={{ marginTop: "0.75rem", maxHeight: "300px", overflowY: "auto" }}>
              <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Cat</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Microchip</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Sex</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Procedure</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Attribution</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Sort cats: in_window first, then by procedure date */}
                  {[...stats.linked_cats]
                    .sort((a, b) => {
                      if (a.in_window !== b.in_window) return a.in_window ? -1 : 1;
                      return new Date(b.procedure_date || 0).getTime() - new Date(a.procedure_date || 0).getTime();
                    })
                    .map((cat) => (
                    <tr
                      key={cat.cat_id}
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        background: cat.in_window ? "#e7f5ff" : "transparent",
                      }}
                    >
                      <td style={{ padding: "0.5rem" }}>
                        <a href={`/cats/${cat.cat_id}`} style={{ color: "#0d6efd", textDecoration: "none" }}>
                          {cat.cat_name}
                        </a>
                      </td>
                      <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.7rem" }}>
                        {cat.microchip || "—"}
                      </td>
                      <td style={{ padding: "0.5rem" }}>{cat.sex || "—"}</td>
                      <td style={{ padding: "0.5rem" }}>
                        {cat.procedure_date ? (
                          <span style={{ color: "#212529" }}>
                            {new Date(cat.procedure_date).toLocaleDateString()}
                          </span>
                        ) : (
                          <span style={{ color: "#dc3545" }}>None</span>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        {cat.in_window ? (
                          <span
                            style={{
                              padding: "0.15rem 0.4rem",
                              background: "#0d6efd",
                              color: "#fff",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                            }}
                          >
                            This Request
                          </span>
                        ) : (
                          <span
                            style={{
                              padding: "0.15rem 0.4rem",
                              background: "#6c757d",
                              color: "#fff",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                            }}
                          >
                            Historical
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Explanation */}
      <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#f0f0f0", borderRadius: "6px", fontSize: "0.75rem", color: "#666" }}>
        <strong>How this is calculated:</strong>
        <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
          <li><strong>For This Request:</strong> Cats caught within the data window (attributable to this request)</li>
          <li><strong>Total at Place:</strong> All altered cats ever linked to this location</li>
          <li><strong>Place Progress:</strong> Total cats caught / TNR target (cats still needing spay/neuter)</li>
          <li><strong>TNR Target:</strong> Cats the requester said still need spay/neuter (not total colony size)</li>
        </ul>
      </div>
    </div>
  );
}
