"use client";

import { useState, useEffect } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useFormAutoSave } from "@/hooks/useFormAutoSave";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";

interface CheckinFormProps {
  equipmentId: string;
  equipmentName: string;
  currentCondition: string;
  hasDeposit?: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Single-step check-in form for kiosk.
 * Condition dropdown, optional deposit-returned checkbox, notes, and confirm.
 */
export function CheckinForm({
  equipmentId,
  equipmentName,
  currentCondition,
  hasDeposit = false,
  onComplete,
  onCancel,
}: CheckinFormProps) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [showResumed, setShowResumed] = useState(false);

  // Auto-saved form state
  const [saved, setSaved, clearSaved, wasRestored] = useFormAutoSave(
    `checkin_${equipmentId}`,
    {
      conditionAfter: currentCondition,
      depositReturned: false,
      notes: "",
    },
  );

  useEffect(() => {
    if (wasRestored) {
      setShowResumed(true);
      const t = setTimeout(() => setShowResumed(false), 3000);
      return () => clearTimeout(t);
    }
  }, [wasRestored]);

  const conditionAfter = saved.conditionAfter;
  const depositReturned = saved.depositReturned;
  const notes = saved.notes;

  const setConditionAfter = (v: string) => setSaved((p) => ({ ...p, conditionAfter: v }));
  const setDepositReturned = (v: boolean) => setSaved((p) => ({ ...p, depositReturned: v }));
  const setNotes = (v: string) => setSaved((p) => ({ ...p, notes: v }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await postApi(`/api/equipment/${equipmentId}/events`, {
        event_type: "check_in",
        condition_after: conditionAfter,
        notes: [
          notes.trim(),
          hasDeposit
            ? depositReturned
              ? "Deposit returned."
              : "Deposit NOT returned."
            : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      });
      clearSaved();
      toast.success(`Checked in ${equipmentName}`);
      onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Check-in failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "16px",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))",
      }}
    >
      {/* Resumed banner */}
      {showResumed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            background: "var(--info-bg)",
            color: "var(--info-text)",
            borderBottom: "1px solid var(--info-border)",
          }}
        >
          <Icon name="rotate-ccw" size={14} color="var(--info-text)" />
          Resumed from where you left off
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--success-bg)",
            color: "var(--success-text)",
            fontSize: "0.9rem",
            fontWeight: 700,
          }}
        >
          &#x2713;
        </span>
        <span
          style={{
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          Check In {equipmentName}
        </span>
      </div>

      <div
        style={{
          padding: "1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {/* Condition */}
        <div>
          <label style={labelStyle}>Condition After Return *</label>
          <select
            value={conditionAfter}
            onChange={(e) => setConditionAfter(e.target.value)}
            style={{
              ...inputStyle,
              minHeight: "56px",
              cursor: "pointer",
              appearance: "auto" as const,
            }}
          >
            {EQUIPMENT_CONDITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Deposit returned */}
        {hasDeposit && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              minHeight: "48px",
              padding: "0.5rem 0",
              cursor: "pointer",
              fontSize: "1rem",
              fontWeight: 500,
              color: "var(--text-primary)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <input
              type="checkbox"
              checked={depositReturned}
              onChange={(e) => setDepositReturned(e.target.checked)}
              style={{
                width: 24,
                height: 24,
                cursor: "pointer",
                accentColor: "var(--primary)",
              }}
            />
            Deposit returned to custodian
          </label>
        )}

        {/* Notes */}
        <div>
          <label style={labelStyle}>Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about condition, missing parts, etc..."
            rows={3}
            style={{
              ...inputStyle,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onClick={onCancel}
            disabled={submitting}
            style={{ minHeight: "56px", borderRadius: "12px" }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            icon="log-in"
            loading={submitting}
            onClick={handleSubmit}
            style={{
              minHeight: "56px",
              borderRadius: "12px",
              background: "var(--success-text, #16a34a)",
              color: "#fff",
              border: "1px solid transparent",
            }}
          >
            Confirm Check In
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: "0.375rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "48px",
  padding: "0.75rem 1rem",
  fontSize: "1rem",
  border: "1px solid var(--card-border, #e5e7eb)",
  borderRadius: "10px",
  background: "var(--background, #fff)",
  boxSizing: "border-box" as const,
  outline: "none",
};
