"use client";

import { useState, useEffect, useCallback } from "react";

interface TrapperReportSubmission {
  submission_id: string;
  reporter_email: string | null;
  reporter_person_id: string | null;
  reporter_name: string | null;
  reporter_match_confidence: number | null;
  content_type: string;
  content_preview: string | null;
  received_at: string;
  extraction_status: string;
  extracted_at: string | null;
  total_items: string;
  pending_items: string;
  approved_items: string;
  rejected_items: string;
  committed_items: string;
}

interface TrapperReportItem {
  item_id: string;
  submission_id: string;
  item_type: string;
  target_entity_type: string;
  target_entity_id: string | null;
  target_entity_name: string | null;
  current_request_status: string | null;
  match_confidence: number | null;
  match_candidates: Array<{
    person_id?: string;
    place_id?: string;
    request_id?: string;
    display_name?: string;
    formatted_address?: string;
    match_score: number;
    matched_signals?: string[];
    context_notes?: string;
  }>;
  extracted_text: string | null;
  extracted_data: Record<string, unknown>;
  review_status: string;
  final_entity_id: string | null;
  final_data: Record<string, unknown> | null;
  committed_at: string | null;
}

interface SubmissionDetail {
  submission: {
    submission_id: string;
    reporter_email: string | null;
    reporter_person_id: string | null;
    reporter_name: string | null;
    reporter_match_confidence: number | null;
    reporter_match_candidates: Array<{
      person_id: string;
      display_name: string;
      match_score: number;
    }>;
    raw_content: string;
    content_type: string;
    received_at: string;
    extraction_status: string;
    extracted_at: string | null;
    ai_extraction: Record<string, unknown> | null;
    extraction_error: string | null;
    review_notes: string | null;
  };
  items: TrapperReportItem[];
}

interface SubmissionStats {
  pending: number;
  extracting: number;
  extracted: number;
  reviewed: number;
  committed: number;
  failed: number;
  total: number;
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "extracted", label: "Extracted" },
  { value: "reviewed", label: "Reviewed" },
  { value: "committed", label: "Committed" },
  { value: "failed", label: "Failed" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  extracting: { bg: "var(--info-bg)", text: "var(--info-text)" },
  extracted: { bg: "var(--info-bg)", text: "var(--info-text)" },
  reviewed: { bg: "var(--success-bg)", text: "var(--success-text)" },
  committed: { bg: "var(--success-bg)", text: "var(--success-text)" },
  failed: { bg: "var(--error-bg)", text: "var(--error-text)" },
};

const ITEM_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  approved: { bg: "var(--success-bg)", text: "var(--success-text)" },
  rejected: { bg: "var(--section-bg)", text: "var(--muted)" },
  needs_clarification: { bg: "var(--info-bg)", text: "var(--info-text)" },
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  request_status: "Request Status Update",
  colony_estimate: "Colony Estimate",
  site_relationship: "Site Relationship",
  person_identifier: "New Contact Info",
  request_note: "Request Note",
  new_site_observation: "New Site",
};

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const colors =
    pct >= 95
      ? { bg: "var(--success-bg)", text: "var(--success-text)" }
      : pct >= 70
        ? { bg: "var(--warning-bg)", text: "var(--warning-text)" }
        : { bg: "var(--error-bg)", text: "var(--error-text)" };

  return (
    <span
      style={{
        padding: "2px 6px",
        borderRadius: "4px",
        fontSize: "11px",
        fontWeight: 500,
        background: colors.bg,
        color: colors.text,
      }}
    >
      {pct}%
    </span>
  );
}

