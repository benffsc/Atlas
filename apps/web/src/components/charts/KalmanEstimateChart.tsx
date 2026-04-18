"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";

interface PopulationObservation {
  observation_id: string;
  observed_count: number;
  source_type: string;
  observation_date: string;
  estimate_before: number | null;
  estimate_after: number;
  variance_after: number;
  floor_count: number;
  ci_lower: number;
  ci_upper: number;
  confidence_level: string;
}

interface PopulationState {
  estimate: number;
  variance: number;
  last_observation_date: string | null;
  last_source_type: string | null;
  observation_count: number;
  floor_count: number;
  ci_lower: number;
  ci_upper: number;
  confidence_level: string;
}

interface TimelineResponse {
  place_id: string;
  observations: PopulationObservation[];
  state: PopulationState | null;
  has_data: boolean;
}

const sourceLabels: Record<string, string> = {
  clinic_records: "Clinic Records",
  chapman_estimate: "Chapman Estimate",
  trapper_site_visit: "Trapper Visit",
  staff_observation: "Staff Observation",
  trapping_request: "Trapping Request",
  intake_form: "Intake Form",
  ai_parsed: "AI Parsed",
};

const sourceColors: Record<string, string> = {
  clinic_records: "#198754",
  chapman_estimate: "#6f42c1",
  trapper_site_visit: "#0d6efd",
  staff_observation: "#20c997",
  trapping_request: "#fd7e14",
  intake_form: "#17a2b8",
  ai_parsed: "#6c757d",
};

interface KalmanEstimateChartProps {
  placeId: string;
}

export function KalmanEstimateChart({ placeId }: KalmanEstimateChartProps) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi<TimelineResponse>(`/api/places/${placeId}/population-timeline`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [placeId]);

  if (loading) {
    return <div style={{ padding: "0.5rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>Loading estimate history...</div>;
  }

  if (!data || !data.has_data || data.observations.length < 2) {
    return null; // Need at least 2 observations for a meaningful chart
  }

  const { observations, state } = data;

  // Chart layout
  const chartHeight = 130;
  const pad = { top: 12, right: 8, bottom: 22, left: 32 };
  const w = 300; // viewBox width (scales to container)
  const h = chartHeight;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  // Scales
  const allValues = observations.flatMap((o) => [o.observed_count, o.ci_upper, o.estimate_after]);
  const yMax = Math.ceil(Math.max(...allValues) * 1.15) || 10;

  const dates = observations.map((o) => new Date(o.observation_date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateRange = maxDate - minDate || 86400000; // at least 1 day

  const x = (date: string) => pad.left + ((new Date(date).getTime() - minDate) / dateRange) * plotW;
  const y = (val: number) => pad.top + plotH - (val / yMax) * plotH;

  // CI band polygon
  const upperPoints = observations.map((o) => `${x(o.observation_date)},${y(o.ci_upper)}`).join(" ");
  const lowerPoints = [...observations].reverse().map((o) => `${x(o.observation_date)},${y(o.ci_lower)}`).join(" ");
  const ciPolygon = `${upperPoints} ${lowerPoints}`;

  // Estimate line
  const estimateLine = observations.map((o, i) => `${i === 0 ? "M" : "L"}${x(o.observation_date)},${y(o.estimate_after)}`).join(" ");

  // Y-axis ticks (3 ticks)
  const yTicks = [0, Math.round(yMax / 2), yMax];

  // Date range label
  const startDate = new Date(observations[0].observation_date);
  const endDate = new Date(observations[observations.length - 1].observation_date);
  const dateLabel = `${startDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" })} — ${endDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}`;

  // Unique source types for legend
  const sourceTypes = [...new Set(observations.map((o) => o.source_type))];

  return (
    <div
      style={{
        background: "var(--section-bg)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "0.75rem",
        marginBottom: "1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <strong style={{ fontSize: "0.85rem", color: "var(--foreground)" }}>Estimate History</strong>
        <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>{dateLabel}</span>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: `${chartHeight}px` }}>
        {/* Grid lines */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} y1={y(tick)} x2={w - pad.right} y2={y(tick)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,2" />
            <text x={pad.left - 3} y={y(tick) + 3} textAnchor="end" fontSize="7" fill="var(--text-secondary)">{tick}</text>
          </g>
        ))}

        {/* CI band */}
        <polygon points={ciPolygon} fill="var(--primary)" opacity="0.08" />

        {/* Floor line */}
        {state && state.floor_count > 0 && (
          <line x1={pad.left} y1={y(state.floor_count)} x2={w - pad.right} y2={y(state.floor_count)} stroke="var(--success-text)" strokeWidth="0.75" strokeDasharray="4,3" opacity="0.6" />
        )}

        {/* Estimate line */}
        <path d={estimateLine} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinejoin="round" />

        {/* Observation dots */}
        {observations.map((o) => (
          <circle
            key={o.observation_id}
            cx={x(o.observation_date)}
            cy={y(o.observed_count)}
            r="2.5"
            fill={sourceColors[o.source_type] || "#6c757d"}
            stroke="var(--background)"
            strokeWidth="0.75"
          />
        ))}

        {/* X-axis date labels (start and end) */}
        <text x={pad.left} y={h - 4} fontSize="6.5" fill="var(--text-secondary)">
          {startDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
        </text>
        <text x={w - pad.right} y={h - 4} textAnchor="end" fontSize="6.5" fill="var(--text-secondary)">
          {endDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.65rem", color: "var(--text-secondary)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          <span style={{ width: "12px", height: "1.5px", background: "var(--primary)", display: "inline-block" }} />
          Estimate
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          <span style={{ width: "8px", height: "8px", background: "var(--primary)", opacity: 0.15, display: "inline-block", borderRadius: "1px" }} />
          95% CI
        </span>
        {sourceTypes.map((type) => (
          <span key={type} style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: sourceColors[type] || "#6c757d", display: "inline-block" }} />
            {sourceLabels[type] || type.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}
