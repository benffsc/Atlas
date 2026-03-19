"use client";

import { useState, useCallback } from "react";
import { postApi } from "@/lib/api-client";
import { useAsyncForm } from "@/hooks/useAsyncForm";
import { ReasonSelectionForm } from "@/components/forms/ReasonSelectionForm";

interface ArchiveRequestModalProps {
  requestId: string;
  requestSummary?: string;
  onComplete: () => void;
  onCancel: () => void;
}

// Archive reasons — data hygiene only (FFS-155)
// Operational closure reasons moved to CloseRequestModal
const ARCHIVE_REASONS = [
  { value: "duplicate", label: "Duplicate Request", description: "Same location/request already exists in system", requiresNotes: false },
  { value: "merged", label: "Merged Into Another", description: "Combined with another request for the same location", requiresNotes: true },
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
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const selectedReason = ARCHIVE_REASONS.find(r => r.value === reason);
  const notesRequired = selectedReason?.requiresNotes ?? false;

  const submitFn = useCallback(async () => {
    if (!reason) throw new Error("Please select an archive reason");
    if (notesRequired && !notes.trim()) throw new Error(`Notes are required for "${selectedReason?.label}"`);

    await postApi(`/api/requests/${requestId}/archive`, {
      reason,
      notes: notes.trim() || null,
    });
  }, [reason, notes, notesRequired, selectedReason, requestId]);

  const { loading: saving, error, handleSubmit } = useAsyncForm({
    onSubmit: submitFn,
    onSuccess: onComplete,
  });

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
            Archive is for data cleanup. To close a case operationally, use <strong>Close Case</strong> instead.
            Archived requests are hidden from the main list but can be restored.
          </p>

          <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Reason for Archiving</h3>
          <ReasonSelectionForm
            reasons={ARCHIVE_REASONS}
            selectedReason={reason}
            onReasonChange={setReason}
            notes={notes}
            onNotesChange={setNotes}
            notesPlaceholder="Additional details about archiving this request..."
            accentColor="#6b7280"
          />

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
