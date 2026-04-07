"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { useToast } from "@/components/feedback/Toast";

/**
 * MIG_3049 / FFS-862 / FFS-1150 Initiative 2
 *
 * Admin review queue for ops.ingest_skipped — rows that the ingest pipeline
 * refused or couldn't place. Canonical case: FFS-862 cancel/rebook cat_info
 * rows whose (Number, Date) has no matching appointment_info row.
 */

interface SkippedRow {
  skipped_id: string;
  source_system: string;
  source_table: string | null;
  source_record_id: string | null;
  source_date: string | null;
  file_upload_id: string | null;
  batch_id: string | null;
  payload: Record<string, unknown>;
  skip_reason: string;
  notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  resolution_notes: string | null;
  created_at: string;
}

interface SummaryRow {
  skip_reason: string;
  source_system: string;
  source_table: string | null;
  total: number;
  earliest_source_date: string | null;
  latest_source_date: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface ListResponse {
  rows: SkippedRow[];
  summary: SummaryRow[];
  limit: number;
  offset: number;
}

const REASON_LABELS: Record<string, string> = {
  ghost_signature: "Ghost signature (no ID, no client, no cat)",
  orphan_reference: "Orphan reference (FFS-862 cancel/rebook)",
  missing_date: "Missing appointment date",
  missing_id: "Missing source identifier",
};

export default function IngestSkippedPage() {
  const toast = useToast();
  const [rows, setRows] = useState<SkippedRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasonFilter, setReasonFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("unresolved");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (reasonFilter) params.set("reason", reasonFilter);
      if (sourceFilter) params.set("source_system", sourceFilter);
      params.set("status", statusFilter);
      const data = await fetchApi<ListResponse>(
        `/api/admin/ingest/skipped?${params.toString()}`
      );
      setRows(data.rows);
      setSummary(data.summary);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load"
      );
    } finally {
      setLoading(false);
    }
  }, [reasonFilter, sourceFilter, statusFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(
    skipped_id: string,
    resolution: "linked" | "force_created" | "dismissed",
    resolution_notes?: string
  ) {
    try {
      await postApi("/api/admin/ingest/skipped", {
        skipped_id,
        resolution,
        resolution_notes,
      }, { method: "PATCH" });
      toast.success(`Marked as ${resolution}`);
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to resolve"
      );
    }
  }

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, margin: 0 }}>
          Ingest Skipped Queue
        </h1>
        <p
          style={{
            marginTop: "8px",
            color: "var(--text-secondary, #6b7280)",
            fontSize: "14px",
          }}
        >
          Rows the ingest pipeline refused or could not place. Canonical case:
          FFS-862 cancel/rebook where a <code>cat_info</code> row has no
          matching <code>appointment_info</code> row. Tracked in{" "}
          <code>ops.ingest_skipped</code> (MIG_3049).
        </p>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        {summary.length === 0 && !loading && (
          <div
            style={{
              padding: "16px",
              background: "var(--success-bg, #d1fae5)",
              color: "var(--success-text, #065f46)",
              borderRadius: "8px",
              gridColumn: "1 / -1",
            }}
          >
            No unresolved skipped rows. Ingest pipeline is clean.
          </div>
        )}
        {summary.map((s) => (
          <div
            key={`${s.skip_reason}-${s.source_system}-${s.source_table}`}
            style={{
              padding: "16px",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "8px",
              background: "var(--bg-elevated, #ffffff)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary, #6b7280)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {s.source_system} · {s.source_table}
            </div>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                marginTop: "4px",
              }}
            >
              {REASON_LABELS[s.skip_reason] || s.skip_reason}
            </div>
            <div
              style={{ fontSize: "28px", fontWeight: 700, marginTop: "8px" }}
            >
              {s.total}
            </div>
            {s.earliest_source_date && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-tertiary, #9ca3af)",
                  marginTop: "4px",
                }}
              >
                {s.earliest_source_date} → {s.latest_source_date}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "6px" }}
        >
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "6px" }}
        >
          <option value="">All reasons</option>
          <option value="ghost_signature">Ghost signature</option>
          <option value="orphan_reference">Orphan reference</option>
          <option value="missing_date">Missing date</option>
          <option value="missing_id">Missing ID</option>
        </select>
        <input
          type="text"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          placeholder="source_system (e.g., clinichq)"
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            minWidth: "240px",
          }}
        />
      </div>

      {/* Rows */}
      {loading ? (
        <SkeletonList items={5} />
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: "var(--text-secondary, #6b7280)",
          }}
        >
          No rows match the current filters.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {rows.map((row) => {
            const expanded = expandedId === row.skipped_id;
            return (
              <div
                key={row.skipped_id}
                style={{
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  background: "var(--bg-elevated, #ffffff)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "16px",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setExpandedId(expanded ? null : row.skipped_id)
                  }
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                      }}
                    >
                      {REASON_LABELS[row.skip_reason] || row.skip_reason}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--text-secondary, #6b7280)",
                        marginTop: "4px",
                      }}
                    >
                      {row.source_system} · {row.source_table || "—"} ·{" "}
                      {row.source_record_id || "no id"}
                      {row.source_date && ` · ${row.source_date}`}
                    </div>
                    {row.notes && (
                      <div
                        style={{
                          fontSize: "13px",
                          marginTop: "6px",
                          color: "var(--text-secondary, #4b5563)",
                        }}
                      >
                        {row.notes}
                      </div>
                    )}
                  </div>
                  {row.resolved_at ? (
                    <div
                      style={{
                        padding: "4px 10px",
                        borderRadius: "12px",
                        background: "var(--success-bg, #d1fae5)",
                        color: "var(--success-text, #065f46)",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      {row.resolution}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resolve(row.skipped_id, "dismissed", "no action needed");
                        }}
                        style={{
                          padding: "6px 10px",
                          fontSize: "12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const notes = prompt(
                            "Resolution notes (how was this linked/created)?"
                          );
                          if (notes !== null) {
                            resolve(row.skipped_id, "linked", notes);
                          }
                        }}
                        style={{
                          padding: "6px 10px",
                          fontSize: "12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Mark Linked
                      </button>
                    </div>
                  )}
                </div>
                {expanded && (
                  <pre
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      background: "var(--bg-subtle, #f9fafb)",
                      borderRadius: "6px",
                      fontSize: "11px",
                      overflow: "auto",
                      maxHeight: "400px",
                    }}
                  >
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
