"use client";

/**
 * ImpactSummary — Mission-connected stats card for the dashboard hero.
 *
 * Design patterns (from industry research):
 *   - charity:water: Label ABOVE number, clean stat grid
 *   - GiveDirectly/GiveWell: Confidence ranges as subtle visual indicator
 *   - Flourish scrollytelling: Progressive disclosure — headline first, detail on click
 *   - Sopact: 4-7 indicators max, audience-specific views
 *   - Best Friends Animal Society: Visual variety, not dense info blocks
 *
 * Key UX decisions:
 *   - Time range selector (All time / Last 5 years / This year) — requested by staff
 *   - Single source of truth: card numbers = drawer numbers (no mismatch)
 *   - Confidence shown as subtle range bar under the number, not separate text
 *   - "See how we calculate this" link → methodology drawer with full narrative
 *
 * Data source: /api/dashboard/impact (v2 model with economic_model)
 * Epic: FFS-1194 (Tier 1 Beacon Polish)
 */

import { useEffect, useState, useCallback } from "react";
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

function fmtBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

// Confidence range bar — subtle visual showing conservative-to-high range
function RangeBar({ low, mid, high, format }: { low: number; mid: number; high: number; format: (n: number) => string }) {
  if (!high || high === 0) return null;
  const midPct = ((mid - low) / (high - low)) * 100;
  return (
    <div style={{ marginTop: "0.3rem" }}>
      <div style={{
        position: "relative", height: 4, borderRadius: 2,
        background: "var(--card-border, #e5e7eb)", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", left: 0, top: 0, height: "100%",
          width: `${midPct}%`, borderRadius: 2,
          background: "var(--primary, #2563eb)", opacity: 0.5,
        }} />
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "0.15rem",
      }}>
        <span>{format(low)}</span>
        <span>{format(high)}</span>
      </div>
    </div>
  );
}

type TimeRange = "all" | "5yr" | "1yr";

const TIME_RANGES: Array<{ key: TimeRange; label: string }> = [
  { key: "all", label: "All time" },
  { key: "5yr", label: "Last 5 years" },
  { key: "1yr", label: "This year" },
];

