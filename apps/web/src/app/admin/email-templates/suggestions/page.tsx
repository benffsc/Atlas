"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import { useToast } from "@/components/feedback/Toast";

interface TemplateSuggestion {
  suggestion_id: string;
  template_id: string;
  template_key: string;
  template_name: string;
  suggested_name: string | null;
  suggested_subject: string | null;
  suggested_body_html: string | null;
  suggested_body_text: string | null;
  suggestion_notes: string | null;
  status: string;
  current_subject: string | null;
  current_body_html: string | null;
  suggested_by_name: string;
  suggested_by_email: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

export default function TemplateSuggestionsPage() {
  const { addToast } = useToast();
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selectedSuggestion, setSelectedSuggestion] = useState<TemplateSuggestion | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);

      const data = await fetchApi<{ suggestions: TemplateSuggestion[] }>(`/api/admin/email-templates/suggestions?${params}`);
      setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error("Failed to fetch suggestions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuggestions();
  }, [statusFilter]);

  const handleAction = async (action: "approve" | "reject") => {
    if (!selectedSuggestion) return;
    setProcessing(true);

    try {
      await postApi(`/api/admin/email-templates/suggestions/${selectedSuggestion.suggestion_id}`, {
        action,
        review_notes: reviewNotes,
      }, { method: "PATCH" });

      setSelectedSuggestion(null);
      setReviewNotes("");
      fetchSuggestions();
    } catch (err) {
      console.error("Failed to process suggestion:", err);
      addToast({ type: "error", message: err instanceof Error ? err.message : "Failed to process suggestion" });
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <Link href="/admin/email-templates" className="text-muted" style={{ textDecoration: "none" }}>
              Templates
            </Link>
            <span className="text-muted">/</span>
            <h1 style={{ margin: 0 }}>Suggestions</h1>
          </div>
          <p className="text-muted">Review and approve staff template suggestions</p>
        </div>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: "1rem" }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input"
          style={{ width: "auto" }}
        >
          <option value="pending">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="all">All</option>
        </select>
      </div>

      {/* Suggestions List */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem" }}>
            <SkeletonTable rows={5} columns={3} />
          </div>
        ) : suggestions.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center" }} className="text-muted">
            {statusFilter === "pending" ? "No pending suggestions" : "No suggestions found"}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--card-border)" }}>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Template</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Changes</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Suggested By</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Date</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Status</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((suggestion) => (
                <tr
                  key={suggestion.suggestion_id}
                  style={{ borderTop: "1px solid var(--card-border)" }}
                >
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{suggestion.template_name}</div>
                    <div className="text-muted" style={{ fontSize: "0.8rem" }}>{suggestion.template_key}</div>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {suggestion.suggested_name && <ChangeBadge label="Name" />}
                      {suggestion.suggested_subject && <ChangeBadge label="Subject" />}
                      {suggestion.suggested_body_html && <ChangeBadge label="Body" />}
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }}>
                    {suggestion.suggested_by_name}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }} className="text-muted">
                    {formatDate(suggestion.created_at)}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <StatusBadge status={suggestion.status} />
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <button
                      onClick={() => setSelectedSuggestion(suggestion)}
                      className="btn btn-secondary"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                    >
                      {suggestion.status === "pending" ? "Review" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Review Modal */}
      {selectedSuggestion && (
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
          onClick={() => setSelectedSuggestion(null)}
        >
          <div
            className="card"
            style={{
              width: "90%",
              maxWidth: "900px",
              maxHeight: "90vh",
              overflow: "auto",
              padding: "1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ margin: 0 }}>Review Suggestion</h2>
                <p className="text-muted" style={{ margin: "0.25rem 0 0 0" }}>
                  {selectedSuggestion.template_name} by {selectedSuggestion.suggested_by_name}
                </p>
              </div>
              <button
                onClick={() => setSelectedSuggestion(null)}
                className="btn btn-secondary"
                style={{ padding: "0.25rem 0.5rem" }}
              >
                ×
              </button>
            </div>

            {/* Staff Notes */}
            {selectedSuggestion.suggestion_notes && (
              <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "#eff6ff", borderRadius: "6px" }}>
                <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }}>Staff Notes:</div>
                <div style={{ fontSize: "0.9rem" }}>{selectedSuggestion.suggestion_notes}</div>
              </div>
            )}

            {/* Comparison */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
              {/* Subject Change */}
              {selectedSuggestion.suggested_subject && (
                <>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Current Subject</div>
                    <div style={{ padding: "0.75rem", background: "var(--card-border)", borderRadius: "6px", fontSize: "0.9rem" }}>
                      {selectedSuggestion.current_subject || "(empty)"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.5rem", color: "#166534" }}>Suggested Subject</div>
                    <div style={{ padding: "0.75rem", background: "#dcfce7", borderRadius: "6px", fontSize: "0.9rem" }}>
                      {selectedSuggestion.suggested_subject}
                    </div>
                  </div>
                </>
              )}

              {/* Body Change */}
              {selectedSuggestion.suggested_body_html && (
                <>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Current Body</div>
                    <div
                      style={{ padding: "0.75rem", background: "var(--card-border)", borderRadius: "6px", fontSize: "0.875rem", maxHeight: "300px", overflow: "auto" }}
                      dangerouslySetInnerHTML={{ __html: selectedSuggestion.current_body_html || "(empty)" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.5rem", color: "#166534" }}>Suggested Body</div>
                    <div
                      style={{ padding: "0.75rem", background: "#dcfce7", borderRadius: "6px", fontSize: "0.875rem", maxHeight: "300px", overflow: "auto" }}
                      dangerouslySetInnerHTML={{ __html: selectedSuggestion.suggested_body_html }}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            {selectedSuggestion.status === "pending" && (
              <div style={{ borderTop: "1px solid var(--card-border)", paddingTop: "1rem" }}>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                    Review Notes (optional)
                  </label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="input"
                    rows={2}
                    placeholder="Add notes for the suggester..."
                  />
                </div>
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => handleAction("reject")}
                    disabled={processing}
                    className="btn"
                    style={{ background: "#fee2e2", color: "#991b1b" }}
                  >
                    {processing ? "..." : "Reject"}
                  </button>
                  <button
                    onClick={() => handleAction("approve")}
                    disabled={processing}
                    className="btn btn-primary"
                  >
                    {processing ? "..." : "Approve & Apply"}
                  </button>
                </div>
              </div>
            )}

            {/* Review Info (for non-pending) */}
            {selectedSuggestion.status !== "pending" && selectedSuggestion.reviewed_at && (
              <div style={{ borderTop: "1px solid var(--card-border)", paddingTop: "1rem" }} className="text-muted">
                <div>
                  {selectedSuggestion.status === "approved" ? "Approved" : "Rejected"} on{" "}
                  {formatDate(selectedSuggestion.reviewed_at)}
                </div>
                {selectedSuggestion.review_notes && (
                  <div style={{ marginTop: "0.5rem" }}>Notes: {selectedSuggestion.review_notes}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: "#fef3c7", text: "#92400e" },
    approved: { bg: "#dcfce7", text: "#166534" },
    rejected: { bg: "#fee2e2", text: "#991b1b" },
    withdrawn: { bg: "#f3f4f6", text: "#374151" },
  };
  const style = colors[status] || colors.pending;

  return (
    <span
      style={{
        padding: "0.25rem 0.5rem",
        borderRadius: "4px",
        fontSize: "0.75rem",
        fontWeight: 500,
        background: style.bg,
        color: style.text,
      }}
    >
      {status}
    </span>
  );
}

function ChangeBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: "0.125rem 0.375rem",
        borderRadius: "4px",
        fontSize: "0.7rem",
        fontWeight: 500,
        background: "#dbeafe",
        color: "#1e40af",
      }}
    >
      {label}
    </span>
  );
}
