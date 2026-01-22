"use client";

import { useState, useEffect } from "react";

interface SourceBreakdown {
  estimate_id: string;
  source_type: string;
  source_label: string;
  total_cats: number;
  base_confidence: number;
  recency_factor: number;
  firsthand_boost: number;
  final_confidence: number;
  weighted_contribution: number;
  observation_date: string | null;
  reported_at: string;
  days_ago: number;
  is_firsthand: boolean;
  reporter_name: string | null;
  notes: string | null;
}

interface ColonySummary {
  final_estimate: number;
  final_confidence: number;
  is_multi_source_confirmed: boolean;
  estimate_count: number;
  primary_source: string | null;
  primary_source_label: string | null;
  has_clinic_verification: boolean;
  verified_cat_count: number;
  verified_altered_count: number;
}

interface DataQuality {
  needs_more_observations: boolean;
  most_recent_days_ago: number | null;
  has_recent_data: boolean;
  source_diversity: number;
  recommendation: string;
  quality_level: "high" | "medium" | "low";
}

interface ColonySourcesResponse {
  place_id: string;
  summary: ColonySummary;
  sources: SourceBreakdown[];
  data_quality: DataQuality;
}

interface ColonySourcesBreakdownProps {
  placeId: string;
}

// Source type colors
const sourceColors: Record<string, string> = {
  verified_cats: "#dc3545",
  post_clinic_survey: "#6f42c1",
  trapper_site_visit: "#0d6efd",
  manual_observation: "#198754",
  trapping_request: "#fd7e14",
  intake_form: "#20c997",
  appointment_request: "#6c757d",
  ai_parsed: "#17a2b8",
  field_observation: "#0dcaf0",
  legacy_mymaps: "#e6a700",
};

const qualityColors: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: "var(--success-bg)", text: "var(--success-text)", border: "var(--success-border)" },
  medium: { bg: "var(--warning-bg)", text: "var(--warning-text)", border: "var(--warning-border)" },
  low: { bg: "var(--danger-bg)", text: "var(--danger-text)", border: "var(--danger-border)" },
};

