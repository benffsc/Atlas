"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";

interface DimensionScore {
  score: number;
  max: number;
  rate_pct?: number | null;
  has_recent_breeding?: boolean;
  trend?: string;
  days_since_activity?: number | null;
}

interface ReadinessData {
  readiness_score: number;
  readiness_label: string;
  dimension_scores: {
    alteration: DimensionScore;
    breeding_absence: DimensionScore;
    stability: DimensionScore;
    recency: DimensionScore;
  };
}

interface PlaceReadinessCardProps {
  placeId: string;
}

const LABEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  complete:        { label: "Complete",        color: "var(--success-text)", bg: "var(--success-bg)" },
  nearly_complete: { label: "Nearly Complete", color: "var(--info-text)",    bg: "var(--info-bg)" },
  in_progress:     { label: "In Progress",     color: "var(--warning-text)", bg: "var(--warning-bg)" },
  needs_work:      { label: "Needs Work",      color: "var(--danger-text)",  bg: "var(--danger-bg)" },
};

const DIMENSION_LABELS: Record<string, { label: string; description: string }> = {
  alteration:       { label: "Alteration Rate",   description: "% of cats with known status that are altered" },
  breeding_absence: { label: "Breeding Absence",  description: "No pregnant/lactating cats in last 6 months" },
  stability:        { label: "Colony Stability",   description: "Population trend based on colony estimates" },
  recency:          { label: "Recent Activity",    description: "How recently this place had clinic activity" },
};

export function PlaceReadinessCard({ placeId }: PlaceReadinessCardProps) {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchReadiness() {
      try {
        const result = await fetchApi<ReadinessData>(`/api/places/${placeId}/readiness`);
        setData(result);
      } catch (err) {
        console.error("Error fetching readiness:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchReadiness();
  }, [placeId]);

  if (loading) {
    return <div className="text-muted">Loading readiness score...</div>;
  }

  if (!data) {
    return <div className="text-muted">Readiness data unavailable.</div>;
  }

  const labelConfig = LABEL_CONFIG[data.readiness_label] || LABEL_CONFIG.needs_work;

  return (
    <div>
      {/* Score header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1 }}>
          {data.readiness_score}
        </div>
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "0.2rem 0.6rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: labelConfig.color,
              background: labelConfig.bg,
            }}
          >
            {labelConfig.label}
          </span>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            out of 100
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        width: "100%",
        height: "8px",
        background: "var(--bg-secondary)",
        borderRadius: "4px",
        marginBottom: "1rem",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${data.readiness_score}%`,
          height: "100%",
          background: labelConfig.color,
          borderRadius: "4px",
          transition: "width 0.3s ease",
        }} />
      </div>

      {/* Dimension sub-bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {(Object.entries(data.dimension_scores) as [string, DimensionScore][]).map(([key, dim]) => {
          const dimConfig = DIMENSION_LABELS[key];
          const pct = (dim.score / dim.max) * 100;
          return (
            <div key={key}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.2rem" }}>
                <span style={{ fontWeight: 500 }}>{dimConfig?.label || key}</span>
                <span style={{ color: "var(--muted)" }}>{dim.score}/{dim.max}</span>
              </div>
              <div style={{
                width: "100%",
                height: "6px",
                background: "var(--bg-secondary)",
                borderRadius: "3px",
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: pct >= 80 ? "var(--success-text)" : pct >= 50 ? "var(--warning-text)" : "var(--danger-text)",
                  borderRadius: "3px",
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
