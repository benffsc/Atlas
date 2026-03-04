"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

interface UnansweredQuestion {
  question_id: string;
  question_text: string;
  normalized_question: string;
  reason: string;
  attempted_tools: string[];
  error_details: string | null;
  response_given: string | null;
  occurrence_count: number;
  first_asked_at: string;
  last_asked_at: string;
  resolution_status: string;
  resolution_notes: string | null;
  related_view: string | null;
  asked_by_name: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  priority_score: number;
}

interface GapStats {
  unresolved: number;
  view_created: number;
  data_added: number;
  out_of_scope: number;
  total: number;
}

const STATUS_TABS = [
  { value: "unresolved", label: "Unresolved" },
  { value: "view_created", label: "View Created" },
  { value: "data_added", label: "Data Added" },
  { value: "out_of_scope", label: "Out of Scope" },
  { value: "all", label: "All" },
];

const REASON_LABELS: Record<string, string> = {
  no_data: "Missing Data",
  no_view: "No View",
  permission: "Permission",
  ambiguous: "Ambiguous",
  out_of_scope: "Out of Scope",
  tool_failed: "Tool Failed",
  complex_query: "Complex Query",
  other: "Other",
};

const REASON_COLORS: Record<string, { bg: string; text: string }> = {
  no_data: { bg: "var(--error-bg)", text: "var(--error-text)" },
  no_view: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  tool_failed: { bg: "var(--error-bg)", text: "var(--error-text)" },
  complex_query: { bg: "var(--info-bg)", text: "var(--info-text)" },
  out_of_scope: { bg: "var(--section-bg)", text: "var(--muted)" },
  permission: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  ambiguous: { bg: "var(--section-bg)", text: "var(--muted)" },
  other: { bg: "var(--section-bg)", text: "var(--muted)" },
};

