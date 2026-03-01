"use client";

import { useState, useEffect } from "react";

interface YearlyBreakdown {
  requests: number;
  caught: number;
  altered: number;
}

interface AlterationHistory {
  place_id: string;
  place_name: string | null;
  formatted_address: string | null;
  locality: string | null;
  postal_code: string | null;
  total_requests: number;
  total_cats_caught: number;
  total_cats_altered: number;
  total_already_altered: number;
  total_males: number;
  total_females: number;
  place_alteration_rate_pct: number | null;
  first_request_date: string | null;
  latest_request_date: string | null;
  yearly_breakdown: Record<string, YearlyBreakdown>;
  has_data: boolean;
}

interface PlaceAlterationHistoryProps {
  placeId: string;
}

export function PlaceAlterationHistory({ placeId }: PlaceAlterationHistoryProps) {
  const [history, setHistory] = useState<AlterationHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showYearly, setShowYearly] = useState(false);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const response = await fetch(`/api/places/${placeId}/alteration-history`);
        if (!response.ok) {
          throw new Error("Failed to load alteration history");
        }
        const data = await response.json();
        setHistory(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading history");
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [placeId]);

  if (loading) {
    return (
      <div style={{ padding: "1rem", color: "#666" }}>
        Loading colony statistics...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem", background: "#fff3cd", borderRadius: "6px", color: "#856404" }}>
        Unable to load colony statistics
      </div>
    );
  }

  if (!history || !history.has_data) {
    return (
      <div style={{ padding: "1rem", color: "#666" }}>
        No TNR activity data available for this location.
      </div>
    );
  }

  // Determine rate color
  let rateColor = "#6c757d";
  if (history.place_alteration_rate_pct !== null) {
    if (history.place_alteration_rate_pct >= 80) rateColor = "#198754";
    else if (history.place_alteration_rate_pct >= 50) rateColor = "#fd7e14";
    else rateColor = "#dc3545";
  }

  const years = Object.keys(history.yearly_breakdown || {}).sort((a, b) => parseInt(b) - parseInt(a));

  return (
    <div>
      {/* Header Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8f9fa", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: rateColor }}>
            {history.place_alteration_rate_pct !== null ? `${history.place_alteration_rate_pct}%` : "—"}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>Alteration Rate</div>
        </div>

        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8f9fa", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{history.total_requests}</div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>Requests</div>
        </div>

        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8f9fa", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{history.total_cats_caught}</div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>Cats Caught</div>
        </div>

        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8f9fa", borderRadius: "8px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#198754" }}>{history.total_cats_altered}</div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>Altered</div>
        </div>
      </div>

      {/* Sex Breakdown */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
        <span><strong>Males:</strong> {history.total_males}</span>
        <span><strong>Females:</strong> {history.total_females}</span>
        <span style={{ color: "#666" }}>
          <strong>Pre-Altered:</strong> {history.total_already_altered}
        </span>
      </div>

      {/* Date Range */}
      {history.first_request_date && (
        <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: "1rem" }}>
          Activity period: {new Date(history.first_request_date).toLocaleDateString()} to{" "}
          {new Date(history.latest_request_date!).toLocaleDateString()}
        </div>
      )}

      {/* Yearly Breakdown */}
      {years.length > 0 && (
        <div>
          <button
            onClick={() => setShowYearly(!showYearly)}
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
            {showYearly ? "▼" : "▶"} Year-by-year breakdown
          </button>

          {showYearly && (
            <div style={{ marginTop: "0.75rem" }}>
              <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Year</th>
                    <th style={{ textAlign: "right", padding: "0.5rem" }}>Requests</th>
                    <th style={{ textAlign: "right", padding: "0.5rem" }}>Caught</th>
                    <th style={{ textAlign: "right", padding: "0.5rem" }}>Altered</th>
                    <th style={{ textAlign: "right", padding: "0.5rem" }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => {
                    const data = history.yearly_breakdown[year];
                    const rate = data.caught > 0 ? Math.round((data.altered / data.caught) * 100) : null;
                    return (
                      <tr key={year} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "0.5rem", fontWeight: 500 }}>{year}</td>
                        <td style={{ padding: "0.5rem", textAlign: "right" }}>{data.requests}</td>
                        <td style={{ padding: "0.5rem", textAlign: "right" }}>{data.caught}</td>
                        <td style={{ padding: "0.5rem", textAlign: "right", color: "#198754" }}>{data.altered}</td>
                        <td style={{ padding: "0.5rem", textAlign: "right" }}>
                          {rate !== null ? `${rate}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
