"use client";

import { useState, useEffect, useCallback } from "react";

interface DataImprovement {
  improvement_id: string;
  title: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  category: string;
  priority: string;
  suggested_fix: Record<string, unknown> | null;
  fix_sql: string | null;
  source: string;
  source_reference_id: string | null;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
  resolved_by: string | null;
  resolver_name: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ImprovementCounts {
  pending: number;
  confirmed: number;
  in_progress: number;
  resolved: number;
  rejected: number;
  wont_fix: number;
  total: number;
}

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const CATEGORY_LABELS: Record<string, string> = {
  data_correction: "Data Fix",
  duplicate_entity: "Duplicate",
  missing_data: "Missing Data",
  stale_data: "Stale Data",
  schema_issue: "Schema",
  business_rule: "Business Rule",
  other: "Other",
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "var(--danger-bg)", text: "var(--danger-text)", border: "var(--danger-border)" },
  high: { bg: "var(--warning-bg)", text: "var(--warning-text)", border: "var(--warning-border)" },
  normal: { bg: "var(--info-bg)", text: "var(--info-text)", border: "var(--info-border)" },
  low: { bg: "var(--section-bg)", text: "var(--muted)", border: "var(--border)" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
  confirmed: { bg: "var(--info-bg)", text: "var(--info-text)" },
  in_progress: { bg: "var(--primary)", text: "var(--primary-foreground)" },
  resolved: { bg: "var(--success-bg)", text: "var(--success-text)" },
  rejected: { bg: "var(--section-bg)", text: "var(--muted)" },
  wont_fix: { bg: "var(--section-bg)", text: "var(--muted)" },
};

export default function DataImprovementsPage() {
  const [activeTab, setActiveTab] = useState("pending");
  const [improvements, setImprovements] = useState<DataImprovement[]>([]);
  const [counts, setCounts] = useState<ImprovementCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImprovement, setSelectedImprovement] = useState<DataImprovement | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchImprovements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/data-improvements?status=${activeTab}`);
      if (!res.ok) throw new Error("Failed to fetch improvements");
      const data = await res.json();
      setImprovements(data.improvements);
      setCounts(data.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load improvements");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchImprovements();
  }, [fetchImprovements]);

  const updateImprovement = async (id: string, updates: Record<string, unknown>) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/data-improvements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) throw new Error("Failed to update");

      fetchImprovements();
      setSelectedImprovement(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setUpdating(false);
    }
  };

  const exportImprovements = async (format: "json" | "markdown") => {
    try {
      const res = await fetch(`/api/admin/data-improvements/export?format=${format}`);
      if (!res.ok) throw new Error("Failed to export");

      if (format === "markdown") {
        const text = await res.text();
        const blob = new Blob([text], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `data-improvements-${new Date().toISOString().split("T")[0]}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `data-improvements-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export");
    }
  };

  const getEntityLink = (imp: DataImprovement) => {
    if (!imp.entity_type || !imp.entity_id) return null;
    const paths: Record<string, string> = {
      place: "/places",
      cat: "/cats",
      person: "/people",
      request: "/requests",
    };
    const path = paths[imp.entity_type];
    if (!path) return null;
    return `${path}/${imp.entity_id}`;
  };

  return (
    <div style={{ padding: "24px 0" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "8px" }}>
            Data Improvements Queue
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Track and resolve data accuracy issues for Claude Code review
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => exportImprovements("markdown")}
            style={{
              padding: "8px 16px",
              background: "var(--section-bg)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Export Markdown
          </button>
          <button
            onClick={() => exportImprovements("json")}
            style={{
              padding: "8px 16px",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Export JSON
          </button>
        </div>
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
                {counts[tab.value as keyof ImprovementCounts] || 0}
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
          Loading improvements...
        </div>
      ) : improvements.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          No {activeTab === "all" ? "" : activeTab} improvements found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {improvements.map((imp) => (
            <div
              key={imp.improvement_id}
              style={{
                background: "var(--card-bg)",
                border: `1px solid ${PRIORITY_COLORS[imp.priority]?.border || "var(--border)"}`,
                borderLeft: `4px solid ${PRIORITY_COLORS[imp.priority]?.text || "var(--border)"}`,
                borderRadius: "12px",
                padding: "16px",
                cursor: "pointer",
              }}
              onClick={() => setSelectedImprovement(imp)}
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
                      background: PRIORITY_COLORS[imp.priority]?.bg,
                      color: PRIORITY_COLORS[imp.priority]?.text,
                      borderRadius: "4px",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    {imp.priority}
                  </span>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: STATUS_COLORS[imp.status]?.bg || "var(--section-bg)",
                      color: STATUS_COLORS[imp.status]?.text || "var(--muted)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      textTransform: "capitalize",
                    }}
                  >
                    {imp.status.replace("_", " ")}
                  </span>
                  <span
                    style={{
                      padding: "4px 8px",
                      background: "var(--section-bg)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                    }}
                  >
                    {CATEGORY_LABELS[imp.category] || imp.category}
                  </span>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {new Date(imp.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Title */}
              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "8px" }}>
                {imp.title}
              </h3>

              {/* Description */}
              <p
                style={{
                  fontSize: "0.875rem",
                  color: "var(--muted)",
                  marginBottom: "12px",
                  maxHeight: "40px",
                  overflow: "hidden",
                }}
              >
                {imp.description}
              </p>

              {/* Entity and Source */}
              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                }}
              >
                {imp.entity_type && (
                  <span>
                    {imp.entity_type}: {imp.entity_name || imp.entity_id}
                  </span>
                )}
                <span>Source: {imp.source.replace("_", " ")}</span>
                {imp.fix_sql && <span style={{ color: "var(--success-text)" }}>Has SQL fix</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedImprovement && (
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
          onClick={() => setSelectedImprovement(null)}
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
                {selectedImprovement.title}
              </h2>
              <button
                onClick={() => setSelectedImprovement(null)}
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

            {/* Badges */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "4px 10px",
                  background: PRIORITY_COLORS[selectedImprovement.priority]?.bg,
                  color: PRIORITY_COLORS[selectedImprovement.priority]?.text,
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                }}
              >
                {selectedImprovement.priority} priority
              </span>
              <span
                style={{
                  padding: "4px 10px",
                  background: STATUS_COLORS[selectedImprovement.status]?.bg,
                  color: STATUS_COLORS[selectedImprovement.status]?.text,
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                }}
              >
                {selectedImprovement.status.replace("_", " ")}
              </span>
              <span
                style={{
                  padding: "4px 10px",
                  background: "var(--section-bg)",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                }}
              >
                {CATEGORY_LABELS[selectedImprovement.category]}
              </span>
            </div>

            {/* Description */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                Description
              </div>
              <div
                style={{
                  background: "var(--section-bg)",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "0.875rem",
                }}
              >
                {selectedImprovement.description}
              </div>
            </div>

            {/* Entity */}
            {selectedImprovement.entity_type && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Affected Record
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
                    {selectedImprovement.entity_type}
                  </span>
                  {getEntityLink(selectedImprovement) && (
                    <a
                      href={getEntityLink(selectedImprovement)!}
                      style={{ color: "var(--primary)", textDecoration: "none" }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {selectedImprovement.entity_name || selectedImprovement.entity_id} →
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Suggested Fix */}
            {selectedImprovement.suggested_fix && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Suggested Fix
                </div>
                <pre
                  style={{
                    background: "var(--section-bg)",
                    padding: "12px",
                    borderRadius: "8px",
                    fontSize: "0.8rem",
                    overflow: "auto",
                    maxHeight: "150px",
                  }}
                >
                  {JSON.stringify(selectedImprovement.suggested_fix, null, 2)}
                </pre>
              </div>
            )}

            {/* SQL Fix */}
            {selectedImprovement.fix_sql && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  SQL Fix
                </div>
                <pre
                  style={{
                    background: "#1e1e1e",
                    color: "#d4d4d4",
                    padding: "12px",
                    borderRadius: "8px",
                    fontSize: "0.8rem",
                    overflow: "auto",
                    maxHeight: "200px",
                  }}
                >
                  {selectedImprovement.fix_sql}
                </pre>
              </div>
            )}

            {/* Resolution notes */}
            {selectedImprovement.resolution_notes && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "6px" }}>
                  Resolution Notes
                </div>
                <div
                  style={{
                    background: "var(--success-bg)",
                    padding: "12px",
                    borderRadius: "8px",
                    fontSize: "0.875rem",
                  }}
                >
                  {selectedImprovement.resolution_notes}
                </div>
              </div>
            )}

            {/* Source info */}
            <div
              style={{
                marginBottom: "16px",
                padding: "12px",
                background: "var(--section-bg)",
                borderRadius: "8px",
                fontSize: "0.8rem",
              }}
            >
              <div>
                <strong>Source:</strong> {selectedImprovement.source.replace("_", " ")}
              </div>
              <div>
                <strong>Created:</strong> {new Date(selectedImprovement.created_at).toLocaleString()}
              </div>
              {selectedImprovement.resolved_at && (
                <div>
                  <strong>Resolved:</strong>{" "}
                  {new Date(selectedImprovement.resolved_at).toLocaleString()} by{" "}
                  {selectedImprovement.resolver_name}
                </div>
              )}
            </div>

            {/* Actions */}
            {!["resolved", "rejected", "wont_fix"].includes(selectedImprovement.status) && (
              <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
                <button
                  onClick={() => updateImprovement(selectedImprovement.improvement_id, { status: "resolved" })}
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
                {selectedImprovement.status === "pending" && (
                  <button
                    onClick={() => updateImprovement(selectedImprovement.improvement_id, { status: "confirmed" })}
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
                    Confirm Issue
                  </button>
                )}
                <button
                  onClick={() => updateImprovement(selectedImprovement.improvement_id, { status: "wont_fix" })}
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
                  Won't Fix
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
