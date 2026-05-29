"use client";

import { useState, useCallback } from "react";
import { postApi } from "@/lib/api-client";
import { useAsyncForm } from "@/hooks/useAsyncForm";
import { Modal } from "@/components/ui";
import { Button } from "@/components/ui/Button";
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

  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="md"
        onClick={handleSubmit}
        loading={saving}
        disabled={!reason || (notesRequired && !notes.trim())}
        style={{ background: "#6b7280", borderColor: "transparent" }}
      >
        Archive Request
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title="Archive Request"
      size="md"
      footer={footer}
    >
      {requestSummary && (
        <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          {requestSummary.length > 60 ? requestSummary.slice(0, 60) + "..." : requestSummary}
        </p>
      )}

      {error && (
        <div
          style={{
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
            color: "var(--danger-text)",
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
          background: "var(--info-bg, rgba(59, 130, 246, 0.1))",
          borderRadius: "8px",
          fontSize: "0.85rem",
          color: "var(--primary, #2563eb)",
        }}
      >
        This request can be restored at any time from the archived requests view.
      </div>
    </Modal>
  );
}
