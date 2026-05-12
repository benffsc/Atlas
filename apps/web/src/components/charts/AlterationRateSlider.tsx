"use client";

/**
 * AlterationRateSlider — Range input (0-100%, 5% increments) with debounced
 * API call to /api/beacon/impact/projection.
 *
 * Shows ProjectionAreaChart comparing baseline vs selected alteration rate.
 * Stats below: kittens prevented delta, economic impact delta, years to target.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { ProjectionAreaChart } from "./ProjectionAreaChart";

interface ProjectionScenario {
  label: string;
  points: Array<{ month: number; date: string; population: number; unaltered: number; alteration_rate: number }>;
  months_to_target: number | null;
  final_alteration_rate: number;
}

interface ProjectionResponse {
  target_alteration_rate: number;
  current: { population: number; altered: number; alteration_rate: number };
  scenarios: { baseline: ProjectionScenario; target: ProjectionScenario };
  yearly_projection: Array<{
    year: number;
    baseline_unaltered: number;
    target_unaltered: number;
    additional_alterations: number;
    kittens_prevented_delta: number;
    economic_impact_delta: number;
  }>;
  totals: {
    additional_alterations: number;
    kittens_prevented_delta: number;
    economic_impact_delta: number;
  };
}

interface Props {
  city?: string;
  years?: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

export function AlterationRateSlider({ city, years = 10 }: Props) {
  const [rate, setRate] = useState(75);
  const [data, setData] = useState<ProjectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchProjection = useCallback(async (targetRate: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        alteration_rate: String(targetRate),
        years: String(years),
      });
      if (city) params.set("city", city);
      const result = await fetchApi<ProjectionResponse>(`/api/beacon/impact/projection?${params}`);
      if (result && "scenarios" in result) {
        setData(result);
      }
    } catch {
      // Silently fail — slider still works
    } finally {
      setLoading(false);
    }
  }, [city, years]);

  // Initial load
  useEffect(() => {
    fetchProjection(rate);
  }, [fetchProjection]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (newRate: number) => {
    setRate(newRate);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProjection(newRate), 300);
  };

  // Build chart data from yearly projection
  const chartData = data?.yearly_projection.map(y => ({
    year: y.year,
    baseline: y.baseline_unaltered,
    target: y.target_unaltered,
  })) ?? [];

  return (
    <div>
      {/* Slider */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)", whiteSpace: "nowrap" }}>
          Target alteration rate
        </label>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={rate}
          onChange={(e) => handleChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: "var(--primary)" }}
        />
        <span style={{
          fontWeight: 700,
          fontSize: "1.1rem",
          color: "var(--primary)",
          minWidth: "3rem",
          textAlign: "right",
        }}>
          {rate}%
        </span>
      </div>

      {data?.current && (
        <div style={{
          fontSize: "0.78rem",
          color: "var(--text-muted)",
          marginBottom: "0.75rem",
        }}>
          Current: {data.current.alteration_rate}% altered ({data.current.altered.toLocaleString()} of {data.current.population.toLocaleString()})
        </div>
      )}

      {/* Chart */}
      {chartData.length > 1 && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.2s" }}>
          <ProjectionAreaChart data={chartData} label="Unaltered cats remaining" />
        </div>
      )}

      {/* Delta stats */}
      {data?.totals && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "0.75rem",
          marginTop: "1rem",
          padding: "0.75rem",
          background: "var(--card-bg, #fff)",
          borderRadius: 8,
          border: "1px solid var(--card-border, #e5e7eb)",
        }}>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Additional alterations
            </div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--foreground)" }}>
              +{formatNumber(data.totals.additional_alterations)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Kittens prevented
            </div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--primary)" }}>
              +{formatNumber(data.totals.kittens_prevented_delta)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Additional savings
            </div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--healthy-text, #22c55e)" }}>
              +{formatCurrency(data.totals.economic_impact_delta)}
            </div>
          </div>
        </div>
      )}

      {/* Time to target */}
      {data?.scenarios.target.months_to_target && (
        <div style={{
          fontSize: "0.78rem",
          color: "var(--text-secondary)",
          marginTop: "0.5rem",
          textAlign: "center",
        }}>
          Estimated {Math.ceil(data.scenarios.target.months_to_target / 12)} year{data.scenarios.target.months_to_target > 12 ? "s" : ""} to reach {rate}% alteration rate
        </div>
      )}
    </div>
  );
}
