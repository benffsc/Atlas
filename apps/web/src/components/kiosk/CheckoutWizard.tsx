"use client";

import { useState, useEffect, useMemo } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useFormAutoSave } from "@/hooks/useFormAutoSave";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  getLabel,
  EQUIPMENT_CHECKOUT_TYPE_OPTIONS,
  EQUIPMENT_CONDITION_OPTIONS,
} from "@/lib/form-options";

interface CheckoutWizardProps {
  equipmentId: string;
  equipmentName: string;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3;

const DEPOSIT_PRESETS = [0, 50, 75];

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split("T")[0];
}

/**
 * 3-step checkout wizard for kiosk:
 * Step 1 "Who" — person picker or walk-in info
 * Step 2 "Terms" — checkout type, deposit, due date, notes
 * Step 3 "Confirm" — summary + submit
 */
export function CheckoutWizard({
  equipmentId,
  equipmentName,
  onComplete,
  onCancel,
}: CheckoutWizardProps) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [showResumed, setShowResumed] = useState(false);

  // Auto-saved form state
  const [saved, setSaved, clearSaved, wasRestored] = useFormAutoSave(
    `checkout_${equipmentId}`,
    {
      step: 1 as Step,
      personRef: { person_id: null, display_name: "", is_resolved: false } as PersonReference,
      walkInName: "",
      walkInPhone: "",
      checkoutType: "",
      depositAmount: 0,
      customDeposit: "",
      dueDate: defaultDueDate(),
      notes: "",
    },
  );

  // Show "Resumed" banner briefly
  useEffect(() => {
    if (wasRestored) {
      setShowResumed(true);
      const t = setTimeout(() => setShowResumed(false), 3000);
      return () => clearTimeout(t);
    }
  }, [wasRestored]);

  // Destructure for convenience
  const step = saved.step;
  const personRef = saved.personRef;
  const walkInName = saved.walkInName;
  const walkInPhone = saved.walkInPhone;
  const checkoutType = saved.checkoutType;
  const depositAmount = saved.depositAmount;
  const customDeposit = saved.customDeposit;
  const dueDate = saved.dueDate;
  const notes = saved.notes;

  // Updaters
  const setStep = (s: Step) => setSaved((p) => ({ ...p, step: s }));
  const setPersonRef = (ref: PersonReference) => setSaved((p) => ({ ...p, personRef: ref }));
  const setWalkInName = (v: string) => setSaved((p) => ({ ...p, walkInName: v }));
  const setWalkInPhone = (v: string) => setSaved((p) => ({ ...p, walkInPhone: v }));
  const setCheckoutType = (v: string) => setSaved((p) => ({ ...p, checkoutType: v }));
  const setDepositAmount = (v: number) => setSaved((p) => ({ ...p, depositAmount: v }));
  const setCustomDeposit = (v: string) => setSaved((p) => ({ ...p, customDeposit: v }));
  const setDueDate = (v: string) => setSaved((p) => ({ ...p, dueDate: v }));
  const setNotes = (v: string) => setSaved((p) => ({ ...p, notes: v }));

  // Derived: who is the custodian?
  const custodianName = personRef.display_name || walkInName;
  const custodianPersonId = personRef.person_id;

  const canAdvanceStep1 = personRef.display_name.length > 0 || walkInName.trim().length > 0;
  const canAdvanceStep2 = checkoutType.length > 0;

  // Resolved deposit (custom overrides preset if non-empty)
  const resolvedDeposit = useMemo(() => {
    if (customDeposit.trim()) {
      const parsed = parseFloat(customDeposit);
      return isNaN(parsed) ? depositAmount : parsed;
    }
    return depositAmount;
  }, [customDeposit, depositAmount]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await postApi(`/api/equipment/${equipmentId}/events`, {
        event_type: "check_out",
        custodian_person_id: custodianPersonId || undefined,
        custodian_name: custodianName || undefined,
        custodian_phone: walkInPhone.trim() || undefined,
        checkout_type: checkoutType,
        deposit_amount: resolvedDeposit > 0 ? resolvedDeposit : undefined,
        due_date: dueDate || undefined,
        notes: notes.trim() || undefined,
      });
      clearSaved();
      toast.success(`Checked out ${equipmentName}`);
      onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Checkout failed"
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

      {/* Step indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
          gap: "0.5rem",
        }}
      >
        {[1, 2, 3].map((s) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.8rem",
                fontWeight: 700,
                background: s <= step ? "var(--primary)" : "var(--muted-bg, #f3f4f6)",
                color: s <= step ? "var(--primary-foreground, #fff)" : "var(--muted)",
                transition: "background 200ms",
              }}
            >
              {s < step ? (
                <Icon name="check" size={14} color="var(--primary-foreground, #fff)" />
              ) : (
                s
              )}
            </div>
            {s < 3 && (
              <div
                style={{
                  width: 24,
                  height: 2,
                  borderRadius: 1,
                  background: s < step ? "var(--primary)" : "var(--border, #e5e7eb)",
                  transition: "background 200ms",
                }}
              />
            )}
          </div>
        ))}
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {step === 1 ? "Who" : step === 2 ? "Terms" : "Confirm"}
        </span>
      </div>

      <div style={{ padding: "1.25rem" }}>
        {/* ===================== STEP 1: WHO ===================== */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <PersonReferencePicker
              value={personRef}
              onChange={(ref) => {
                setPersonRef(ref);
                // Clear walk-in fields if person selected from DB
                if (ref.is_resolved) {
                  setWalkInName("");
                  setWalkInPhone("");
                }
              }}
              placeholder="Search for a person..."
              label="Person"
              allowCreate={false}
              inputStyle={{ minHeight: "48px", fontSize: "1rem" }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                color: "var(--muted)",
                fontSize: "0.85rem",
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: "var(--border, #e5e7eb)",
                }}
              />
              Or enter walk-in info
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: "var(--border, #e5e7eb)",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>
                  Name {!personRef.display_name && "*"}
                </label>
                <input
                  type="text"
                  value={walkInName}
                  onChange={(e) => {
                    setWalkInName(e.target.value);
                    // Clear person ref if typing walk-in
                    if (personRef.is_resolved) {
                      setPersonRef({
                        person_id: null,
                        display_name: "",
                        is_resolved: false,
                      });
                    }
                  }}
                  placeholder="Walk-in name"
                  disabled={personRef.is_resolved}
                  style={{
                    ...inputStyle,
                    background: personRef.is_resolved
                      ? "var(--muted-bg, #f3f4f6)"
                      : "var(--background, #fff)",
                  }}
                />
              </div>
              <div>
                <label style={labelStyle}>Phone (optional)</label>
                <input
                  type="tel"
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="(555) 555-1234"
                  disabled={personRef.is_resolved}
                  style={{
                    ...inputStyle,
                    background: personRef.is_resolved
                      ? "var(--muted-bg, #f3f4f6)"
                      : "var(--background, #fff)",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                marginTop: "0.5rem",
              }}
            >
              <Button
                variant="ghost"
                size="lg"
                fullWidth
                onClick={onCancel}
                style={{ minHeight: "56px", borderRadius: "12px" }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={!canAdvanceStep1}
                onClick={() => setStep(2)}
                style={{ minHeight: "56px", borderRadius: "12px" }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* ===================== STEP 2: TERMS ===================== */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* Checkout type */}
            <div>
              <label style={labelStyle}>Checkout Type *</label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.5rem",
                }}
              >
                {EQUIPMENT_CHECKOUT_TYPE_OPTIONS.map((opt) => {
                  const isSelected = checkoutType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCheckoutType(opt.value)}
                      style={{
                        minHeight: "80px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.35rem",
                        borderRadius: "12px",
                        border: isSelected
                          ? "2px solid var(--primary)"
                          : "2px solid var(--card-border, #e5e7eb)",
                        background: isSelected
                          ? "var(--primary-bg, rgba(59,130,246,0.08))"
                          : "var(--background, #fff)",
                        color: isSelected
                          ? "var(--primary)"
                          : "var(--text-primary)",
                        cursor: "pointer",
                        fontSize: "1rem",
                        fontWeight: isSelected ? 700 : 500,
                        transition: "all 150ms ease",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      <Icon
                        name={checkoutTypeIcon(opt.value)}
                        size={22}
                        color={isSelected ? "var(--primary)" : "var(--muted)"}
                      />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Deposit */}
            <div>
              <label style={labelStyle}>Deposit</label>
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                {DEPOSIT_PRESETS.map((amount) => {
                  const isSelected = depositAmount === amount && !customDeposit.trim();
                  return (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => {
                        setDepositAmount(amount);
                        setCustomDeposit("");
                      }}
                      style={{
                        flex: 1,
                        minHeight: "48px",
                        borderRadius: "10px",
                        border: isSelected
                          ? "2px solid var(--primary)"
                          : "2px solid var(--card-border, #e5e7eb)",
                        background: isSelected
                          ? "var(--primary-bg, rgba(59,130,246,0.08))"
                          : "var(--background, #fff)",
                        color: isSelected
                          ? "var(--primary)"
                          : "var(--text-primary)",
                        cursor: "pointer",
                        fontSize: "1rem",
                        fontWeight: isSelected ? 700 : 500,
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {amount === 0 ? "$0" : `$${amount}`}
                    </button>
                  );
                })}
              </div>
              <input
                type="number"
                value={customDeposit}
                onChange={(e) => setCustomDeposit(e.target.value)}
                placeholder="Custom amount..."
                min={0}
                step={1}
                style={inputStyle}
              />
            </div>

            {/* Due date */}
            <div>
              <label style={labelStyle}>Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Notes */}
            <div>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this checkout..."
                rows={3}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* Nav buttons */}
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
              }}
            >
              <Button
                variant="ghost"
                size="lg"
                fullWidth
                onClick={() => setStep(1)}
                style={{ minHeight: "56px", borderRadius: "12px" }}
              >
                Back
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={!canAdvanceStep2}
                onClick={() => setStep(3)}
                style={{ minHeight: "56px", borderRadius: "12px" }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* ===================== STEP 3: CONFIRM ===================== */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h3
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              Confirm Check Out
            </h3>

            {/* Summary card */}
            <div
              style={{
                background: "var(--section-bg, #f9fafb)",
                border: "1px solid var(--card-border, #e5e7eb)",
                borderRadius: "12px",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              <SummaryRow label="Equipment" value={equipmentName} />
              <SummaryRow
                label="To"
                value={
                  personRef.is_resolved
                    ? `${custodianName} (linked)`
                    : custodianName
                }
              />
              {walkInPhone && <SummaryRow label="Phone" value={walkInPhone} />}
              <SummaryRow
                label="Type"
                value={getLabel(EQUIPMENT_CHECKOUT_TYPE_OPTIONS, checkoutType)}
              />
              <SummaryRow
                label="Deposit"
                value={resolvedDeposit > 0 ? `$${resolvedDeposit}` : "None"}
              />
              <SummaryRow
                label="Due"
                value={
                  dueDate
                    ? new Date(dueDate + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "Not set"
                }
              />
              {notes.trim() && <SummaryRow label="Notes" value={notes.trim()} />}
            </div>

            {/* Action buttons */}
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
              }}
            >
              <Button
                variant="ghost"
                size="lg"
                fullWidth
                onClick={() => setStep(2)}
                disabled={submitting}
                style={{ minHeight: "56px", borderRadius: "12px" }}
              >
                Back
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                icon="log-out"
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
                Confirm Check Out
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "1rem",
      }}
    >
      <span
        style={{
          fontSize: "0.85rem",
          color: "var(--muted)",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "0.9rem",
          fontWeight: 500,
          color: "var(--text-primary)",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function checkoutTypeIcon(type: string): string {
  switch (type) {
    case "client":
      return "user";
    case "trapper":
      return "target";
    case "internal":
      return "building";
    case "foster":
      return "heart";
    default:
      return "box";
  }
}

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
