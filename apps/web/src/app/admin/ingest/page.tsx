"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { ClinicHQUploadModal } from "@/components/modals";

/**
 * FFS-746: Ingest Dashboard — upload history, batch status, retry, processing phase visibility
 * Replaces the legacy redirect to /admin/data?tab=processing
 */

// --- Types ---

interface BatchFile {
  upload_id: string;
  source_table: string;
  filename: string;
  status: string;
  processing_phase: string;
  rows_total: number | null;
  rows_inserted: number | null;
  rows_skipped: number | null;
  error_message: string | null;
  last_error: string | null;
  failed_at_step: string | null;
  retry_count: number;
  processed_at: string | null;
  post_processing_results: Record<string, unknown> | null;
}

interface Batch {
  batch_id: string;
  source_system: string;
  batch_status: string;
  files_count: number;
  files_completed: number;
  files_failed: number;
  total_rows: number;
  total_inserted: number;
  total_skipped: number;
  first_uploaded: string;
  last_processed: string | null;
  data_date_min: string | null;
  data_date_max: string | null;
  has_retry_available: boolean;
  max_retry_count: number;
  files: BatchFile[];
}

interface BatchesResponse {
  batches: Batch[];
  total: number;
  limit: number;
  offset: number;
}

// --- Constants ---

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  completed: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Completed" },
  failed: { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626", label: "Failed" },
  processing: { bg: "rgba(59, 130, 246, 0.1)", color: "#2563eb", label: "Processing" },
  pending: { bg: "rgba(107, 114, 128, 0.1)", color: "#6b7280", label: "Pending" },
  partial: { bg: "rgba(245, 158, 11, 0.1)", color: "#d97706", label: "Partial" },
};

const PHASE_LABELS: Record<string, string> = {
  pending: "Queued",
  staging: "Staging rows",
  staged: "Staged",
  post_processing: "Post-processing",
  completed: "Done",
  failed: "Failed",
};

const SOURCE_TABLE_LABELS: Record<string, { icon: string; label: string }> = {
  appointment_info: { icon: "1", label: "Appointments" },
  cat_info: { icon: "2", label: "Cats" },
  owner_info: { icon: "3", label: "Owners" },
};

// --- Page ---

