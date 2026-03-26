"use client";

import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS, EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { getCustodyStyle, getActionColor } from "@/lib/equipment-styles";

interface QuickActionCardProps {
  equipment: VEquipmentInventoryRow & { available_actions?: string[] };
  onAction: (action: string) => void;
  actionLoading?: boolean;
}

export function QuickActionCard({ equipment, onAction, actionLoading }: QuickActionCardProps) {
  const colors = getCustodyStyle(equipment.custody_status);

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

      {/* Action Buttons */}
      {equipment.available_actions && equipment.available_actions.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {equipment.available_actions.map((action) => (
            <ActionButton
              key={action}
              action={action}
              onClick={() => onAction(action)}
              loading={actionLoading}
              isPrimary={action === "check_out" || action === "check_in"}
            />
          ))}
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

function ActionButton({ action, onClick, loading, isPrimary }: { action: string; onClick: () => void; loading?: boolean; isPrimary?: boolean }) {
  const color = getActionColor(action);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        padding: isPrimary ? "0.5rem 1.25rem" : "0.375rem 0.75rem",
        fontSize: isPrimary ? "0.9rem" : "0.8rem",
        fontWeight: isPrimary ? 600 : 500,
        background: isPrimary ? color : "transparent",
        color: isPrimary ? "#fff" : color,
        border: isPrimary ? "none" : `1px solid ${color}40`,
        borderRadius: "8px",
        cursor: loading ? "wait" : "pointer",
        opacity: loading ? 0.6 : 1,
      }}
    >
      {ACTION_LABELS[action] || action}
    </button>
  );
}
