"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";

interface TippyConversation {
  conversation_id: string;
  staff_id: string | null;
  staff_name: string | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  tools_used: string[];
  is_archived: boolean;
  first_message: string | null;
  has_feedback: boolean;
  feedback_count: number;
}

interface TippyMessage {
  message_id: string;
  role: "user" | "assistant" | "system" | "tool_result";
  content: string;
  tool_calls: unknown | null;
  tool_results: unknown | null;
  tokens_used: number | null;
  created_at: string;
}

interface ConversationDetail {
  conversation: TippyConversation;
  messages: TippyMessage[];
  feedback: Array<{
    feedback_id: string;
    tippy_message: string;
    user_correction: string;
    feedback_type: string;
    status: string;
    created_at: string;
  }>;
}

interface Stats {
  total_conversations: number;
  unique_staff: number;
  total_messages: number;
  total_feedback: number;
}

const ROLE_COLORS: Record<string, { bg: string; label: string }> = {
  user: { bg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", label: "User" },
  assistant: { bg: "#e5e7eb", label: "Tippy" },
  system: { bg: "#fef3c7", label: "System" },
  tool_result: { bg: "#d1fae5", label: "Tool" },
};

export default function TippyConversationsPage() {
  const [conversations, setConversations] = useState<TippyConversation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [filterTool, setFilterTool] = useState("");
  const [filterHasFeedback, setFilterHasFeedback] = useState(false);

  // Detail modal
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTool) params.set("tool", filterTool);
      if (filterHasFeedback) params.set("has_feedback", "true");

      const data = await fetchApi<{
        conversations: TippyConversation[];
        stats: Stats;
        tools: string[];
      }>(`/api/admin/tippy-conversations?${params}`);
      setConversations(data.conversations);
      setStats(data.stats);
      setTools(data.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [filterTool, filterHasFeedback]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const fetchDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const data = await fetchApi<ConversationDetail>(
        `/api/admin/tippy-conversations/${id}`
      );
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    }
  }, [selectedId, fetchDetail]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div style={{ padding: "24px 0" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "8px" }}>
          Tippy Conversations
        </h1>
        <p style={{ color: "var(--muted)" }}>
          Review staff queries to Tippy to understand data needs and improve AI navigation
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "12px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
              Total Conversations
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
              {stats.total_conversations}
            </div>
          </div>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "12px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
              Unique Staff
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
              {stats.unique_staff}
            </div>
          </div>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "12px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
              Total Messages
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
              {stats.total_messages}
            </div>
          </div>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "12px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
              Feedback Items
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
              {stats.total_feedback}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "24px",
          alignItems: "center",
        }}
      >
        <select
          value={filterTool}
          onChange={(e) => setFilterTool(e.target.value)}
          style={{
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            background: "var(--background)",
            fontSize: "0.875rem",
          }}
        >
          <option value="">All tools</option>
          {tools.map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </select>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.875rem",
          }}
        >
          <input
            type="checkbox"
            checked={filterHasFeedback}
            onChange={(e) => setFilterHasFeedback(e.target.checked)}
          />
          Has feedback
        </label>

        <a
          href="/admin/tippy-feedback"
          style={{
            marginLeft: "auto",
            fontSize: "0.875rem",
            color: "var(--primary)",
            textDecoration: "none",
          }}
        >
          View Feedback Queue →
        </a>
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

      {/* Loading / Empty / List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          Loading conversations...
        </div>
      ) : conversations.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          No conversations found. Conversations appear here once staff use Tippy.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {conversations.map((conv) => (
            <div
              key={conv.conversation_id}
              onClick={() => setSelectedId(conv.conversation_id)}
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: "12px",
                padding: "16px",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--card-border)")}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {conv.staff_name || "Anonymous"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {formatDate(conv.started_at)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: "var(--section-bg)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                    }}
                  >
                    {conv.message_count} messages
                  </span>
                  {conv.has_feedback && (
                    <span
                      style={{
                        padding: "4px 8px",
                        background: "var(--warning-bg)",
                        color: "var(--warning-text)",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      {conv.feedback_count} feedback
                    </span>
                  )}
                </div>
              </div>

              {/* First message preview */}
              {conv.first_message && (
                <div
                  style={{
                    background: "var(--section-bg)",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    color: "var(--foreground)",
                    maxHeight: "60px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginBottom: "12px",
                  }}
                >
                  "{conv.first_message.slice(0, 200)}
                  {conv.first_message.length > 200 && "..."}"
                </div>
              )}

              {/* Tools used */}
              {conv.tools_used && conv.tools_used.length > 0 && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {conv.tools_used.map((tool) => (
                    <span
                      key={tool}
                      style={{
                        padding: "2px 8px",
                        background: "#d1fae5",
                        color: "#065f46",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        fontFamily: "monospace",
                      }}
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedId && (
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
          onClick={() => {
            setSelectedId(null);
            setDetail(null);
          }}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: "12px",
              width: "700px",
              maxHeight: "90vh",
              overflow: "auto",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
                Conversation Detail
              </h2>
              <button
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
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

            {loadingDetail ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
                Loading...
              </div>
            ) : detail ? (
              <>
                {/* Conversation info */}
                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    marginBottom: "20px",
                    fontSize: "0.85rem",
                    color: "var(--muted)",
                  }}
                >
                  <span>Staff: {detail.conversation.staff_name || "Anonymous"}</span>
                  <span>•</span>
                  <span>{formatDate(detail.conversation.started_at)}</span>
                  <span>•</span>
                  <span>{detail.messages.length} messages</span>
                </div>

                {/* Messages */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    marginBottom: "20px",
                  }}
                >
                  {detail.messages.map((msg) => (
                    <div
                      key={msg.message_id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                      }}
                    >
                      <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: "4px" }}>
                        {ROLE_COLORS[msg.role]?.label || msg.role}
                      </div>
                      <div
                        style={{
                          maxWidth: "90%",
                          padding: "10px 14px",
                          borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                          background: ROLE_COLORS[msg.role]?.bg || "#e5e7eb",
                          color: msg.role === "user" ? "#fff" : "inherit",
                          fontSize: "0.875rem",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {msg.content}
                      </div>
                      {msg.tool_calls ? (
                        <div
                          style={{
                            marginTop: "4px",
                            fontSize: "0.7rem",
                            color: "#065f46",
                            fontFamily: "monospace",
                          }}
                        >
                          Tools: {JSON.stringify(msg.tool_calls)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/* Feedback on this conversation */}
                {detail.feedback.length > 0 && (
                  <div
                    style={{
                      borderTop: "1px solid var(--border)",
                      paddingTop: "16px",
                    }}
                  >
                    <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "12px" }}>
                      Feedback ({detail.feedback.length})
                    </div>
                    {detail.feedback.map((fb) => (
                      <div
                        key={fb.feedback_id}
                        style={{
                          background: "var(--warning-bg)",
                          padding: "12px",
                          borderRadius: "8px",
                          marginBottom: "8px",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
                          {fb.feedback_type} • {fb.status}
                        </div>
                        <div style={{ fontSize: "0.85rem" }}>{fb.user_correction}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
