"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getCustodyStyle } from "@/lib/equipment-styles";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";

interface HeroCheckinCardProps {
  equipmentId: string;
  equipmentName: string;
  custodianName: string | null;
  custodianId: string | null;
  currentCondition: string;
  daysOut: number | null;
  onComplete: () => void;
  onOtherActions: () => void;
}

/**
 * One-tap check-in card shown when scanning a checked_out trap.
 * Big green button for the most common action; details collapsed behind toggle.
 */
export function HeroCheckinCard({
  equipmentId,
  equipmentName,
  custodianName,
  custodianId,
  currentCondition,
  daysOut,
  onComplete,
  onOtherActions,
}: HeroCheckinCardProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [conditionAfter, setConditionAfter] = useState(currentCondition);
  const [notes, setNotes] = useState("");

  const colors = getCustodyStyle("checked_out");

  const handleCheckin = async () => {
    setLoading(true);
    try {
      await postApi(`/api/equipment/${equipmentId}/events`, {
        event_type: "check_in",
        condition_after: conditionAfter !== currentCondition ? conditionAfter : undefined,
        notes: notes.trim() || undefined,
      });

      toast.success(`Checked in ${equipmentName}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            await postApi(`/api/equipment/${equipmentId}/events`, {
              event_type: "check_out",
              custodian_person_id: custodianId || undefined,
              notes: "Undo check-in",
            });
          },
        },
        duration: 5000,
      });

      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        borderRadius: "12px",
        border: `2px solid ${colors.border}`,
        background: colors.bg,
        padding: "1.25rem",
        animation: "fadeIn 0.2s ease-in",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <Icon name="log-in" size={32} color="var(--success-text)" />
        <h3 style={{ margin: "0.5rem 0 0.25rem", fontSize: "1.1rem", fontWeight: 700 }}>
          Check in from <strong>{custodianName || "Unknown"}</strong>?
        </h3>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {equipmentName}
          {daysOut != null && daysOut > 0 && (
            <span style={{ marginLeft: "0.5rem", color: daysOut > 14 ? "var(--danger-text)" : "var(--muted)" }}>
              ({daysOut} days out)
            </span>
          )}
        </p>
      </div>

      {/* Primary action */}
      <Button
        variant="primary"
        size="lg"
        icon="log-in"
        fullWidth
        loading={loading}
        onClick={handleCheckin}
        style={{
          minHeight: "56px",
          borderRadius: "12px",
          background: "var(--success-text, #16a34a)",
          color: "#fff",
          border: "1px solid transparent",
          fontSize: "1.05rem",
          fontWeight: 600,
        }}
      >
        Check In
      </Button>

      {/* Collapsible details */}
      <div style={{ marginTop: "0.75rem", textAlign: "center" }}>
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: "0.8rem",
            cursor: "pointer",
            padding: "0.25rem 0.5rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
          }}
        >
          <Icon name={showDetails ? "chevron-up" : "chevron-down"} size={14} />
          {showDetails ? "Hide details" : "Add details"}
        </button>
      </div>

      {showDetails && (
        <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              Condition
            </label>
            <select
              value={conditionAfter}
              onChange={(e) => setConditionAfter(e.target.value)}
              style={{
                width: "100%",
                padding: "0.5rem",
                fontSize: "0.9rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
              }}
            >
              <option value="">No change</option>
              {EQUIPMENT_CONDITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              style={{
                width: "100%",
                padding: "0.5rem",
                fontSize: "0.9rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      )}

      {/* Other actions link */}
      <div style={{ marginTop: "0.75rem", textAlign: "center" }}>
        <button
          onClick={onOtherActions}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            fontSize: "0.8rem",
            cursor: "pointer",
            padding: "0.25rem 0.5rem",
            textDecoration: "underline",
          }}
        >
          Other actions...
        </button>
      </div>
    </div>
  );
}
