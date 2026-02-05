"use client";

import { useState, useEffect, useCallback } from "react";
import { formatPhone } from "@/lib/formatters";

interface TippyDraft {
  draft_id: string;
  created_at: string;
  expires_at: string;
  is_expired: boolean;
  hours_until_expiry: number;
  raw_address: string;
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  estimated_cat_count: number | null;
  summary: string;
  notes: string | null;
  has_kittens: boolean;
  priority: string;
  tippy_reasoning: string;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_context: {
    resolved_place_name?: string;
    resolved_address?: string;
    total_requests?: number;
    active_requests?: number;
    cats_already_altered?: number;
    latest_request_date?: string;
    tippy_summary?: string;
  } | null;
  status: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  promoted_request_id: string | null;
  created_by_staff_id: string;
  created_by_name: string;
  conversation_id: string | null;
  existing_request_count: number;
  active_request_count: number;
}

interface DraftStats {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  expired_count: number;
  approved_this_week: number;
  rejected_this_week: number;
  approval_rate_pct: number | null;
  avg_review_hours: number | null;
}

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "all", label: "All" },
];

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  urgent: { bg: "#fee2e2", text: "#b91c1c" },
  high: { bg: "#fef3c7", text: "#b45309" },
  normal: { bg: "var(--section-bg)", text: "var(--muted)" },
  low: { bg: "var(--section-bg)", text: "var(--muted)" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  approved: { bg: "var(--success-bg)", text: "var(--success-text)" },
  rejected: { bg: "var(--section-bg)", text: "var(--muted)" },
  expired: { bg: "#fee2e2", text: "#b91c1c" },
};

