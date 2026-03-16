"use client";

import { useState } from "react";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { postApi } from "@/lib/api-client";

interface Trapper {
  person_id: string;
  display_name: string;
  trapper_type: string;
  role_status: string;
  availability_status: string;
  has_signed_contract: boolean;
}

interface EditTrapperDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  trapper: Trapper;
  onSaved: () => void;
}

/**
 * Drawer for editing trapper profile fields without leaving the list.
 * PATCHes to /api/trappers (existing endpoint).
 */
export function EditTrapperDrawer({ isOpen, onClose, trapper, onSaved }: EditTrapperDrawerProps) {
  const [trapperType, setTrapperType] = useState(trapper.trapper_type);
  const [roleStatus, setRoleStatus] = useState(trapper.role_status);
  const [availability, setAvailability] = useState(trapper.availability_status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    trapperType !== trapper.trapper_type ||
    roleStatus !== trapper.role_status ||
    availability !== trapper.availability_status;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const changes: Array<{ action: string; value: string }> = [];
      if (trapperType !== trapper.trapper_type) changes.push({ action: "type", value: trapperType });
      if (roleStatus !== trapper.role_status) changes.push({ action: "status", value: roleStatus });
      if (availability !== trapper.availability_status) changes.push({ action: "availability", value: availability });

      for (const change of changes) {
        await postApi(
          "/api/trappers",
          { person_id: trapper.person_id, action: change.action, value: change.value },
          { method: "PATCH" },
        );
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    border: "1px solid var(--border, #e5e7eb)",
    borderRadius: "6px",
    background: "var(--background, #fff)",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "0.25rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary, #6b7280)",
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit ${trapper.display_name}`}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: "transparent",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: hasChanges ? "#2563eb" : "#e5e7eb",
              color: hasChanges ? "#fff" : "#9ca3af",
              border: "none",
              borderRadius: "6px",
              cursor: hasChanges ? "pointer" : "not-allowed",
              fontWeight: 500,
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </>
      }
    >
      {error && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            color: "#dc2626",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={labelStyle}>Trapper Type</label>
          <select value={trapperType} onChange={(e) => setTrapperType(e.target.value)} style={fieldStyle}>
            <option value="coordinator">Coordinator</option>
            <option value="head_trapper">Head Trapper</option>
            <option value="ffsc_trapper">FFSC Trapper</option>
            <option value="community_trapper">Community</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Role Status</label>
          <select value={roleStatus} onChange={(e) => setRoleStatus(e.target.value)} style={fieldStyle}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Availability</label>
          <select value={availability} onChange={(e) => setAvailability(e.target.value)} style={fieldStyle}>
            <option value="available">Available</option>
            <option value="busy">Busy</option>
            <option value="on_leave">On Leave</option>
          </select>
        </div>
      </div>
    </ActionDrawer>
  );
}
