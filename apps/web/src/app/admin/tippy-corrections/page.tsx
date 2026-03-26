"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { TabBar } from "@/components/ui/TabBar";
import { SkeletonTable } from "@/components/feedback/Skeleton";

interface ProposedCorrection {
  correction_id: string;
  entity_type: string;
  entity_id: string;
  entity_display_name: string | null;
  field_name: string;
  current_value: string | null;
  proposed_value: string;
  confidence: string;
  discovery_context: string;
  reasoning: string | null;
  evidence_sources: Array<{ source: string; value: string; confidence: string }>;
  status: string;
  conversation_id: string | null;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

interface CorrectionStats {
  proposed: number;
  approved: number;
  applied: number;
  rejected: number;
  total: number;
}

const STATUS_TABS = [
  { value: "proposed", label: "Proposed" },
  { value: "approved", label: "Approved" },
  { value: "applied", label: "Applied" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const CONFIDENCE_COLORS: Record<string, { bg: string; text: string }> = {
  high: { bg: "var(--success-bg)", text: "var(--success-text)" },
  medium: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  low: { bg: "var(--section-bg)", text: "var(--muted)" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  proposed: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  approved: { bg: "var(--info-bg)", text: "var(--info-text)" },
  applied: { bg: "var(--success-bg)", text: "var(--success-text)" },
  rejected: { bg: "var(--section-bg)", text: "var(--muted)" },
  auto_applied: { bg: "var(--success-bg)", text: "var(--success-text)" },
};

export default function TippyCorrectionsPage() {
  const [activeTab, setActiveTab] = useState("proposed");
  const [corrections, setCorrections] = useState<ProposedCorrection[]>([]);
  const [stats, setStats] = useState<CorrectionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCorrection, setSelectedCorrection] = useState<ProposedCorrection | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchCorrections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{
        corrections: ProposedCorrection[];
        stats: CorrectionStats;
      }>(`/api/admin/tippy-corrections?status=${activeTab}`);
      setCorrections(data.corrections);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load corrections");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchCorrections();
  }, [fetchCorrections]);

  const updateStatus = async (correctionId: string, newStatus: string) => {
    setUpdating(true);
    try {
      await postApi(`/api/admin/tippy-corrections/${correctionId}`, {
        status: newStatus,
        review_notes: reviewNotes || null,
      }, { method: "PATCH" });

      setSelectedCorrection(null);
      setReviewNotes("");
      fetchCorrections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const applyCorrection = async (correctionId: string) => {
    setUpdating(true);
    try {
      await postApi(`/api/admin/tippy-corrections/${correctionId}/apply`, {});

      setSelectedCorrection(null);
      fetchCorrections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "8px" }}>
        Tippy Proposed Corrections
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "24px" }}>
        Review and approve data corrections proposed by Tippy when finding discrepancies.
      </p>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--error-bg)",
            color: "var(--error-text)",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          {error}
          <button
            onClick={() => setError("")}
            style={{ marginLeft: "16px", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stats Summary */}
      {stats && (
        <div
          style={{
            display: "flex",
            gap: "16px",
            marginBottom: "24px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ background: "var(--warning-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.proposed}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Proposed</div>
          </div>
          <div style={{ background: "var(--info-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.approved}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Approved</div>
          </div>
          <div style={{ background: "var(--success-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.applied}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Applied</div>
          </div>
          <div style={{ background: "var(--section-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.rejected}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Rejected</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <TabBar
        tabs={STATUS_TABS.map((t) => ({
          id: t.value,
          label: t.label,
          count: t.value !== "all" && stats ? (stats[t.value as keyof CorrectionStats] as number) || 0 : undefined,
        }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* List */}
      {loading ? (
        <div style={{ padding: "2rem" }}><SkeletonTable rows={6} columns={4} /></div>
      ) : corrections.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
          No corrections found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {corrections.map((corr) => (
            <div
              key={corr.correction_id}
              onClick={() => {
                setSelectedCorrection(corr);
                setReviewNotes(corr.review_notes || "");
              }}
              style={{
                padding: "16px",
                background: "var(--card-bg)",
                borderRadius: "8px",
                cursor: "pointer",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    background: STATUS_COLORS[corr.status]?.bg || "var(--section-bg)",
                    color: STATUS_COLORS[corr.status]?.text || "var(--foreground)",
                  }}
                >
                  {corr.status}
                </span>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    background: CONFIDENCE_COLORS[corr.confidence]?.bg || "var(--section-bg)",
                    color: CONFIDENCE_COLORS[corr.confidence]?.text || "var(--foreground)",
                  }}
                >
                  {corr.confidence} confidence
                </span>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    background: "var(--section-bg)",
                  }}
                >
                  {corr.entity_type}
                </span>
              </div>

              <div style={{ fontWeight: 500, marginBottom: "4px" }}>
                {corr.entity_display_name || corr.entity_id}
              </div>

              <div style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "8px" }}>
                <strong>{corr.field_name}</strong>: &quot;{String(corr.current_value)}&quot; &rarr; &quot;{String(corr.proposed_value)}&quot;
              </div>

              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                {corr.discovery_context.substring(0, 100)}
                {corr.discovery_context.length > 100 ? "..." : ""}
              </div>

              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "8px" }}>
                {new Date(corr.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedCorrection && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
          onClick={() => setSelectedCorrection(null)}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: "12px",
              maxWidth: "700px",
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "16px" }}>Proposed Correction</h2>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: "4px",
                    fontSize: "14px",
                    background: STATUS_COLORS[selectedCorrection.status]?.bg,
                    color: STATUS_COLORS[selectedCorrection.status]?.text,
                  }}
                >
                  {selectedCorrection.status}
                </span>
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: "4px",
                    fontSize: "14px",
                    background: CONFIDENCE_COLORS[selectedCorrection.confidence]?.bg,
                    color: CONFIDENCE_COLORS[selectedCorrection.confidence]?.text,
                  }}
                >
                  {selectedCorrection.confidence} confidence
                </span>
              </div>

              <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Entity</h3>
              <p style={{ marginBottom: "12px" }}>
                <strong>{selectedCorrection.entity_type}</strong>:{" "}
                {selectedCorrection.entity_display_name || selectedCorrection.entity_id}
              </p>

              <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Proposed Change</h3>
              <div
                style={{
                  background: "var(--section-bg)",
                  padding: "12px",
                  borderRadius: "8px",
                  marginBottom: "12px",
                  fontFamily: "monospace",
                  fontSize: "13px",
                }}
              >
                <div>
                  <strong>{selectedCorrection.field_name}</strong>
                </div>
                <div style={{ color: "var(--error-text)" }}>
                  - {String(selectedCorrection.current_value) || "(empty)"}
                </div>
                <div style={{ color: "var(--success-text)" }}>
                  + {String(selectedCorrection.proposed_value)}
                </div>
              </div>

              <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Discovery Context</h3>
              <p style={{ marginBottom: "12px", color: "var(--muted)" }}>
                {selectedCorrection.discovery_context}
              </p>

              {selectedCorrection.reasoning && (
                <>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Reasoning</h3>
                  <p style={{ marginBottom: "12px", color: "var(--muted)" }}>
                    {selectedCorrection.reasoning}
                  </p>
                </>
              )}

              {selectedCorrection.evidence_sources && selectedCorrection.evidence_sources.length > 0 && (
                <>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Evidence Sources</h3>
                  <ul style={{ marginBottom: "12px", paddingLeft: "20px" }}>
                    {selectedCorrection.evidence_sources.map((src, i) => (
                      <li key={i} style={{ color: "var(--muted)", fontSize: "13px" }}>
                        <strong>{src.source}</strong>: {src.value} ({src.confidence} confidence)
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {selectedCorrection.status === "proposed" && (
                <>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Review Notes</h3>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Optional notes about this correction..."
                    style={{
                      width: "100%",
                      minHeight: "80px",
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      marginBottom: "16px",
                      fontFamily: "inherit",
                    }}
                  />
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => setSelectedCorrection(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                Close
              </button>

              {selectedCorrection.status === "proposed" && (
                <>
                  <button
                    onClick={() => updateStatus(selectedCorrection.correction_id, "rejected")}
                    disabled={updating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: "var(--error-bg)",
                      color: "var(--error-text)",
                      cursor: "pointer",
                    }}
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => updateStatus(selectedCorrection.correction_id, "approved")}
                    disabled={updating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: "var(--info-bg)",
                      color: "var(--info-text)",
                      cursor: "pointer",
                    }}
                  >
                    Approve
                  </button>
                </>
              )}

              {selectedCorrection.status === "approved" && (
                <button
                  onClick={() => applyCorrection(selectedCorrection.correction_id)}
                  disabled={updating}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: "var(--success-bg)",
                    color: "var(--success-text)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Apply Correction
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