export default function TippyDraftsPage() {
  const [activeTab, setActiveTab] = useState("pending");
  const [drafts, setDrafts] = useState<TippyDraft[]>([]);
  const [stats, setStats] = useState<DraftStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDraft, setSelectedDraft] = useState<TippyDraft | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [updating, setUpdating] = useState(false);
  const [overrideAddress, setOverrideAddress] = useState("");
  const [overrideCatCount, setOverrideCatCount] = useState<number | "">("");
  const [overridePriority, setOverridePriority] = useState("");

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tippy-drafts?status=${activeTab}`);
      if (!res.ok) throw new Error("Failed to fetch drafts");
      const data = await res.json();
      setDrafts(data.drafts);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const handleDraftAction = async (draftId: string, action: "approve" | "reject") => {
    setUpdating(true);
    try {
      const body: Record<string, unknown> = {
        action,
        review_notes: reviewNotes || null,
      };

      if (action === "approve") {
        const overrides: Record<string, unknown> = {};
        if (overrideAddress) overrides.address = overrideAddress;
        if (overrideCatCount !== "") overrides.cat_count = overrideCatCount;
        if (overridePriority) overrides.priority = overridePriority;
        if (Object.keys(overrides).length > 0) {
          body.overrides = overrides;
        }
      }

      const res = await fetch(`/api/admin/tippy-drafts/${draftId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process draft");

      // Refresh list
      fetchDrafts();
      setSelectedDraft(null);
      setReviewNotes("");
      setOverrideAddress("");
      setOverrideCatCount("");
      setOverridePriority("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process draft");
    } finally {
      setUpdating(false);
    }
  };

  const formatExpiry = (hoursUntil: number) => {
    if (hoursUntil < 0) return "Expired";
    if (hoursUntil < 24) return `${Math.round(hoursUntil)}h left`;
    return `${Math.round(hoursUntil / 24)}d left`;
  };

  return (
    <div style={{ padding: "24px 0" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "8px" }}>
          Tippy Draft Requests
        </h1>
        <p style={{ color: "var(--muted)" }}>
          Review and approve requests created by Tippy from staff conversations
        </p>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Pending Review</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>{stats.pending_count}</div>
          </div>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Approved This Week</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--success-text)" }}>
              {stats.approved_this_week}
            </div>
          </div>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Approval Rate</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
              {stats.approval_rate_pct ? `${stats.approval_rate_pct}%` : "—"}
            </div>
          </div>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Avg Review Time</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
              {stats.avg_review_hours ? `${Math.round(stats.avg_review_hours)}h` : "—"}
            </div>
          </div>
        </div>
      )}

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
            {stats && tab.value !== "all" && (
              <span
                style={{
                  background: activeTab === tab.value ? "rgba(255,255,255,0.2)" : "var(--section-bg)",
                  padding: "2px 6px",
                  borderRadius: "10px",
                  fontSize: "0.75rem",
                }}
              >
                {stats[`${tab.value}_count` as keyof DraftStats] || 0}
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
          <button
            onClick={() => setError("")}
            style={{
              marginLeft: "12px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          Loading drafts...
        </div>
      ) : drafts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          No {activeTab === "all" ? "" : activeTab} drafts found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {drafts.map((draft) => (
            <div
              key={draft.draft_id}
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: "12px",
                padding: "16px",
                cursor: draft.status === "pending" ? "pointer" : "default",
                opacity: draft.is_expired ? 0.7 : 1,
              }}
              onClick={() => draft.status === "pending" && setSelectedDraft(draft)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "12px",
                }}
              >
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: PRIORITY_COLORS[draft.priority]?.bg || "var(--section-bg)",
                      color: PRIORITY_COLORS[draft.priority]?.text || "var(--muted)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      textTransform: "uppercase",
                    }}
                  >
                    {draft.priority}
                  </span>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: STATUS_COLORS[draft.status]?.bg || "var(--section-bg)",
                      color: STATUS_COLORS[draft.status]?.text || "var(--muted)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      textTransform: "capitalize",
                    }}
                  >
                    {draft.status}
                  </span>
                  {draft.has_kittens && (
                    <span
                      style={{
                        padding: "4px 8px",
                        background: "#fef3c7",
                        color: "#b45309",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                      }}
                    >
                      Has Kittens
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: draft.hours_until_expiry < 24 ? "#b91c1c" : "var(--muted)",
                    fontWeight: draft.hours_until_expiry < 24 ? 500 : 400,
                  }}
                >
                  {formatExpiry(draft.hours_until_expiry)}
                </span>
              </div>

              {/* Address & Contact */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "1rem", fontWeight: 500 }}>{draft.raw_address}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>
                  {draft.requester_name && <span>{draft.requester_name}</span>}
                  {draft.requester_phone && <span> • {formatPhone(draft.requester_phone)}</span>}
                  {draft.estimated_cat_count && <span> • ~{draft.estimated_cat_count} cats</span>}
                </div>
              </div>

              {/* Summary */}
              <div
                style={{
                  background: "var(--section-bg)",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                  marginBottom: "12px",
                }}
              >
                {draft.summary}
              </div>

              {/* Existing place context warning */}
              {draft.active_request_count > 0 && (
                <div
                  style={{
                    background: "#fef3c7",
                    border: "1px solid #f59e0b",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    marginBottom: "12px",
                  }}
                >
                  <strong>Note:</strong> This location has {draft.active_request_count} active
                  request(s) and {draft.place_context?.cats_already_altered || 0} cats already
                  altered.
                </div>
              )}

              {/* Footer */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                }}
              >
                <span>Created by {draft.created_by_name}</span>
                <span>{new Date(draft.created_at).toLocaleDateString()}</span>
              </div>

              {/* Approved/rejected info */}
              {draft.status !== "pending" && draft.reviewed_by_name && (
                <div
                  style={{
                    marginTop: "12px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--border)",
                    fontSize: "0.85rem",
                    color: "var(--muted)",
                  }}
                >
                  {draft.status === "approved" ? "Approved" : "Rejected"} by {draft.reviewed_by_name}
                  {draft.review_notes && ` — "${draft.review_notes}"`}
                  {draft.promoted_request_id && (
                    <a
                      href={`/requests/${draft.promoted_request_id}`}
                      style={{ marginLeft: "8px", color: "var(--primary)" }}
                    >
                      View Request →
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Detail/Approval Modal */}
      {selectedDraft && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "16px",
          }}
          onClick={() => setSelectedDraft(null)}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "650px",
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
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Review Draft Request</h2>
              <button
                onClick={() => setSelectedDraft(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  color: "var(--muted)",
                }}
              >
                &times;
              </button>
            </div>

            {/* Address */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Address
              </div>
              <div style={{ fontSize: "1rem" }}>{selectedDraft.raw_address}</div>
              {selectedDraft.place_name && (
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>
                  Resolved to: {selectedDraft.place_name}
                </div>
              )}
            </div>

            {/* Contact */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Contact Information
              </div>
              <div style={{ fontSize: "0.9rem" }}>
                {selectedDraft.requester_name || "No name provided"}
                {selectedDraft.requester_phone && ` • ${formatPhone(selectedDraft.requester_phone)}`}
                {selectedDraft.requester_email && ` • ${selectedDraft.requester_email}`}
              </div>
            </div>

            {/* Summary & Notes */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Summary
              </div>
              <div
                style={{
                  background: "var(--section-bg)",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                }}
              >
                {selectedDraft.summary}
              </div>
            </div>

            {selectedDraft.notes && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Additional Notes
                </div>
                <div
                  style={{
                    background: "var(--section-bg)",
                    padding: "12px",
                    borderRadius: "8px",
                    fontSize: "0.9rem",
                  }}
                >
                  {selectedDraft.notes}
                </div>
              </div>
            )}

            {/* Tippy's Reasoning */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Tippy's Reasoning
              </div>
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #3b82f6",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                }}
              >
                {selectedDraft.tippy_reasoning}
              </div>
            </div>

            {/* Existing Place Context */}
            {selectedDraft.place_context && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Existing TNR History at Location
                </div>
                <div
                  style={{
                    background:
                      selectedDraft.active_request_count > 0 ? "#fef3c7" : "var(--section-bg)",
                    border:
                      selectedDraft.active_request_count > 0
                        ? "1px solid #f59e0b"
                        : "1px solid var(--border)",
                    padding: "12px",
                    borderRadius: "8px",
                    fontSize: "0.9rem",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <span style={{ color: "var(--muted)" }}>Total Requests:</span>{" "}
                      {selectedDraft.place_context.total_requests || 0}
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)" }}>Active Requests:</span>{" "}
                      <span
                        style={{
                          fontWeight: selectedDraft.active_request_count > 0 ? 600 : 400,
                          color: selectedDraft.active_request_count > 0 ? "#b45309" : "inherit",
                        }}
                      >
                        {selectedDraft.active_request_count}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)" }}>Cats Already Altered:</span>{" "}
                      {selectedDraft.place_context.cats_already_altered || 0}
                    </div>
                    {selectedDraft.place_context.latest_request_date && (
                      <div>
                        <span style={{ color: "var(--muted)" }}>Latest Request:</span>{" "}
                        {new Date(selectedDraft.place_context.latest_request_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Overrides (only if approving) */}
            <div
              style={{
                marginBottom: "16px",
                padding: "16px",
                background: "var(--section-bg)",
                borderRadius: "8px",
              }}
            >
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "12px" }}>
                Overrides (optional, for approval only)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label
                    style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}
                  >
                    Override Address
                  </label>
                  <input
                    type="text"
                    value={overrideAddress}
                    onChange={(e) => setOverrideAddress(e.target.value)}
                    placeholder={selectedDraft.raw_address}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}
                  >
                    Override Cat Count
                  </label>
                  <input
                    type="number"
                    value={overrideCatCount}
                    onChange={(e) =>
                      setOverrideCatCount(e.target.value === "" ? "" : parseInt(e.target.value))
                    }
                    placeholder={String(selectedDraft.estimated_cat_count || "")}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}
                  >
                    Override Priority
                  </label>
                  <select
                    value={overridePriority}
                    onChange={(e) => setOverridePriority(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  >
                    <option value="">Keep {selectedDraft.priority}</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Review Notes */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Review Notes (optional)
              </div>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add notes about your decision..."
                rows={2}
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

            {/* Actions */}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => handleDraftAction(selectedDraft.draft_id, "approve")}
                disabled={updating || selectedDraft.is_expired}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: selectedDraft.is_expired ? "var(--section-bg)" : "var(--success-text)",
                  color: selectedDraft.is_expired ? "var(--muted)" : "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: updating || selectedDraft.is_expired ? "not-allowed" : "pointer",
                  fontWeight: 500,
                  fontSize: "0.9rem",
                }}
              >
                {updating ? "Processing..." : "Approve & Create Request"}
              </button>
              <button
                onClick={() => handleDraftAction(selectedDraft.draft_id, "reject")}
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
                  fontSize: "0.9rem",
                }}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
