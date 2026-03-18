"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";

interface PopulationEstimate {
  place_id: string;
  estimated_population: number;
  ci_lower: number;
  ci_upper: number;
  marked_count: number;
  capture_count: number;
  recapture_count: number;
  sample_adequate: boolean;
  confidence_level: string;
  observation_start: string;
  observation_end: string;
  last_calculated_at: string;
}

interface PopEstimateResponse {
  estimate: PopulationEstimate;
  meta: {
    method: string;
    formula: string;
    observation_days: number;
    sample_adequacy_threshold: string;
  };
}

interface PopulationEstimateCardProps {
  placeId: string;
  days?: number;
}

export function PopulationEstimateCard({ placeId, days = 365 }: PopulationEstimateCardProps) {
  const [data, setData] = useState<PopEstimateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [insufficientData, setInsufficientData] = useState(false);

  useEffect(() => {
    setLoading(true);
    setInsufficientData(false);
    fetchApi<PopEstimateResponse>(`/api/beacon/population/${placeId}?days=${days}`)
      .then(setData)
      .catch((err) => {
        if (err?.status === 404 || err?.message?.includes("Insufficient")) {
          setInsufficientData(true);
        } else {
          console.error("Failed to load population estimate:", err);
        }
      })
      .finally(() => setLoading(false));
  }, [placeId, days]);

  if (loading) {
    return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>Calculating population estimate...</div>;
  }

  if (insufficientData) {
    return (
      <div style={{
        padding: "1rem",
        background: "var(--section-bg)",
        borderRadius: "8px",
        border: "1px solid var(--card-border, #e5e7eb)",
      }}>
        <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.25rem" }}>Population Estimate</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Insufficient data for Chapman mark-recapture estimate. Need appointments in both halves of the observation window.
        </div>
      </div>
    );
  }

  if (!data) return null;

  const est = data.estimate;
  const adequate = est.sample_adequate;

  return (
    <div style={{
      padding: "1rem",
      background: adequate ? "var(--success-bg)" : "#fffbeb",
      borderRadius: "8px",
      border: `1px solid ${adequate ? "var(--success-border)" : "#fde68a"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Chapman Population Estimate</div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "2px" }}>
            Mark-recapture over {data.meta.observation_days} days
          </div>
        </div>
        <span style={{
          display: "inline-block",
          padding: "0.15rem 0.5rem",
          borderRadius: "9999px",
          fontSize: "0.7rem",
          fontWeight: 500,
          background: adequate ? "#dcfce7" : "#fef3c7",
          color: adequate ? "#166534" : "#92400e",
        }}>
          {adequate ? "Adequate Sample" : "Low Sample"}
        </span>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "0.75rem",
        marginBottom: "0.75rem",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: adequate ? "#16a34a" : "#d97706" }}>
            {est.estimated_population}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Estimated</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text)" }}>
            {est.ci_lower}–{est.ci_upper}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>95% CI</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text)" }}>
            {est.confidence_level}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Confidence</div>
        </div>
      </div>

      {/* Method details */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "0.5rem",
        padding: "0.5rem",
        background: "rgba(255,255,255,0.6)",
        borderRadius: "6px",
        fontSize: "0.75rem",
      }}>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Marked: </span>
          <strong>{est.marked_count}</strong>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Captured: </span>
          <strong>{est.capture_count}</strong>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Recaptured: </span>
          <strong>{est.recapture_count}</strong>
        </div>
      </div>

      {!adequate && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#92400e" }}>
          Need at least 7 recaptures for reliable estimate (currently {est.recapture_count}).
        </div>
      )}
    </div>
  );
}
