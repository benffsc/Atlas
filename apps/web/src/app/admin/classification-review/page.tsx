"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";

interface PlaceNeedingClassification {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  current_classification: string | null;
  suggested_classification: string;
  avg_confidence: number;
  request_count: number;
  agreement_count: number;
  most_recent_request_id: string;
  most_recent_at: string;
  signals_sample: Record<string, { value: unknown; weight: number; toward: string }> | null;
}

interface ClassificationStats {
  pending_places: number;
  pending_requests: number;
  auto_applied_today: number;
  by_classification: Record<string, number>;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  unknown: "Unknown",
  individual_cats: "Individual Cats",
  small_colony: "Small Colony (3-10)",
  large_colony: "Large Colony (10+)",
  feeding_station: "Feeding Station",
};

const CLASSIFICATION_COLORS: Record<string, { bg: string; border: string }> = {
  unknown: { bg: "#f3f4f6", border: "#9ca3af" },
  individual_cats: { bg: "#dbeafe", border: "#3b82f6" },
  small_colony: { bg: "#fef3c7", border: "#f59e0b" },
  large_colony: { bg: "#fee2e2", border: "#ef4444" },
  feeding_station: { bg: "#d1fae5", border: "#10b981" },
};

const FILTER_OPTIONS = [
  { value: "all", label: "All Pending" },
  { value: "high_confidence", label: "High Confidence (80%+)" },
  { value: "low_confidence", label: "Low Confidence (<60%)" },
  { value: "conflicting", label: "Conflicting Signals" },
];