export default function IngestDashboardPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const { error: toastError, success: toastSuccess } = useToast();

  const fetchBatches = useCallback(async () => {
    try {
      const data = await fetchApi<BatchesResponse>(
        `/api/ingest/batches?limit=25&status=${statusFilter}`
      );
      setBatches(data.batches);
      setTotal(data.total);
    } catch {
      toastError("Failed to load upload history");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toastError]);

  useEffect(() => {
    setLoading(true);
    fetchBatches();
  }, [fetchBatches]);

  // Auto-refresh while any batch is processing
  useEffect(() => {
    const hasProcessing = batches.some(b => b.batch_status === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(fetchBatches, 5000);
    return () => clearInterval(interval);
  }, [batches, fetchBatches]);

  const handleRetry = async (batchId: string) => {
    setRetrying(batchId);
    try {
      await postApi(`/api/ingest/batch/${batchId}/retry`, {});
      toastSuccess("Retry initiated — processing will restart");
      await fetchBatches();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return "-";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Ingest Dashboard</h1>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>
            Upload history, batch status, and pipeline health
          </p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          style={{
            padding: "10px 20px",
            background: "var(--primary, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Upload New Batch
        </button>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Batches", value: total, color: "#6b7280" },
          { label: "Completed", value: batches.filter(b => b.batch_status === "completed").length, color: "#059669" },
          { label: "Failed", value: batches.filter(b => b.batch_status === "failed").length, color: "#dc2626" },
          { label: "Processing", value: batches.filter(b => b.batch_status === "processing").length, color: "#2563eb" },
        ].map(stat => (
          <div
            key={stat.label}
            style={{
              padding: "1rem",
              background: "var(--card-bg, #fff)",
              borderRadius: "8px",
              border: "1px solid var(--border, #e5e7eb)",
              borderTop: `3px solid ${stat.color}`,
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{stat.value}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted, #6b7280)" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "1rem", borderBottom: "1px solid var(--border, #e5e7eb)", paddingBottom: "2px" }}>
        {["all", "completed", "failed", "processing"].map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            style={{
              padding: "8px 16px",
              border: "none",
              background: statusFilter === f ? "var(--primary, #2563eb)" : "transparent",
              color: statusFilter === f ? "#fff" : "var(--muted, #6b7280)",
              borderRadius: "6px 6px 0 0",
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Batch list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem" }}>
          <div className="spinner" style={{ width: "32px", height: "32px", margin: "0 auto 1rem" }} />
          <p className="text-muted">Loading upload history...</p>
        </div>
      ) : batches.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted, #6b7280)" }}>
          <p>No batches found{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.</p>
          <button
            onClick={() => setShowUploadModal(true)}
            style={{
              marginTop: "0.5rem",
              padding: "8px 16px",
              background: "var(--primary, #2563eb)",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Upload First Batch
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {batches.map(batch => {
            const isExpanded = expandedBatch === batch.batch_id;
            const statusStyle = STATUS_STYLES[batch.batch_status] || STATUS_STYLES.pending;

            return (
              <div
                key={batch.batch_id}
                style={{
                  background: "var(--card-bg, #fff)",
                  borderRadius: "8px",
                  border: "1px solid var(--border, #e5e7eb)",
                  overflow: "hidden",
                }}
              >
                {/* Batch row */}
                <div
                  onClick={() => setExpandedBatch(isExpanded ? null : batch.batch_id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(140px, 1fr) 100px 80px 100px 80px auto",
                    alignItems: "center",
                    gap: "12px",
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-secondary, #f9fafb)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  {/* Date + source */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                      {formatDate(batch.first_uploaded)}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted, #6b7280)" }}>
                      {formatTime(batch.first_uploaded)} &middot; {batch.source_system}
                    </div>
                  </div>

                  {/* Status badge */}
                  <div>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "3px 10px",
                        borderRadius: "12px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: statusStyle.bg,
                        color: statusStyle.color,
                      }}
                    >
                      {statusStyle.label}
                    </span>
                  </div>

                  {/* Files */}
                  <div style={{ fontSize: "0.85rem", textAlign: "center" }}>
                    <span style={{ fontWeight: 600 }}>{batch.files_completed}</span>
                    <span style={{ color: "var(--muted, #6b7280)" }}>/{batch.files_count}</span>
                  </div>

                  {/* Rows */}
                  <div style={{ fontSize: "0.85rem", textAlign: "center" }}>
                    <span style={{ fontWeight: 600 }}>{batch.total_inserted.toLocaleString()}</span>
                    <span style={{ fontSize: "0.7rem", color: "var(--muted, #6b7280)" }}> rows</span>
                  </div>

                  {/* Duration */}
                  <div style={{ fontSize: "0.8rem", color: "var(--muted, #6b7280)", textAlign: "center" }}>
                    {formatDuration(batch.first_uploaded, batch.last_processed)}
                  </div>

                  {/* Expand arrow */}
                  <div style={{ fontSize: "0.8rem", color: "var(--muted, #6b7280)", textAlign: "right" }}>
                    {isExpanded ? "\u25B2" : "\u25BC"}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid var(--border, #e5e7eb)", padding: "16px" }}>
                    {/* Data date range */}
                    {batch.data_date_min && (
                      <div style={{ fontSize: "0.8rem", color: "var(--muted, #6b7280)", marginBottom: "12px" }}>
                        Data range: {batch.data_date_min} to {batch.data_date_max}
                        {" "}&middot; Batch: <code style={{ fontSize: "0.7rem" }}>{batch.batch_id.slice(0, 8)}</code>
                      </div>
                    )}

                    {/* Per-file breakdown */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                      {batch.files.map((file) => {
                        const stLabel = SOURCE_TABLE_LABELS[file.source_table] || { icon: "?", label: file.source_table };
                        const fileStatus = STATUS_STYLES[file.status] || STATUS_STYLES.pending;
                        const phase = PHASE_LABELS[file.processing_phase] || file.processing_phase;

                        return (
                          <div
                            key={file.upload_id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "28px 1fr auto",
                              gap: "10px",
                              alignItems: "start",
                              padding: "10px 12px",
                              borderRadius: "6px",
                              background: "var(--bg-secondary, #f9fafb)",
                              border: file.status === "failed" ? "1px solid rgba(239, 68, 68, 0.2)" : "1px solid transparent",
                            }}
                          >
                            {/* Step number */}
                            <div style={{
                              width: "24px", height: "24px", borderRadius: "50%",
                              background: fileStatus.color, color: "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "0.7rem", fontWeight: 700,
                            }}>
                              {stLabel.icon}
                            </div>

                            {/* File details */}
                            <div>
                              <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                                {stLabel.label}
                                <span style={{ fontWeight: 400, fontSize: "0.75rem", color: "var(--muted, #6b7280)", marginLeft: "8px" }}>
                                  {file.filename}
                                </span>
                              </div>

                              {/* Counts */}
                              {file.rows_total != null && (
                                <div style={{ fontSize: "0.75rem", color: "var(--muted, #6b7280)", marginTop: "2px" }}>
                                  {file.rows_inserted ?? 0} inserted &middot; {file.rows_skipped ?? 0} skipped &middot; {file.rows_total} total
                                </div>
                              )}

                              {/* Error message */}
                              {(file.error_message || file.last_error) && (
                                <div style={{
                                  fontSize: "0.75rem", color: "#dc2626", marginTop: "4px",
                                  padding: "4px 8px", background: "rgba(239, 68, 68, 0.06)", borderRadius: "4px",
                                }}>
                                  {file.failed_at_step && <strong>Failed at: {file.failed_at_step} &mdash; </strong>}
                                  {file.last_error || file.error_message}
                                </div>
                              )}

                              {/* Post-processing highlights */}
                              {file.post_processing_results && !file.error_message && (
                                <PostProcessingHighlights results={file.post_processing_results} />
                              )}
                            </div>

                            {/* Phase badge */}
                            <div style={{ textAlign: "right" }}>
                              <span style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "10px",
                                fontSize: "0.65rem",
                                fontWeight: 600,
                                background: fileStatus.bg,
                                color: fileStatus.color,
                              }}>
                                {phase}
                              </span>
                              {file.retry_count > 0 && (
                                <div style={{ fontSize: "0.65rem", color: "var(--muted, #6b7280)", marginTop: "2px" }}>
                                  Retry {file.retry_count}/3
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Retry button */}
                    {batch.has_retry_available && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRetry(batch.batch_id); }}
                        disabled={retrying === batch.batch_id}
                        style={{
                          padding: "8px 16px",
                          background: retrying === batch.batch_id ? "var(--muted, #9ca3af)" : "#dc2626",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "0.85rem",
                          fontWeight: 500,
                          cursor: retrying === batch.batch_id ? "not-allowed" : "pointer",
                        }}
                      >
                        {retrying === batch.batch_id ? "Retrying..." : `Retry Failed Files (attempt ${batch.max_retry_count + 1}/3)`}
                      </button>
                    )}

                    {/* Max retries exhausted */}
                    {batch.batch_status === "failed" && !batch.has_retry_available && batch.max_retry_count >= 3 && (
                      <div style={{
                        padding: "8px 12px",
                        background: "rgba(239, 68, 68, 0.06)",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                        color: "#dc2626",
                      }}>
                        Max retries (3) exhausted. Manual investigation required.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      <ClinicHQUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={() => {
          setShowUploadModal(false);
          fetchBatches();
        }}
      />
    </div>
  );
}

// --- Post-processing highlights ---

function PostProcessingHighlights({ results }: { results: Record<string, unknown> }) {
  // Pick the most interesting counters to show
  const highlights: Array<{ label: string; value: number }> = [];

  const pick = (key: string, label: string) => {
    const v = results[key];
    if (typeof v === "number" && v > 0) highlights.push({ label, value: v });
  };

  pick("cats_created_or_matched", "Cats");
  pick("people_created_or_matched", "People");
  pick("places_created_or_matched", "Places");
  pick("new_appointments", "Appointments");
  pick("test_results_created", "Test results");
  pick("cats_created_without_chip", "Cats (no chip)");
  pick("recheck_cats_matched", "Recheck matches");

  // Entity linking
  const linking = results.entity_linking as Record<string, number> | undefined;
  if (linking) {
    if (linking.cats_linked_to_places > 0) highlights.push({ label: "Cat-place links", value: linking.cats_linked_to_places });
    if (linking.cats_linked_via_appointment_places > 0) highlights.push({ label: "Cat-appt links", value: linking.cats_linked_via_appointment_places });
  }

  if (highlights.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
      {highlights.map(h => (
        <span
          key={h.label}
          style={{
            fontSize: "0.65rem",
            padding: "2px 6px",
            borderRadius: "4px",
            background: "rgba(16, 185, 129, 0.08)",
            color: "#059669",
          }}
        >
          {h.value} {h.label}
        </span>
      ))}
    </div>
  );
}
