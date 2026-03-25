"use client";

import { useState, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { formatPhone } from "@/lib/formatters";

interface OwnerChange {
  review_id: string;
  review_type: string;
  priority: number;
  created_at: string;
  notes: string | null;
  match_confidence: number | null;
  // Old person
  old_person_id: string;
  old_person_name: string;
  old_email: string | null;
  old_phone: string | null;
  old_address: string | null;
  // New person
  new_person_id: string | null;
  new_person_name: string | null;
  new_name: string;
  new_email: string | null;
  new_phone: string | null;
  new_address: string | null;
  // Context
  appointment_number: string | null;
  detection_reason: string | null;
  cat_count: number;
  cats_affected: string[];
  cat_names: string[] | null;
}

interface ActionResponse {
  success: boolean;
  message?: string;
  error?: string;
  result?: {
    action: string;
    relationships_deleted?: number;
    relationships_created?: number;
    cats_transferred?: number;
  };
}

export default function OwnerChangesPage() {
  const [changes, setChanges] = useState<OwnerChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchChanges = async () => {
    try {
      const data = await fetchApi<{ changes: OwnerChange[] }>("/api/admin/owner-changes");
      setChanges(data.changes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChanges();
  }, []);

  const handleAction = async (
    reviewId: string,
    action: "transfer" | "merge" | "keep_both" | "reject",
    reason?: string
  ) => {
    setActionLoading(reviewId);
    try {
      await postApi<ActionResponse>(`/api/admin/owner-changes/${reviewId}`, { action, reason });
      // Remove from list
      setChanges((prev) => prev.filter((c) => c.review_id !== reviewId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to perform action");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div>
        <h1>Owner Change Review</h1>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1>Owner Change Review</h1>
        <div className="card" style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444" }}>
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Owner Change Review</h1>
          <p className="text-muted">
            Review detected owner changes from ClinicHQ imports
          </p>
        </div>
        <a
          href="/admin/ingest"
          className="btn btn-secondary"
          style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
        >
          Back to Ingest
        </a>
      </div>

      {/* Stats Bar */}
      <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem", display: "flex", gap: "2rem" }}>
        <div>
          <span className="text-muted">Pending:</span>{" "}
          <strong>{changes.length}</strong>
        </div>
        <div>
          <span className="text-muted">Transfers:</span>{" "}
          <strong style={{ color: "#ef4444" }}>
            {changes.filter(c => c.review_type === "owner_transfer").length}
          </strong>
        </div>
        <div>
          <span className="text-muted">Household:</span>{" "}
          <strong style={{ color: "#f59e0b" }}>
            {changes.filter(c => c.review_type === "owner_household").length}
          </strong>
        </div>
        <div className="text-muted text-sm" style={{ marginLeft: "auto" }}>
          Owner changes detected during ClinicHQ imports
        </div>
      </div>

      {/* Guidance */}
      <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem", background: "#f0f9ff", border: "1px solid #bae6fd" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem" }}>
          Review Types:
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8125rem", color: "#334155" }}>
          <li><strong style={{ color: "#ef4444" }}>Owner Transfer</strong>: Different email AND phone. The original person may no longer care for these cats.</li>
          <li><strong style={{ color: "#f59e0b" }}>Household</strong>: Same phone but different name. Could be spouse, family member, or caretaker change.</li>
          <li><strong style={{ color: "var(--primary, #3b82f6)" }}>Other Change</strong>: Contact info changed but unclear if same person.</li>
        </ul>
        <div style={{ marginTop: "0.75rem", fontSize: "0.8125rem" }}>
          <strong>Actions:</strong>
          <ul style={{ margin: "0.25rem 0 0 0", paddingLeft: "1.25rem" }}>
            <li><strong>Transfer</strong>: Move cats from old person to new person (e.g., Jill was referrer, Kathleen is actual resident)</li>
            <li><strong>Same Person</strong>: Update old person&apos;s info (e.g., name spelling correction)</li>
            <li><strong>Keep Both</strong>: Both people are valid caretakers (e.g., household members)</li>
            <li><strong>Reject</strong>: Ignore this change, keep existing data</li>
          </ul>
        </div>
      </div>

      {/* Change List */}
      {changes.length === 0 ? (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>No pending reviews</div>
          <p className="text-muted">All owner changes have been resolved</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {changes.map((change) => (
            <OwnerChangeCard
              key={change.review_id}
              change={change}
              onAction={handleAction}
              loading={actionLoading === change.review_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OwnerChangeCard({
  change,
  onAction,
  loading,
}: {
  change: OwnerChange;
  onAction: (id: string, action: "transfer" | "merge" | "keep_both" | "reject", reason?: string) => void;
  loading: boolean;
}) {
  const typeColors: Record<string, { bg: string; text: string; label: string }> = {
    owner_transfer: { bg: "#fef2f2", text: "#dc2626", label: "TRANSFER" },
    owner_household: { bg: "#fffbeb", text: "#d97706", label: "HOUSEHOLD" },
    owner_change: { bg: "#eff6ff", text: "#2563eb", label: "CHANGE" },
  };
  const typeStyle = typeColors[change.review_type] || typeColors.owner_change;

  return (
    <div className="card" style={{ padding: "1.25rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <span
            style={{
              padding: "0.125rem 0.5rem",
              borderRadius: "4px",
              background: typeStyle.bg,
              color: typeStyle.text,
              fontSize: "0.75rem",
              fontWeight: 600,
              marginRight: "0.5rem",
            }}
          >
            {typeStyle.label}
          </span>
          {change.appointment_number && (
            <span className="text-muted text-sm" style={{ marginRight: "0.5rem" }}>
              Appt #{change.appointment_number}
            </span>
          )}
          <span className="text-muted text-sm">
            {new Date(change.created_at).toLocaleString()}
          </span>
        </div>
        {change.match_confidence !== null && (
          <div
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "4px",
              background: change.match_confidence < 0.5 ? "#fef2f2" : "#fef3c7",
              fontWeight: 600,
              fontSize: "0.875rem",
              color: change.match_confidence < 0.5 ? "#dc2626" : "#d97706",
            }}
          >
            {(change.match_confidence * 100).toFixed(0)}% same person
          </div>
        )}
      </div>

      {/* Side-by-side comparison */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1rem", marginBottom: "1rem" }}>
        {/* Old Person */}
        <div style={{ padding: "1rem", background: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem", color: "#dc2626" }}>
            Old Record
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <a href={`/people/${change.old_person_id}`} style={{ fontWeight: 500 }}>
              {change.old_person_name || "Unknown"}
            </a>
          </div>
          {change.old_email && (
            <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              <span className="text-muted">Email:</span> {change.old_email}
            </div>
          )}
          {change.old_phone && (
            <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              <span className="text-muted">Phone:</span> {formatPhone(change.old_phone)}
            </div>
          )}
          {change.old_address && (
            <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
              {change.old_address}
            </div>
          )}
        </div>

        {/* Arrow */}
        <div style={{ display: "flex", alignItems: "center", fontSize: "1.5rem", color: "#94a3b8" }}>
          →
        </div>

        {/* New Data */}
        <div style={{ padding: "1rem", background: "var(--success-bg)", borderRadius: "8px", border: "1px solid var(--success-border)" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem", color: "#16a34a" }}>
            New Data from ClinicHQ
          </div>
          <div style={{ marginBottom: "0.5rem", fontWeight: 500 }}>
            {change.new_name}
            {change.new_person_id && (
              <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                (exists in Atlas)
              </span>
            )}
          </div>
          {change.new_email && (
            <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              <span className="text-muted">Email:</span>{" "}
              <span style={{ color: change.new_email !== change.old_email ? "#16a34a" : undefined }}>
                {change.new_email}
              </span>
            </div>
          )}
          {change.new_phone && (
            <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              <span className="text-muted">Phone:</span>{" "}
              <span style={{ color: change.new_phone !== change.old_phone ? "#16a34a" : undefined }}>
                {formatPhone(change.new_phone)}
              </span>
            </div>
          )}
          {change.new_address && (
            <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
              {change.new_address}
            </div>
          )}
        </div>
      </div>

      {/* Cats affected */}
      {change.cat_count > 0 && (
        <div style={{
          padding: "0.75rem 1rem",
          borderRadius: "6px",
          background: "#f8fafc",
          marginBottom: "1rem",
        }}>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem", fontSize: "0.875rem" }}>
            {change.cat_count} cat{change.cat_count !== 1 ? "s" : ""} affected:
          </div>
          <div style={{ fontSize: "0.875rem", color: "#475569" }}>
            {change.cat_names?.join(", ") || "Loading..."}
          </div>
        </div>
      )}

      {/* Notes */}
      {change.notes && (
        <div className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
          <strong>Detection:</strong> {change.notes}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", borderTop: "1px solid var(--card-border)", paddingTop: "1rem", flexWrap: "wrap" }}>
        {change.new_person_id && change.review_type === "owner_transfer" && (
          <button
            onClick={() => onAction(change.review_id, "transfer", "Ownership transfer confirmed")}
            disabled={loading}
            className="btn"
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: "#dc2626",
              color: "white",
              border: "none",
            }}
          >
            {loading ? "..." : `Transfer ${change.cat_count} Cat${change.cat_count !== 1 ? "s" : ""}`}
          </button>
        )}
        <button
          onClick={() => onAction(change.review_id, "merge", "Same person, info updated")}
          disabled={loading}
          className="btn btn-primary"
          style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
        >
          {loading ? "..." : "Same Person (Update Info)"}
        </button>
        <button
          onClick={() => onAction(change.review_id, "keep_both", "Both people are caretakers")}
          disabled={loading}
          className="btn btn-secondary"
          style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
        >
          {loading ? "..." : "Keep Both"}
        </button>
        <button
          onClick={() => onAction(change.review_id, "reject", "Change rejected")}
          disabled={loading}
          className="btn"
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            background: "#fef2f2",
            border: "1px solid #ef4444",
            color: "#dc2626",
          }}
        >
          {loading ? "..." : "Reject"}
        </button>
      </div>
    </div>
  );
}