export default function ClassificationReviewPage() {
  const [places, setPlaces] = useState<PlaceNeedingClassification[]>([]);
  const [stats, setStats] = useState<ClassificationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState("all");
  const [classificationFilter, setClassificationFilter] = useState<string | null>(null);

  const [selectedPlaces, setSelectedPlaces] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkClassification, setBulkClassification] = useState("individual_cats");
  const [bulkReason, setBulkReason] = useState("");
  const [processing, setProcessing] = useState(false);

  const [expandedPlace, setExpandedPlace] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter });
      if (classificationFilter) {
        params.set("classification", classificationFilter);
      }

      const data = await fetchApi<{ places: PlaceNeedingClassification[]; stats: ClassificationStats }>(`/api/admin/classification-review?${params}`);
      setPlaces(data.places);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter, classificationFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleSelectAll = () => {
    if (selectedPlaces.size === places.length) {
      setSelectedPlaces(new Set());
    } else {
      setSelectedPlaces(new Set(places.map(p => p.place_id)));
    }
  };

  const toggleSelect = (placeId: string) => {
    const newSelected = new Set(selectedPlaces);
    if (newSelected.has(placeId)) {
      newSelected.delete(placeId);
    } else {
      newSelected.add(placeId);
    }
    setSelectedPlaces(newSelected);
  };

  const handleBulkAction = async () => {
    if (selectedPlaces.size === 0) return;

    setProcessing(true);
    try {
      const body: Record<string, unknown> = {
        action: bulkAction,
        place_ids: Array.from(selectedPlaces),
      };

      if (bulkAction === "apply_classification") {
        body.classification = bulkClassification;
        body.reason = bulkReason || undefined;
      }

      const result = await postApi<{ updated: number }>("/api/admin/classification-review", body);
      alert(`Updated ${result.updated} places`);

      setSelectedPlaces(new Set());
      setBulkAction(null);
      setBulkReason("");
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to process");
    } finally {
      setProcessing(false);
    }
  };

  const acceptSingle = async (place: PlaceNeedingClassification) => {
    try {
      await postApi(`/api/requests/${place.most_recent_request_id}/classification-suggestion`, { action: "accept" });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to accept");
    }
  };

  const dismissSingle = async (place: PlaceNeedingClassification) => {
    try {
      await postApi(`/api/requests/${place.most_recent_request_id}/classification-suggestion`, { action: "dismiss" });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to dismiss");
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Classification Review Queue
        </h1>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Review and approve classification suggestions for places
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
          <div className="card" style={{ padding: "1rem" }}>
            <div style={{ fontSize: "2rem", fontWeight: 600 }}>{stats.pending_places}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Places Pending</div>
          </div>
          <div className="card" style={{ padding: "1rem" }}>
            <div style={{ fontSize: "2rem", fontWeight: 600 }}>{stats.pending_requests}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Requests with Suggestions</div>
          </div>
          <div className="card" style={{ padding: "1rem" }}>
            <div style={{ fontSize: "2rem", fontWeight: 600 }}>{stats.auto_applied_today}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Auto-Applied Today</div>
          </div>
          <div className="card" style={{ padding: "1rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {Object.entries(stats.by_classification).map(([cls, count]) => (
                <span
                  key={cls}
                  onClick={() => setClassificationFilter(classificationFilter === cls ? null : cls)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    background: CLASSIFICATION_COLORS[cls]?.bg || "#f3f4f6",
                    border: `1px solid ${CLASSIFICATION_COLORS[cls]?.border || "#d1d5db"}`,
                    cursor: "pointer",
                    opacity: classificationFilter && classificationFilter !== cls ? 0.5 : 1,
                  }}
                >
                  {CLASSIFICATION_LABELS[cls] || cls}: {count}
                </span>
              ))}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>By Classification</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border)",
                  background: filter === opt.value ? "var(--primary)" : "var(--bg)",
                  color: filter === opt.value ? "#fff" : "inherit",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {classificationFilter && (
            <button
              onClick={() => setClassificationFilter(null)}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              Clear: {CLASSIFICATION_LABELS[classificationFilter]} x
            </button>
          )}
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedPlaces.size > 0 && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem", background: "var(--info-bg)" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 500 }}>{selectedPlaces.size} selected</span>

            <select
              value={bulkAction || ""}
              onChange={(e) => setBulkAction(e.target.value || null)}
              style={{ padding: "0.4rem", borderRadius: "4px", border: "1px solid var(--border)" }}
            >
              <option value="">Choose action...</option>
              <option value="accept_all">Accept Suggested</option>
              <option value="apply_classification">Apply Classification...</option>
            </select>

            {bulkAction === "apply_classification" && (
              <>
                <select
                  value={bulkClassification}
                  onChange={(e) => setBulkClassification(e.target.value)}
                  style={{ padding: "0.4rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                >
                  <option value="individual_cats">Individual Cats</option>
                  <option value="small_colony">Small Colony</option>
                  <option value="large_colony">Large Colony</option>
                  <option value="feeding_station">Feeding Station</option>
                </select>
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={bulkReason}
                  onChange={(e) => setBulkReason(e.target.value)}
                  style={{ padding: "0.4rem", borderRadius: "4px", border: "1px solid var(--border)", width: "200px" }}
                />
              </>
            )}

            {bulkAction && (
              <button
                onClick={handleBulkAction}
                disabled={processing}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: "4px",
                  border: "none",
                  background: "var(--primary)",
                  color: "#fff",
                  cursor: processing ? "not-allowed" : "pointer",
                  opacity: processing ? 0.6 : 1,
                }}
              >
                {processing ? "Processing..." : "Apply"}
              </button>
            )}

            <button
              onClick={() => setSelectedPlaces(new Set())}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                cursor: "pointer",
              }}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "1rem", background: "var(--error-bg)", color: "var(--error-text)", borderRadius: "8px", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      )}

      {/* Places Table */}
      {!loading && places.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--section-bg)" }}>
                <th style={{ padding: "0.75rem", textAlign: "left", width: "40px" }}>
                  <input
                    type="checkbox"
                    checked={selectedPlaces.size === places.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Place</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Suggested</th>
                <th style={{ padding: "0.75rem", textAlign: "center" }}>Confidence</th>
                <th style={{ padding: "0.75rem", textAlign: "center" }}>Requests</th>
                <th style={{ padding: "0.75rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {places.map((place) => (
                <>
                  <tr
                    key={place.place_id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: selectedPlaces.has(place.place_id) ? "var(--info-bg)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "0.75rem" }}>
                      <input
                        type="checkbox"
                        checked={selectedPlaces.has(place.place_id)}
                        onChange={() => toggleSelect(place.place_id)}
                      />
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <Link
                        href={`/places/${place.place_id}`}
                        style={{ fontWeight: 500, color: "var(--primary)" }}
                      >
                        {place.display_name || place.formatted_address.split(",")[0]}
                      </Link>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                        {place.formatted_address}
                      </div>
                      {place.current_classification && place.current_classification !== "unknown" && (
                        <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                          Current: {CLASSIFICATION_LABELS[place.current_classification]}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <span
                        style={{
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.85rem",
                          background: CLASSIFICATION_COLORS[place.suggested_classification]?.bg || "#f3f4f6",
                          border: `1px solid ${CLASSIFICATION_COLORS[place.suggested_classification]?.border || "#d1d5db"}`,
                        }}
                      >
                        {CLASSIFICATION_LABELS[place.suggested_classification] || place.suggested_classification}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem", textAlign: "center" }}>
                      <span
                        style={{
                          fontWeight: 500,
                          color: place.avg_confidence >= 0.8 ? "var(--success-text)" :
                                 place.avg_confidence >= 0.6 ? "var(--warning-text)" : "var(--muted)",
                        }}
                      >
                        {Math.round(place.avg_confidence * 100)}%
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem", textAlign: "center" }}>
                      <span title={`${place.agreement_count} agree out of ${place.request_count}`}>
                        {place.agreement_count}/{place.request_count}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => setExpandedPlace(expandedPlace === place.place_id ? null : place.place_id)}
                          style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                            background: "var(--bg)",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          {expandedPlace === place.place_id ? "Hide" : "Signals"}
                        </button>
                        <button
                          onClick={() => acceptSingle(place)}
                          style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            border: "none",
                            background: "var(--success-bg)",
                            color: "var(--success-text)",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => dismissSingle(place)}
                          style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                            background: "var(--bg)",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          Dismiss
                        </button>
                        <Link
                          href={`/requests/${place.most_recent_request_id}`}
                          style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                            background: "var(--bg)",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          View Request
                        </Link>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded signals row */}
                  {expandedPlace === place.place_id && place.signals_sample && (
                    <tr key={`${place.place_id}-signals`}>
                      <td colSpan={6} style={{ padding: "1rem", background: "var(--section-bg)" }}>
                        <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.5rem" }}>
                          Contributing Signals
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                          {Object.entries(place.signals_sample)
                            .filter(([key]) => !["individual_score", "colony_score"].includes(key))
                            .map(([key, signal]) => (
                              <div
                                key={key}
                                style={{
                                  padding: "0.5rem",
                                  background: "var(--bg)",
                                  borderRadius: "4px",
                                  border: "1px solid var(--border)",
                                  fontSize: "0.8rem",
                                }}
                              >
                                <div style={{ fontWeight: 500 }}>{key.replace(/_/g, " ")}</div>
                                <div style={{ color: "var(--muted)" }}>
                                  {String(signal.value)} ({signal.weight > 0 ? "+" : ""}{signal.weight} toward {signal.toward})
                                </div>
                              </div>
                            ))}
                        </div>
                        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                          Individual Score: {String((place.signals_sample as Record<string, unknown>).individual_score ?? 0)} |
                          Colony Score: {String((place.signals_sample as Record<string, unknown>).colony_score ?? 0)}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {!loading && places.length === 0 && (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 500, marginBottom: "0.5rem" }}>
            No places pending review
          </div>
          <div style={{ color: "var(--muted)" }}>
            {classificationFilter
              ? `No ${CLASSIFICATION_LABELS[classificationFilter]} suggestions pending`
              : "All classification suggestions have been processed"}
          </div>
        </div>
      )}
    </div>
  );
}
