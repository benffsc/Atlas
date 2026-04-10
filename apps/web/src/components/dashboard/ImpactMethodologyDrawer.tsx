"use client";

/**
 * ImpactMethodologyDrawer — "Show your work" audit drawer for impact stats.
 *
 * When a user clicks a number on the ImpactSummary card, this drawer opens
 * and shows:
 *   - The metric name and current value
 *   - The formula / how it's computed
 *   - The assumptions used (with rationale and sources)
 *   - Caveats and limitations
 *   - A sample of the actual underlying records (lazy-loaded)
 *
 * This is the donor credibility layer. A gala attendee asks "how did you
 * get 328,990 kittens prevented?" and Ben clicks the number to show the
 * formula, the sources, and 10 recent real records that generated it.
 *
 * Pattern: "show your work" — data storytelling with transparent methodology.
 * Epic: FFS-1194 (Tier 1 Beacon Polish, audit drawer enhancement).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { fetchApi } from "@/lib/api-client";
import type { ImpactMethodology } from "@/app/api/dashboard/impact/route";

interface YearlyRow {
  year: number;
  reference_count: number;
  db_count: number;
  donor_facing_count: number;
  alignment_status: string;
}

interface YearlyData {
  years: YearlyRow[];
  totals: { reference: number; db: number; donor_facing: number };
}

const YEARLY_STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  aligned: { label: "Aligned", bg: "rgba(34,197,94,0.12)", color: "#15803d" },
  db_under: { label: "Under", bg: "rgba(245,158,11,0.12)", color: "#92400e" },
  db_over: { label: "Over", bg: "rgba(239,68,68,0.12)", color: "#b91c1c" },
  pre_system: { label: "Pre-sys", bg: "rgba(156,163,175,0.12)", color: "#4b5563" },
};

export type ImpactMetric = "cats_altered" | "kittens_prevented" | "shelter_cost_avoided";

interface SampleRecord {
  cat_id: string;
  cat_name: string | null;
  microchip: string | null;
  appointment_date: string | null;
  procedure: string;
  clinic_name: string | null;
  source_system: string;
}

interface AuditResponse {
  metric: ImpactMetric;
  sample: SampleRecord[];
  sample_size: number;
  note: string;
}

const METRIC_LABELS: Record<ImpactMetric, { title: string; heroLabel: string }> = {
  cats_altered: {
    title: "Cats altered — methodology",
    heroLabel: "cats altered",
  },
  kittens_prevented: {
    title: "Kittens prevented — methodology",
    heroLabel: "kittens prevented",
  },
  shelter_cost_avoided: {
    title: "Shelter costs avoided — methodology",
    heroLabel: "shelter costs avoided",
  },
};

function formatHeroNumber(metric: ImpactMetric, value: number): string {
  if (metric === "shelter_cost_avoided") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
    return `$${value.toLocaleString()}`;
  }
  return value.toLocaleString();
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  metric: ImpactMetric | null;
  methodology: ImpactMethodology | null;
  startYear: number;
  computedAt: string;
}

export function ImpactMethodologyDrawer({
  isOpen,
  onClose,
  metric,
  methodology,
  startYear,
  computedAt,
}: Props) {
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(false);
  const [yearly, setYearly] = useState<YearlyData | null>(null);
  const [yearlyLoading, setYearlyLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !metric) {
      setAudit(null);
      setAuditError(false);
      return;
    }
    let cancelled = false;
    setAuditLoading(true);
    setAuditError(false);
    fetchApi<AuditResponse>(`/api/dashboard/impact/audit?metric=${metric}&limit=10`)
      .then((result) => {
        if (cancelled) return;
        if (result && typeof result === "object" && "sample" in result) {
          setAudit(result as AuditResponse);
        } else {
          setAuditError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAuditError(true);
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, metric]);

  // Fetch yearly breakdown when drawer opens for cats_altered
  useEffect(() => {
    if (!isOpen || metric !== "cats_altered") {
      setYearly(null);
      return;
    }
    let cancelled = false;
    setYearlyLoading(true);
    fetchApi<YearlyData>("/api/dashboard/impact/yearly")
      .then((result) => {
        if (cancelled) return;
        if (result && Array.isArray(result.years)) {
          setYearly(result);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setYearlyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, metric]);

  if (!metric || !methodology) return null;

  const m = methodology[metric];
  const label = METRIC_LABELS[metric];
  const computedDate = new Date(computedAt).toLocaleString();

  return (
    <ActionDrawer isOpen={isOpen} onClose={onClose} title={label.title} width="lg">
      <div className="impact-audit">
        {/* Hero number */}
        <div className="impact-audit-hero">
          <div className="impact-audit-hero-number">
            {formatHeroNumber(metric, m.value)}
          </div>
          <div className="impact-audit-hero-label">
            {label.heroLabel} since {startYear}
          </div>
        </div>

        {/* Formula */}
        <section className="impact-audit-section">
          <h4 className="impact-audit-section-title">How we calculate this</h4>
          <code className="impact-audit-formula">{m.formula}</code>
          {"data_source" in m && m.data_source && (
            <div className="impact-audit-meta">
              <strong>Source:</strong> <code>{m.data_source}</code>
              {"record_count" in m && (
                <>
                  {" "}
                  · <strong>{m.record_count.toLocaleString()}</strong> records counted
                </>
              )}
            </div>
          )}
        </section>

        {/* Assumptions */}
        {m.assumptions && m.assumptions.length > 0 && (
          <section className="impact-audit-section">
            <h4 className="impact-audit-section-title">Assumptions</h4>
            {m.assumptions.map((a, i) => (
              <div key={i} className="impact-audit-assumption">
                <div className="impact-audit-assumption-header">
                  <span className="impact-audit-assumption-label">{a.label}</span>
                  <span className="impact-audit-assumption-value">{a.value}</span>
                </div>
                <p className="impact-audit-assumption-rationale">{a.rationale}</p>
              </div>
            ))}
          </section>
        )}

        {/* Sources */}
        {m.sources && m.sources.length > 0 && (
          <section className="impact-audit-section">
            <h4 className="impact-audit-section-title">Sources</h4>
            <ul className="impact-audit-sources">
              {m.sources.map((s, i) => (
                <li key={i}>
                  {s.url && s.url !== "#" ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.label} ↗
                    </a>
                  ) : (
                    <span>{s.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Caveats */}
        {m.caveats && m.caveats.length > 0 && (
          <section className="impact-audit-section">
            <h4 className="impact-audit-section-title">Caveats &amp; limitations</h4>
            <ul className="impact-audit-caveats">
              {m.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Sample records — real data for spot checking */}
        <section className="impact-audit-section">
          <h4 className="impact-audit-section-title">
            {metric === "cats_altered"
              ? "Recent records (spot check)"
              : "Underlying records"}
          </h4>
          {metric !== "cats_altered" && (
            <p className="impact-audit-note">
              This metric is derived from the <strong>cats altered</strong> count via the formula above. These are the most recent underlying records that contribute to the calculation.
            </p>
          )}
          {auditLoading && (
            <div className="impact-audit-loading">Loading sample…</div>
          )}
          {auditError && (
            <div className="impact-audit-error">
              Unable to load sample records. The overall numbers are still valid.
            </div>
          )}
          {audit && audit.sample.length > 0 && (
            <div className="impact-audit-table-wrapper">
              <table className="impact-audit-table">
                <thead>
                  <tr>
                    <th>Cat</th>
                    <th>Microchip</th>
                    <th>Date</th>
                    <th>Procedure</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.sample.map((row) => (
                    <tr key={row.cat_id}>
                      <td>
                        <Link href={`/cats/${row.cat_id}`} className="impact-audit-cat-link">
                          {row.cat_name || "(unnamed)"}
                        </Link>
                      </td>
                      <td className="impact-audit-mono">
                        {row.microchip ? row.microchip.slice(-6) : "—"}
                      </td>
                      <td>{row.appointment_date || "—"}</td>
                      <td>{row.procedure}</td>
                      <td className="impact-audit-mono">{row.source_system}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="impact-audit-sample-note">
                Showing {audit.sample.length} most recent. Click any cat to see the full record.
              </p>
            </div>
          )}
          {audit && audit.sample.length === 0 && (
            <div className="impact-audit-empty">No records yet.</div>
          )}
        </section>

        {/* Year-by-year breakdown (cats_altered only) */}
        {metric === "cats_altered" && (
          <section className="impact-audit-section">
            <h4 className="impact-audit-section-title">Year-by-year breakdown</h4>
            {yearlyLoading && (
              <div className="impact-audit-loading">Loading yearly data…</div>
            )}
            {yearly && yearly.years.length > 0 && (
              <div className="impact-audit-table-wrapper" style={{ maxHeight: "320px", overflowY: "auto" }}>
                <table className="impact-audit-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th style={{ textAlign: "right" }}>Reference</th>
                      <th style={{ textAlign: "right" }}>DB</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...yearly.years].reverse().map((row) => {
                      const s = YEARLY_STATUS_STYLE[row.alignment_status] || YEARLY_STATUS_STYLE.pre_system;
                      return (
                        <tr key={row.year}>
                          <td><strong>{row.year}</strong></td>
                          <td className="impact-audit-mono" style={{ textAlign: "right" }}>
                            {row.reference_count.toLocaleString()}
                          </td>
                          <td className="impact-audit-mono" style={{ textAlign: "right" }}>
                            {row.db_count.toLocaleString()}
                          </td>
                          <td>
                            <span style={{
                              display: "inline-block",
                              padding: "0.1rem 0.4rem",
                              borderRadius: "3px",
                              fontSize: "0.68rem",
                              fontWeight: 600,
                              background: s.bg,
                              color: s.color,
                            }}>
                              {s.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="impact-audit-sample-note">
                  Totals — Reference: {yearly.totals.reference.toLocaleString()} · DB: {yearly.totals.db.toLocaleString()} · Donor-facing: {yearly.totals.donor_facing.toLocaleString()}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Footer metadata */}
        <div className="impact-audit-footer">
          Computed at {computedDate}. Cached for 1 hour.
        </div>
      </div>
    </ActionDrawer>
  );
}
