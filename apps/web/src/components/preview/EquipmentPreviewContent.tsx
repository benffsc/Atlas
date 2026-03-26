"use client";

import { EntityPreviewPanel } from "@/components/preview/EntityPreviewPanel";
import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS, EQUIPMENT_CONDITION_OPTIONS, EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { getCustodyStyle, getFunctionalStyle } from "@/lib/equipment-styles";

interface EquipmentPreviewContentProps {
  equipment: VEquipmentInventoryRow;
  onClose: () => void;
}

export function EquipmentPreviewContent({ equipment, onClose }: EquipmentPreviewContentProps) {
  const stats = [
    {
      label: "Status",
      value: getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, equipment.custody_status),
      color: getCustodyStyle(equipment.custody_status).text,
    },
    {
      label: "Condition",
      value: getLabel(EQUIPMENT_CONDITION_OPTIONS, equipment.condition_status),
    },
    {
      label: "Total Checkouts",
      value: String(equipment.total_checkouts),
    },
    ...(equipment.days_checked_out != null ? [{
      label: "Days Out",
      value: String(equipment.days_checked_out),
      color: equipment.days_checked_out > 14 ? "var(--danger-text)" : undefined,
    }] : []),
  ];

  const sections = [
    // Photo section (if available)
    ...(equipment.photo_url ? [{
      id: "photo",
      title: "Photo",
      content: (
        <div style={{ textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={equipment.photo_url}
            alt={equipment.display_name}
            style={{
              maxWidth: "100%",
              maxHeight: "200px",
              borderRadius: "8px",
              objectFit: "contain",
              background: "var(--muted-bg)",
            }}
          />
        </div>
      ),
    }] : []),
    {
      id: "details",
      title: "Details",
      content: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Type</div>
            <div>{equipment.type_display_name || equipment.legacy_type}</div>
          </div>
          {equipment.barcode && (
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Barcode</div>
              <div style={{ fontFamily: "monospace" }}>{equipment.barcode}</div>
            </div>
          )}
          {equipment.item_type && (
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Item Type</div>
              <div>{equipment.item_type}</div>
            </div>
          )}
          {equipment.size && (
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Size</div>
              <div>{equipment.size}</div>
            </div>
          )}
          {equipment.functional_status && equipment.functional_status !== "functional" && (
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Functional Status</div>
              <div style={{ color: getFunctionalStyle(equipment.functional_status).text, fontWeight: 500 }}>
                {getLabel(EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS, equipment.functional_status)}
              </div>
            </div>
          )}
          {equipment.serial_number && (
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Serial Number</div>
              <div>{equipment.serial_number}</div>
            </div>
          )}
          {equipment.manufacturer && (
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Manufacturer</div>
              <div>{equipment.manufacturer}</div>
            </div>
          )}
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Source</div>
            <div>{equipment.source_system}</div>
          </div>
        </div>
      ),
    },
    ...((equipment.custodian_name || equipment.current_holder_name) ? [{
      id: "custody",
      title: "Current Custody",
      content: (
        <div style={{ fontSize: "0.85rem" }}>
          <div style={{ fontWeight: 500 }}>{equipment.custodian_name || equipment.current_holder_name}</div>
          {equipment.current_place_address && (
            <div style={{ color: "var(--muted)", marginTop: "0.25rem" }}>{equipment.current_place_address}</div>
          )}
          {(equipment.current_due_date || equipment.expected_return_date) && (
            <div style={{ marginTop: "0.25rem", color: "var(--muted)" }}>
              Due: {new Date(equipment.current_due_date || equipment.expected_return_date!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          )}
        </div>
      ),
    }] : []),
    ...(equipment.notes ? [{
      id: "notes",
      title: "Notes",
      content: <div style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{equipment.notes}</div>,
    }] : []),
  ];

  return (
    <EntityPreviewPanel
      title={equipment.display_name}
      detailHref={`/equipment/${equipment.equipment_id}?from=equipment`}
      onClose={onClose}
      badges={
        <span style={{
          padding: "0.125rem 0.5rem",
          borderRadius: "12px",
          fontSize: "0.7rem",
          fontWeight: 600,
          background: getCustodyStyle(equipment.custody_status).bg,
          color: getCustodyStyle(equipment.custody_status).text,
        }}>
          {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, equipment.custody_status)}
        </span>
      }
      stats={stats}
      sections={sections}
    />
  );
}
