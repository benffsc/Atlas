"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/feedback/Toast";
import { fetchApi, postApi } from "@/lib/api-client";

/**
 * EvidenceReviewPanel — Staff review UI for CDS-AI photo chunks.
 *
 * Per-chunk card: photo thumbnails + extracted waiver data + match result.
 * Color coding: green (>0.9), yellow (0.5-0.9), red (<0.5 or unmatched).
 * Actions: Approve (manual), Override (pick cat), Reject.
 *
 * Manual assignments are protected by matched_via='manual' — AI never
 * overwrites them (MIG_3048 pattern).
 *
 * Linear: FFS-1092
 */

interface ReviewSegment {
  segment_id: string;
  segment_role: string;
  sequence_number: number;
  storage_path: string | null;
  original_filename: string | null;
}

interface ReviewChunk {
  chunk_id: string;
  assignment_status: string;
  matched_cat_id: string | null;
  matched_cat_name: string | null;
  matched_via: string | null;
  confidence: number | null;
  waiver_data: Record<string, unknown> | null;
  segments: ReviewSegment[];
}

interface ReviewData {
  clinic_date: string;
  chunks: ReviewChunk[];
  orphan_count: number;
  orphans: ReviewSegment[];
}

interface Props {
  date: string;
}

export function EvidenceReviewPanel({ date }: Props) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const { addToast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchApi<ReviewData>(
        `/api/admin/clinic-days/${date}/evidence/review`
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

  const handleAction = async (chunkId: string, action: "approve" | "reject", catId?: string) => {
    setActionInProgress(chunkId);
    try {
      await postApi(`/api/admin/clinic-days/${date}/evidence/review`, {
        chunk_id: chunkId,
        action,
        ...(catId && { cat_id: catId }),
      });
      addToast({
        type: "success",
        message: `Chunk ${action === "approve" ? "approved" : "rejected"}`,
      });
      await loadData();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : `${action} failed`,
      });
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
        Loading evidence...
      </div>
    );
  }

  if (!data || data.chunks.length === 0) {
    return (
      <div style={{
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--muted)",
      }}>
        <div style={{ fontSize: "1.1rem", marginBottom: "8px" }}>
          No evidence chunks found
        </div>
        <p style={{ fontSize: "0.85rem" }}>
          Photos will appear here after CDS-AI classifies and chunks them.
        </p>
      </div>
    );
  }

  // Stats
  const assigned = data.chunks.filter((c) => c.assignment_status === "assigned").length;
  const needsReview = data.chunks.filter((c) =>
    c.assignment_status === "ambiguous" || c.assignment_status === "chunked"
  ).length;
  const rejected = data.chunks.filter((c) => c.assignment_status === "rejected").length;

  return (
    <div>
      {/* Stats bar */}
      <div style={{
        display: "flex",
        gap: "16px",
        marginBottom: "16px",
        fontSize: "0.85rem",
      }}>
        <span>
          <strong>{data.chunks.length}</strong> chunks total
        </span>
        <span style={{ color: "var(--success-text)" }}>
          {assigned} assigned
        </span>
        {needsReview > 0 && (
          <span style={{ color: "var(--warning-text)" }}>
            {needsReview} need review
          </span>
        )}
        {rejected > 0 && (
          <span style={{ color: "var(--muted)" }}>
            {rejected} rejected
          </span>
        )}
        {data.orphan_count > 0 && (
          <span style={{ color: "var(--muted)" }}>
            {data.orphan_count} orphan photos
          </span>
        )}
      </div>

      {/* Chunk cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {data.chunks.map((chunk) => (
          <ChunkCard
            key={chunk.chunk_id}
            chunk={chunk}
            isLoading={actionInProgress === chunk.chunk_id}
            onApprove={() => handleAction(chunk.chunk_id, "approve")}
            onReject={() => handleAction(chunk.chunk_id, "reject")}
          />
        ))}
      </div>

      {/* Orphan photos */}
      {data.orphan_count > 0 && (
        <div style={{ marginTop: "24px" }}>
          <h3 style={{ fontSize: "0.95rem", marginBottom: "12px" }}>
            Orphan Photos ({data.orphan_count})
          </h3>
          <div style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}>
            {data.orphans.map((seg) => (
              <div
                key={seg.segment_id}
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "6px",
                  overflow: "hidden",
                  border: "1px solid var(--card-border)",
                  background: "var(--section-bg)",
                }}
                title={seg.original_filename || `Seq #${seg.sequence_number}`}
              >
                {seg.storage_path ? (
                  <img
                    src={seg.storage_path}
                    alt={seg.original_filename || ""}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--muted)",
                    fontSize: "0.7rem",
                  }}>
                    #{seg.sequence_number}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ChunkCard ───────────────────────────────────────────────

function ChunkCard({
  chunk,
  isLoading,
  onApprove,
  onReject,
}: {
  chunk: ReviewChunk;
  isLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const confidence = chunk.confidence ?? 0;
  const isAssigned = chunk.assignment_status === "assigned";
  const isRejected = chunk.assignment_status === "rejected";
  const isManual = chunk.matched_via === "manual";

  // Color coding by confidence
  const borderColor = isRejected
    ? "var(--muted)"
    : isManual
    ? "var(--primary)"
    : confidence >= 0.9
    ? "var(--success-text)"
    : confidence >= 0.5
    ? "var(--warning-text)"
    : "var(--danger-text)";

  const confidenceBadge = isManual
    ? { label: "Manual", bg: "var(--primary-bg)", color: "var(--primary)" }
    : confidence >= 0.9
    ? { label: "High", bg: "var(--success-bg)", color: "var(--success-text)" }
    : confidence >= 0.5
    ? { label: "Medium", bg: "var(--warning-bg)", color: "var(--warning-text)" }
    : chunk.matched_cat_id
    ? { label: "Low", bg: "var(--danger-bg)", color: "var(--danger-text)" }
    : { label: "Unmatched", bg: "var(--section-bg)", color: "var(--muted)" };

  const wd = chunk.waiver_data as Record<string, unknown> | null;
  const catPhotos = chunk.segments.filter((s) => s.segment_role === "cat_photo");
  const waiverPhoto = chunk.segments.find((s) => s.segment_role === "waiver_photo");

  return (
    <div
      className="card"
      style={{
        borderLeft: `3px solid ${borderColor}`,
        opacity: isRejected ? 0.6 : 1,
      }}
    >
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "16px",
      }}>
        {/* Left: photos + waiver data */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Photo thumbnails */}
          <div style={{
            display: "flex",
            gap: "6px",
            marginBottom: "10px",
            flexWrap: "wrap",
          }}>
            {/* Waiver thumbnail first */}
            {waiverPhoto?.storage_path && (
              <a
                href={waiverPhoto.storage_path}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  width: "60px",
                  height: "60px",
                  borderRadius: "4px",
                  overflow: "hidden",
                  border: "2px solid var(--primary)",
                  flexShrink: 0,
                }}
                title="Waiver photo"
              >
                <img
                  src={waiverPhoto.storage_path}
                  alt="Waiver"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </a>
            )}
            {/* Cat photo thumbnails */}
            {catPhotos.slice(0, 4).map((seg) => (
              <a
                key={seg.segment_id}
                href={seg.storage_path || "#"}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  width: "60px",
                  height: "60px",
                  borderRadius: "4px",
                  overflow: "hidden",
                  border: "1px solid var(--card-border)",
                  flexShrink: 0,
                }}
                title={seg.original_filename || `#${seg.sequence_number}`}
              >
                {seg.storage_path ? (
                  <img
                    src={seg.storage_path}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--section-bg)",
                    color: "var(--muted)",
                    fontSize: "0.65rem",
                  }}>
                    #{seg.sequence_number}
                  </div>
                )}
              </a>
            ))}
            {catPhotos.length > 4 && (
              <div style={{
                width: "60px",
                height: "60px",
                borderRadius: "4px",
                border: "1px solid var(--card-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: "0.75rem",
                background: "var(--section-bg)",
              }}>
                +{catPhotos.length - 4}
              </div>
            )}
          </div>

          {/* Waiver extracted data */}
          <div style={{ fontSize: "0.85rem" }}>
            <div style={{ fontWeight: 600, marginBottom: "2px" }}>
              {wd?.clinic_number ? `#${wd.clinic_number}` : "No clinic #"}
              {wd?.owner_last_name ? (
                <span style={{ fontWeight: 400 }}>
                  {" "}&mdash; {String(wd.owner_first_name || "")} {String(wd.owner_last_name)}
                </span>
              ) : null}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
              {[
                wd?.description ? String(wd.description) : null,
                wd?.sex === "M" ? "Male" : wd?.sex === "F" ? "Female" : null,
                wd?.weight_lbs ? `${wd.weight_lbs} lbs` : null,
              ].filter(Boolean).join(" · ") || "No waiver data"}
            </div>
            {wd?.microchip_number ? (
              <div style={{
                fontFamily: "monospace",
                fontSize: "0.75rem",
                color: "var(--muted)",
                marginTop: "2px",
              }}>
                Chip: {String(wd.microchip_number)}
              </div>
            ) : null}
          </div>
        </div>

        {/* Right: match result + actions */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "8px",
          flexShrink: 0,
        }}>
          {/* Confidence badge */}
          <span style={{
            padding: "2px 8px",
            borderRadius: "10px",
            fontSize: "0.7rem",
            fontWeight: 600,
            background: confidenceBadge.bg,
            color: confidenceBadge.color,
          }}>
            {confidenceBadge.label}
          </span>

          {/* Match result */}
          {chunk.matched_cat_id ? (
            <div style={{
              textAlign: "right",
              fontSize: "0.8rem",
            }}>
              <div style={{ fontWeight: 500 }}>
                {chunk.matched_cat_name || chunk.matched_cat_id.substring(0, 8)}
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.7rem" }}>
                via {chunk.matched_via}
              </div>
            </div>
          ) : (
            <div style={{
              fontSize: "0.8rem",
              color: "var(--danger-text)",
              fontWeight: 500,
            }}>
              No match
            </div>
          )}

          {/* Actions */}
          {!isRejected && (
            <div style={{ display: "flex", gap: "4px" }}>
              {chunk.matched_cat_id && !isManual && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onApprove}
                  loading={isLoading}
                >
                  Approve
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onReject}
                loading={isLoading}
              >
                Reject
              </Button>
            </div>
          )}
          {isRejected && (
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Rejected
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
