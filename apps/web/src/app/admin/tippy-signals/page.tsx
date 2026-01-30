"use client";

import { useState, useEffect, useCallback } from "react";

interface TippySignal {
  signal_type: string;
  signal_id: string;
  created_at: string;
  status: string;
  detail_type: string;
  summary: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  reported_by: string | null;
  staff_id: string | null;
  confidence: string | null;
  is_silent: boolean;
}

interface SignalSummary {
  signal_type: string;
  total: number;
  needs_attention: number;
  last_7_days: number;
  latest: string | null;
}

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  feedback: "Feedback",
  correction: "Correction",
  gap: "Gap",
  draft_request: "Draft Request",
};

const SIGNAL_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  feedback: { bg: "#fef3c7", text: "#92400e" },
  correction: { bg: "#dbeafe", text: "#1e40af" },
  gap: { bg: "#fce7f3", text: "#9d174d" },
  draft_request: { bg: "#d1fae5", text: "#065f46" },
};

const DETAIL_PAGE_MAP: Record<string, string> = {
  feedback: "/admin/tippy-feedback",
  correction: "/admin/tippy-corrections",
  gap: "/admin/tippy-gaps",
  draft_request: "/admin/tippy-drafts",
};

const NEEDS_ATTENTION_STATUSES = ["pending", "proposed", "unresolved"];

const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "feedback", label: "Feedback" },
  { value: "correction", label: "Corrections" },
  { value: "gap", label: "Gaps" },
  { value: "draft_request", label: "Drafts" },
];

const STATUS_TABS = [
  { value: "needs_attention", label: "Needs Attention" },
  { value: "all", label: "All" },
];

export default function TippySignalsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("needs_attention");
  const [signals, setSignals] = useState<TippySignal[]>([]);
  const [summary, setSummary] = useState<SignalSummary[]>([]);
  const [totalNeedsAttention, setTotalNeedsAttention] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/tippy-signals?type=${typeFilter}&status=${statusFilter}`
      );
      if (!res.ok) throw new Error("Failed to fetch signals");
      const data = await res.json();
      setSignals(data.signals);
      setSummary(data.summary);
      setTotalNeedsAttention(data.total_needs_attention);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load signals");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 1) return `${Math.round(diffMs / (1000 * 60))}m ago`;
    if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`;
    const diffDays = Math.round(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const isNeedsAttention = (status: string) =>
    NEEDS_ATTENTION_STATUSES.includes(status);

  return (
    <div>
      <h1 style={{ margin: "0 0 0.5rem 0" }}>Tippy Signals</h1>
      <p style={{ margin: "0 0 1.5rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
        Unified view of all Tippy feedback, corrections, gaps, and draft requests
      </p>

      {/* Summary Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        {/* Total needs attention */}
        <div
          style={{
            padding: "1rem",
            background: totalNeedsAttention > 0 ? "#fef2f2" : "var(--card-bg)",
            border: `1px solid ${totalNeedsAttention > 0 ? "#fecaca" : "var(--card-border)"}`,
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: totalNeedsAttention > 0 ? "#dc2626" : "var(--text-primary)" }}>
            {totalNeedsAttention}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Needs Attention
          </div>
        </div>

        {/* Per-type counts */}
        {summary.map((s) => (
          <div
            key={s.signal_type}
            style={{
              padding: "1rem",
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              cursor: "pointer",
              opacity: typeFilter !== "all" && typeFilter !== s.signal_type ? 0.5 : 1,
            }}
            onClick={() =>
              setTypeFilter(typeFilter === s.signal_type ? "all" : s.signal_type)
            }
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{s.total}</div>
              {s.needs_attention > 0 && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    padding: "2px 6px",
                    borderRadius: "10px",
                    background: "#fef2f2",
                    color: "#dc2626",
                    fontWeight: 600,
                  }}
                >
                  {s.needs_attention} pending
                </span>
              )}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {SIGNAL_TYPE_LABELS[s.signal_type] || s.signal_type}
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {/* Type tabs */}
        <div style={{ display: "flex", gap: "0.25rem", background: "var(--section-bg)", borderRadius: "6px", padding: "2px" }}>
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setTypeFilter(tab.value)}
              style={{
                padding: "0.4rem 0.75rem",
                fontSize: "0.8rem",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                background: typeFilter === tab.value ? "var(--card-bg)" : "transparent",
                color: typeFilter === tab.value ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: typeFilter === tab.value ? 600 : 400,
                boxShadow: typeFilter === tab.value ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Status tabs */}
        <div style={{ display: "flex", gap: "0.25rem", background: "var(--section-bg)", borderRadius: "6px", padding: "2px" }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              style={{
                padding: "0.4rem 0.75rem",
                fontSize: "0.8rem",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                background: statusFilter === tab.value ? "var(--card-bg)" : "transparent",
                color: statusFilter === tab.value ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: statusFilter === tab.value ? 600 : 400,
                boxShadow: statusFilter === tab.value ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "1rem", background: "#fef2f2", color: "#dc2626", borderRadius: "6px", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
          Loading signals...
        </div>
      )}

      {/* Signals List */}
      {!loading && signals.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
          No signals match the current filters
        </div>
      )}

      {!loading &&
        signals.map((signal) => {
          const typeColor = SIGNAL_TYPE_COLORS[signal.signal_type] || { bg: "#f3f4f6", text: "#374151" };
          const detailPage = DETAIL_PAGE_MAP[signal.signal_type];
          const needsAction = isNeedsAttention(signal.status);

          return (
            <div
              key={`${signal.signal_type}-${signal.signal_id}`}
              style={{
                padding: "0.75rem 1rem",
                marginBottom: "0.5rem",
                background: needsAction ? "var(--card-bg)" : "var(--section-bg)",
                border: `1px solid ${needsAction ? "var(--warning-bg)" : "var(--card-border)"}`,
                borderRadius: "6px",
                cursor: detailPage ? "pointer" : "default",
                borderLeft: needsAction ? "3px solid var(--warning-text)" : "3px solid transparent",
              }}
              onClick={() => {
                if (detailPage) {
                  window.location.href = detailPage;
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                {/* Signal type badge */}
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "10px",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    background: typeColor.bg,
                    color: typeColor.text,
                  }}
                >
                  {SIGNAL_TYPE_LABELS[signal.signal_type] || signal.signal_type}
                </span>

                {/* Status */}
                <span style={{ fontSize: "0.75rem", color: needsAction ? "var(--warning-text)" : "var(--text-muted)" }}>
                  {signal.status}
                </span>

                {/* Confidence */}
                {signal.confidence && (
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    ({signal.confidence})
                  </span>
                )}

                {/* Silent indicator */}
                {signal.is_silent && (
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    auto
                  </span>
                )}

                <span style={{ flex: 1 }} />

                {/* Date */}
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {formatDate(signal.created_at)}
                </span>
              </div>

              {/* Summary */}
              <div
                style={{
                  fontSize: "0.875rem",
                  color: "var(--text-primary)",
                  marginBottom: signal.entity_name || signal.reported_by ? "0.25rem" : 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {signal.summary || "(no summary)"}
              </div>

              {/* Entity + reporter */}
              {(signal.entity_name || signal.reported_by) && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", gap: "1rem" }}>
                  {signal.entity_name && (
                    <span>
                      {signal.entity_type}: {signal.entity_name}
                    </span>
                  )}
                  {signal.reported_by && <span>by {signal.reported_by}</span>}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
