"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

interface QueueItem {
  id: string;
  entity_type: string;
  entity_id: string;
  issue_type: string;
  suggested_action: string;
  details: Record<string, unknown>;
  status: string;
  created_at: string;
  entity_details: Record<string, unknown> | null;
  request_details: {
    summary: string;
    status: string;
    place_address: string;
  } | null;
}

interface QueueResponse {
  items: QueueItem[];
  total: number;
  limit: number;
  offset: number;
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  potential_request_match: "Appointment-Request Match",
  phone_address_mismatch: "Phone/Address Mismatch",
};

const ISSUE_TYPE_COLORS: Record<string, string> = {
  potential_request_match: "#3b82f6",
  phone_address_mismatch: "#f59e0b",
};

export default function ReviewQueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const limit = 50;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
        status: "pending",
      });
      if (issueFilter) params.set("issue_type", issueFilter);
      const result = await fetchApi<QueueResponse>(
        `/api/admin/review-queue?${params}`
      );
      setData(result);
      setError(null);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [issueFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAction = async (itemId: string, action: "approve" | "dismiss") => {
    setActionLoading(itemId);
    try {
      await postApi("/api/admin/review-queue", { id: itemId, action }, { method: "PATCH" });
      if (data) {
        setData({
          ...data,
          items: data.items.filter((i) => i.id !== itemId),
          total: data.total - 1,
        });
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    } catch {
      // Error handled by postApi
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkAction = async (action: "approve" | "dismiss") => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await postApi("/api/admin/review-queue", { ids: Array.from(selected), action }, { method: "PATCH" });
      if (data) {
        setData({
          ...data,
          items: data.items.filter((i) => !selected.has(i.id)),
          total: data.total - selected.size,
        });
      }
      setSelected(new Set());
    } catch {
      // Error handled by postApi
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    if (selected.size === data.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.items.map((i) => i.id)));
    }
  };

  const formatAddress = (addr: unknown): string => {
    if (!addr || typeof addr !== "string") return "\u2014";
    return addr.length > 60 ? addr.slice(0, 57) + "..." : addr;
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Data Quality Review Queue</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
            {data ? `${data.total} pending item${data.total !== 1 ? "s" : ""}` : "Loading..."}
          </p>
        </div>
        <a href="/admin" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          Back to Admin
        </a>
      </div>

      {/* Filters + Bulk Actions */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={issueFilter}
          onChange={(e) => { setIssueFilter(e.target.value); setPage(0); }}
          style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem" }}
        >
          <option value="">All types</option>
          <option value="potential_request_match">Appointment-Request Match</option>
          <option value="phone_address_mismatch">Phone/Address Mismatch</option>
        </select>

        {data && data.items.length > 0 && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selected.size === data.items.length && data.items.length > 0}
                onChange={toggleSelectAll}
              />
              Select all ({data.items.length})
            </label>

            {selected.size > 0 && (
              <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)", alignSelf: "center" }}>
                  {selected.size} selected
                </span>
                <button
                  onClick={() => handleBulkAction("approve")}
                  disabled={bulkLoading}
                  style={{
                    padding: "0.4rem 0.75rem", borderRadius: "6px", border: "none",
                    background: "#10b981", color: "white", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
                    opacity: bulkLoading ? 0.5 : 1,
                  }}
                >
                  Approve Selected
                </button>
                <button
                  onClick={() => handleBulkAction("dismiss")}
                  disabled={bulkLoading}
                  style={{
                    padding: "0.4rem 0.75rem", borderRadius: "6px",
                    border: "1px solid var(--border)", background: "var(--background)", color: "#6b7280",
                    fontSize: "0.8rem", cursor: "pointer", opacity: bulkLoading ? 0.5 : 1,
                  }}
                >
                  Dismiss Selected
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "#fee2e2", borderRadius: "8px", marginBottom: "1rem", color: "#991b1b" }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>Loading...</div>
      )}

      {data && data.items.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          No pending items to review.
        </div>
      )}

      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {data?.items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: "1rem 1.25rem",
              background: selected.has(item.id) ? "#f0fdf4" : "white",
              borderRadius: "8px",
              border: `1px solid ${selected.has(item.id) ? "#86efac" : "var(--border)"}`,
              opacity: actionLoading === item.id || bulkLoading ? 0.5 : 1,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: "0.75rem", flex: 1 }}>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  style={{ marginTop: "0.2rem" }}
                />
                <div style={{ flex: 1 }}>
                  {/* Issue type badge */}
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "white",
                      background: ISSUE_TYPE_COLORS[item.issue_type] || "#6b7280",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {ISSUE_TYPE_LABELS[item.issue_type] || item.issue_type}
                  </span>

                  {/* Match details */}
                  {item.issue_type === "potential_request_match" && (
                    <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
                      <div>
                        <strong>Appointment:</strong>{" "}
                        {item.entity_details?.client_name as string || "Unknown"}{" "}
                        <span style={{ color: "var(--muted)" }}>
                          ({item.entity_details?.appointment_date as string || "?"})
                        </span>
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                        Appt address: {formatAddress(item.details?.appointment_address)}
                      </div>
                      {item.request_details && (
                        <div style={{ marginTop: "0.25rem" }}>
                          <strong>Request:</strong>{" "}
                          {item.request_details.summary}
                          <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                            Request address: {formatAddress(item.request_details.place_address)}
                          </div>
                        </div>
                      )}
                      {item.details?.similarity != null && (
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                          Match type: {item.details?.match_type as string}{" "}
                          (similarity: {Number(item.details.similarity).toFixed(2)})
                        </div>
                      )}
                    </div>
                  )}

                  {item.issue_type === "phone_address_mismatch" && (
                    <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
                      <div>
                        <strong>Appointment phone:</strong> {item.details?.appointment_phone as string || "?"}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                        Appt address: {formatAddress(item.details?.appointment_address)}
                      </div>
                      <div style={{ marginTop: "0.25rem" }}>
                        <strong>Person:</strong> {item.details?.person_name as string || "?"}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                        Person address: {formatAddress(item.details?.person_address)}
                      </div>
                      {item.details?.address_similarity != null && (
                        <div style={{ fontSize: "0.8rem", color: "#ef4444", marginTop: "0.25rem" }}>
                          Address similarity: {Number(item.details.address_similarity).toFixed(2)} (threshold: 0.5)
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                    Queued {new Date(item.created_at).toLocaleDateString()} | ID: {item.entity_id.slice(0, 8)}...
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "0.5rem", marginLeft: "1rem" }}>
                <button
                  onClick={() => handleAction(item.id, "approve")}
                  disabled={actionLoading === item.id || bulkLoading}
                  style={{
                    padding: "0.4rem 0.75rem", borderRadius: "6px", border: "none",
                    background: "#10b981", color: "white", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => handleAction(item.id, "dismiss")}
                  disabled={actionLoading === item.id || bulkLoading}
                  style={{
                    padding: "0.4rem 0.75rem", borderRadius: "6px",
                    border: "1px solid var(--border)", background: "var(--background)", color: "#6b7280",
                    fontSize: "0.8rem", cursor: "pointer",
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {data && data.total > limit && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem", fontSize: "0.85rem" }}>
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.5 : 1 }}
          >
            Previous
          </button>
          <span style={{ color: "var(--muted)" }}>
            Page {page + 1} of {Math.ceil(data.total / limit)}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={(page + 1) * limit >= data.total}
            style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", cursor: (page + 1) * limit >= data.total ? "not-allowed" : "pointer", opacity: (page + 1) * limit >= data.total ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