export function ColonySourcesBreakdown({ placeId }: ColonySourcesBreakdownProps) {
  const [data, setData] = useState<ColonySourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSources() {
      try {
        const response = await fetch(`/api/places/${placeId}/colony-sources`);
        if (!response.ok) {
          throw new Error("Failed to load colony sources");
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading sources");
      } finally {
        setLoading(false);
      }
    }

    fetchSources();
  }, [placeId]);

  if (loading) {
    return (
      <div style={{ padding: "1rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
        Loading source breakdown...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem", background: "var(--danger-bg)", borderRadius: "6px", color: "var(--danger-text)", fontSize: "0.85rem" }}>
        {error}
      </div>
    );
  }

  if (!data || data.sources.length === 0) {
    return (
      <div style={{ padding: "1rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
        No source data available. Add observations to start tracking colony estimates.
      </div>
    );
  }

  // Validate that data has the expected structure
  if (!data.data_quality || !data.data_quality.quality_level) {
    return (
      <div style={{ padding: "1rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
        Unable to calculate data quality. Please try again later.
      </div>
    );
  }

  const { summary, sources, data_quality } = data;
  const qualityStyle = qualityColors[data_quality.quality_level] || qualityColors.low;

  return (
    <div style={{ marginTop: "1rem" }}>
      {/* Data Quality Card */}
      <div
        style={{
          padding: "0.75rem 1rem",
          background: qualityStyle.bg,
          border: `1px solid ${qualityStyle.border}`,
          borderRadius: "8px",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: qualityStyle.text,
            }}
          />
          <strong style={{ fontSize: "0.85rem", color: qualityStyle.text }}>
            Data Quality: {data_quality.quality_level.charAt(0).toUpperCase() + data_quality.quality_level.slice(1)}
          </strong>
        </div>
        <p style={{ margin: 0, fontSize: "0.8rem", color: qualityStyle.text }}>
          {data_quality.recommendation}
        </p>
        <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: qualityStyle.text, opacity: 0.9 }}>
          {data_quality.source_diversity} source type{data_quality.source_diversity !== 1 ? "s" : ""} |{" "}
          {data_quality.most_recent_days_ago !== null ? (
            data_quality.has_recent_data
              ? `Last update: ${data_quality.most_recent_days_ago} days ago`
              : `Last update: ${data_quality.most_recent_days_ago} days ago (stale)`
          ) : (
            "No observation dates"
          )}
        </div>
      </div>

      {/* Summary Badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        {summary.is_multi_source_confirmed && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: "var(--success-bg)",
              color: "var(--success-text)",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: 500,
            }}
            title="2+ sources agree within 20% on cat count"
          >
            Multi-Source Confirmed (+15% confidence)
          </span>
        )}
        {summary.has_clinic_verification && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: "var(--info-bg)",
              color: "var(--info-text)",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: 500,
            }}
          >
            Clinic Verified
          </span>
        )}
        {summary.verified_cat_count > 0 && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: "var(--section-bg)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              fontSize: "0.75rem",
              color: "var(--foreground)",
            }}
          >
            {summary.verified_cat_count} cats in database ({summary.verified_altered_count} altered)
          </span>
        )}
      </div>

      {/* Source Contribution Visual */}
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.5rem", color: "var(--foreground)" }}>
          Source Contributions to Final Estimate
        </div>

        {/* Stacked bar */}
        <div
          style={{
            height: "24px",
            borderRadius: "4px",
            overflow: "hidden",
            display: "flex",
            background: "var(--section-bg)",
          }}
        >
          {sources.map((source, idx) => (
            <div
              key={source.estimate_id}
              style={{
                width: `${source.weighted_contribution}%`,
                minWidth: source.weighted_contribution > 0 ? "4px" : 0,
                background: sourceColors[source.source_type] || "#6c757d",
                borderLeft: idx > 0 ? "1px solid var(--background)" : undefined,
              }}
              title={`${source.source_label}: ${source.total_cats} cats (${source.weighted_contribution}% weight)`}
            />
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.7rem" }}>
          {sources.map((source) => (
            <div key={source.estimate_id} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "2px",
                  background: sourceColors[source.source_type] || "#6c757d",
                }}
              />
              <span style={{ color: "var(--text-secondary)" }}>
                {source.source_label} ({source.weighted_contribution}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Source Table */}
      <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.5rem", color: "var(--foreground)" }}>
        Confidence Breakdown by Source
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.75rem",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "0.5rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                Source
              </th>
              <th style={{ textAlign: "right", padding: "0.5rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                Cats
              </th>
              <th style={{ textAlign: "right", padding: "0.5rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                Base
              </th>
              <th style={{ textAlign: "right", padding: "0.5rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                Recency
              </th>
              <th style={{ textAlign: "right", padding: "0.5rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                Final
              </th>
              <th style={{ textAlign: "right", padding: "0.5rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                Weight
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr
                key={source.estimate_id}
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: "var(--background)",
                }}
              >
                <td style={{ padding: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span
                      style={{
                        width: "3px",
                        height: "16px",
                        borderRadius: "2px",
                        background: sourceColors[source.source_type] || "#6c757d",
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 500, color: "var(--foreground)" }}>{source.source_label}</div>
                      <div style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>
                        {source.observation_date
                          ? new Date(source.observation_date).toLocaleDateString()
                          : new Date(source.reported_at).toLocaleDateString()}
                        {Number.isFinite(source.days_ago) && (
                          <> ({source.days_ago}d ago)</>
                        )}
                        {source.is_firsthand && (
                          <span style={{ color: "var(--success-text)", marginLeft: "0.25rem" }}>
                            +{(source.firsthand_boost * 100).toFixed(0)}% firsthand
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem", fontWeight: 600, color: "var(--foreground)" }}>
                  {source.total_cats}
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem", color: "var(--text-secondary)" }}>
                  {(source.base_confidence * 100).toFixed(0)}%
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "0.5rem",
                    color: source.recency_factor < 0.5 ? "var(--danger-text)" : "var(--text-secondary)",
                  }}
                >
                  ×{source.recency_factor.toFixed(2)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "0.5rem",
                    fontWeight: 600,
                    color:
                      source.final_confidence >= 0.7
                        ? "var(--success-text)"
                        : source.final_confidence >= 0.4
                          ? "var(--warning-text)"
                          : "var(--danger-text)",
                  }}
                >
                  {(source.final_confidence * 100).toFixed(0)}%
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem", fontWeight: 600, color: "var(--primary)" }}>
                  {source.weighted_contribution}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Explanation */}
      <div
        style={{
          marginTop: "1rem",
          padding: "0.75rem",
          background: "var(--section-bg)",
          borderRadius: "6px",
          fontSize: "0.7rem",
          color: "var(--text-secondary)",
        }}
      >
        <strong style={{ color: "var(--foreground)" }}>How confidence is calculated:</strong>
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", lineHeight: 1.6 }}>
          <li>
            <strong>Base confidence</strong> comes from source type (Clinic: 85%, Trapper: 80%, Request: 60%, Intake: 55%)
          </li>
          <li>
            <strong>Recency factor</strong> decays over time (×1.0 if &lt;30d, ×0.9 if &lt;90d, ×0.75 if &lt;180d, ×0.5 if &lt;1yr, ×0.25 if older)
          </li>
          <li>
            <strong>Firsthand bonus</strong> adds +5% if reporter personally observed the cats
          </li>
          <li>
            <strong>Weight</strong> shows how much each source contributes to the weighted average final estimate
          </li>
        </ul>
      </div>
    </div>
  );
}
