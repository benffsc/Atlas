"use client";

import { useState, useEffect, useCallback } from "react";
import { formatPhone } from "@/lib/formatters";

interface Tier4ReviewItem {
  duplicate_id: string;
  existing_person_id: string;
  potential_match_id: string;
  match_type: string;
  name_similarity: number;
  status: string;
  detected_at: string;
  existing_name: string;
  existing_created_at: string;
  existing_emails: string[] | null;
  existing_phones: string[] | null;
  new_name: string;
  new_source: string | null;
  shared_address: string | null;
  existing_cat_count: number;
  existing_request_count: number;
  existing_appointment_count: number;
  decision_id: string | null;
  decision_reason: string | null;
  incoming_email: string | null;
  incoming_phone: string | null;
  incoming_address: string | null;
  hours_in_queue: number;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

interface ReviewStats {
  total_pending: number;
  same_name_same_address: number;
  tier4_same_name_same_address: number;
  avg_hours_in_queue: number;
}

interface ReviewResponse {
  reviews: Tier4ReviewItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
  stats: ReviewStats;
}

const MATCH_TYPE_TABS = [
  { type: null, label: "All", color: "#6c757d" },
  { type: "same_name_same_address", label: "Same Name + Address", color: "#6f42c1" },
  { type: "tier4_same_name_same_address", label: "Tier 4 Prevention", color: "#0d6efd" },
];

function matchTypeLabel(type: string): string {
  return MATCH_TYPE_TABS.find((t) => t.type === type)?.label || type;
}

function matchTypeColor(type: string): string {
  return MATCH_TYPE_TABS.find((t) => t.type === type)?.color || "#6c757d";
}

function formatHoursInQueue(hours: number): string {
  if (hours < 1) return "< 1 hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

function PersonStats({
  cats,
  requests,
  appointments,
}: {
  cats: number;
  requests: number;
  appointments: number;
}) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8rem", flexWrap: "wrap" }}>
      <span title="Cat relationships">{cats} cats</span>
      <span title="Requests as requester">{requests} requests</span>
      <span title="Appointments">{appointments} appts</span>
    </div>
  );
}

