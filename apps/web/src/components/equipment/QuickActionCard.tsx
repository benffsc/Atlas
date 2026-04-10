"use client";

import { useState } from "react";
import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS, EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { getCustodyStyle, getActionColor } from "@/lib/equipment-styles";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface QuickActionCardProps {
  equipment: VEquipmentInventoryRow & { available_actions?: string[]; primary_action?: string | null };
  onAction: (action: string) => void;
  actionLoading?: boolean;
}

const ACTION_LABELS: Record<string, string> = {
  check_out: "Check Out",
  check_in: "Check In",
  transfer: "Transfer",
  condition_change: "Update Condition",
  maintenance_start: "Start Maintenance",
  maintenance_end: "End Maintenance",
  reported_missing: "Report Missing",
  found: "Mark Found",
  retired: "Retire",
  note: "Add Note",
};

const ACTION_ICONS: Record<string, string> = {
  check_out: "log-out",
  check_in: "log-in",
  transfer: "arrow-right-left",
  condition_change: "wrench",
  maintenance_start: "tool",
  maintenance_end: "check",
  reported_missing: "alert-triangle",
  found: "check-circle",
  retired: "archive",
  note: "message-square",
};

/** Max visible secondary actions before "More..." toggle */
const MAX_VISIBLE_SECONDARY = 3;

export function QuickActionCard({ equipment, onAction, actionLoading }: QuickActionCardProps) {
  const colors = getCustodyStyle(equipment.custody_status);
  const [showAll, setShowAll] = useState(false);

  const actions = equipment.available_actions || [];
  const primaryAction = equipment.primary_action || actions[0];

  // Split into primary + secondary
  const secondaryActions = actions.filter((a) => a !== primaryAction);
  const visibleSecondary = showAll ? secondaryActions : secondaryActions.slice(0, MAX_VISIBLE_SECONDARY);
  const hiddenCount = secondaryActions.length - MAX_VISIBLE_SECONDARY;

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
            {equipment.display_name}
          </h2>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            {equipment.type_display_name || equipment.legacy_type}
            {equipment.barcode && (
              <span style={{ marginLeft: "0.75rem", fontFamily: "monospace", fontWeight: 500 }}>
                #{equipment.barcode}
              </span>
            )}
          </div>
        </div>
        <span
          style={{
            padding: "0.25rem 0.75rem",
            borderRadius: "20px",
            fontSize: "0.8rem",
            fontWeight: 600,
            background: colors.text + "18",
            color: colors.text,
          }}
        >
          {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, equipment.custody_status)}
        </span>
      </div>

      {/* Info Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
        <InfoCell label="Condition" value={getLabel(EQUIPMENT_CONDITION_OPTIONS, equipment.condition_status)} />
        <InfoCell label="Total Checkouts" value={String(equipment.total_checkouts)} />
        {equipment.custodian_name && (
          <InfoCell label="Current Custodian" value={equipment.custodian_name} />
        )}
        {equipment.current_place_address && (
          <InfoCell label="Location" value={equipment.current_place_address} />
        )}
        {equipment.days_checked_out != null && (
          <InfoCell label="Days Out" value={String(equipment.days_checked_out)} highlight={equipment.days_checked_out > 14} />
        )}
        {equipment.current_due_date && (
          <InfoCell label="Due Date" value={new Date(equipment.current_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
        )}
      </div>

      {/* Primary Action */}
      {primaryAction && (
        <Button
          variant="primary"
          size="lg"
          icon={ACTION_ICONS[primaryAction]}
          fullWidth
          loading={actionLoading}
          onClick={() => onAction(primaryAction)}
          style={{
            minHeight: "48px",
            borderRadius: "10px",
            fontSize: "0.95rem",
            fontWeight: 600,
          }}
        >
          {ACTION_LABELS[primaryAction] || primaryAction}
        </Button>
      )}

      {/* Secondary Actions */}
      {visibleSecondary.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginTop: "0.5rem" }}>
          {visibleSecondary.map((action) => (
            <Button
              key={action}
              variant="ghost"
              size="md"
              icon={ACTION_ICONS[action]}
              fullWidth
              disabled={actionLoading}
              onClick={() => onAction(action)}
              style={{ borderRadius: "8px" }}
            >
              {ACTION_LABELS[action] || action}
            </Button>
          ))}

          {!showAll && hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                fontSize: "0.8rem",
                cursor: "pointer",
                padding: "0.25rem",
                textAlign: "center",
              }}
            >
              More ({hiddenCount})...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.125rem" }}>{label}</div>
      <div style={{ fontSize: "0.875rem", fontWeight: 500, color: highlight ? "var(--danger-text)" : undefined }}>{value}</div>
    </div>
  );
}
