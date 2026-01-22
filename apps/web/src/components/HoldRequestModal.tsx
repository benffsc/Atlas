"use client";

import { useState, useEffect } from "react";

interface HoldRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  staffName?: string;
  onSuccess?: () => void;
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
}: HoldRequestModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [holdNotes, setHoldNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedReason("");
      setHoldNotes("");
      setError(null);
    }
  }, [isOpen]);

  const selectedReasonObj = HOLD_REASONS.find((r) => r.value === selectedReason);
  const requiresNotes = selectedReason === "other";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!selectedReason) {
      setError("Please select a hold reason");
      return;
    }
    if (requiresNotes && !holdNotes.trim()) {
      setError("Please provide notes for 'Other' reason");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "on_hold",
          hold_reason: selectedReason,
          hold_reason_notes: holdNotes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to put request on hold");
      }

      onSuccess?.();
      handleClose();
    } catch (err) {
      console.error("Error putting request on hold:", err);
      setError(err instanceof Error ? err.message : "Failed to put request on hold");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (!loading) {
      setSelectedReason("");
      setHoldNotes("");
      setError(null);
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
              Put Request On Hold
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
          {/* Hold Reason */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Hold Reason <span style={{ color: "#dc3545" }}>*</span>
            </label>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
              required
            >
              <option value="">Select a reason...</option>
              {HOLD_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
            {selectedReasonObj?.description && (
              <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                {selectedReasonObj.description}
              </p>
            )}
          </div>

          {/* Hold Notes */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Notes
              {requiresNotes && <span style={{ color: "#dc3545" }}> *</span>}
            </label>
            <textarea
              value={holdNotes}
              onChange={(e) => setHoldNotes(e.target.value)}
              rows={3}
              placeholder="Additional details about why this is on hold..."
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                resize: "vertical",
                background: "var(--input-bg, #fff)",
              }}
              required={requiresNotes}
            />
          </div>

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
                background: "#ffc107",
                color: "#000",
                fontSize: "0.9rem",
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Processing..." : "Put On Hold"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
