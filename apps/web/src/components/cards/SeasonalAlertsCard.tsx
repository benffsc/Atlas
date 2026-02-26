"use client";

import { useState, useEffect } from "react";

interface SeasonalAlert {
  alert_type: string;
  severity: "high" | "medium" | "info";
  message: string;
  metric_name: string;
  current_value: number;
  threshold: number;
  recommendation?: string;
}

interface CurrentSeason {
  is_breeding_season: boolean;
  breeding_active_pct: number;
  demand_supply_ratio: number | null;
  current_month: number;
  current_month_name: string;
  season: string;
}

interface Prediction {
  kitten_surge_expected: boolean;
  surge_confidence: "high" | "medium" | "low";
  expected_timing: string;
  reasoning: string;
}

interface BreedingIndicators {
  pregnant: number;
  lactating: number;
  in_heat: number;
  total_females_processed: number;
}

interface SeasonalAlertsResponse {
  alerts: SeasonalAlert[];
  current_season: CurrentSeason;
  predictions: Prediction;
  breeding_indicators: BreedingIndicators | null;
}

const severityStyles: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  high: {
    bg: "var(--danger-bg)",
    border: "var(--danger-border)",
    text: "var(--danger-text)",
    icon: "!!!",
  },
  medium: {
    bg: "var(--warning-bg)",
    border: "var(--warning-border)",
    text: "var(--warning-text)",
    icon: "!",
  },
  info: {
    bg: "var(--info-bg)",
    border: "var(--info-border)",
    text: "var(--info-text)",
    icon: "i",
  },
};

const seasonEmojis: Record<string, string> = {
  spring: "🌸",
  summer: "☀️",
  fall: "🍂",
  winter: "❄️",
};