export function ImpactSummary() {
  const [data, setData] = useState<ImpactResponse | null>(null);
  const [yearlyData, setYearlyData] = useState<YearlyRow[]>([]);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [auditMetric, setAuditMetric] = useState<ImpactMetric | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
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
        setYearlyData(yearly.years);
      }
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [retryCount]);

  if (data && data.enabled === false) return null;

  if (error) {
    return (
      <section className="impact-summary-card" aria-label="Impact summary (loading error)">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Impact numbers unavailable</span>
          <button type="button" onClick={() => { setError(false); setRetryCount(c => c + 1); }}
            style={{ background: "none", border: "1px solid var(--card-border)", borderRadius: 6, padding: "0.25rem 0.75rem", fontSize: "0.78rem", color: "var(--primary)", cursor: "pointer" }}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  // Compute time-filtered numbers from yearly data
  const currentYear = new Date().getFullYear();
  const filteredYears = yearlyData.filter(y => {
    if (timeRange === "5yr") return y.year >= currentYear - 4;
    if (timeRange === "1yr") return y.year === currentYear;
    return true;
  });
  const filteredCats = filteredYears.reduce((s, y) => s + y.donor_facing_count, 0);

  // Use filtered cats to scale the model proportionally
  const allCats = data?.cats_altered ?? 1;
  const ratio = allCats > 0 ? filteredCats / allCats : 1;
  const useFiltered = timeRange !== "all" && filteredCats > 0 && yearlyData.length > 0;

  const displayCats = useFiltered ? filteredCats : (data?.cats_altered ?? 0);
  const displayKittens = useFiltered
    ? Math.round((data?.kittens_prevented ?? 0) * ratio)
    : (data?.kittens_prevented ?? 0);
  const displayCost = useFiltered
    ? Math.round((data?.shelter_cost_avoided ?? 0) * ratio)
    : (data?.shelter_cost_avoided ?? 0);

  // Confidence ranges from economic model (scaled by ratio if filtered)
  const eco = data?.economic_model;
  const consKittens = eco ? Math.round(eco.conservative.kittens_prevented * (useFiltered ? ratio : 1)) : 0;
  const highKittens = eco ? Math.round(eco.high.kittens_prevented * (useFiltered ? ratio : 1)) : 0;
  const consCost = eco ? Math.round(eco.conservative.costs.total * (useFiltered ? ratio : 1)) : 0;
  const highCost = eco ? Math.round(eco.high.costs.total * (useFiltered ? ratio : 1)) : 0;

  const rangeLabel = timeRange === "all"
    ? (data ? `since ${data.start_year}` : "")
    : timeRange === "5yr"
    ? `${currentYear - 4}–${currentYear}`
    : String(currentYear);

  // Sparkline from last 10 years of yearly data
  const sparkValues = yearlyData.slice(-10).map(y => y.donor_facing_count);

  const openAudit = (metric: ImpactMetric) => setAuditMetric(metric);

  return (
    <>
      <section className="impact-summary-card" aria-label={`Our impact ${rangeLabel}`}>
        {/* Header with time range pills */}
        <div className="impact-summary-header">
          <div>
            <h3 className="impact-summary-title">
              Our impact {rangeLabel}
            </h3>
          </div>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {TIME_RANGES.map(tr => (
              <button key={tr.key} type="button"
                onClick={() => setTimeRange(tr.key)}
                style={{
                  padding: "0.15rem 0.5rem", borderRadius: 4, fontSize: "0.7rem",
                  fontWeight: timeRange === tr.key ? 700 : 400,
                  border: `1px solid ${timeRange === tr.key ? "var(--primary)" : "var(--card-border)"}`,
                  background: timeRange === tr.key ? "var(--primary)" : "transparent",
                  color: timeRange === tr.key ? "#fff" : "var(--text-muted)",
                  cursor: "pointer",
                }}>
                {tr.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats grid — 3 stats, consistent hierarchy */}
        <div className="impact-summary-grid">
          {/* Cats altered */}
          <button type="button" className="impact-stat impact-stat-button"
            onClick={() => data && openAudit("cats_altered")} disabled={!data}
            aria-label="Cats altered — click to see methodology">
            <div className="impact-number">
              {data ? (isShowcase
                ? <AnimatedCountUp value={displayCats} format={fmtBig} />
                : fmtBig(displayCats)
              ) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">cats altered</div>
            {sparkValues.length > 2 && (
              <div className="impact-sparkline-wrapper">
                <SparklineSVG values={sparkValues} color="var(--primary)" />
              </div>
            )}
            {data && <div className="impact-audit-hint">How we count this →</div>}
          </button>

          {/* Kittens prevented — hero stat */}
          <button type="button" className="impact-stat impact-stat-button impact-stat-highlight"
            onClick={() => data && openAudit("kittens_prevented")} disabled={!data}
            aria-label="Kittens prevented — click to see methodology">
            <div className="impact-number">
              {data ? (isShowcase
                ? <>~<AnimatedCountUp value={displayKittens} format={fmtBig} duration={2500} /></>
                : `~${fmtBig(displayKittens)}`
              ) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">kittens prevented</div>
            {eco && <RangeBar low={consKittens} mid={displayKittens} high={highKittens} format={fmtBig} />}
            {data && <div className="impact-audit-hint">See the population model →</div>}
          </button>

          {/* Community costs avoided */}
          <button type="button" className="impact-stat impact-stat-button"
            onClick={() => data && openAudit("shelter_cost_avoided")} disabled={!data}
            aria-label="Community costs avoided — click to see methodology">
            <div className="impact-number">
              {data ? (isShowcase
                ? <AnimatedCountUp value={displayCost} format={fmtUsd} duration={3000} />
                : fmtUsd(displayCost)
              ) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">community costs avoided</div>
            {eco && <RangeBar low={consCost} mid={displayCost} high={highCost} format={fmtUsd} />}
            {data && <div className="impact-audit-hint">See the cost model →</div>}
          </button>
        </div>

        {/* Methodology link */}
        {data && (
          <div style={{
            textAlign: "center", padding: "0.5rem 0 0 0",
            borderTop: "1px solid var(--card-border, #e5e7eb)",
            marginTop: "0.5rem",
          }}>
            <a href="/beacon/impact" style={{
              fontSize: "0.78rem", color: "var(--primary)", textDecoration: "none", fontWeight: 500,
            }}>
              Full impact report with methodology →
            </a>
          </div>
        )}
      </section>

      <ImpactMethodologyDrawer
        isOpen={auditMetric !== null}
        onClose={() => setAuditMetric(null)}
        metric={auditMetric}
        methodology={data?.methodology ?? null}
        economicModel={data?.economic_model ?? null}
        startYear={data?.start_year ?? currentYear}
        computedAt={data?.computed_at ?? new Date().toISOString()}
      />
    </>
  );
}
