"use client";

/**
 * ImpactSummary — Mission-connected stats card for the dashboard hero.
 *
 * Shows "since inception" impact numbers that translate operational data
 * (cats altered) into mission outcomes (kittens prevented, shelter cost avoided).
 *
 * Each stat is clickable — clicking opens ImpactMethodologyDrawer which
 * shows the formula, assumptions, sources, and actual sample records so
 * donors / auditors can verify the numbers.
 *
 * Pattern reference: Bridgespan nonprofit dashboard guide — connect outcome
 * metrics to mission story. + "show your work" data storytelling pattern —
 * every impressive number should have a visible audit trail.
 *
 * Data source: /api/dashboard/impact (returns numbers + full methodology)
 * Audit source: /api/dashboard/impact/audit (sample records, lazy-loaded)
 *
 * Tracks: FFS-1194 (Tier 1 Beacon Polish)
 */

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api-client";
import { ImpactMethodologyDrawer, type ImpactMetric } from "./ImpactMethodologyDrawer";
import { AnimatedCountUp } from "./AnimatedCountUp";
import { SparklineSVG } from "../charts/SparklineSVG";
import { useShowcase } from "@/components/ShowcaseContext";
import type { ImpactMethodology, ImpactLabels, EconomicModel } from "@/app/api/dashboard/impact/route";

interface ImpactResponse {
  enabled: boolean;
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
  computed_at: string;
  labels: ImpactLabels;
  methodology: ImpactMethodology;
  economic_model?: EconomicModel;
}

interface YearlyRow {
  year: number;
  donor_facing_count: number;
}

interface YearlyData {
  years: YearlyRow[];
}

/** Format large numbers for the display card (not the drawer hero). */
function formatBigNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

