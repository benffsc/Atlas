"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";
import { useKioskStaff } from "./KioskStaffContext";
import { KioskCard } from "./KioskCard";
import { kioskLabelStyle as labelStyle, kioskInputStyle as inputStyle } from "./kiosk-styles";

interface SimpleActionConfirmProps {
  equipmentId: string;
  action: string;
  actionLabel: string;
  currentCondition: string;
  onComplete: () => void;
  onCancel: () => void;
}

/** Actions that show the condition selector */
const CONDITION_ACTIONS = new Set(["condition_change"]);

/** Actions considered destructive (danger styling) */
const DANGER_ACTIONS = new Set(["reported_missing", "retired"]);

/** Actions that need a custodian (who is receiving the item) */
const CUSTODIAN_ACTIONS = new Set(["transfer"]);

/** Icon per action type */
function actionIcon(action: string): string {
  switch (action) {
    case "condition_change":
      return "wrench";
    case "reported_missing":
      return "alert-triangle";
    case "found":
      return "check-circle";
    case "retired":
      return "archive";
    case "maintenance_start":
      return "tool";
    case "maintenance_end":
      return "check";
    case "transfer":
      return "arrow-right-left";
    case "note":
      return "message-square";
    default:
      return "zap";
  }
}

/**
 * Generic confirmation form for non-checkout/checkin actions:
 * condition_change, reported_missing, found, retired,
 * maintenance_start, maintenance_end, transfer, note.
 *
 * Shows: action title, optional condition selector, optional custodian picker
 * (for transfers), notes textarea, confirm/cancel.
 */
export function SimpleActionConfirm({
  equipmentId,
  action,
  actionLabel,
  currentCondition,
  onComplete,
  onCancel,
}: SimpleActionConfirmProps) {
  const toast = useToast();
  const { activeStaff } = useKioskStaff();
  const [conditionAfter, setConditionAfter] = useState(currentCondition);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Transfer custodian state
  const [personRef, setPersonRef] = useState<PersonReference>({
    person_id: null,
    display_name: "",
    is_resolved: false,
  });
  const [resolutionStatus, setResolutionStatus] = useState<"resolved" | "unresolved" | "created">("resolved");

  const showCondition = CONDITION_ACTIONS.has(action);
  const showCustodian = CUSTODIAN_ACTIONS.has(action);
  const isDanger = DANGER_ACTIONS.has(action);

  const handleSubmit = async () => {
    // Condition change requires the value to actually change
    if (showCondition && conditionAfter === currentCondition) {
      toast.warning("Please select a different condition.");
      return;
    }

    // Transfer requires a custodian
    if (showCustodian && !personRef.display_name.trim()) {
      toast.warning("Please select who is receiving this equipment.");
      return;
    }

    setSubmitting(true);
    try {
      await postApi(`/api/equipment/${equipmentId}/events`, {
        event_type: action,
        actor_person_id: activeStaff?.person_id || undefined,
        condition_after: showCondition ? conditionAfter : undefined,
        custodian_person_id: showCustodian ? (personRef.person_id || undefined) : undefined,
        custodian_name: showCustodian ? (personRef.display_name.trim() || undefined) : undefined,
        custodian_name_raw: showCustodian ? (personRef.display_name.trim() || undefined) : undefined,
        resolution_status: showCustodian ? resolutionStatus : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(`${actionLabel} recorded`);
      onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `${actionLabel} failed`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KioskCard
      icon={actionIcon(action)}
      title={actionLabel}
      iconColor={isDanger ? "var(--danger-text)" : "var(--primary)"}
    >
      <div
        style={{
          padding: "1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {/* Custodian picker — only for transfer */}
        {showCustodian && (
          <PersonReferencePicker
            value={personRef}
            onChange={setPersonRef}
            onResolutionType={setResolutionStatus}
            placeholder="Search for the new custodian..."
            label="Transfer To *"
            allowCreate
            inputStyle={{
              minHeight: "48px",
              fontSize: "1rem",
              borderRadius: "10px",
            }}
          />
        )}

        {/* Condition selector — only for condition_change */}
        {showCondition && (
          <div>
            <label style={labelStyle}>New Condition *</label>
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
                  {opt.value === currentCondition ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Warning for destructive actions */}
        {isDanger && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: "10px",
              fontSize: "0.9rem",
              color: "var(--danger-text)",
              fontWeight: 500,
            }}
          >
            {action === "reported_missing"
              ? "This will mark the equipment as missing. The status will change and staff will be alerted."
              : action === "retired"
                ? "This will permanently retire this equipment from the inventory."
                : "This action may affect equipment availability."}
          </div>
        )}

        {/* Notes */}
        <div>
          <label style={labelStyle}>
            Notes {isDanger ? "*" : "(optional)"}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              action === "reported_missing"
                ? "Where was it last seen? Any details..."
                : action === "note"
                  ? "Write your note here..."
                  : "Any additional details..."
            }
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
            variant={isDanger ? "danger" : "primary"}
            size="lg"
            fullWidth
            icon={actionIcon(action)}
            loading={submitting}
            onClick={handleSubmit}
            disabled={isDanger && !notes.trim()}
            style={{
              minHeight: "56px",
              borderRadius: "12px",
              ...(action === "found"
                ? {
                    background: "var(--success-text, #16a34a)",
                    color: "#fff",
                    border: "1px solid transparent",
                  }
                : {}),
            }}
          >
            Confirm {actionLabel}
          </Button>
        </div>
      </div>
    </KioskCard>
  );
}
