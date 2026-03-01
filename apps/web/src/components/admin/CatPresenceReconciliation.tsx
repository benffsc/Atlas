"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface CatPresence {
  cat_place_id: string;
  cat_id: string;
  cat_name: string;
  altered_status: string | null;
  relationship_type: string;
  last_observed_at: string | null;
  explicit_status: string;
  effective_status: string;
  inferred_status: string;
  presence_confirmed_at: string | null;
  presence_confirmed_by: string | null;
  departure_reason: string | null;
  reactivation_reason: string | null;
  has_observation: boolean;
  days_since_observed: number | null;
  altered_date: string | null;
  is_altered: boolean;
}

interface ReconciliationSummary {
  total_cats: number;
  current_cats: number;
  uncertain_cats: number;
  departed_cats: number;
  unconfirmed_cats: number;
  needs_reconciliation: boolean;
  authoritative_cat_count: number | null;
  has_count_mismatch: boolean;
}

interface Props {
  placeId: string;
  onUpdate?: () => void;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  current: { bg: "#d1fae5", text: "#065f46", border: "#10b981" },
  uncertain: { bg: "#fef3c7", text: "#92400e", border: "#f59e0b" },
  departed: { bg: "#fee2e2", text: "#991b1b", border: "#ef4444" },
  unknown: { bg: "#f3f4f6", text: "#374151", border: "#9ca3af" },
};

const DEPARTURE_REASONS = [
  { value: "adopted", label: "Adopted" },
  { value: "deceased", label: "Deceased" },
  { value: "relocated", label: "Relocated" },
  { value: "lost", label: "Lost/Missing" },
  { value: "unknown", label: "Unknown" },
];

const REACTIVATION_REASONS = [
  { value: "client_confirmed", label: "Client confirmed still there" },
  { value: "staff_override", label: "Staff override" },
];

function formatDaysAgo(days: number | null): string {
  if (days === null) return "Never observed";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  }
  const years = Math.floor(days / 365);
  const remainingMonths = Math.floor((days % 365) / 30);
  if (remainingMonths > 0) {
    return `${years} year${years > 1 ? "s" : ""}, ${remainingMonths} month${remainingMonths > 1 ? "s" : ""} ago`;
  }
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

