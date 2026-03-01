"use client";

import { useState, useEffect } from "react";

interface EditRecord {
  edit_id: string;
  edit_type: string;
  field_name: string | null;
  old_value: unknown;
  new_value: unknown;
  related_entity_type: string | null;
  related_entity_id: string | null;
  related_entity_name: string | null;
  reason: string | null;
  editor: string;
  edit_source: string;
  created_at: string;
  is_rolled_back: boolean;
}

interface EditHistoryProps {
  entityType: "person" | "cat" | "place" | "request";
  entityId: string;
  limit?: number;
  onClose?: () => void;
}

export function EditHistory({
  entityType,
  entityId,
  limit = 50,
  onClose,
}: EditHistoryProps) {
  const [history, setHistory] = useState<EditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const response = await fetch(
          `/api/entities/${entityType}/${entityId}/history?limit=${limit}`
        );
        const data = await response.json();
        setHistory(data.history || []);
      } catch (err) {
        setError("Failed to load history");
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
  }, [entityType, entityId, limit]);

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "(empty)";
    if (typeof value === "string") return value || "(empty)";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return value.toString();
    return JSON.stringify(value);
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const mins = Math.floor(diff / (1000 * 60));
        return `${mins}m ago`;
      }
      return `${hours}h ago`;
    }
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  const getEditTypeLabel = (editType: string): string => {
    const labels: Record<string, string> = {
      field_update: "Updated",
      ownership_transfer: "Ownership Transfer",
      identifier_change: "Identifier Changed",
      address_correction: "Address Corrected",
      merge: "Merged",
      split: "Split",
      link: "Linked",
      unlink: "Unlinked",
      create: "Created",
      delete: "Deleted",
      restore: "Restored",
    };
    return labels[editType] || editType;
  };

  const getEditTypeColor = (editType: string): string => {
    const colors: Record<string, string> = {
      field_update: "#6c757d",
      ownership_transfer: "#0d6efd",
      identifier_change: "#ffc107",
      address_correction: "#198754",
      merge: "#6f42c1",
      link: "#20c997",
      unlink: "#dc3545",
      create: "#198754",
      delete: "#dc3545",
    };
    return colors[editType] || "#6c757d";
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
        Loading history...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: "1rem",
        background: "var(--danger-bg)",
        color: "var(--danger-text)",
        borderRadius: "4px",
      }}>
        {error}
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "1rem",
        padding: "0 0.5rem",
      }}>
        <h3 style={{ margin: 0 }}>Edit History</h3>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.2rem",
              cursor: "pointer",
              color: "var(--muted)",
            }}
          >
            x
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div style={{
          padding: "2rem",
          textAlign: "center",
          color: "var(--muted)",
          background: "var(--section-bg)",
          borderRadius: "4px",
        }}>
          No edit history found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {history.map((edit) => (
            <div
              key={edit.edit_id}
              style={{
                padding: "0.75rem",
                background: edit.is_rolled_back ? "var(--muted-bg)" : "var(--section-bg)",
                borderRadius: "4px",
                borderLeft: `3px solid ${getEditTypeColor(edit.edit_type)}`,
                opacity: edit.is_rolled_back ? 0.6 : 1,
              }}
            >
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "0.5rem",
              }}>
                <span style={{
                  fontSize: "0.75rem",
                  padding: "0.15rem 0.5rem",
                  background: getEditTypeColor(edit.edit_type),
                  color: "white",
                  borderRadius: "3px",
                }}>
                  {getEditTypeLabel(edit.edit_type)}
                </span>
                <span style={{
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                }}>
                  {formatDate(edit.created_at)}
                </span>
              </div>

              {edit.field_name && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong style={{ fontSize: "0.9rem" }}>
                    {edit.field_name.replace(/_/g, " ")}
                  </strong>
                </div>
              )}

              {(edit.old_value !== null || edit.new_value !== null) && (
                <div style={{
                  display: "flex",
                  gap: "1rem",
                  fontSize: "0.85rem",
                }}>
                  {edit.old_value !== null && (
                    <div>
                      <span style={{ color: "var(--muted)" }}>From: </span>
                      <span style={{ textDecoration: "line-through", color: "var(--danger-text)" }}>
                        {formatValue(edit.old_value)}
                      </span>
                    </div>
                  )}
                  {edit.new_value !== null && (
                    <div>
                      <span style={{ color: "var(--muted)" }}>To: </span>
                      <span style={{ color: "var(--success-text)" }}>
                        {formatValue(edit.new_value)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {edit.related_entity_name && (
                <div style={{
                  fontSize: "0.85rem",
                  marginTop: "0.5rem",
                  color: "var(--muted)",
                }}>
                  Related: {edit.related_entity_type} "{edit.related_entity_name}"
                </div>
              )}

              {edit.reason && (
                <div style={{
                  fontSize: "0.85rem",
                  marginTop: "0.5rem",
                  fontStyle: "italic",
                  color: "var(--muted)",
                }}>
                  Reason: {edit.reason}
                </div>
              )}

              <div style={{
                fontSize: "0.75rem",
                marginTop: "0.5rem",
                color: "var(--muted)",
              }}>
                By {edit.editor} via {edit.edit_source}
                {edit.is_rolled_back && " (rolled back)"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default EditHistory;
