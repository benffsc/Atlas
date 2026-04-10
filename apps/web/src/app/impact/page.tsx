"use client";

/**
 * /impact — Donor-ready impact presentation page.
 *
 * Chromeless (no sidebar/nav). Combines the impact hero numbers
 * with the year-over-year chart and methodology into a single
 * shareable page suitable for gala presentations and donor links.
 *
 * Pattern: follows /story page (chromeless public surface).
 * Data sources: /api/dashboard/impact, /api/dashboard/impact/yearly
 *
 * Epic: FFS-1193 (Beacon Polish)
 */

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api-client";
import { YearlyImpactChart } from "@/components/dashboard/YearlyImpactChart";
import type { ImpactMethodology } from "@/app/api/dashboard/impact/route";

interface ImpactData {
  enabled: boolean;
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
  computed_at: string;
  methodology: ImpactMethodology;
}

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

export default function ImpactPage() {
  const [data, setData] = useState<ImpactData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchApi<ImpactData>("/api/dashboard/impact")
      .then((result) => {
        if (result && typeof result === "object" && "cats_altered" in result) {
          setData(result as ImpactData);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="impact-page">
        <div className="impact-page-error">
          <p>Unable to load impact data. Try refreshing.</p>
          <a href="/" className="impact-page-cta">Go home</a>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="impact-page">
        <div className="impact-page-loading">
          <img src="/beacon-logo.jpeg" alt="Beacon" style={{ width: 160, opacity: 0.7 }} />
          <div style={{ marginTop: "1rem", color: "var(--text-muted)" }}>Loading impact data...</div>
        </div>
      </div>
    );
  }

  const catsAlteredMethodology = data.methodology?.cats_altered;

  return (
    <div className="impact-page">
      {/* Header */}
      <header className="impact-page-header">
        <img src="/beacon-logo.jpeg" alt="Beacon" className="impact-page-logo" />
      </header>

      {/* Hero impact numbers */}
      <section className="impact-page-hero" aria-label="Impact summary">
        <h1 className="impact-page-title">Our impact since {data.start_year}</h1>
        <p className="impact-page-subtitle">
          Every number represents real cats helped in our community
        </p>

        <div className="impact-page-stats">
          <div className="impact-page-stat">
            <div className="impact-page-stat-number">{formatBigNumber(data.cats_altered)}</div>
            <div className="impact-page-stat-label">cats altered</div>
          </div>
          <div className="impact-page-stat impact-page-stat-highlight">
            <div className="impact-page-stat-number">~{formatBigNumber(data.kittens_prevented)}</div>
            <div className="impact-page-stat-label">kittens prevented</div>
          </div>
          <div className="impact-page-stat">
            <div className="impact-page-stat-number">{formatCurrency(data.shelter_cost_avoided)}</div>
            <div className="impact-page-stat-label">shelter costs avoided</div>
          </div>
        </div>
      </section>

      {/* Year-over-year chart (reuses dashboard component) */}
      <section className="impact-page-chart">
        <YearlyImpactChart />
      </section>

      {/* Methodology section */}
      {catsAlteredMethodology && (
        <section className="impact-page-methodology" aria-label="How we calculate these numbers">
          <h2 className="impact-page-section-title">How we calculate these numbers</h2>

          <div className="impact-page-formula-block">
            <h3>Cats altered</h3>
            <code>{catsAlteredMethodology.formula}</code>
            {"data_source" in catsAlteredMethodology && catsAlteredMethodology.data_source && (
              <p className="impact-page-meta">
                Source: <code>{catsAlteredMethodology.data_source}</code>
                {"record_count" in catsAlteredMethodology && (
                  <> · <strong>{catsAlteredMethodology.record_count.toLocaleString()}</strong> provable records</>
                )}
              </p>
            )}
          </div>

          {catsAlteredMethodology.assumptions && catsAlteredMethodology.assumptions.length > 0 && (
            <div className="impact-page-assumptions">
              <h3>Key assumptions</h3>
              {catsAlteredMethodology.assumptions.map((a, i) => (
                <div key={i} className="impact-page-assumption">
                  <span className="impact-page-assumption-label">{a.label}</span>
                  <span className="impact-page-assumption-value">{a.value}</span>
                  <p>{a.rationale}</p>
                </div>
              ))}
            </div>
          )}

          {catsAlteredMethodology.caveats && catsAlteredMethodology.caveats.length > 0 && (
            <div className="impact-page-caveats">
              <h3>Caveats</h3>
              <ul>
                {catsAlteredMethodology.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Footer CTA */}
      <footer className="impact-page-footer">
        <a href="/story" className="impact-page-cta">Read our story</a>
        <p className="impact-page-computed">
          Data computed {new Date(data.computed_at).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </footer>
    </div>
  );
}