export function ImpactSummary() {
  const [data, setData] = useState<ImpactResponse | null>(null);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [auditMetric, setAuditMetric] = useState<ImpactMetric | null>(null);
  const [yearlyData, setYearlyData] = useState<number[]>([]);
  const { isShowcase } = useShowcase();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchApi<ImpactResponse>("/api/dashboard/impact"),
      fetchApi<YearlyData>("/api/dashboard/impact/yearly").catch(() => null),
    ]).then(([result, yearly]) => {
      if (cancelled) return;
      if (result && typeof result === "object" && "cats_altered" in result) {
        setData(result as ImpactResponse);
        setError(false);
      } else {
        setError(true);
      }
      if (yearly && Array.isArray(yearly.years)) {
        // Last 10 years of donor_facing_count for sparklines
        const last10 = yearly.years.slice(-10).map((y: YearlyRow) => y.donor_facing_count);
        setYearlyData(last10);
      }
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  // Admin disabled — hide entirely
  if (data && data.enabled === false) return null;

  // On error, show a subtle retry prompt instead of hiding
  if (error) {
    return (
      <section className="impact-summary-card" aria-label="Impact summary (loading error)">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Impact numbers unavailable
          </span>
          <button
            type="button"
            onClick={() => { setError(false); setRetryCount((c) => c + 1); }}
            style={{
              background: "none",
              border: "1px solid var(--card-border)",
              borderRadius: 6,
              padding: "0.25rem 0.75rem",
              fontSize: "0.78rem",
              color: "var(--primary)",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const openAudit = (metric: ImpactMetric) => setAuditMetric(metric);
  const closeAudit = () => setAuditMetric(null);

  // Labels come from ops.app_config (admin-configurable, white-label friendly).
  // While loading, fall back to sensible defaults so the card doesn't flicker.
  const labels = data?.labels ?? {
    card_title: "Our impact",
    card_subtitle: "Click any number to see the math",
    cats_altered: "cats altered",
    kittens_prevented: "kittens prevented",
    shelter_cost_avoided: "shelter costs avoided",
  };

  return (
    <>
      <section className="impact-summary-card" aria-label={`${labels.card_title} since inception`}>
        <div className="impact-summary-header">
          <h3 className="impact-summary-title">
            {labels.card_title} {data ? `since ${data.start_year}` : ""}
          </h3>
          <span className="impact-summary-subtitle">{labels.card_subtitle}</span>
        </div>
        <div className="impact-summary-grid">
          <button
            type="button"
            className="impact-stat impact-stat-button"
            onClick={() => data && openAudit("cats_altered")}
            disabled={!data}
            aria-label={`${labels.cats_altered} — click to see methodology`}
          >
            <div className="impact-number">
              {data ? (
                isShowcase
                  ? <AnimatedCountUp value={data.cats_altered} format={formatBigNumber} />
                  : formatBigNumber(data.cats_altered)
              ) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">{labels.cats_altered}</div>
            {yearlyData.length > 2 && (
              <div className="impact-sparkline-wrapper">
                <SparklineSVG values={yearlyData} color="var(--primary)" />
              </div>
            )}
            {data && <div className="impact-audit-hint">See the data →</div>}
          </button>

          <button
            type="button"
            className="impact-stat impact-stat-button impact-stat-highlight"
            onClick={() => data && openAudit("kittens_prevented")}
            disabled={!data}
            aria-label={`${labels.kittens_prevented} — click to see methodology`}
          >
            <div className="impact-number">
              {data ? (
                isShowcase
                  ? <>~<AnimatedCountUp value={data.kittens_prevented} format={formatBigNumber} duration={2500} /></>
                  : `~${formatBigNumber(data.kittens_prevented)}`
              ) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">{labels.kittens_prevented}</div>
            {data?.economic_model && (
              <div className="impact-confidence-badge">
                {formatBigNumber(data.economic_model.conservative.kittens_prevented)} – {formatBigNumber(data.economic_model.high.kittens_prevented)}
              </div>
            )}
            {yearlyData.length > 2 && (
              <div className="impact-sparkline-wrapper">
                <SparklineSVG values={yearlyData.map(v => v * (data?.methodology?.kittens_prevented?.multiplier ?? 10))} color="var(--primary)" />
              </div>
            )}
            {data && <div className="impact-audit-hint">See the math →</div>}
          </button>

          <button
            type="button"
            className="impact-stat impact-stat-button"
            onClick={() => data && openAudit("shelter_cost_avoided")}
            disabled={!data}
            aria-label={`${labels.shelter_cost_avoided} — click to see methodology`}
          >
            <div className="impact-number">
              {data ? (
                isShowcase
                  ? <AnimatedCountUp value={data.shelter_cost_avoided} format={formatCurrency} duration={3000} />
                  : formatCurrency(data.shelter_cost_avoided)
              ) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">
              {data?.economic_model ? "community costs avoided" : labels.shelter_cost_avoided}
            </div>
            {data?.economic_model && (
              <div className="impact-confidence-badge">
                {formatCurrency(data.economic_model.conservative.costs.total)} – {formatCurrency(data.economic_model.high.costs.total)}
              </div>
            )}
            {yearlyData.length > 2 && (
              <div className="impact-sparkline-wrapper">
                <SparklineSVG
                  values={yearlyData.map(v => {
                    const kMult = data?.methodology?.kittens_prevented?.multiplier ?? 10;
                    const sMult = data?.methodology?.shelter_cost_avoided?.multiplier ?? 200;
                    return v * kMult * sMult;
                  })}
                  color="var(--primary)"
                />
              </div>
            )}
            {data && <div className="impact-audit-hint">See the math →</div>}
          </button>
        </div>
      </section>

      <ImpactMethodologyDrawer
        isOpen={auditMetric !== null}
        onClose={closeAudit}
        metric={auditMetric}
        methodology={data?.methodology ?? null}
        economicModel={data?.economic_model ?? null}
        startYear={data?.start_year ?? new Date().getFullYear()}
        computedAt={data?.computed_at ?? new Date().toISOString()}
      />
    </>
  );
}
