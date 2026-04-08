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
import type { ImpactMethodology } from "@/app/api/dashboard/impact/route";

interface ImpactResponse {
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
  computed_at: string;
  methodology: ImpactMethodology;
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
  const [auditMetric, setAuditMetric] = useState<ImpactMetric | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApi<ImpactResponse>("/api/dashboard/impact")
      .then((result) => {
        if (cancelled) return;
        if (result && typeof result === "object" && "cats_altered" in result) {
          setData(result as ImpactResponse);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide the card entirely if the endpoint fails — don't block the dashboard
  if (error) return null;

  const openAudit = (metric: ImpactMetric) => setAuditMetric(metric);
  const closeAudit = () => setAuditMetric(null);

  return (
    <>
      <section className="impact-summary-card" aria-label="Our impact since inception">
        <div className="impact-summary-header">
          <h3 className="impact-summary-title">
            Our impact {data ? `since ${data.start_year}` : ""}
          </h3>
          <span className="impact-summary-subtitle">
            Click any number to see the math
          </span>
        </div>
        <div className="impact-summary-grid">
          <button
            type="button"
            className="impact-stat impact-stat-button"
            onClick={() => data && openAudit("cats_altered")}
            disabled={!data}
            aria-label="Cats altered — click to see methodology"
          >
            <div className="impact-number">
              {data ? formatBigNumber(data.cats_altered) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">cats altered</div>
            {data && <div className="impact-audit-hint">See the data →</div>}
          </button>

          <button
            type="button"
            className="impact-stat impact-stat-button impact-stat-highlight"
            onClick={() => data && openAudit("kittens_prevented")}
            disabled={!data}
            aria-label="Kittens prevented — click to see methodology"
          >
            <div className="impact-number">
              {data ? `~${formatBigNumber(data.kittens_prevented)}` : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">kittens prevented</div>
            {data && <div className="impact-audit-hint">See the math →</div>}
          </button>

          <button
            type="button"
            className="impact-stat impact-stat-button"
            onClick={() => data && openAudit("shelter_cost_avoided")}
            disabled={!data}
            aria-label="Shelter costs avoided — click to see methodology"
          >
            <div className="impact-number">
              {data ? formatCurrency(data.shelter_cost_avoided) : <span className="impact-skeleton" />}
            </div>
            <div className="impact-label">shelter costs avoided</div>
            {data && <div className="impact-audit-hint">See the math →</div>}
          </button>
        </div>
      </section>

      <ImpactMethodologyDrawer
        isOpen={auditMetric !== null}
        onClose={closeAudit}
        metric={auditMetric}
        methodology={data?.methodology ?? null}
        startYear={data?.start_year ?? new Date().getFullYear()}
        computedAt={data?.computed_at ?? new Date().toISOString()}
      />
    </>
  );
}
