"use client";

/**
 * ImpactSummary — Mission-connected stats card for the dashboard hero.
 *
 * Shows "since inception" impact numbers that translate operational data
 * (cats altered) into mission outcomes (kittens prevented, shelter cost avoided).
 *
 * Pattern reference: Bridgespan nonprofit dashboard guide — connect outcome
 * metrics to mission story. Donors and board members see impact, not operations.
 *
 * Data source: /api/dashboard/impact (new endpoint). Falls back to placeholder
 * numbers while loading, and gracefully hides if the endpoint fails (so this
 * card never blocks the rest of the dashboard).
 *
 * Tracks: FFS-1194 (Tier 1 Beacon Polish)
 */

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api-client";

interface ImpactData {
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
}

export function ImpactSummary() {
  const [data, setData] = useState<ImpactData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchApi<ImpactData>("/api/dashboard/impact")
      .then((result) => {
        if (cancelled) return;
        if (result && typeof result === "object" && "cats_altered" in result) {
          setData(result as ImpactData);
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

  return (
    <section className="impact-summary-card" aria-label="Our impact since inception">
      <div className="impact-summary-header">
        <h3 className="impact-summary-title">
          Our impact {data ? `since ${data.start_year}` : ""}
        </h3>
        <span className="impact-summary-subtitle">Every number is a life changed</span>
      </div>
      <div className="impact-summary-grid">
        <div className="impact-stat">
          <div className="impact-number">
            {data ? data.cats_altered.toLocaleString() : <span className="impact-skeleton" />}
          </div>
          <div className="impact-label">cats altered</div>
        </div>
        <div className="impact-stat impact-stat-highlight">
          <div className="impact-number">
            {data ? `~${data.kittens_prevented.toLocaleString()}` : <span className="impact-skeleton" />}
          </div>
          <div className="impact-label">kittens prevented</div>
        </div>
        <div className="impact-stat">
          <div className="impact-number">
            {data ? `$${(data.shelter_cost_avoided / 1000).toFixed(0)}k` : <span className="impact-skeleton" />}
          </div>
          <div className="impact-label">shelter costs avoided</div>
        </div>
      </div>
    </section>
  );
}