export function SeasonalAlertsCard() {
  const [data, setData] = useState<SeasonalAlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const response = await fetch("/api/beacon/seasonal-alerts");
        if (!response.ok) {
          throw new Error("Failed to load seasonal alerts");
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading alerts");
      } finally {
        setLoading(false);
      }
    }

    fetchAlerts();
  }, []);

  const toggleAlert = (index: number) => {
    setExpandedAlerts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div
        style={{
          padding: "1.5rem",
          background: "var(--section-bg)",
          borderRadius: "12px",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Loading seasonal data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "1.5rem",
          background: "var(--danger-bg)",
          borderRadius: "12px",
          border: "1px solid var(--danger-border)",
        }}
      >
        <div style={{ color: "var(--danger-text)", fontSize: "0.9rem" }}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { alerts, current_season, predictions, breeding_indicators } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Current Season Header */}
      <div
        style={{
          padding: "1rem 1.5rem",
          background: current_season.is_breeding_season
            ? "linear-gradient(135deg, var(--warning-bg), var(--section-bg))"
            : "var(--section-bg)",
          borderRadius: "12px",
          border: `1px solid ${current_season.is_breeding_season ? "var(--warning-border)" : "var(--border)"}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "1.25rem" }}>{seasonEmojis[current_season.season] || "📅"}</span>
              <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--foreground)", textTransform: "capitalize" }}>
                {current_season.current_month_name} - {current_season.season}
              </span>
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              {current_season.is_breeding_season ? (
                <span>
                  <strong style={{ color: "var(--warning-text)" }}>Breeding Season Active</strong> (Feb-Nov)
                </span>
              ) : (
                <span>Off-season - lower kitten intake expected</span>
              )}
            </div>
          </div>

          {/* Breeding Activity Gauge */}
          {current_season.breeding_active_pct > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                Breeding Activity
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div
                  style={{
                    width: "80px",
                    height: "8px",
                    background: "var(--border)",
                    borderRadius: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, current_season.breeding_active_pct)}%`,
                      height: "100%",
                      background:
                        current_season.breeding_active_pct > 50
                          ? "var(--danger-text)"
                          : current_season.breeding_active_pct > 30
                            ? "var(--warning-text)"
                            : "var(--success-text)",
                      borderRadius: "4px",
                    }}
                  />
                </div>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
                  {current_season.breeding_active_pct}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Breeding Indicators */}
        {breeding_indicators && breeding_indicators.total_females_processed > 0 && (
          <div
            style={{
              marginTop: "0.75rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: "1.5rem",
              flexWrap: "wrap",
              fontSize: "0.8rem",
            }}
          >
            <span style={{ color: "var(--text-secondary)" }}>
              From <strong>{breeding_indicators.total_females_processed}</strong> females this month:
            </span>
            {breeding_indicators.pregnant > 0 && (
              <span style={{ color: "var(--danger-text)" }}>
                <strong>{breeding_indicators.pregnant}</strong> pregnant
              </span>
            )}
            {breeding_indicators.lactating > 0 && (
              <span style={{ color: "var(--warning-text)" }}>
                <strong>{breeding_indicators.lactating}</strong> lactating
              </span>
            )}
            {breeding_indicators.in_heat > 0 && (
              <span style={{ color: "var(--primary)" }}>
                <strong>{breeding_indicators.in_heat}</strong> in heat
              </span>
            )}
          </div>
        )}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {alerts.map((alert, index) => {
            const style = severityStyles[alert.severity];
            const isExpanded = expandedAlerts.has(index);

            return (
              <div
                key={index}
                style={{
                  padding: "1rem",
                  background: style.bg,
                  border: `1px solid ${style.border}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
                onClick={() => toggleAlert(index)}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: style.border,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {style.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: style.text, marginBottom: "0.25rem" }}>
                      {alert.message}
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: "0.5rem" }}>
                        <div style={{ fontSize: "0.8rem", color: style.text, marginBottom: "0.5rem" }}>
                          {alert.recommendation}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                          Current: <strong>{alert.current_value}</strong> | Threshold: {alert.threshold}
                        </div>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No Alerts Message */}
      {alerts.length === 0 && (
        <div
          style={{
            padding: "1rem",
            background: "var(--success-bg)",
            border: "1px solid var(--success-border)",
            borderRadius: "8px",
            color: "var(--success-text)",
            fontSize: "0.9rem",
          }}
        >
          No active alerts. Seasonal activity is within normal ranges.
        </div>
      )}

      {/* Prediction Card */}
      {predictions.kitten_surge_expected && (
        <div
          style={{
            padding: "1rem",
            background:
              predictions.surge_confidence === "high"
                ? "var(--warning-bg)"
                : "var(--section-bg)",
            border: `1px solid ${predictions.surge_confidence === "high" ? "var(--warning-border)" : "var(--border)"}`,
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
              Kitten Surge Prediction
            </span>
            <span
              style={{
                padding: "0.15rem 0.4rem",
                background:
                  predictions.surge_confidence === "high"
                    ? "var(--danger-text)"
                    : predictions.surge_confidence === "medium"
                      ? "var(--warning-text)"
                      : "var(--text-secondary)",
                color: "#fff",
                borderRadius: "4px",
                fontSize: "0.65rem",
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              {predictions.surge_confidence} confidence
            </span>
          </div>
          <div style={{ fontSize: "0.9rem", color: "var(--foreground)", marginBottom: "0.5rem" }}>
            <strong>Expected:</strong> {predictions.expected_timing}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            {predictions.reasoning}
          </div>
        </div>
      )}

      {/* Demand/Supply Ratio */}
      {current_season.demand_supply_ratio !== null && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "var(--section-bg)",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            fontSize: "0.85rem",
          }}
        >
          <span style={{ color: "var(--text-secondary)" }}>Request/Capacity Ratio: </span>
          <span
            style={{
              fontWeight: 600,
              color:
                current_season.demand_supply_ratio > 2
                  ? "var(--danger-text)"
                  : current_season.demand_supply_ratio > 1.5
                    ? "var(--warning-text)"
                    : "var(--success-text)",
            }}
          >
            {current_season.demand_supply_ratio}x
          </span>
          <span style={{ color: "var(--text-secondary)", marginLeft: "0.5rem" }}>
            {current_season.demand_supply_ratio > 1.5
              ? "(Above capacity)"
              : current_season.demand_supply_ratio > 1
                ? "(Near capacity)"
                : "(Within capacity)"}
          </span>
        </div>
      )}
    </div>
  );
}