export default function TrapperReportsPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [submissions, setSubmissions] = useState<TrapperReportSubmission[]>([]);
  const [stats, setStats] = useState<SubmissionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDetail | null>(null);
  const [updating, setUpdating] = useState(false);

  // New submission form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newReporterEmail, setNewReporterEmail] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newContentType, setNewContentType] = useState("email");

  // Structured entry state
  const [showStructuredEntry, setShowStructuredEntry] = useState(false);
  // Reporter search
  const [reporterMode, setReporterMode] = useState<"trappers" | "all">("trappers");
  const [reporterSearch, setReporterSearch] = useState("");
  const [reporterResults, setReporterResults] = useState<{ id: string; name: string; type?: string }[]>([]);
  const [selectedReporter, setSelectedReporter] = useState<{ id: string; name: string } | null>(null);
  const [searchingReporter, setSearchingReporter] = useState(false);
  // Request search
  const [requestSearch, setRequestSearch] = useState("");
  const [requestResults, setRequestResults] = useState<{ id: string; address: string; requester?: string; status?: string }[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<{ id: string; address: string; requester?: string } | null>(null);
  const [searchingRequest, setSearchingRequest] = useState(false);
  // Structured numbers
  const [catsTrapped, setCatsTrapped] = useState<number | "">("");
  const [catsRemaining, setCatsRemaining] = useState<number | "">("");
  const [statusUpdate, setStatusUpdate] = useState<"none" | "in_progress" | "on_hold" | "completed">("none");
  const [holdReason, setHoldReason] = useState("");

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/trapper-reports?status=${activeTab}`);
      if (!res.ok) throw new Error("Failed to fetch submissions");
      const data = await res.json();
      setSubmissions(data.submissions);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const fetchSubmissionDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/trapper-reports/${id}`);
      if (!res.ok) throw new Error("Failed to fetch submission");
      const data = await res.json();
      setSelectedSubmission(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submission");
    }
  };

  // Search for trappers
  const searchTrappers = async (query: string) => {
    if (query.length < 2) {
      setReporterResults([]);
      return;
    }
    setSearchingReporter(true);
    try {
      const res = await fetch(`/api/trappers?search=${encodeURIComponent(query)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setReporterResults(
          (data.trappers || []).map((t: { person_id: string; display_name: string; trapper_type: string }) => ({
            id: t.person_id,
            name: t.display_name,
            type: t.trapper_type,
          }))
        );
      }
    } catch (err) {
      console.error("Failed to search trappers:", err);
    } finally {
      setSearchingReporter(false);
    }
  };

  // Search for all people
  const searchPeople = async (query: string) => {
    if (query.length < 2) {
      setReporterResults([]);
      return;
    }
    setSearchingReporter(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=person&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setReporterResults(
          (data.results || []).map((p: { entity_id: string; display_name: string }) => ({
            id: p.entity_id,
            name: p.display_name,
          }))
        );
      }
    } catch (err) {
      console.error("Failed to search people:", err);
    } finally {
      setSearchingReporter(false);
    }
  };

  // Search for requests
  const searchRequests = async (query: string) => {
    if (query.length < 2) {
      setRequestResults([]);
      return;
    }
    setSearchingRequest(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=request&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setRequestResults(
          (data.requests || []).map((r: { request_id: string; place_address: string; requester_name: string; status: string }) => ({
            id: r.request_id,
            address: r.place_address || "No address",
            requester: r.requester_name,
            status: r.status,
          }))
        );
      }
    } catch (err) {
      console.error("Failed to search requests:", err);
    } finally {
      setSearchingRequest(false);
    }
  };

  // Debounced search handlers
  useEffect(() => {
    const timer = setTimeout(() => {
      if (reporterSearch) {
        if (reporterMode === "trappers") {
          searchTrappers(reporterSearch);
        } else {
          searchPeople(reporterSearch);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [reporterSearch, reporterMode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (requestSearch) {
        searchRequests(requestSearch);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [requestSearch]);

  const resetFormState = () => {
    setNewReporterEmail("");
    setNewContent("");
    setNewContentType("email");
    setShowStructuredEntry(false);
    setReporterMode("trappers");
    setReporterSearch("");
    setReporterResults([]);
    setSelectedReporter(null);
    setRequestSearch("");
    setRequestResults([]);
    setSelectedRequest(null);
    setCatsTrapped("");
    setCatsRemaining("");
    setStatusUpdate("none");
    setHoldReason("");
  };

  const submitNewReport = async () => {
    if (!newContent.trim()) {
      setError("Content is required");
      return;
    }

    setUpdating(true);
    try {
      // Build structured data if any fields are filled
      const hasStructuredData = selectedReporter || selectedRequest ||
        catsTrapped !== "" || catsRemaining !== "" || statusUpdate !== "none";

      const structuredData = hasStructuredData ? {
        cats_trapped: catsTrapped !== "" ? Number(catsTrapped) : null,
        cats_remaining: catsRemaining !== "" ? Number(catsRemaining) : null,
        status_update: statusUpdate !== "none" ? statusUpdate : null,
        hold_reason: statusUpdate === "on_hold" ? holdReason || null : null,
      } : null;

      const res = await fetch("/api/admin/trapper-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporter_email: selectedReporter ? null : newReporterEmail || null,
          reporter_person_id: selectedReporter?.id || null,
          request_id: selectedRequest?.id || null,
          structured_data: structuredData,
          content: newContent,
          content_type: newContentType,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit");
      }

      setShowNewForm(false);
      resetFormState();
      fetchSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setUpdating(false);
    }
  };

  const runExtraction = async (id: string) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/trapper-reports/${id}/extract`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Extraction failed");
      }

      const data = await res.json();
      alert(`Extracted ${data.sites_processed} sites, created ${data.items_created} items for review`);

      fetchSubmissions();
      if (selectedSubmission?.submission.submission_id === id) {
        fetchSubmissionDetail(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setUpdating(false);
    }
  };

  const deleteSubmission = async (id: string) => {
    if (!confirm("Are you sure you want to delete this submission? This cannot be undone.")) {
      return;
    }

    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/trapper-reports/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }

      setSelectedSubmission(null);
      fetchSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setUpdating(false);
    }
  };

  const updateItemStatus = async (itemId: string, status: string) => {
    if (!selectedSubmission) return;

    setUpdating(true);
    try {
      const res = await fetch(
        `/api/admin/trapper-reports/${selectedSubmission.submission.submission_id}/items/${itemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ review_status: status }),
        }
      );

      if (!res.ok) throw new Error("Failed to update item");

      fetchSubmissionDetail(selectedSubmission.submission.submission_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const commitApproved = async () => {
    if (!selectedSubmission) return;

    setUpdating(true);
    try {
      const res = await fetch(
        `/api/admin/trapper-reports/${selectedSubmission.submission.submission_id}/commit`,
        {
          method: "POST",
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Commit failed");
      }

      const data = await res.json();
      alert(`Committed ${data.committed} items, ${data.failed} failed`);

      fetchSubmissions();
      fetchSubmissionDetail(selectedSubmission.submission.submission_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 600 }}>Trapper Report Ingest</h1>
        <button
          onClick={() => setShowNewForm(true)}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            background: "var(--primary)",
            color: "white",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          + Submit Report
        </button>
      </div>
      <p style={{ color: "var(--muted)", marginBottom: "24px" }}>
        Submit trapper field reports for AI extraction and review before committing to the database.
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

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
          <div style={{ background: "var(--warning-bg)", padding: "10px 16px", borderRadius: "8px" }}>
            <div style={{ fontSize: "20px", fontWeight: 600 }}>{stats.pending}</div>
            <div style={{ fontSize: "11px", color: "var(--muted)" }}>Pending</div>
          </div>
          <div style={{ background: "var(--info-bg)", padding: "10px 16px", borderRadius: "8px" }}>
            <div style={{ fontSize: "20px", fontWeight: 600 }}>{stats.extracted}</div>
            <div style={{ fontSize: "11px", color: "var(--muted)" }}>Extracted</div>
          </div>
          <div style={{ background: "var(--success-bg)", padding: "10px 16px", borderRadius: "8px" }}>
            <div style={{ fontSize: "20px", fontWeight: 600 }}>{stats.committed}</div>
            <div style={{ fontSize: "11px", color: "var(--muted)" }}>Committed</div>
          </div>
          {stats.failed > 0 && (
            <div style={{ background: "var(--error-bg)", padding: "10px 16px", borderRadius: "8px" }}>
              <div style={{ fontSize: "20px", fontWeight: 600 }}>{stats.failed}</div>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>Failed</div>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: activeTab === tab.value ? "var(--primary)" : "var(--section-bg)",
              color: activeTab === tab.value ? "white" : "var(--foreground)",
              cursor: "pointer",
              fontWeight: activeTab === tab.value ? 600 : 400,
              fontSize: "14px",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
      ) : submissions.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
          No submissions found. Click &quot;Submit Report&quot; to add one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {submissions.map((sub) => (
            <div
              key={sub.submission_id}
              onClick={() => fetchSubmissionDetail(sub.submission_id)}
              style={{
                padding: "14px 16px",
                background: "var(--card-bg)",
                borderRadius: "8px",
                cursor: "pointer",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", gap: "8px", marginBottom: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    background: STATUS_COLORS[sub.extraction_status]?.bg || "var(--section-bg)",
                    color: STATUS_COLORS[sub.extraction_status]?.text || "var(--foreground)",
                  }}
                >
                  {sub.extraction_status}
                </span>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>{sub.content_type}</span>
                {sub.reporter_match_confidence && (
                  <ConfidenceBadge score={sub.reporter_match_confidence} />
                )}
              </div>

              <div style={{ fontWeight: 500, marginBottom: "4px" }}>
                {sub.reporter_name || sub.reporter_email || "Unknown Reporter"}
              </div>

              <div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "6px" }}>
                {sub.content_preview?.substring(0, 150)}
                {(sub.content_preview?.length || 0) > 150 ? "..." : ""}
              </div>

              <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "var(--muted)" }}>
                <span>{new Date(sub.received_at).toLocaleDateString()}</span>
                {parseInt(sub.total_items) > 0 && (
                  <span>
                    {sub.pending_items} pending / {sub.approved_items} approved / {sub.committed_items} committed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Report Form Modal */}
      {showNewForm && (
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
          onClick={() => setShowNewForm(false)}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: "12px",
              maxWidth: "600px",
              width: "100%",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "16px" }}>Submit Trapper Report</h2>

            {/* Structured Entry Toggle */}
            <button
              type="button"
              onClick={() => setShowStructuredEntry(!showStructuredEntry)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                marginBottom: "16px",
                background: showStructuredEntry ? "var(--info-bg)" : "var(--section-bg)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--foreground)",
                width: "100%",
                justifyContent: "center",
              }}
            >
              <span>{showStructuredEntry ? "▼" : "▶"}</span>
              {showStructuredEntry ? "Hide Structured Entry" : "Add Details (Higher Confidence)"}
            </button>

            {/* Structured Entry Section */}
            {showStructuredEntry && (
              <div style={{
                padding: "16px",
                marginBottom: "16px",
                background: "var(--section-bg)",
                borderRadius: "8px",
                border: "1px solid var(--border)",
              }}>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "12px" }}>
                  Fill in what you know. More detail = higher confidence, less AI guessing.
                </p>

                {/* Reporter Search */}
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                    Reporter (who submitted this?)
                  </label>
                  {selectedReporter ? (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 10px",
                      background: "var(--success-bg)",
                      borderRadius: "6px",
                    }}>
                      <span style={{ flex: 1, fontWeight: 500 }}>{selectedReporter.name}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedReporter(null)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "14px",
                          color: "var(--muted)",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
                        <button
                          type="button"
                          onClick={() => { setReporterMode("trappers"); setReporterResults([]); }}
                          style={{
                            padding: "4px 10px",
                            borderRadius: "4px",
                            border: "none",
                            background: reporterMode === "trappers" ? "var(--primary)" : "var(--background)",
                            color: reporterMode === "trappers" ? "white" : "inherit",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          Trappers
                        </button>
                        <button
                          type="button"
                          onClick={() => { setReporterMode("all"); setReporterResults([]); }}
                          style={{
                            padding: "4px 10px",
                            borderRadius: "4px",
                            border: "none",
                            background: reporterMode === "all" ? "var(--primary)" : "var(--background)",
                            color: reporterMode === "all" ? "white" : "inherit",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          All People
                        </button>
                      </div>
                      <input
                        type="text"
                        value={reporterSearch}
                        onChange={(e) => setReporterSearch(e.target.value)}
                        placeholder={reporterMode === "trappers" ? "Search trappers by name..." : "Search all people..."}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          background: "var(--background)",
                          fontSize: "13px",
                        }}
                      />
                      {searchingReporter && <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>Searching...</div>}
                      {reporterResults.length > 0 && (
                        <div style={{
                          marginTop: "4px",
                          maxHeight: "150px",
                          overflowY: "auto",
                          border: "1px solid var(--border)",
                          borderRadius: "6px",
                          background: "var(--background)",
                        }}>
                          {reporterResults.map((r) => (
                            <div
                              key={r.id}
                              onClick={() => {
                                setSelectedReporter({ id: r.id, name: r.name });
                                setReporterSearch("");
                                setReporterResults([]);
                              }}
                              style={{
                                padding: "8px 10px",
                                cursor: "pointer",
                                borderBottom: "1px solid var(--border)",
                                fontSize: "13px",
                              }}
                            >
                              <span style={{ fontWeight: 500 }}>{r.name}</span>
                              {r.type && (
                                <span style={{
                                  marginLeft: "8px",
                                  padding: "2px 6px",
                                  background: r.type === "community_trapper" ? "var(--warning-bg)" : "var(--success-bg)",
                                  borderRadius: "3px",
                                  fontSize: "11px",
                                }}>
                                  {r.type.replace("_", " ")}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Request Search */}
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                    Request (what site is this about?)
                  </label>
                  {selectedRequest ? (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 10px",
                      background: "var(--success-bg)",
                      borderRadius: "6px",
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: "13px" }}>{selectedRequest.address}</div>
                        {selectedRequest.requester && (
                          <div style={{ fontSize: "12px", color: "var(--muted)" }}>{selectedRequest.requester}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedRequest(null)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "14px",
                          color: "var(--muted)",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={requestSearch}
                        onChange={(e) => setRequestSearch(e.target.value)}
                        placeholder="Search by address or requester name..."
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          background: "var(--background)",
                          fontSize: "13px",
                        }}
                      />
                      {searchingRequest && <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>Searching...</div>}
                      {requestResults.length > 0 && (
                        <div style={{
                          marginTop: "4px",
                          maxHeight: "150px",
                          overflowY: "auto",
                          border: "1px solid var(--border)",
                          borderRadius: "6px",
                          background: "var(--background)",
                        }}>
                          {requestResults.map((r) => (
                            <div
                              key={r.id}
                              onClick={() => {
                                setSelectedRequest({ id: r.id, address: r.address, requester: r.requester });
                                setRequestSearch("");
                                setRequestResults([]);
                              }}
                              style={{
                                padding: "8px 10px",
                                cursor: "pointer",
                                borderBottom: "1px solid var(--border)",
                                fontSize: "13px",
                              }}
                            >
                              <div style={{ fontWeight: 500 }}>{r.address}</div>
                              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                                {r.requester && <span>{r.requester} • </span>}
                                <span style={{ textTransform: "capitalize" }}>{r.status}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Numbers */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                      Cats Trapped
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={catsTrapped}
                      onChange={(e) => setCatsTrapped(e.target.value === "" ? "" : parseInt(e.target.value))}
                      placeholder="0"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                        background: "var(--background)",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                      Cats Remaining
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={catsRemaining}
                      onChange={(e) => setCatsRemaining(e.target.value === "" ? "" : parseInt(e.target.value))}
                      placeholder="0"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                        background: "var(--background)",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                </div>

                {/* Status Update */}
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                    Status Update
                  </label>
                  <select
                    value={statusUpdate}
                    onChange={(e) => setStatusUpdate(e.target.value as typeof statusUpdate)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "var(--background)",
                      fontSize: "13px",
                    }}
                  >
                    <option value="none">No status change</option>
                    <option value="in_progress">In Progress</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                  </select>
                  {statusUpdate === "on_hold" && (
                    <input
                      type="text"
                      value={holdReason}
                      onChange={(e) => setHoldReason(e.target.value)}
                      placeholder="Hold reason..."
                      style={{
                        width: "100%",
                        marginTop: "6px",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                        background: "var(--background)",
                        fontSize: "13px",
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Reporter Email (if not using structured entry or no reporter selected) */}
            {(!showStructuredEntry || !selectedReporter) && (
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "14px", fontWeight: 500, marginBottom: "6px" }}>
                  {showStructuredEntry ? "Or enter email manually" : "Reporter Email (optional)"}
                </label>
                <input
                  type="email"
                  value={newReporterEmail}
                  onChange={(e) => setNewReporterEmail(e.target.value)}
                  placeholder="trapper@example.com"
                  disabled={!!selectedReporter}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: selectedReporter ? "var(--section-bg)" : "var(--background)",
                    opacity: selectedReporter ? 0.5 : 1,
                  }}
                />
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "14px", fontWeight: 500, marginBottom: "6px" }}>
                Content Type
              </label>
              <select
                value={newContentType}
                onChange={(e) => setNewContentType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                }}
              >
                <option value="email">Email</option>
                <option value="form">Form Submission</option>
                <option value="sms">SMS/Text</option>
                <option value="note">Notes</option>
              </select>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "14px", fontWeight: 500, marginBottom: "6px" }}>
                Report Content *
              </label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Paste the trapper's report here..."
                style={{
                  width: "100%",
                  minHeight: "150px",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>

            {/* Confidence Indicator */}
            {showStructuredEntry && (selectedReporter || selectedRequest || catsTrapped !== "" || catsRemaining !== "" || statusUpdate !== "none") && (
              <div style={{
                padding: "10px 12px",
                marginBottom: "16px",
                background: "var(--success-bg)",
                borderRadius: "6px",
                fontSize: "13px",
              }}>
                <strong>Pre-filled data will be saved with 100% confidence</strong>
                <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px", fontSize: "12px", color: "var(--muted)" }}>
                  {selectedReporter && <li>Reporter: {selectedReporter.name}</li>}
                  {selectedRequest && <li>Request: {selectedRequest.address}</li>}
                  {catsTrapped !== "" && <li>Cats trapped: {catsTrapped}</li>}
                  {catsRemaining !== "" && <li>Cats remaining: {catsRemaining}</li>}
                  {statusUpdate !== "none" && <li>Status: {statusUpdate.replace("_", " ")}</li>}
                </ul>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowNewForm(false);
                  resetFormState();
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitNewReport}
                disabled={updating || !newContent.trim()}
                style={{
                  padding: "10px 16px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--primary)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 500,
                  opacity: updating || !newContent.trim() ? 0.5 : 1,
                }}
              >
                {updating ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submission Detail Modal - Side by Side View */}
      {selectedSubmission && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "stretch",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
          onClick={() => setSelectedSubmission(null)}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: "12px",
              maxWidth: "1200px",
              width: "100%",
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h2 style={{ marginBottom: "4px" }}>
                  Report from {selectedSubmission.submission.reporter_name || selectedSubmission.submission.reporter_email || "Unknown"}
                </h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      background: STATUS_COLORS[selectedSubmission.submission.extraction_status]?.bg,
                      color: STATUS_COLORS[selectedSubmission.submission.extraction_status]?.text,
                    }}
                  >
                    {selectedSubmission.submission.extraction_status}
                  </span>
                  {selectedSubmission.submission.reporter_match_confidence && (
                    <>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>Match:</span>
                      <ConfidenceBadge score={selectedSubmission.submission.reporter_match_confidence} />
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {selectedSubmission.submission.extraction_status === "pending" && (
                  <button
                    onClick={() => runExtraction(selectedSubmission.submission.submission_id)}
                    disabled={updating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: "var(--primary)",
                      color: "white",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    {updating ? "Extracting..." : "Run AI Extraction"}
                  </button>
                )}
                {selectedSubmission.items.some((i) => i.review_status === "approved" && !i.committed_at) && (
                  <button
                    onClick={commitApproved}
                    disabled={updating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: "var(--success-bg)",
                      color: "var(--success-text)",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    Commit Approved
                  </button>
                )}
                {!selectedSubmission.items.some((i) => i.committed_at) && (
                  <button
                    onClick={() => deleteSubmission(selectedSubmission.submission.submission_id)}
                    disabled={updating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: "var(--error-bg)",
                      color: "var(--error-text)",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={() => setSelectedSubmission(null)}
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
              </div>
            </div>

            {/* Content - Side by Side */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              {/* Left: Original Text */}
              <div
                style={{
                  flex: 1,
                  borderRight: "1px solid var(--border)",
                  overflow: "auto",
                  padding: "16px",
                }}
              >
                <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px", color: "var(--muted)" }}>
                  ORIGINAL TEXT
                </h3>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "inherit",
                    fontSize: "14px",
                    lineHeight: "1.6",
                    margin: 0,
                  }}
                >
                  {selectedSubmission.submission.raw_content}
                </pre>

                {selectedSubmission.submission.extraction_error && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "12px",
                      background: "var(--error-bg)",
                      color: "var(--error-text)",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  >
                    <strong>Extraction Error:</strong> {selectedSubmission.submission.extraction_error}
                  </div>
                )}
              </div>

              {/* Right: Extracted Items */}
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  padding: "16px",
                  background: "var(--section-bg)",
                }}
              >
                <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px", color: "var(--muted)" }}>
                  EXTRACTED ITEMS ({selectedSubmission.items.length})
                </h3>

                {selectedSubmission.items.length === 0 ? (
                  <div style={{ color: "var(--muted)", textAlign: "center", padding: "40px" }}>
                    {selectedSubmission.submission.extraction_status === "pending"
                      ? 'Click "Run AI Extraction" to process this report'
                      : "No items extracted"}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {selectedSubmission.items.map((item) => (
                      <div
                        key={item.item_id}
                        style={{
                          background: "var(--card-bg)",
                          borderRadius: "8px",
                          padding: "14px",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center" }}>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "11px",
                              fontWeight: 500,
                              background: ITEM_STATUS_COLORS[item.review_status]?.bg,
                              color: ITEM_STATUS_COLORS[item.review_status]?.text,
                            }}
                          >
                            {item.review_status}
                          </span>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "11px",
                              background: "var(--section-bg)",
                            }}
                          >
                            {ITEM_TYPE_LABELS[item.item_type] || item.item_type}
                          </span>
                          {item.match_confidence && <ConfidenceBadge score={item.match_confidence} />}
                          {item.committed_at && (
                            <span style={{ fontSize: "11px", color: "var(--success-text)" }}>Committed</span>
                          )}
                        </div>

                        {/* Target entity */}
                        <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "6px" }}>
                          {item.target_entity_name || (item.target_entity_id ? `ID: ${item.target_entity_id.substring(0, 8)}...` : "No match")}
                        </div>

                        {/* Current status for requests */}
                        {item.current_request_status && (
                          <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px" }}>
                            Current status: <strong>{item.current_request_status}</strong>
                          </div>
                        )}

                        {/* Extracted data summary */}
                        <div
                          style={{
                            fontSize: "13px",
                            color: "var(--muted)",
                            background: "var(--section-bg)",
                            padding: "8px 10px",
                            borderRadius: "6px",
                            marginBottom: "8px",
                          }}
                        >
                          {item.item_type === "request_status" && (
                            <>
                              <div>
                                <strong>Proposed status:</strong> {(item.extracted_data as { status?: string }).status}
                              </div>
                              {(item.extracted_data as { hold_reason?: string }).hold_reason && (
                                <div>
                                  <strong>Hold reason:</strong> {(item.extracted_data as { hold_reason?: string }).hold_reason}
                                </div>
                              )}
                              {(item.extracted_data as { note?: string }).note && (
                                <div>
                                  <strong>Note:</strong> {(item.extracted_data as { note?: string }).note}
                                </div>
                              )}
                            </>
                          )}
                          {item.item_type === "colony_estimate" && (
                            <>
                              {(item.extracted_data as { cats_remaining?: { min?: number; max?: number } }).cats_remaining && (
                                <div>
                                  <strong>Cats remaining:</strong>{" "}
                                  {(item.extracted_data as { cats_remaining: { min?: number; max?: number } }).cats_remaining.min}
                                  {(item.extracted_data as { cats_remaining: { min?: number; max?: number } }).cats_remaining.max !==
                                    (item.extracted_data as { cats_remaining: { min?: number; max?: number } }).cats_remaining.min &&
                                    ` - ${(item.extracted_data as { cats_remaining: { min?: number; max?: number } }).cats_remaining.max}`}
                                </div>
                              )}
                              {(item.extracted_data as { cats_trapped?: { total?: number } }).cats_trapped && (
                                <div>
                                  <strong>Cats trapped:</strong> {(item.extracted_data as { cats_trapped: { total?: number } }).cats_trapped.total}
                                </div>
                              )}
                            </>
                          )}
                          {item.item_type === "person_identifier" && (
                            <div>
                              <strong>New {(item.extracted_data as { id_type?: string }).id_type}:</strong>{" "}
                              {(item.extracted_data as { id_value?: string }).id_value}
                            </div>
                          )}
                          {item.item_type === "site_relationship" && (
                            <div>
                              <strong>Related to:</strong> {(item.extracted_data as { related_address?: string }).related_address}
                            </div>
                          )}
                        </div>

                        {/* Original text snippet */}
                        {item.extracted_text && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--muted)",
                              fontStyle: "italic",
                              marginBottom: "8px",
                              borderLeft: "2px solid var(--border)",
                              paddingLeft: "8px",
                            }}
                          >
                            &quot;{item.extracted_text.substring(0, 150)}
                            {item.extracted_text.length > 150 ? "..." : ""}&quot;
                          </div>
                        )}

                        {/* Actions */}
                        {item.review_status === "pending" && !item.committed_at && (
                          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                            <button
                              onClick={() => updateItemStatus(item.item_id, "approved")}
                              disabled={updating}
                              style={{
                                padding: "6px 12px",
                                borderRadius: "4px",
                                border: "none",
                                background: "var(--success-bg)",
                                color: "var(--success-text)",
                                cursor: "pointer",
                                fontSize: "12px",
                                fontWeight: 500,
                              }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => updateItemStatus(item.item_id, "rejected")}
                              disabled={updating}
                              style={{
                                padding: "6px 12px",
                                borderRadius: "4px",
                                border: "none",
                                background: "var(--section-bg)",
                                color: "var(--muted)",
                                cursor: "pointer",
                                fontSize: "12px",
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
