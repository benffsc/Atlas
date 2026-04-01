"use client";

import { useState, useEffect } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useFormAutoSave } from "@/hooks/useFormAutoSave";
import { Button } from "@/components/ui/Button";
import { KioskPhotoCapture } from "@/components/kiosk/KioskPhotoCapture";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";
import { useKioskStaff } from "./KioskStaffContext";
import { KioskCard } from "./KioskCard";
import { kioskLabelStyle as labelStyle, kioskInputStyle as inputStyle } from "./kiosk-styles";

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
  const { activeStaff } = useKioskStaff();
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

  // Photo state (not auto-saved — File objects can't be serialized)
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  const handlePhotoChange = (file: File | null) => {
    setPhotoFile(file);
    if (file) {
      setPhotoPreviewUrl(URL.createObjectURL(file));
    } else {
      setPhotoPreviewUrl(null);
    }
  };

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
      // Upload photo first if captured
      let uploadedPhotoUrl: string | undefined;
      if (photoFile) {
        try {
          const formData = new FormData();
          formData.append("file", photoFile);
          const res = await fetch(`/api/equipment/${equipmentId}/photo`, {
            method: "POST",
            body: formData,
          });
          if (res.ok) {
            const data = await res.json();
            uploadedPhotoUrl = data.data?.photo_url || data.photo_url;
          }
        } catch {
          // Photo upload failure is non-blocking
        }
      }

      await postApi(`/api/equipment/${equipmentId}/events`, {
        event_type: "check_in",
        actor_person_id: activeStaff?.person_id || undefined,
        condition_after: conditionAfter,
        photo_url: uploadedPhotoUrl,
        deposit_returned_at:
          hasDeposit && depositReturned ? new Date().toISOString() : undefined,
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
    <KioskCard
      icon="log-in"
      title={`Check In ${equipmentName}`}
      iconColor="var(--success-text)"
      showResumed={showResumed}
    >
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

        {/* Photo capture */}
        <KioskPhotoCapture
          value={photoPreviewUrl}
          onChange={handlePhotoChange}
          label="Condition Photo"
          autoPrompt={conditionAfter === "damaged" || conditionAfter === "poor"}
          helperText={
            conditionAfter === "damaged" || conditionAfter === "poor"
              ? "Photo recommended for damaged/poor condition"
              : "Optional — helps document equipment condition"
          }
        />

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
    </KioskCard>
  );
}

