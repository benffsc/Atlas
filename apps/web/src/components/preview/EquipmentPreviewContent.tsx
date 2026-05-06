"use client";

import { useState } from "react";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { EntityPreviewPanel } from "@/components/preview/EntityPreviewPanel";
import { Icon } from "@/components/ui/Icon";
import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS, EQUIPMENT_CONDITION_OPTIONS, EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { getCustodyStyle, getFunctionalStyle } from "@/lib/equipment-styles";

interface EquipmentPreviewContentProps {
  equipment: VEquipmentInventoryRow;
  onClose: () => void;
  onUpdate?: () => void;
}

export function EquipmentPreviewContent({ equipment, onClose, onUpdate }: EquipmentPreviewContentProps) {
  const toast = useToast();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(equipment.display_name);
  const [saving, setSaving] = useState(false);

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === equipment.display_name) {
      setEditingName(false);
      setNameValue(equipment.display_name);
      return;
    }
    setSaving(true);
    try {
      await fetchApi(`/api/equipment/${equipment.equipment_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment_name: trimmed }),
      });
      toast.success(`Renamed to "${trimmed}"`);
      setEditingName(false);
      onUpdate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setSaving(false);
    }
  };

  const titleContent = editingName ? (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <input
        type="text"
        value={nameValue}
        onChange={(e) => setNameValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") { setEditingName(false); setNameValue(equipment.display_name); } }}
        autoFocus
        disabled={saving}
        style={{
          flex: 1, padding: "0.25rem 0.5rem", borderRadius: 6,
          border: "1.5px solid var(--primary, #3b82f6)", fontSize: "1rem",
          fontWeight: 600, fontFamily: "inherit", color: "var(--text-primary)",
          outline: "none", boxSizing: "border-box", minWidth: 0,
        }}
      />
      <button onClick={handleSaveName} disabled={saving} style={{ background: "none", border: "none", cursor: "pointer", padding: "0.25rem" }} title="Save">
        <Icon name="check" size={18} color="var(--success-text)" />
      </button>
      <button onClick={() => { setEditingName(false); setNameValue(equipment.display_name); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "0.25rem" }} title="Cancel">
        <Icon name="x" size={18} color="var(--muted)" />
      </button>
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <span>{equipment.display_name}</span>
      <button
        onClick={() => { setNameValue(equipment.display_name); setEditingName(true); }}
        style={{ background: "none", border: "none", cursor: "pointer", padding: "0.125rem", color: "var(--muted)", flexShrink: 0 }}
        title="Edit name"
      >
        <Icon name="pencil" size={14} color="var(--muted)" />
      </button>
    </div>
  );

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
            <div>
              {equipment.source_system === "airtable"
                ? "Airtable (synced)"
                : equipment.source_system === "atlas_ui"
                  ? "Beacon (kiosk)"
                  : equipment.source_system}
            </div>
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
      title={titleContent}
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
