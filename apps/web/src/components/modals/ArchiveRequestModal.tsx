"use client";

import { useState } from "react";

interface ArchiveRequestModalProps {
  requestId: string;
  requestSummary?: string;
  onComplete: () => void;
  onCancel: () => void;
}

// Archive reason options - some require notes
const ARCHIVE_REASONS = [
  { value: "duplicate", label: "Duplicate Request", description: "Same location/request already exists in system", requiresNotes: false },
  { value: "merged", label: "Merged Into Another", description: "Combined with another request for the same location", requiresNotes: true },
  { value: "out_of_area", label: "Out of Service Area", description: "Location is outside Sonoma County service area", requiresNotes: false },
  { value: "no_response", label: "No Response", description: "Unable to reach requester after multiple attempts", requiresNotes: false },
  { value: "withdrawn", label: "Withdrawn by Requester", description: "Requester no longer needs assistance", requiresNotes: false },
  { value: "resolved_elsewhere", label: "Resolved by Another Org", description: "Cats were fixed by another organization", requiresNotes: true },
  { value: "invalid", label: "Invalid/Spam", description: "Spam, test data, or invalid submission", requiresNotes: false },
  { value: "test_data", label: "Test Data", description: "Created for testing purposes", requiresNotes: false },
  { value: "other", label: "Other", description: "Other reason not listed above", requiresNotes: true },
];

export default function ArchiveRequestModal({
  requestId,
  requestSummary,
  onComplete,
  onCancel,
}: ArchiveRequestModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const selectedReason = ARCHIVE_REASONS.find(r => r.value === reason);
  const notesRequired = selectedReason?.requiresNotes ?? false;

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select an archive reason");
      return;
    }

    if (notesRequired && !notes.trim()) {
      setError(`Notes are required for "${selectedReason?.label}"`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          notes: notes.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error?.message || data.error || "Failed to archive request");
        return;
      }

      onComplete();
    } catch (err) {
      setError("Network error - please try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          maxWidth: "500px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.5rem",
            borderBottom: "1px solid var(--border)",
            background: "linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)",
            color: "#fff",
            borderRadius: "12px 12px 0 0",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Archive Request</h2>
          {requestSummary && (
            <p style={{ margin: "0.5rem 0 0", opacity: 0.9, fontSize: "0.9rem" }}>
              {requestSummary.length > 60 ? requestSummary.slice(0, 60) + "..." : requestSummary}
            </p>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: "1.5rem" }}>
          {error && (
            <div
              style={{
                background: "rgba(220, 53, 69, 0.1)",
                border: "1px solid rgba(220, 53, 69, 0.3)",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem",
                color: "#dc3545",
              }}
            >
              {error}
            </div>
          )}

          <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.9rem" }}>
            Archived requests are hidden from the main list but can still be viewed
            and restored if needed.
          </p>

          <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Reason for Archiving</h3>
          <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1.5rem" }}>
            {ARCHIVE_REASONS.map((r) => (
              <label
                key={r.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  padding: "0.75rem",
                  border: `2px solid ${reason === r.value ? "#6b7280" : "var(--border)"}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                  background: reason === r.value ? "rgba(107, 114, 128, 0.05)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ marginTop: "0.2rem" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {r.label}
                    {r.requiresNotes && (
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 400 }}>
                        (notes required)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{r.description}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Notes */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.9rem" }}>
              Notes {notesRequired ? "(required)" : "(optional)"}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                notesRequired
                  ? "Please provide details..."
                  : "Additional details about archiving this request..."
              }
              rows={3}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: `1px solid ${notesRequired && !notes.trim() && reason ? "#dc3545" : "var(--border)"}`,
                resize: "vertical",
              }}
            />
          </div>

          {/* Info message */}
          <div
            style={{
              padding: "0.75rem",
              background: "rgba(59, 130, 246, 0.1)",
              borderRadius: "8px",
              fontSize: "0.85rem",
              color: "#2563eb",
            }}
          >
            This request can be restored at any time from the archived requests view.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <button
            onClick={handleSubmit}
            disabled={saving || !reason || (notesRequired && !notes.trim())}
            style={{
              padding: "0.5rem 1.5rem",
              background: saving || !reason || (notesRequired && !notes.trim()) ? "#9ca3af" : "#6b7280",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: saving || !reason || (notesRequired && !notes.trim()) ? "not-allowed" : "pointer",
              fontWeight: 500,
            }}
          >
            {saving ? "Archiving..." : "Archive Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
