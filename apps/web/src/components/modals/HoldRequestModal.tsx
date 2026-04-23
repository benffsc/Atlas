"use client";

import { useState, useEffect, useCallback } from "react";
import { postApi } from "@/lib/api-client";
import { useAsyncForm } from "@/hooks/useAsyncForm";
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSubmit();
  }

  function handleClose() {
    if (!loading) {
      setSelectedReason("");
      setHoldNotes("");
      clearError();
      onClose();
    }
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px",
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "450px",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
              Pause Request
            </h2>
            {staffName && (
              <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                Recording as: {staffName}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: loading ? "not-allowed" : "pointer",
              color: "var(--muted)",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
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
                background: "#f8d7da",
                border: "1px solid #f5c6cb",
                borderRadius: "8px",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#721c24" }}>{error}</p>
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "20px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              style={{
                padding: "10px 20px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                background: "var(--card-bg, #fff)",
                fontSize: "0.9rem",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px 20px",
                border: "none",
                borderRadius: "8px",
                background: "#ec4899",  // MIG_2530: paused status color (pink)
                color: "#fff",
                fontSize: "0.9rem",
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Processing..." : "Pause Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