export default function MergeReviewPage() {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchType, setMatchType] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState(false);

  const limit = 30;

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (matchType) params.set("match_type", matchType);

      const res = await fetch(`/api/admin/merge-review?${params}`);
      const result = await res.json();
      setData(result);
    } catch (error) {
      console.error("Failed to fetch reviews:", error);
    } finally {
      setLoading(false);
    }
  }, [matchType, offset]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [matchType]);

  const handleResolve = async (
    duplicateId: string,
    action: "merge" | "keep_separate" | "dismiss"
  ) => {
    setResolving(duplicateId);
    try {
      const res = await fetch(`/api/admin/merge-review/${duplicateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, resolved_by: "staff_ui" }),
      });
      if (res.ok) {
        fetchReviews();
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(duplicateId);
          return next;
        });
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (error) {
      console.error("Failed to resolve:", error);
    } finally {
      setResolving(null);
    }
  };

  const handleBatchResolve = async (action: "merge" | "keep_separate" | "dismiss") => {
    if (!selected.size) return;
    const actionLabel =
      action === "merge"
        ? "Merge"
        : action === "keep_separate"
          ? "Keep separate"
          : "Dismiss";
    if (!confirm(`${actionLabel} ${selected.size} selected review(s)?`)) return;

    setBatchAction(true);
    const ids = Array.from(selected);
    let successCount = 0;
    let errorCount = 0;

    for (const id of ids) {
      try {
        const res = await fetch(`/api/admin/merge-review/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, resolved_by: "staff_ui_batch" }),
        });
        if (res.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    if (errorCount > 0) {
      alert(`${successCount} succeeded, ${errorCount} failed`);
    }
    setSelected(new Set());
    fetchReviews();
    setBatchAction(false);
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (!data) return;
    if (selected.size === data.reviews.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.reviews.map((r) => r.duplicate_id)));
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Person Merge Review</h1>
          <p className="text-muted">
            Review same-name-same-address duplicate candidates for merging
          </p>
        </div>
        <a
          href="/admin/person-dedup"
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            textDecoration: "none",
            color: "var(--foreground)",
          }}
        >
          Full Dedup Review
        </a>
      </div>

      {/* Stats Dashboard */}
      {data?.stats && (
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-muted, #f8f9fa)",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "80px",
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {data.stats.total_pending}
            </div>
            <div className="text-muted text-sm">Pending</div>
          </div>
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-muted, #f8f9fa)",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "80px",
              borderLeft: "3px solid #6f42c1",
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {data.stats.same_name_same_address}
            </div>
            <div className="text-muted text-sm">Cleanup</div>
          </div>
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-muted, #f8f9fa)",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "80px",
              borderLeft: "3px solid #0d6efd",
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {data.stats.tier4_same_name_same_address}
            </div>
            <div className="text-muted text-sm">Prevention</div>
          </div>
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-muted, #f8f9fa)",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "100px",
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {formatHoursInQueue(data.stats.avg_hours_in_queue)}
            </div>
            <div className="text-muted text-sm">Avg Queue Time</div>
          </div>
        </div>
      )}

      {/* Guidance */}
      <div
        className="card"
        style={{
          padding: "1rem",
          marginBottom: "1.5rem",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem" }}>
          Review Guide:
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8125rem", color: "#334155" }}>
          <li>
            <strong>Cleanup:</strong> Existing duplicates found by MIG_939 (same name + same address). Usually safe to <strong>Merge</strong>.
          </li>
          <li>
            <strong>Prevention:</strong> New data caught by Tier 4 prevention before creating duplicates. Compare carefully.
          </li>
          <li>
            <strong>Different phones:</strong> Same person with new phone? <strong>Merge</strong>. Different people at same address? <strong>Keep Separate</strong>.
          </li>
        </ul>
      </div>

      {/* Match Type Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        {MATCH_TYPE_TABS.map((tab) => {
          const count =
            tab.type === null
              ? data?.stats.total_pending || 0
              : tab.type === "same_name_same_address"
                ? data?.stats.same_name_same_address || 0
                : data?.stats.tier4_same_name_same_address || 0;
          return (
            <button
              key={tab.type || "all"}
              onClick={() => setMatchType(tab.type)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: matchType === tab.type ? tab.color : "transparent",
                color: matchType === tab.type ? "#fff" : "var(--foreground)",
                cursor: "pointer",
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: "0.5rem",
                  background:
                    matchType === tab.type
                      ? "rgba(255,255,255,0.2)"
                      : "var(--bg-muted)",
                  padding: "0.15rem 0.4rem",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Batch Actions Bar */}
      {selected.size > 0 && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            padding: "0.75rem 1rem",
            background: "var(--bg-muted, #f8f9fa)",
            borderRadius: "8px",
            marginBottom: "1rem",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 500, marginRight: "0.5rem" }}>
            {selected.size} selected
          </span>
          <button
            onClick={() => handleBatchResolve("merge")}
            disabled={batchAction}
            style={{
              padding: "0.4rem 0.75rem",
              background: "#fd7e14",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Merge All
          </button>
          <button
            onClick={() => handleBatchResolve("keep_separate")}
            disabled={batchAction}
            style={{
              padding: "0.4rem 0.75rem",
              background: "#198754",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Keep All Separate
          </button>
          <button
            onClick={() => handleBatchResolve("dismiss")}
            disabled={batchAction}
            style={{
              padding: "0.4rem 0.75rem",
              background: "#6c757d",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Dismiss All
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{
              padding: "0.4rem 0.75rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Clear
          </button>
        </div>
      )}

      {loading && <div className="loading">Loading reviews...</div>}

      {!loading && data?.reviews.length === 0 && (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>No pending reviews</div>
          <p className="text-muted">All merge candidates have been resolved</p>
        </div>
      )}

      {/* Select All */}
      {!loading && data && data.reviews.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}>
          <label style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={selected.size === data.reviews.length}
              onChange={selectAll}
              style={{ marginRight: "0.5rem" }}
            />
            Select all on this page
          </label>
        </div>
      )}

      {/* Review Cards */}
      {!loading &&
        data?.reviews.map((review) => {
          const isSelected = selected.has(review.duplicate_id);
          const isResolving = resolving === review.duplicate_id;

          return (
            <div
              key={review.duplicate_id}
              className="card"
              style={{
                padding: "1.25rem",
                marginBottom: "0.75rem",
                borderLeft: `4px solid ${matchTypeColor(review.match_type)}`,
                opacity: isResolving ? 0.6 : 1,
                background: isSelected ? "rgba(13, 110, 253, 0.05)" : undefined,
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(review.duplicate_id)}
                  />
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.2rem 0.5rem",
                      background: matchTypeColor(review.match_type),
                      color: "#fff",
                      borderRadius: "4px",
                    }}
                  >
                    {matchTypeLabel(review.match_type)}
                  </span>
                  {review.shared_address && (
                    <span className="text-muted text-sm">
                      @ {review.shared_address.length > 40
                        ? review.shared_address.substring(0, 40) + "..."
                        : review.shared_address}
                    </span>
                  )}
                </div>
                <span className="text-muted text-sm">
                  In queue: {formatHoursInQueue(review.hours_in_queue)}
                </span>
              </div>

              {/* Side-by-side Comparison */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  gap: "1rem",
                  alignItems: "stretch",
                }}
              >
                {/* Existing Person (Keep) */}
                <div
                  style={{
                    padding: "0.75rem",
                    background: "rgba(25, 135, 84, 0.08)",
                    borderRadius: "8px",
                    border: "1px solid rgba(25, 135, 84, 0.2)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.65rem",
                      textTransform: "uppercase",
                      color: "#198754",
                      marginBottom: "0.25rem",
                      fontWeight: 600,
                    }}
                  >
                    Existing (Keep)
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "1rem",
                      marginBottom: "0.5rem",
                    }}
                  >
                    <a href={`/people/${review.existing_person_id}`}>
                      {review.existing_name || "(no name)"}
                    </a>
                  </div>
                  {review.existing_emails && review.existing_emails.length > 0 && (
                    <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                      <span className="text-muted">Email:</span> {review.existing_emails[0]}
                      {review.existing_emails.length > 1 && ` +${review.existing_emails.length - 1}`}
                    </div>
                  )}
                  {review.existing_phones && review.existing_phones.length > 0 && (
                    <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                      <span className="text-muted">Phone:</span> {formatPhone(review.existing_phones[0])}
                      {review.existing_phones.length > 1 && ` +${review.existing_phones.length - 1}`}
                    </div>
                  )}
                  <PersonStats
                    cats={review.existing_cat_count}
                    requests={review.existing_request_count}
                    appointments={review.existing_appointment_count}
                  />
                  <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                    Created {new Date(review.existing_created_at).toLocaleDateString()}
                  </div>
                </div>

                {/* Similarity Indicator */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: "60px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "1.4rem",
                      fontWeight: 700,
                      color:
                        review.name_similarity >= 0.85
                          ? "#198754"
                          : review.name_similarity >= 0.5
                            ? "#fd7e14"
                            : "#dc3545",
                    }}
                  >
                    {Math.round(review.name_similarity * 100)}%
                  </div>
                  <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                    name match
                  </div>
                </div>

                {/* Incoming Person (Merge) */}
                <div
                  style={{
                    padding: "0.75rem",
                    background: "rgba(108, 117, 125, 0.08)",
                    borderRadius: "8px",
                    border: "1px solid rgba(108, 117, 125, 0.2)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.65rem",
                      textTransform: "uppercase",
                      color: "#6c757d",
                      marginBottom: "0.25rem",
                      fontWeight: 600,
                    }}
                  >
                    Incoming (Merge Into Existing)
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "1rem",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {review.new_name || "(no name)"}
                  </div>
                  {review.incoming_email && (
                    <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                      <span className="text-muted">Email:</span> {review.incoming_email}
                    </div>
                  )}
                  {review.incoming_phone && (
                    <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                      <span className="text-muted">Phone:</span> {formatPhone(review.incoming_phone)}
                    </div>
                  )}
                  {review.incoming_address && (
                    <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                      <span className="text-muted">Address:</span>{" "}
                      {review.incoming_address.length > 30
                        ? review.incoming_address.substring(0, 30) + "..."
                        : review.incoming_address}
                    </div>
                  )}
                  {review.new_source && (
                    <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                      Source: {review.new_source}
                    </div>
                  )}
                </div>
              </div>

              {/* Decision Reason (if from automated system) */}
              {review.decision_reason && (
                <div
                  className="text-muted text-sm"
                  style={{
                    marginTop: "0.75rem",
                    padding: "0.5rem 0.75rem",
                    background: "var(--bg-muted)",
                    borderRadius: "4px",
                  }}
                >
                  <strong>Detection Reason:</strong> {review.decision_reason}
                </div>
              )}

              {/* Action Buttons */}
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginTop: "0.75rem",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => handleResolve(review.duplicate_id, "keep_separate")}
                  disabled={isResolving}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: "#198754",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Keep Separate
                </button>
                <button
                  onClick={() => handleResolve(review.duplicate_id, "merge")}
                  disabled={isResolving}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: "#fd7e14",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Merge
                </button>
                <button
                  onClick={() => handleResolve(review.duplicate_id, "dismiss")}
                  disabled={isResolving}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: "#6c757d",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}

      {/* Pagination */}
      {!loading && data && data.pagination.total > limit && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1.5rem",
          }}
        >
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: offset === 0 ? "default" : "pointer",
              opacity: offset === 0 ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <span className="text-muted text-sm">
            Showing {offset + 1}–{Math.min(offset + limit, data.pagination.total)} of{" "}
            {data.pagination.total}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= data.pagination.total}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: offset + limit >= data.pagination.total ? "default" : "pointer",
              opacity: offset + limit >= data.pagination.total ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
