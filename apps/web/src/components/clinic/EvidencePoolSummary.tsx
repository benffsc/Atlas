"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";

/**
 * EvidencePoolSummary — Evidence pipeline status for the clinic day hub.
 *
 * Shows role distribution bar, chunk assignment stats, and audit alerts.
 * Only renders when the date has evidence segments (photos processed by CDS-AI).
 *
 * Linear: FFS-1222
 */

interface EvidenceData {
  has_evidence: boolean;
  roles: {
    cat_photo: number;
    waiver_photo: number;
    microchip_barcode: number;
    discard: number;
    pending: number;
    unknown: number;
    total: number;
  };
  chunks: {
    total_chunks: number;
    assigned: number;
    ambiguous: number;
    unmatched: number;
  };
  audits: {
    critical: number;
    warning: number;
    info: number;
  };
}

interface Props {
  date: string;
  onNavigateToReview?: () => void;
}

export function EvidencePoolSummary({ date, onNavigateToReview }: Props) {
  const [data, setData] = useState<EvidenceData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const result = await fetchApi<EvidenceData>(
        `/api/admin/clinic-days/${date}/evidence`
      );
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Don't render anything if loading or no evidence
  if (loading || !data?.has_evidence) return null;

  const { roles, chunks, audits } = data;
  const classified = roles.total - roles.pending;
  const classifiedPct = roles.total > 0 ? Math.round((classified / roles.total) * 100) : 0;

  // Role bar segments
  const barSegments = [
    { label: "Cat", count: roles.cat_photo, color: "var(--success-text)" },
    { label: "Waiver", count: roles.waiver_photo, color: "var(--primary)" },
    { label: "Barcode", count: roles.microchip_barcode, color: "var(--info-text)" },
    { label: "Discard", count: roles.discard, color: "var(--muted)" },
    { label: "Pending", count: roles.pending, color: "var(--warning-text)" },
  ].filter((s) => s.count > 0);

  const needsReview = chunks.ambiguous + chunks.unmatched;

  return (
    <div className="card">
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "12px",
      }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
          Evidence Pool
        </h3>
        {classifiedPct < 100 && (
          <span style={{
            fontSize: "0.75rem",
            padding: "2px 8px",
            borderRadius: "10px",
            background: "var(--warning-bg)",
            color: "var(--warning-text)",
          }}>
            {classifiedPct}% classified
          </span>
        )}
      </div>

      {/* Audit alerts */}
      {(audits.critical > 0 || audits.warning > 0) && (
        <div style={{
          padding: "8px 12px",
          marginBottom: "12px",
          borderRadius: "6px",
          background: audits.critical > 0 ? "var(--danger-bg)" : "var(--warning-bg)",
          color: audits.critical > 0 ? "var(--danger-text)" : "var(--warning-text)",
          fontSize: "0.85rem",
          fontWeight: 500,
        }}>
          {audits.critical > 0 && (
            <span>{audits.critical} critical audit finding{audits.critical !== 1 ? "s" : ""}</span>
          )}
          {audits.critical > 0 && audits.warning > 0 && <span> &middot; </span>}
          {audits.warning > 0 && (
            <span>{audits.warning} warning{audits.warning !== 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {/* Role distribution bar */}
      <div style={{
        height: "8px",
        borderRadius: "4px",
        overflow: "hidden",
        display: "flex",
        marginBottom: "8px",
        background: "var(--section-bg)",
      }}>
        {barSegments.map((seg) => (
          <div
            key={seg.label}
            style={{
              width: `${(seg.count / roles.total) * 100}%`,
              background: seg.color,
              minWidth: seg.count > 0 ? "2px" : 0,
            }}
            title={`${seg.label}: ${seg.count}`}
          />
        ))}
      </div>

      {/* Role legend */}
      <div style={{
        display: "flex",
        gap: "12px",
        fontSize: "0.75rem",
        color: "var(--muted)",
        marginBottom: "12px",
        flexWrap: "wrap",
      }}>
        {barSegments.map((seg) => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{
              width: "8px",
              height: "8px",
              borderRadius: "2px",
              background: seg.color,
            }} />
            <span>{seg.label} ({seg.count})</span>
          </div>
        ))}
      </div>

      {/* Chunk stats */}
      {chunks.total_chunks > 0 && (
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.85rem",
        }}>
          <div>
            <span style={{ fontWeight: 600 }}>{chunks.total_chunks}</span>
            <span style={{ color: "var(--muted)" }}> chunks</span>
            <span style={{ color: "var(--muted)" }}> — </span>
            <span style={{ color: "var(--success-text)", fontWeight: 500 }}>
              {chunks.assigned} assigned
            </span>
            {needsReview > 0 && (
              <>
                <span style={{ color: "var(--muted)" }}>, </span>
                <span style={{ color: "var(--warning-text)", fontWeight: 500 }}>
                  {needsReview} need review
                </span>
              </>
            )}
          </div>
          {needsReview > 0 && onNavigateToReview && (
            <button
              onClick={onNavigateToReview}
              style={{
                background: "none",
                border: "none",
                color: "var(--primary)",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 500,
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Review
            </button>
          )}
        </div>
      )}
    </div>
  );
}
