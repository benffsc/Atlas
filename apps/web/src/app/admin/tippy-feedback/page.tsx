"use client";

import { useState, useEffect, useCallback } from "react";

interface TippyFeedback {
  feedback_id: string;
  staff_id: string;
  staff_name: string;
  tippy_message: string;
  user_correction: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  feedback_type: string;
  status: string;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  data_improvement_id: string | null;
  created_at: string;
}

interface FeedbackCounts {
  pending: number;
  reviewed: number;
  resolved: number;
  rejected: number;
  total: number;
}

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  incorrect_count: "Wrong Count",
  incorrect_status: "Wrong Status",
  incorrect_location: "Wrong Location",
  incorrect_person: "Wrong Person",
  outdated_info: "Outdated Info",
  other: "Other",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  reviewed: { bg: "var(--info-bg)", text: "var(--info-text)" },
  resolved: { bg: "var(--success-bg)", text: "var(--success-text)" },
  rejected: { bg: "var(--section-bg)", text: "var(--muted)" },
};

export default function TippyFeedbackPage() {
  const [activeTab, setActiveTab] = useState("pending");
  const [feedback, setFeedback] = useState<TippyFeedback[]>([]);
  const [counts, setCounts] = useState<FeedbackCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFeedback, setSelectedFeedback] = useState<TippyFeedback | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tippy-feedback?status=${activeTab}`);
      if (!res.ok) throw new Error("Failed to fetch feedback");
      const data = await res.json();
      setFeedback(data.feedback);
      setCounts(data.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const updateStatus = async (feedbackId: string, newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/tippy-feedback/${feedbackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          review_notes: reviewNotes || null,
        }),
      });

      if (!res.ok) throw new Error("Failed to update");

      // Refresh list
      fetchFeedback();
      setSelectedFeedback(null);
      setReviewNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setUpdating(false);
    }
  };

  const getEntityLink = (fb: TippyFeedback) => {
    if (!fb.entity_type || !fb.entity_id) return null;
    const paths: Record<string, string> = {
      place: "/places",
      cat: "/cats",
      person: "/people",
      request: "/requests",
    };
    const path = paths[fb.entity_type];
    if (!path) return null;
    return `${path}/${fb.entity_id}`;
  };

  return (
    <div style={{ padding: "24px 0" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "8px" }}>
          Tippy Feedback Review
        </h1>
        <p style={{ color: "var(--muted)" }}>
          Staff-reported data discrepancies from Tippy conversations
        </p>
      </div>

      {/* Status Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "24px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "12px",
        }}
      >
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: "8px 16px",
              background: activeTab === tab.value ? "var(--primary)" : "transparent",
              color: activeTab === tab.value ? "var(--primary-foreground)" : "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {tab.label}
            {counts && tab.value !== "all" && (
              <span
                style={{
                  background: activeTab === tab.value ? "rgba(255,255,255,0.2)" : "var(--section-bg)",
                  padding: "2px 6px",
                  borderRadius: "10px",
                  fontSize: "0.75rem",
                }}
              >
                {counts[tab.value as keyof FeedbackCounts]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--danger-bg)",
            color: "var(--danger-text)",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          Loading feedback...
        </div>
      ) : feedback.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          No {activeTab === "all" ? "" : activeTab} feedback found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {feedback.map((fb) => (
            <div
              key={fb.feedback_id}
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: "12px",
                padding: "16px",
                cursor: "pointer",
              }}
              onClick={() => setSelectedFeedback(fb)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "12px",
                }}
              >
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: STATUS_COLORS[fb.status]?.bg || "var(--section-bg)",
                      color: STATUS_COLORS[fb.status]?.text || "var(--muted)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      textTransform: "capitalize",
                    }}
                  >
                    {fb.status}
                  </span>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: "var(--section-bg)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                    }}
                  >
                    {FEEDBACK_TYPE_LABELS[fb.feedback_type] || fb.feedback_type}
                  </span>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {new Date(fb.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Tippy's message */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
                  Tippy said:
                </div>
                <div
                  style={{
                    background: "var(--section-bg)",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    maxHeight: "60px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {fb.tippy_message.slice(0, 200)}
                  {fb.tippy_message.length > 200 && "..."}
                </div>
              </div>

              {/* User correction */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
                  Staff correction:
                </div>
                <div style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                  {fb.user_correction}
                </div>
              </div>

              {/* Entity link */}
              {fb.entity_type && (
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    Affects:
                  </span>
                  {getEntityLink(fb) ? (
                    <a
                      href={getEntityLink(fb)!}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--primary)",
                        textDecoration: "none",
                      }}
                    >
                      {fb.entity_name || fb.entity_id} ({fb.entity_type})
                    </a>
                  ) : (
                    <span style={{ fontSize: "0.85rem" }}>
                      {fb.entity_name || fb.entity_id} ({fb.entity_type})
                    </span>
                  )}
                </div>
              )}

              {/* Reporter */}
              <div
                style={{
                  marginTop: "12px",
                  paddingTop: "12px",
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                }}
              >
                <span>Reported by: {fb.staff_name}</span>
                {fb.reviewer_name && <span>Reviewed by: {fb.reviewer_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedFeedback && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setSelectedFeedback(null)}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: "12px",
              width: "600px",
              maxHeight: "90vh",
              overflow: "auto",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Feedback Detail</h2>
              <button
                onClick={() => setSelectedFeedback(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                }}
              >
                x
              </button>
            </div>

            {/* Full Tippy message */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Tippy's Response:
              </div>
              <div
                style={{
                  background: "var(--section-bg)",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "0.875rem",
                  maxHeight: "150px",
                  overflow: "auto",
                }}
              >
                {selectedFeedback.tippy_message}
              </div>
            </div>

            {/* Full correction */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Staff's Correction:
              </div>
              <div
                style={{
                  background: "var(--warning-bg)",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "0.875rem",
                }}
              >
                {selectedFeedback.user_correction}
              </div>
            </div>

            {/* Entity info */}
            {selectedFeedback.entity_type && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Affected Record:
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: "var(--section-bg)",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      textTransform: "capitalize",
                    }}
                  >
                    {selectedFeedback.entity_type}
                  </span>
                  {getEntityLink(selectedFeedback) && (
                    <a
                      href={getEntityLink(selectedFeedback)!}
                      style={{ color: "var(--primary)", textDecoration: "none" }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {selectedFeedback.entity_name || selectedFeedback.entity_id} →
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Data improvement link */}
            {selectedFeedback.data_improvement_id && (
              <div style={{ marginBottom: "16px" }}>
                <a
                  href={`/admin/data-improvements?id=${selectedFeedback.data_improvement_id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    color: "var(--primary)",
                    fontSize: "0.875rem",
                  }}
                >
                  View linked data improvement →
                </a>
              </div>
            )}

            {/* Review notes */}
            {selectedFeedback.status === "pending" && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Review Notes (optional):
                </div>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add notes about this feedback..."
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontSize: "0.875rem",
                    resize: "vertical",
                  }}
                />
              </div>
            )}

            {/* Existing review notes */}
            {selectedFeedback.review_notes && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Review Notes:
                </div>
                <div
                  style={{
                    background: "var(--section-bg)",
                    padding: "12px",
                    borderRadius: "8px",
                    fontSize: "0.875rem",
                  }}
                >
                  {selectedFeedback.review_notes}
                </div>
              </div>
            )}

            {/* Actions */}
            {selectedFeedback.status === "pending" && (
              <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
                <button
                  onClick={() => updateStatus(selectedFeedback.feedback_id, "resolved")}
                  disabled={updating}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "var(--success-text)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    cursor: updating ? "not-allowed" : "pointer",
                    fontWeight: 500,
                  }}
                >
                  Mark Resolved
                </button>
                <button
                  onClick={() => updateStatus(selectedFeedback.feedback_id, "reviewed")}
                  disabled={updating}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "var(--info-text)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    cursor: updating ? "not-allowed" : "pointer",
                    fontWeight: 500,
                  }}
                >
                  Mark Reviewed
                </button>
                <button
                  onClick={() => updateStatus(selectedFeedback.feedback_id, "rejected")}
                  disabled={updating}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    cursor: updating ? "not-allowed" : "pointer",
                    fontWeight: 500,
                  }}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
