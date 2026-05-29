"use client";

import { useState, useEffect, useCallback } from "react";
import { postApi } from "@/lib/api-client";
import { useAsyncForm } from "@/hooks/useAsyncForm";
import { Modal } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { ReasonSelectionForm } from "@/components/forms/ReasonSelectionForm";

interface HoldRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  staffName?: string;
  onSuccess?: () => void;
  /** FFS-1367: Optimistic locking — last known updated_at from server */
  updatedAt?: string;
}

const HOLD_REASONS = [
  { value: "weather", label: "Weather", description: "Bad weather preventing trapping" },
  { value: "callback_pending", label: "Callback Pending", description: "Waiting for requester to call back" },
  { value: "access_issue", label: "Access Issue", description: "Cannot access the property" },
  { value: "resource_constraint", label: "Resource Constraint", description: "No available trappers or equipment" },
  { value: "client_unavailable", label: "Client Unavailable", description: "Requester is unavailable" },
  { value: "scheduling_conflict", label: "Scheduling Conflict", description: "Scheduling issues" },
  { value: "trap_shy", label: "Trap Shy Cats", description: "Cats avoiding traps, need to wait" },
  { value: "other", label: "Other", description: "Other reason (specify in notes)" },
];

export default function HoldRequestModal({
  isOpen,
  onClose,
  requestId,
  staffName,
  onSuccess,
  updatedAt,
}: HoldRequestModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [holdNotes, setHoldNotes] = useState("");

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedReason("");
      setHoldNotes("");
      clearError();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const requiresNotes = selectedReason === "other";

  const submitFn = useCallback(async () => {
    if (!selectedReason) throw new Error("Please select a pause reason");
    if (requiresNotes && !holdNotes.trim()) throw new Error("Please provide notes for 'Other' reason");

    await postApi(`/api/requests/${requestId}`, {
      status: "paused",
      hold_reason: selectedReason,
      hold_reason_notes: holdNotes || null,
      updated_at: updatedAt,
    }, { method: "PATCH" });
  }, [selectedReason, holdNotes, requiresNotes, requestId]);

  const { loading, error, clearError, handleSubmit: doSubmit } = useAsyncForm({
    onSubmit: submitFn,
    onSuccess: () => {
      onSuccess?.();
      handleClose();
    },
  });

  function handleClose() {
    if (!loading) {
      setSelectedReason("");
      setHoldNotes("");
      clearError();
      onClose();
    }
  }

  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={handleClose} disabled={loading}>
        Cancel
      </Button>
      <Button variant="primary" size="md" onClick={doSubmit} loading={loading} disabled={!selectedReason}>
        Pause Request
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={staffName ? `Pause Request` : "Pause Request"}
      size="sm"
      footer={footer}
    >
      {staffName && (
        <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
          Recording as: {staffName}
        </p>
      )}

      <ReasonSelectionForm
        reasons={HOLD_REASONS}
        selectedReason={selectedReason}
        onReasonChange={setSelectedReason}
        notes={holdNotes}
        onNotesChange={setHoldNotes}
        notesRequired={requiresNotes}
        notesPlaceholder="Additional details about why this is paused..."
        variant="select"
      />

      {/* Error message */}
      {error && (
        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: "8px",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--danger-text)" }}>{error}</p>
        </div>
      )}
    </Modal>
  );
}
