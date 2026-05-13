"use client";

import { useState, useCallback, useRef } from "react";
import { formatDistance } from "@/components/map/hooks/useMeasurement";
import { fetchApi } from "@/lib/api-client";

export interface ComparePoint {
  lat: number;
  lng: number;
  label: string;
}

interface DirectionsLeg {
  distance_meters: number;
  distance_text: string;
  duration_seconds: number;
  duration_text: string;
  start_address: string;
  end_address: string;
}

interface DirectionsResult {
  distance_meters: number;
  distance_text: string;
  duration_seconds: number;
  duration_text: string;
  overview_polyline: string;
  legs: DirectionsLeg[];
}

interface Props {
  points: ComparePoint[];
  onRemovePoint: (index: number) => void;
  onClear: () => void;
  onClose: () => void;
  onReorder: (from: number, to: number) => void;
  onAddPoint: (point: ComparePoint) => void;
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

export function DistanceComparePanel({ points, onRemovePoint, onClear, onClose, onReorder, onAddPoint }: Props) {
  const [directions, setDirections] = useState<DirectionsResult | null>(null);
  const [loadingDirections, setLoadingDirections] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ place_id: string; description: string }>>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const fetchDirections = useCallback(async () => {
    if (points.length < 2) return;
    setLoadingDirections(true);
    setError(null);

    try {
      const origin = `${points[0].lat},${points[0].lng}`;
      const destination = `${points[points.length - 1].lat},${points[points.length - 1].lng}`;
      const waypoints = points.length > 2
        ? points.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join("|")
        : null;

      let url = `/api/places/directions?origin=${origin}&destination=${destination}`;
      if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;

      const result = await fetchApi<DirectionsResult>(url);
      setDirections(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get directions");
    } finally {
      setLoadingDirections(false);
    }
  }, [points]);

  // Auto-fetch directions when we have 2+ points
  const prevPointsKey = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");

  // Compute straight-line distances
  const segments: Array<{ from: string; to: string; straight: number }> = [];
  let totalStraight = 0;
  for (let i = 1; i < points.length; i++) {
    const dist = haversine(points[i - 1], points[i]);
    totalStraight += dist;
    segments.push({
      from: points[i - 1].label,
      to: points[i].label,
      straight: dist,
    });
  }

  return (
    <div style={{
      background: "var(--background, #fff)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      boxShadow: "var(--shadow-md)",
      width: 340,
      maxHeight: "70vh",
      overflowY: "auto",
      fontSize: "0.85rem",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, background: "var(--background, #fff)", zIndex: 1,
      }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Compare Distances</div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-tertiary)", lineHeight: 1 }}
          title="Close (Esc)"
        >
          &times;
        </button>
      </div>

      {/* Waypoints */}
      <div style={{ padding: "10px 14px" }}>
        {points.length === 0 ? (
          <div style={{ color: "var(--text-tertiary)", fontStyle: "italic", padding: "0.5rem 0", textAlign: "center", fontSize: "0.8rem" }}>
            Search for addresses or click pins on the map
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {points.map((pt, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Route marker */}
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center", width: 24, flexShrink: 0,
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: i === 0 ? "var(--primary)" : i === points.length - 1 ? "var(--danger-text, #dc2626)" : "var(--text-secondary)",
                    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {String.fromCharCode(65 + i)}
                  </div>
                  {i < points.length - 1 && (
                    <div style={{ width: 2, height: 20, background: "var(--border)", margin: "2px 0" }} />
                  )}
                </div>

                {/* Label + controls */}
                <div style={{ flex: 1, minWidth: 0, padding: "6px 0" }}>
                  <div style={{
                    fontSize: "0.82rem", fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {pt.label}
                  </div>
                </div>

                {/* Move up/down + remove */}
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  {i > 0 && (
                    <button onClick={() => onReorder(i, i - 1)} style={iconBtnStyle} title="Move up">
                      &#x25B2;
                    </button>
                  )}
                  {i < points.length - 1 && (
                    <button onClick={() => onReorder(i, i + 1)} style={iconBtnStyle} title="Move down">
                      &#x25BC;
                    </button>
                  )}
                  <button onClick={() => onRemovePoint(i)} style={{ ...iconBtnStyle, color: "var(--danger-text)" }} title="Remove">
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add stop search */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                const q = e.target.value;
                setSearchQuery(q);
                if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                if (q.length < 3) { setSearchResults([]); setDropdownRect(null); return; }
                searchTimeoutRef.current = setTimeout(async () => {
                  setSearching(true);
                  try {
                    const res = await fetchApi<{ predictions: Array<{ place_id: string; description: string }> }>(
                      `/api/places/autocomplete?input=${encodeURIComponent(q)}`
                    );
                    setSearchResults(res.predictions || []);
                    // Position dropdown below input
                    if (searchInputRef.current) {
                      const rect = searchInputRef.current.getBoundingClientRect();
                      setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                    }
                  } catch { setSearchResults([]); }
                  setSearching(false);
                }, 300);
              }}
              placeholder="Search address to add stop..."
              style={{
                flex: 1,
                padding: "7px 10px",
                fontSize: "0.8rem",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: 6,
                outline: "none",
                background: "var(--card-bg, #fff)",
              }}
              onFocus={() => {
                if (searchQuery.length >= 3 && searchResults.length > 0 && searchInputRef.current) {
                  const rect = searchInputRef.current.getBoundingClientRect();
                  setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                }
              }}
            />
            {searching && (
              <div style={{ display: "flex", alignItems: "center", padding: "0 4px", color: "var(--text-tertiary)", fontSize: "0.7rem" }}>
                ...
              </div>
            )}
          </div>
          {searchResults.length > 0 && dropdownRect && (
            <div style={{
              position: "fixed",
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: 9999,
              background: "var(--background, #fff)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
              maxHeight: 240,
              overflowY: "auto",
            }}>
              {searchResults.map((r) => (
                <button
                  key={r.place_id}
                  onClick={async () => {
                    try {
                      const detail = await fetchApi<{ place: { geometry: { location: { lat: number; lng: number } }; formatted_address: string } }>(
                        `/api/places/details?place_id=${r.place_id}`
                      );
                      if (detail.place?.geometry?.location) {
                        onAddPoint({
                          lat: detail.place.geometry.location.lat,
                          lng: detail.place.geometry.location.lng,
                          label: detail.place.formatted_address || r.description,
                        });
                      }
                    } catch { /* non-fatal */ }
                    setSearchQuery("");
                    setSearchResults([]);
                    setDropdownRect(null);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    borderBottom: "1px solid var(--border, #f3f4f6)",
                    background: "transparent",
                    textAlign: "left",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    color: "var(--foreground)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--primary-bg, #eff6ff)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {r.description}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Distance summary */}
      {points.length >= 2 && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px" }}>
          {/* Straight-line distances */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", marginBottom: 6 }}>
              Straight Line
            </div>
            {segments.map((seg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", padding: "2px 0" }}>
                <span style={{ color: "var(--text-secondary)" }}>{seg.from.split(",")[0]} → {seg.to.split(",")[0]}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatDistance(seg.straight)}</span>
              </div>
            ))}
            {segments.length > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "4px 0 0", borderTop: "1px solid var(--border)", marginTop: 4 }}>
                <span style={{ fontWeight: 600 }}>Total</span>
                <span style={{ fontWeight: 700 }}>{formatDistance(totalStraight)}</span>
              </div>
            )}
          </div>

          {/* Road distance */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)" }}>
                Driving Route
              </div>
              {!directions && !loadingDirections && (
                <button
                  onClick={fetchDirections}
                  style={{
                    padding: "3px 10px", fontSize: "0.75rem", fontWeight: 600,
                    background: "var(--primary)", color: "#fff", border: "none",
                    borderRadius: 4, cursor: "pointer",
                  }}
                >
                  Get Route
                </button>
              )}
            </div>

            {loadingDirections && (
              <div style={{ color: "var(--text-tertiary)", fontSize: "0.8rem", fontStyle: "italic" }}>Calculating route...</div>
            )}

            {error && (
              <div style={{ color: "var(--danger-text)", fontSize: "0.8rem" }}>{error}</div>
            )}

            {directions && (
              <div>
                {directions.legs.map((leg, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", padding: "2px 0" }}>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {points[i]?.label.split(",")[0]} → {points[i + 1]?.label.split(",")[0]}
                    </span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {leg.distance_text} · {leg.duration_text}
                    </span>
                  </div>
                ))}
                {directions.legs.length > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "4px 0 0", borderTop: "1px solid var(--border)", marginTop: 4 }}>
                    <span style={{ fontWeight: 600 }}>Total</span>
                    <span style={{ fontWeight: 700 }}>
                      {directions.distance_text} · {formatDuration(directions.duration_seconds)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {points.length > 0 && (
        <div style={{
          display: "flex", gap: 6, padding: "8px 14px",
          borderTop: "1px solid var(--border)",
        }}>
          <button onClick={onClear} style={actionBtnStyle}>Clear All</button>
          {directions && (
            <button
              onClick={() => {
                const lines = segments.map((s, i) => {
                  const leg = directions.legs[i];
                  return `${s.from} → ${s.to}: ${formatDistance(s.straight)} straight${leg ? `, ${leg.distance_text} driving (${leg.duration_text})` : ""}`;
                });
                lines.push(`\nTotal: ${formatDistance(totalStraight)} straight, ${directions.distance_text} driving (${formatDuration(directions.duration_seconds)})`);
                navigator.clipboard.writeText(lines.join("\n"));
              }}
              style={actionBtnStyle}
            >
              Copy
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 10, color: "var(--text-tertiary)", padding: "2px 4px",
  lineHeight: 1,
};

const actionBtnStyle: React.CSSProperties = {
  padding: "4px 10px", fontSize: "0.75rem", fontWeight: 500,
  background: "var(--card-bg)", border: "1px solid var(--border)",
  borderRadius: 4, cursor: "pointer", color: "var(--foreground)",
};
