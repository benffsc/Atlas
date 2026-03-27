"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import { MAP_Z_INDEX } from "@/lib/design-tokens";
import { calculateDistance, formatDistance } from "@/types/map";
import { decodePolyline } from "@/lib/polyline";

interface PlaceComparisonData {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  lat: number | null;
  lng: number | null;
  cat_count: number;
  altered_count: number;
  alteration_rate_pct: number | null;
  disease_status: Array<{ disease_key: string; short_code: string; color: string; positive_cats: number }>;
  last_activity: string | null;
  request_count: number;
  active_request_count: number;
  person_count: number;
}

interface DirectionsData {
  distance_meters: number;
  distance_text: string;
  duration_seconds: number;
  duration_text: string;
  overview_polyline: string;
}

interface LocationComparisonPanelProps {
  placeIds: string[];
  onRemovePlace: (id: string) => void;
  onClear: () => void;
  onRoutePolyline?: (points: Array<{ lat: number; lng: number }> | null) => void;
}

export function LocationComparisonPanel({ placeIds, onRemovePlace, onClear, onRoutePolyline }: LocationComparisonPanelProps) {
  const [places, setPlaces] = useState<PlaceComparisonData[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [directions, setDirections] = useState<DirectionsData | null>(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);

  useEffect(() => {
    if (placeIds.length === 0) {
      setPlaces([]);
      setDirections(null);
      onRoutePolyline?.(null);
      return;
    }

    const fetchPlaces = async () => {
      setLoading(true);
      try {
        const results = await Promise.all(
          placeIds.map(async (id) => {
            try {
              const data = await fetchApi<{
                place_id: string;
                address: string;
                display_name: string | null;
                lat?: number;
                lng?: number;
                cat_count: number;
                total_altered: number;
                disease_badges: Array<{ disease_key: string; short_code: string; color: string; positive_cat_count: number }>;
                request_count: number;
                active_request_count: number;
                person_count: number;
              }>(`/api/places/${id}/map-details`);
              const catCount = data.cat_count || 0;
              const alteredCount = data.total_altered || 0;
              return {
                place_id: id,
                formatted_address: data.address || "Unknown",
                display_name: data.display_name || null,
                lat: data.lat || null,
                lng: data.lng || null,
                cat_count: catCount,
                altered_count: alteredCount,
                alteration_rate_pct: catCount > 0 ? Math.round((alteredCount / catCount) * 100) : null,
                disease_status: (data.disease_badges || []).map(d => ({
                  disease_key: d.disease_key,
                  short_code: d.short_code,
                  color: d.color,
                  positive_cats: d.positive_cat_count,
                })),
                last_activity: null,
                request_count: data.request_count || 0,
                active_request_count: data.active_request_count || 0,
                person_count: data.person_count || 0,
              } as PlaceComparisonData;
            } catch {
              return {
                place_id: id,
                formatted_address: "Failed to load",
                display_name: null,
                lat: null,
                lng: null,
                cat_count: 0,
                altered_count: 0,
                alteration_rate_pct: null,
                disease_status: [],
                last_activity: null,
                request_count: 0,
                active_request_count: 0,
                person_count: 0,
              } as PlaceComparisonData;
            }
          })
        );
        setPlaces(results);
      } finally {
        setLoading(false);
      }
    };

    fetchPlaces();
    // Clear directions when places change
    setDirections(null);
    onRoutePolyline?.(null);
  }, [placeIds, onRoutePolyline]);

  const handleGetDirections = async () => {
    if (places.length !== 2) return;
    const [a, b] = places;
    if (!a.lat || !a.lng || !b.lat || !b.lng) return;

    setDirectionsLoading(true);
    try {
      const data = await fetchApi<DirectionsData>(
        `/api/places/directions?origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}`
      );
      setDirections(data);
      if (data.overview_polyline) {
        const decoded = decodePolyline(data.overview_polyline);
        onRoutePolyline?.(decoded);
      }
    } catch (err) {
      console.error("Failed to get directions:", err);
    } finally {
      setDirectionsLoading(false);
    }
  };

  const handleClear = () => {
    onRoutePolyline?.(null);
    onClear();
  };

  if (placeIds.length === 0) return null;

  // Calculate straight-line distance if 2 places with coords
  const straightLineDistance =
    places.length === 2 && places[0].lat && places[0].lng && places[1].lat && places[1].lng
      ? calculateDistance(
          { lat: places[0].lat, lng: places[0].lng },
          { lat: places[1].lat, lng: places[1].lng }
        )
      : null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: MAP_Z_INDEX.drawer,
        background: "var(--background)",
        borderRadius: 12,
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        maxWidth: 700,
        width: "90%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "var(--section-bg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          Compare ({placeIds.length})
          <span style={{ fontSize: "0.7rem" }}>{collapsed ? "\u25B2" : "\u25BC"}</span>
        </button>
        <button
          onClick={handleClear}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--danger-text)",
            fontSize: "0.8rem",
          }}
        >
          Clear
        </button>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: 12, overflowX: "auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "1rem" }}>
              Loading comparison data...
            </div>
          ) : (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border-default)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--text-secondary)" }}>Metric</th>
                    {places.map((p) => (
                      <th key={p.place_id} style={{ textAlign: "center", padding: "4px 8px", minWidth: 140 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <span style={{ fontSize: "0.75rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.display_name || p.formatted_address.split(",")[0]}
                          </span>
                          <button
                            onClick={() => onRemovePlace(p.place_id)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: "0.7rem", padding: 0, lineHeight: 1 }}
                            title="Remove from comparison"
                          >
                            ×
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <ComparisonRow label="Cats" values={places.map(p => String(p.cat_count))} />
                  <ComparisonRow label="Altered" values={places.map(p => String(p.altered_count))} />
                  <ComparisonRow
                    label="Alteration Rate"
                    values={places.map(p => p.alteration_rate_pct !== null ? `${p.alteration_rate_pct}%` : "\u2014")}
                  />
                  <ComparisonRow
                    label="Disease"
                    values={places.map(p =>
                      p.disease_status.length > 0
                        ? p.disease_status.map(d => d.short_code).join(", ")
                        : "None"
                    )}
                  />
                  <ComparisonRow label="Requests" values={places.map(p => String(p.request_count))} />
                  <ComparisonRow
                    label="Active Requests"
                    values={places.map(p => String(p.active_request_count))}
                    highlight
                  />
                  <ComparisonRow label="People" values={places.map(p => String(p.person_count))} />
                  {/* Distance rows */}
                  {straightLineDistance !== null && (
                    <ComparisonRow
                      label="Straight Line"
                      values={[formatDistance(straightLineDistance)]}
                      colSpan={places.length}
                    />
                  )}
                  {directions && (
                    <>
                      <ComparisonRow
                        label="Driving Distance"
                        values={[directions.distance_text]}
                        colSpan={places.length}
                      />
                      <ComparisonRow
                        label="Driving Time"
                        values={[directions.duration_text]}
                        colSpan={places.length}
                        highlight
                      />
                    </>
                  )}
                </tbody>
              </table>

              {/* Directions button */}
              {places.length === 2 && places[0].lat && places[1].lat && !directions && (
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={handleGetDirections}
                    disabled={directionsLoading}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: directionsLoading ? "var(--section-bg)" : "var(--primary)",
                      color: directionsLoading ? "var(--text-secondary)" : "white",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      cursor: directionsLoading ? "wait" : "pointer",
                    }}
                  >
                    {directionsLoading ? "Getting directions..." : "Get Directions"}
                  </button>
                </div>
              )}

              {/* Open in Google Maps link */}
              {directions && places.length === 2 && places[0].lat && places[1].lat && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
                  <a
                    href={`https://www.google.com/maps/dir/${places[0].lat},${places[0].lng}/${places[1].lat},${places[1].lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "0.75rem", color: "var(--primary)", textDecoration: "none" }}
                  >
                    Open in Google Maps &rarr;
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonRow({ label, values, highlight, colSpan }: { label: string; values: string[]; highlight?: boolean; colSpan?: number }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
      <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontWeight: 500 }}>{label}</td>
      {colSpan ? (
        <td
          colSpan={colSpan}
          style={{
            textAlign: "center",
            padding: "4px 8px",
            fontWeight: highlight ? 600 : 400,
            color: highlight ? "var(--primary)" : "var(--text-primary)",
          }}
        >
          {values[0]}
        </td>
      ) : (
        values.map((v, i) => (
          <td
            key={i}
            style={{
              textAlign: "center",
              padding: "4px 8px",
              fontWeight: highlight ? 600 : 400,
              color: highlight && v !== "0" ? "var(--critical-text)" : "var(--text-primary)",
            }}
          >
            {v}
          </td>
        ))
      )}
    </tr>
  );
}
