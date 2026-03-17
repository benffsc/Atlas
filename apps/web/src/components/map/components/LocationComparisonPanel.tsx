"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

interface PlaceComparisonData {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  cat_count: number;
  altered_count: number;
  alteration_rate_pct: number | null;
  disease_status: Array<{ disease_key: string; short_code: string; color: string; positive_cats: number }>;
  last_activity: string | null;
  request_count: number;
  active_request_count: number;
  person_count: number;
}

interface LocationComparisonPanelProps {
  placeIds: string[];
  onRemovePlace: (id: string) => void;
  onClear: () => void;
}

export function LocationComparisonPanel({ placeIds, onRemovePlace, onClear }: LocationComparisonPanelProps) {
  const [places, setPlaces] = useState<PlaceComparisonData[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (placeIds.length === 0) {
      setPlaces([]);
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
  }, [placeIds]);

  if (placeIds.length === 0) return null;

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
          onClick={onClear}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#ef4444",
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
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "1rem" }}>
              Loading comparison data...
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px", color: "#6b7280" }}>Metric</th>
                  {places.map((p) => (
                    <th key={p.place_id} style={{ textAlign: "center", padding: "4px 8px", minWidth: 140 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <span style={{ fontSize: "0.75rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.display_name || p.formatted_address.split(",")[0]}
                        </span>
                        <button
                          onClick={() => onRemovePlace(p.place_id)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: "0.7rem", padding: 0, lineHeight: 1 }}
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
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonRow({ label, values, highlight }: { label: string; values: string[]; highlight?: boolean }) {
  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td style={{ padding: "4px 8px", color: "#6b7280", fontWeight: 500 }}>{label}</td>
      {values.map((v, i) => (
        <td
          key={i}
          style={{
            textAlign: "center",
            padding: "4px 8px",
            fontWeight: highlight ? 600 : 400,
            color: highlight && v !== "0" ? "#dc2626" : "#374151",
          }}
        >
          {v}
        </td>
      ))}
    </tr>
  );
}