export function CatPresenceReconciliation({ placeId, onUpdate }: Props) {
  const [cats, setCats] = useState<CatPresence[]>([]);
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [showDepartureModal, setShowDepartureModal] = useState<string | null>(null);
  const [showReactivationModal, setShowReactivationModal] = useState<string | null>(null);
  const [departureReason, setDepartureReason] = useState("unknown");
  const [reactivationReason, setReactivationReason] = useState("client_confirmed");
  const [dismissed, setDismissed] = useState(false);

  const fetchPresence = useCallback(async () => {
    try {
      const res = await fetch(`/api/places/${placeId}/cat-presence`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setCats(data.cats || []);
      setSummary(data.summary || null);
    } catch (error) {
      console.error("Error fetching cat presence:", error);
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  useEffect(() => {
    fetchPresence();
  }, [fetchPresence]);

  const handleUpdateStatus = async (
    catId: string,
    status: string,
    reason?: string
  ) => {
    setUpdating(catId);
    try {
      const res = await fetch(`/api/places/${placeId}/cat-presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [
            {
              cat_id: catId,
              presence_status: status,
              departure_reason: reason,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await fetchPresence();
      onUpdate?.();
    } catch (error) {
      console.error("Error updating cat presence:", error);
      alert("Failed to update cat status");
    } finally {
      setUpdating(null);
      setShowDepartureModal(null);
    }
  };

  const handleMarkAllOldAsGone = async () => {
    if (!confirm("Mark all cats not seen in 3+ years as departed?")) return;

    setUpdating("bulk");
    try {
      const res = await fetch(`/api/places/${placeId}/cat-presence`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_old_as_departed" }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await fetchPresence();
      onUpdate?.();
    } catch (error) {
      console.error("Error marking old cats as gone:", error);
      alert("Failed to update");
    } finally {
      setUpdating(null);
    }
  };

  // Don't render if loading
  if (loading) return null;

  // Don't render if no cats need reconciliation
  if (!summary?.needs_reconciliation || dismissed) return null;

  // Filter to cats that need attention
  const catsNeedingAttention = cats.filter(
    (c) =>
      c.effective_status === "uncertain" ||
      (c.effective_status === "departed" &&
        (c.explicit_status === "unknown" || !c.explicit_status))
  );

  // Count cats that would be marked as gone by bulk action
  const oldCatsCount = cats.filter(
    (c) =>
      (c.explicit_status === "unknown" || !c.explicit_status) &&
      (c.days_since_observed === null || c.days_since_observed > 365 * 3)
  ).length;

  return (
    <div
      style={{
        backgroundColor: "#fffbeb",
        border: "1px solid #f59e0b",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "1.5rem",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.25rem" }}>&#9888;&#65039;</span>
        <div style={{ flex: 1 }}>
          <h3
            style={{
              margin: 0,
              fontSize: "1rem",
              fontWeight: 600,
              color: "#92400e",
            }}
          >
            Historical Cats Discovered
          </h3>
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.875rem",
              color: "#a16207",
            }}
          >
            Atlas found {catsNeedingAttention.length} cat
            {catsNeedingAttention.length !== 1 ? "s" : ""} linked to this
            address from historical records. Please confirm their current
            status.
          </p>

          {summary.has_count_mismatch && (
            <p
              style={{
                margin: "0.5rem 0 0",
                fontSize: "0.875rem",
                color: "#b91c1c",
                fontWeight: 500,
              }}
            >
              Count mismatch: Authoritative count is{" "}
              {summary.authoritative_cat_count}, but {summary.current_cats}{" "}
              cats show as current.
            </p>
          )}
        </div>
      </div>

      {/* Cat list */}
      <div style={{ marginTop: "1rem" }}>
        {catsNeedingAttention.map((cat) => {
          const statusColor = STATUS_COLORS[cat.effective_status] || STATUS_COLORS.unknown;
          const isUpdating = updating === cat.cat_id;

          return (
            <div
              key={cat.cat_id}
              style={{
                backgroundColor: "white",
                border: `1px solid ${statusColor.border}`,
                borderRadius: "0.375rem",
                padding: "0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Link
                      href={`/cats/${cat.cat_id}`}
                      style={{
                        fontWeight: 500,
                        color: "#1f2937",
                        textDecoration: "none",
                      }}
                    >
                      {cat.cat_name || "Unknown Cat"}
                    </Link>
                    {cat.is_altered && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          backgroundColor: "#dbeafe",
                          color: "#1e40af",
                          padding: "0.125rem 0.375rem",
                          borderRadius: "0.25rem",
                        }}
                      >
                        {cat.altered_status || "Altered"}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: "0.75rem",
                        backgroundColor: statusColor.bg,
                        color: statusColor.text,
                        padding: "0.125rem 0.375rem",
                        borderRadius: "0.25rem",
                      }}
                    >
                      {cat.effective_status}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.875rem",
                      color: "#6b7280",
                      marginTop: "0.25rem",
                    }}
                  >
                    Last seen: {formatDaysAgo(cat.days_since_observed)}
                    {cat.altered_date && (
                      <span style={{ marginLeft: "0.75rem" }}>
                        Altered: {new Date(cat.altered_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <button
                    onClick={() => setShowReactivationModal(cat.cat_id)}
                    disabled={isUpdating}
                    style={{
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.875rem",
                      backgroundColor: "#d1fae5",
                      color: "#065f46",
                      border: "1px solid #10b981",
                      borderRadius: "0.25rem",
                      cursor: isUpdating ? "not-allowed" : "pointer",
                      opacity: isUpdating ? 0.5 : 1,
                    }}
                  >
                    Still Here
                  </button>
                  <button
                    onClick={() => setShowDepartureModal(cat.cat_id)}
                    disabled={isUpdating}
                    style={{
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.875rem",
                      backgroundColor: "#fee2e2",
                      color: "#991b1b",
                      border: "1px solid #ef4444",
                      borderRadius: "0.25rem",
                      cursor: isUpdating ? "not-allowed" : "pointer",
                      opacity: isUpdating ? 0.5 : 1,
                    }}
                  >
                    Gone
                  </button>
                </div>
              </div>

              {/* Reactivation reason modal */}
              {showReactivationModal === cat.cat_id && (
                <div
                  style={{
                    marginTop: "0.75rem",
                    paddingTop: "0.75rem",
                    borderTop: "1px solid #e5e7eb",
                  }}
                >
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      marginBottom: "0.5rem",
                    }}
                  >
                    How do you know it&apos;s still there?
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <select
                      value={reactivationReason}
                      onChange={(e) => setReactivationReason(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "0.5rem",
                        border: "1px solid #d1d5db",
                        borderRadius: "0.25rem",
                        fontSize: "0.875rem",
                      }}
                    >
                      {REACTIVATION_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        handleUpdateStatus(cat.cat_id, "current", reactivationReason)
                      }
                      disabled={isUpdating}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "#10b981",
                        color: "white",
                        border: "none",
                        borderRadius: "0.25rem",
                        cursor: isUpdating ? "not-allowed" : "pointer",
                        opacity: isUpdating ? 0.5 : 1,
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setShowReactivationModal(null)}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "#f3f4f6",
                        color: "#374151",
                        border: "1px solid #d1d5db",
                        borderRadius: "0.25rem",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Departure reason modal */}
              {showDepartureModal === cat.cat_id && (
                <div
                  style={{
                    marginTop: "0.75rem",
                    paddingTop: "0.75rem",
                    borderTop: "1px solid #e5e7eb",
                  }}
                >
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      marginBottom: "0.5rem",
                    }}
                  >
                    Reason (optional):
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <select
                      value={departureReason}
                      onChange={(e) => setDepartureReason(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "0.5rem",
                        border: "1px solid #d1d5db",
                        borderRadius: "0.25rem",
                        fontSize: "0.875rem",
                      }}
                    >
                      {DEPARTURE_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        handleUpdateStatus(cat.cat_id, "departed", departureReason)
                      }
                      disabled={isUpdating}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "#ef4444",
                        color: "white",
                        border: "none",
                        borderRadius: "0.25rem",
                        cursor: isUpdating ? "not-allowed" : "pointer",
                        opacity: isUpdating ? 0.5 : 1,
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setShowDepartureModal(null)}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "#f3f4f6",
                        color: "#374151",
                        border: "1px solid #d1d5db",
                        borderRadius: "0.25rem",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bulk actions */}
      <div
        style={{
          marginTop: "1rem",
          paddingTop: "1rem",
          borderTop: "1px solid #fcd34d",
          display: "flex",
          gap: "0.75rem",
        }}
      >
        {oldCatsCount > 0 && (
          <button
            onClick={handleMarkAllOldAsGone}
            disabled={updating === "bulk"}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              backgroundColor: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fca5a5",
              borderRadius: "0.375rem",
              cursor: updating === "bulk" ? "not-allowed" : "pointer",
              opacity: updating === "bulk" ? 0.5 : 1,
            }}
          >
            Mark All Old Cats as Gone ({oldCatsCount})
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            backgroundColor: "#f3f4f6",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: "0.375rem",
            cursor: "pointer",
          }}
        >
          Dismiss for Now
        </button>
      </div>
    </div>
  );
}