export default function TippyGapsPage() {
  const [activeTab, setActiveTab] = useState("unresolved");
  const [questions, setQuestions] = useState<UnansweredQuestion[]>([]);
  const [stats, setStats] = useState<GapStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState<UnansweredQuestion | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [relatedView, setRelatedView] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{
        questions: UnansweredQuestion[];
        stats: GapStats;
      }>(`/api/admin/tippy-gaps?status=${activeTab}`);
      setQuestions(data.questions);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load questions");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const resolveQuestion = async (questionId: string, newStatus: string) => {
    setUpdating(true);
    try {
      await postApi(`/api/admin/tippy-gaps/${questionId}`, {
        resolution_status: newStatus,
        resolution_notes: resolutionNotes || null,
        related_view: relatedView || null,
      }, { method: "PATCH" });

      setSelectedQuestion(null);
      setResolutionNotes("");
      setRelatedView("");
      fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "8px" }}>
        Tippy Schema Gaps
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "24px" }}>
        Questions Tippy couldn&apos;t answer - use to identify missing views or data.
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
        <div style={{ display: "flex", gap: "16px", marginBottom: "24px", flexWrap: "wrap" }}>
          <div style={{ background: "var(--warning-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.unresolved}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Unresolved</div>
          </div>
          <div style={{ background: "var(--success-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.view_created}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Views Created</div>
          </div>
          <div style={{ background: "var(--info-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.data_added}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Data Added</div>
          </div>
          <div style={{ background: "var(--section-bg)", padding: "12px 20px", borderRadius: "8px" }}>
            <div style={{ fontSize: "24px", fontWeight: 600 }}>{stats.out_of_scope}</div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Out of Scope</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: activeTab === tab.value ? "var(--primary)" : "var(--section-bg)",
              color: activeTab === tab.value ? "white" : "var(--foreground)",
              cursor: "pointer",
              fontWeight: activeTab === tab.value ? 600 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
      ) : questions.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
          No questions found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {questions.map((q) => (
            <div
              key={q.question_id}
              onClick={() => {
                setSelectedQuestion(q);
                setResolutionNotes(q.resolution_notes || "");
                setRelatedView(q.related_view || "");
              }}
              style={{
                padding: "16px",
                background: "var(--card-bg)",
                borderRadius: "8px",
                cursor: "pointer",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    background: REASON_COLORS[q.reason]?.bg || "var(--section-bg)",
                    color: REASON_COLORS[q.reason]?.text || "var(--foreground)",
                  }}
                >
                  {REASON_LABELS[q.reason] || q.reason}
                </span>
                {q.occurrence_count > 1 && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      background: "var(--primary)",
                      color: "white",
                    }}
                  >
                    x{q.occurrence_count}
                  </span>
                )}
                <span style={{ fontSize: "12px", color: "var(--muted)", marginLeft: "auto" }}>
                  Priority: {q.priority_score}
                </span>
              </div>

              <div style={{ fontWeight: 500, marginBottom: "8px" }}>
                &quot;{q.question_text.substring(0, 150)}{q.question_text.length > 150 ? "..." : ""}&quot;
              </div>

              {q.attempted_tools && q.attempted_tools.length > 0 && (
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>
                  Tried: {q.attempted_tools.join(", ")}
                </div>
              )}

              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                First: {new Date(q.first_asked_at).toLocaleDateString()} |
                Last: {new Date(q.last_asked_at).toLocaleDateString()}
                {q.asked_by_name && ` | By: ${q.asked_by_name}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedQuestion && (
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
          onClick={() => setSelectedQuestion(null)}
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
            <h2 style={{ marginBottom: "16px" }}>Unanswerable Question</h2>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: "4px",
                    fontSize: "14px",
                    background: REASON_COLORS[selectedQuestion.reason]?.bg,
                    color: REASON_COLORS[selectedQuestion.reason]?.text,
                  }}
                >
                  {REASON_LABELS[selectedQuestion.reason] || selectedQuestion.reason}
                </span>
                {selectedQuestion.occurrence_count > 1 && (
                  <span
                    style={{
                      padding: "4px 12px",
                      borderRadius: "4px",
                      fontSize: "14px",
                      background: "var(--primary)",
                      color: "white",
                    }}
                  >
                    Asked {selectedQuestion.occurrence_count} times
                  </span>
                )}
              </div>

              <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Question</h3>
              <p
                style={{
                  marginBottom: "12px",
                  background: "var(--section-bg)",
                  padding: "12px",
                  borderRadius: "8px",
                }}
              >
                &quot;{selectedQuestion.question_text}&quot;
              </p>

              {selectedQuestion.attempted_tools && selectedQuestion.attempted_tools.length > 0 && (
                <>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Tools Attempted</h3>
                  <p style={{ marginBottom: "12px", color: "var(--muted)" }}>
                    {selectedQuestion.attempted_tools.join(", ")}
                  </p>
                </>
              )}

              {selectedQuestion.error_details && (
                <>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Error Details</h3>
                  <p style={{ marginBottom: "12px", color: "var(--error-text)", fontFamily: "monospace", fontSize: "13px" }}>
                    {selectedQuestion.error_details}
                  </p>
                </>
              )}

              {selectedQuestion.response_given && (
                <>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Response Given</h3>
                  <p style={{ marginBottom: "12px", color: "var(--muted)" }}>
                    {selectedQuestion.response_given}
                  </p>
                </>
              )}

              {selectedQuestion.resolution_status === "unresolved" && (
                <>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Resolution Notes</h3>
                  <textarea
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="How was this resolved?"
                    style={{
                      width: "100%",
                      minHeight: "60px",
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      marginBottom: "12px",
                      fontFamily: "inherit",
                    }}
                  />

                  <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Related View (if created)</h3>
                  <input
                    type="text"
                    value={relatedView}
                    onChange={(e) => setRelatedView(e.target.value)}
                    placeholder="v_new_view_name"
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      marginBottom: "16px",
                    }}
                  />
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => setSelectedQuestion(null)}
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

              {selectedQuestion.resolution_status === "unresolved" && (
                <>
                  <button
                    onClick={() => resolveQuestion(selectedQuestion.question_id, "out_of_scope")}
                    disabled={updating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: "var(--section-bg)",
                      cursor: "pointer",
                    }}
                  >
                    Out of Scope
                  </button>
                  <button
                    onClick={() => resolveQuestion(selectedQuestion.question_id, "data_added")}
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
                    Data Added
                  </button>
                  <button
                    onClick={() => resolveQuestion(selectedQuestion.question_id, "view_created")}
                    disabled={updating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: "var(--success-bg)",
                      color: "var(--success-text)",
                      cursor: "pointer",
                    }}
                  >
                    View Created
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
