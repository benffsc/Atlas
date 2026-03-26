"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { SkeletonList } from "@/components/feedback/Skeleton";

interface Anomaly {
  anomaly_id: string;
  conversation_id: string | null;
  staff_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_display_name: string | null;
  anomaly_type: string;
  description: string;
  evidence: Record<string, unknown>;
  severity: string;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: string;
  flagged_by_name: string | null;
  resolved_by_name: string | null;
}

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: "#fecaca", text: "#991b1b" },
  high: { bg: "#fed7aa", text: "#9a3412" },
  medium: { bg: "#fef3c7", text: "#92400e" },
  low: { bg: "#e0e7ff", text: "#3730a3" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: "#dbeafe", text: "#1e40af" },
  acknowledged: { bg: "#fef3c7", text: "#92400e" },
  investigating: { bg: "#fce7f3", text: "#9d174d" },
  resolved: { bg: "#d1fae5", text: "#065f46" },
  wont_fix: { bg: "#f3f4f6", text: "#6b7280" },
};

const STATUS_OPTIONS = ["new", "acknowledged", "investigating", "resolved", "wont_fix", "all"];

export default function AnomaliesPage() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("new");
  const [severityFilter, setSeverityFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<{ id: string; status: string; notes: string } | null>(null);

  const fetchAnomalies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (severityFilter) params.set("severity", severityFilter);

      const data = await fetchApi(`/api/admin/anomalies?${params}`) as { anomalies: Anomaly[]; total: number };
      setAnomalies(data.anomalies || []);
      setTotal(data.total || 0);
    } catch {
      setAnomalies([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter]);

  useEffect(() => {
    fetchAnomalies();
  }, [fetchAnomalies]);

  const handleUpdateStatus = async () => {
    if (!updateStatus) return;
    try {
      await fetch("/api/admin/anomalies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anomaly_id: updateStatus.id,
          status: updateStatus.status,
          resolution_notes: updateStatus.notes || undefined,
        }),
      });
      setUpdateStatus(null);
      fetchAnomalies();
    } catch {
      // Ignore
    }
  };

  const copyToClipboard = (anomaly: Anomaly) => {
    const md = `## Anomaly: ${anomaly.anomaly_type}\n\n` +
      `**Severity:** ${anomaly.severity}\n` +
      `**Flagged by:** ${anomaly.flagged_by_name || "Tippy"}\n` +
      `**Date:** ${new Date(anomaly.created_at).toLocaleDateString()}\n\n` +
      `### Description\n${anomaly.description}\n\n` +
      (anomaly.entity_display_name ? `**Entity:** ${anomaly.entity_type} — ${anomaly.entity_display_name}\n\n` : "") +
      (Object.keys(anomaly.evidence).length > 0 ? `### Evidence\n\`\`\`json\n${JSON.stringify(anomaly.evidence, null, 2)}\n\`\`\`\n` : "");

    navigator.clipboard.writeText(md);
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "4px" }}>
          Tippy Anomalies
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Data anomalies flagged by Tippy during conversations. {total} total.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--card-border)",
                background: statusFilter === s ? "var(--primary)" : "var(--card-bg)",
                color: statusFilter === s ? "#fff" : "inherit",
                cursor: "pointer",
                fontSize: "0.8rem",
                textTransform: "capitalize",
              }}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: "6px",
            border: "1px solid var(--card-border)",
            background: "var(--card-bg)",
            fontSize: "0.8rem",
          }}
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: "1rem 0" }}><SkeletonList items={5} /></div>
      ) : anomalies.length === 0 ? (
        <div style={{
          padding: "48px",
          textAlign: "center",
          color: "var(--text-muted)",
          border: "1px solid var(--card-border)",
          borderRadius: "8px",
        }}>
          No anomalies found for this filter.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {anomalies.map(a => {
            const sevColor = SEVERITY_COLORS[a.severity] || SEVERITY_COLORS.medium;
            const statColor = STATUS_COLORS[a.status] || STATUS_COLORS.new;
            const isExpanded = expandedId === a.anomaly_id;

            return (
              <div
                key={a.anomaly_id}
                style={{
                  border: "1px solid var(--card-border)",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  background: "var(--card-bg)",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
                  onClick={() => setExpandedId(isExpanded ? null : a.anomaly_id)}
                >
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    background: sevColor.bg,
                    color: sevColor.text,
                    textTransform: "uppercase",
                  }}>
                    {a.severity}
                  </span>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "0.7rem",
                    background: statColor.bg,
                    color: statColor.text,
                    textTransform: "capitalize",
                  }}>
                    {a.status.replace("_", " ")}
                  </span>
                  <span style={{ fontSize: "0.8rem", fontWeight: 500, flex: 1 }}>
                    {a.anomaly_type.replace(/_/g, " ")}
                    {a.entity_display_name && (
                      <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                        {" "}— {a.entity_display_name}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                  <span style={{ fontSize: "0.8rem" }}>{isExpanded ? "^" : "v"}</span>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--card-border)" }}>
                    <p style={{ fontSize: "0.85rem", marginBottom: "8px" }}>{a.description}</p>

                    {a.flagged_by_name && (
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                        Flagged by: {a.flagged_by_name}
                      </p>
                    )}

                    {Object.keys(a.evidence).length > 0 && (
                      <details style={{ marginBottom: "8px" }}>
                        <summary style={{ fontSize: "0.8rem", cursor: "pointer", color: "var(--text-muted)" }}>
                          Evidence
                        </summary>
                        <pre style={{
                          fontSize: "0.75rem",
                          background: "var(--card-border)",
                          padding: "8px",
                          borderRadius: "4px",
                          overflow: "auto",
                          maxHeight: "200px",
                          marginTop: "4px",
                        }}>
                          {JSON.stringify(a.evidence, null, 2)}
                        </pre>
                      </details>
                    )}

                    {a.resolution_notes && (
                      <p style={{ fontSize: "0.8rem", fontStyle: "italic", color: "var(--text-muted)", marginBottom: "8px" }}>
                        Resolution: {a.resolution_notes} ({a.resolved_by_name})
                      </p>
                    )}

                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      {a.status === "new" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setUpdateStatus({ id: a.anomaly_id, status: "acknowledged", notes: "" });
                          }}
                          style={{
                            padding: "4px 12px",
                            borderRadius: "4px",
                            border: "1px solid var(--card-border)",
                            background: "var(--card-bg)",
                            fontSize: "0.8rem",
                            cursor: "pointer",
                          }}
                        >
                          Acknowledge
                        </button>
                      )}
                      {a.status !== "resolved" && a.status !== "wont_fix" && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setUpdateStatus({ id: a.anomaly_id, status: "resolved", notes: "" });
                            }}
                            style={{
                              padding: "4px 12px",
                              borderRadius: "4px",
                              border: "none",
                              background: "#d1fae5",
                              color: "#065f46",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                            }}
                          >
                            Resolve
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setUpdateStatus({ id: a.anomaly_id, status: "wont_fix", notes: "" });
                            }}
                            style={{
                              padding: "4px 12px",
                              borderRadius: "4px",
                              border: "1px solid var(--card-border)",
                              background: "var(--card-bg)",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              color: "var(--text-muted)",
                            }}
                          >
                            Won&apos;t Fix
                          </button>
                        </>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(a);
                        }}
                        title="Copy as markdown (for Linear issue)"
                        style={{
                          padding: "4px 12px",
                          borderRadius: "4px",
                          border: "1px solid var(--card-border)",
                          background: "var(--card-bg)",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                          marginLeft: "auto",
                        }}
                      >
                        Copy for Linear
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Status update modal */}
      {updateStatus && (
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
          onClick={() => setUpdateStatus(null)}
        >
          <div
            style={{
              background: "var(--card-bg, #fff)",
              borderRadius: "12px",
              padding: "24px",
              width: "400px",
              maxWidth: "90vw",
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "12px" }}>
              {updateStatus.status === "resolved" ? "Resolve" : updateStatus.status === "wont_fix" ? "Won't Fix" : "Update"} Anomaly
            </h3>
            <textarea
              placeholder="Resolution notes (optional)"
              value={updateStatus.notes}
              onChange={e => setUpdateStatus({ ...updateStatus, notes: e.target.value })}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid var(--card-border)",
                minHeight: "80px",
                fontSize: "0.85rem",
                marginBottom: "12px",
              }}
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setUpdateStatus(null)}
                style={{
                  padding: "6px 16px",
                  borderRadius: "6px",
                  border: "1px solid var(--card-border)",
                  background: "var(--card-bg)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateStatus}
                style={{
                  padding: "6px 16px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--primary)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
