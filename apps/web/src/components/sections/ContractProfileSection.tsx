"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { ConfirmChangeModal } from "@/components/person/ConfirmChangeModal";
import type { ConfirmChangeAction } from "@/components/person/ConfirmChangeModal";
import { useToast } from "@/components/feedback/Toast";
import type { SectionProps } from "@/lib/person-roles/types";

const TYPE_LABELS: Record<string, string> = {
  coordinator: "Coordinator",
  head_trapper: "Head Trapper",
  ffsc_trapper: "FFSC Trapper",
  community_trapper: "Community Trapper",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  revoked: "Revoked",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  busy: "Busy",
  on_leave: "On Leave",
};

const DANGEROUS_CHANGES = new Set(["suspended", "revoked"]);

/**
 * Contract & Profile section for trapper detail.
 * Shows contract status, trapper type, role status, availability — all editable.
 * Also shows profile edit form (notes, rescue name, certification, contract areas).
 */
export function ContractProfileSection({ personId, data, onDataChange }: SectionProps) {
  const { addToast } = useToast();
  const { trapperProfile: profile, trapperStats: stats } = data;

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [editProfile, setEditProfile] = useState({
    notes: "", rescue_name: "", has_signed_contract: false,
    contract_signed_date: "", contract_areas: "", certified_date: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Confirm modal
  const [confirmAction, setConfirmAction] = useState<ConfirmChangeAction | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!profile) return null;

  const startEditProfile = () => {
    setEditProfile({
      notes: profile.notes || "",
      rescue_name: profile.rescue_name || "",
      has_signed_contract: profile.has_signed_contract,
      contract_signed_date: profile.contract_signed_date || "",
      contract_areas: (profile.contract_areas || []).join(", "),
      certified_date: profile.certified_date || "",
    });
    setEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const areas = editProfile.contract_areas.split(",").map(a => a.trim()).filter(Boolean);
      await postApi(`/api/people/${personId}/trapper-profile`, {
        notes: editProfile.notes || null,
        rescue_name: editProfile.rescue_name || null,
        has_signed_contract: editProfile.has_signed_contract,
        contract_signed_date: editProfile.contract_signed_date || null,
        contract_areas: areas.length > 0 ? areas : null,
        certified_date: editProfile.certified_date || null,
      }, { method: "PATCH" });
      setEditingProfile(false);
      onDataChange?.("trapper");
    } catch (err) {
      console.error("Failed to save profile:", err);
      addToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSavingProfile(false);
    }
  };

  const requestChange = (field: string, newValue: string) => {
    let currentValue = "";
    let labels: Record<string, string> = {};

    if (field === "status") {
      currentValue = profile.is_active ? "active" : "inactive";
      labels = STATUS_LABELS;
    } else if (field === "type") {
      currentValue = stats?.trapper_type || "community_trapper";
      labels = TYPE_LABELS;
    } else if (field === "availability") {
      currentValue = stats?.availability_status || "available";
      labels = AVAILABILITY_LABELS;
    }

    if (currentValue === newValue) return;

    setConfirmAction({
      field,
      label: field === "status" ? "Status" : field === "type" ? "Trapper Type" : "Availability",
      currentValue,
      newValue,
      currentLabel: labels[currentValue] || currentValue,
      newLabel: labels[newValue] || newValue,
      isDangerous: DANGEROUS_CHANGES.has(newValue) ||
        (field === "type" && !!stats?.is_ffsc_trapper && newValue === "community_trapper"),
    });
  };

  const executeChange = async (reason: string) => {
    if (!confirmAction) return;
    setConfirming(true);
    try {
      await postApi("/api/trappers", {
        person_id: personId,
        action: confirmAction.field,
        value: confirmAction.newValue,
        reason: reason || null,
      }, { method: "PATCH" });
      setConfirmAction(null);
      onDataChange?.("trapper");
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Failed to update" });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        {!editingProfile ? (
          <button onClick={startEditProfile} style={{
            fontSize: "0.8rem", padding: "0.35rem 0.75rem", background: "transparent",
            border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer",
          }}>
            Edit Profile
          </button>
        ) : (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={handleSaveProfile} disabled={savingProfile} style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
              {savingProfile ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setEditingProfile(false)} disabled={savingProfile} style={{
              fontSize: "0.8rem", padding: "0.35rem 0.75rem", background: "transparent", border: "1px solid var(--border)",
            }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {!editingProfile ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" }}>
            {/* Contract Status */}
            <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Contract</div>
              <span style={{
                display: "inline-block", padding: "0.25rem 0.75rem", borderRadius: "9999px", fontSize: "0.85rem", fontWeight: 500,
                background: profile.has_signed_contract ? "#dcfce7" : "#fee2e2",
                color: profile.has_signed_contract ? "#166534" : "#b91c1c",
              }}>
                {profile.has_signed_contract ? "Signed" : "Not Signed"}
              </span>
              {profile.contract_signed_date && (
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                  {new Date(profile.contract_signed_date).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* Trapper Type */}
            <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Type</div>
              <select
                value={stats?.trapper_type || "community_trapper"}
                onChange={(e) => requestChange("type", e.target.value)}
                style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--background)", cursor: "pointer" }}
              >
                {Object.entries(TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              {profile.tier && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.4rem" }}>{profile.tier}</div>}
              {profile.is_legacy_informal && <div style={{ fontSize: "0.75rem", color: "#b45309", marginTop: "0.25rem" }}>Legacy informal</div>}
              {profile.rescue_name && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>Rescue: {profile.rescue_name}</div>}
            </div>

            {/* Role Status */}
            <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Status</div>
              <select
                value={profile.is_active ? "active" : "inactive"}
                onChange={(e) => requestChange("status", e.target.value)}
                style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--background)", cursor: "pointer" }}
              >
                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              {profile.certified_date && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.4rem" }}>Certified: {new Date(profile.certified_date).toLocaleDateString()}</div>}
            </div>

            {/* Availability */}
            <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Availability</div>
              <select
                value={stats?.availability_status || "available"}
                onChange={(e) => requestChange("availability", e.target.value)}
                style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--background)", cursor: "pointer" }}
              >
                {Object.entries(AVAILABILITY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {profile.notes && (
            <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Notes & Availability</div>
              <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{profile.notes}</div>
            </div>
          )}

          {profile.contract_areas && profile.contract_areas.length > 0 && (
            <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>Contracted Areas</div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {profile.contract_areas.map((area, i) => (
                  <span key={i} style={{ padding: "0.25rem 0.5rem", background: "#e2e8f0", borderRadius: "4px", fontSize: "0.85rem" }}>{area}</span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* Edit mode form */
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={editProfile.has_signed_contract} onChange={(e) => setEditProfile(prev => ({ ...prev, has_signed_contract: e.target.checked }))} />
              <span style={{ fontWeight: 500 }}>Contract Signed</span>
            </label>
            {editProfile.has_signed_contract && (
              <div style={{ marginTop: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Date Signed</label>
                <input type="date" value={editProfile.contract_signed_date} onChange={(e) => setEditProfile(prev => ({ ...prev, contract_signed_date: e.target.value }))} style={{ padding: "0.4rem", width: "200px" }} />
              </div>
            )}
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>Certification Date</label>
            <input type="date" value={editProfile.certified_date} onChange={(e) => setEditProfile(prev => ({ ...prev, certified_date: e.target.value }))} style={{ padding: "0.4rem", width: "200px" }} />
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>Date trapper was certified/approved</div>
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>Contract Areas</label>
            <textarea value={editProfile.contract_areas} onChange={(e) => setEditProfile(prev => ({ ...prev, contract_areas: e.target.value }))} placeholder="Comma-separated areas" rows={2} style={{ width: "100%", padding: "0.5rem" }} />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>Rescue Name</label>
            <input type="text" value={editProfile.rescue_name} onChange={(e) => setEditProfile(prev => ({ ...prev, rescue_name: e.target.value }))} placeholder="e.g. Cat Rescue of Cloverdale" style={{ width: "100%", padding: "0.5rem" }} />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>Notes & Availability</label>
            <textarea value={editProfile.notes} onChange={(e) => setEditProfile(prev => ({ ...prev, notes: e.target.value }))} placeholder="Availability, preferences, special notes..." rows={4} style={{ width: "100%", padding: "0.5rem" }} />
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmChangeModal
          action={confirmAction}
          onConfirm={executeChange}
          onCancel={() => setConfirmAction(null)}
          confirming={confirming}
        />
      )}
    </>
  );
}
