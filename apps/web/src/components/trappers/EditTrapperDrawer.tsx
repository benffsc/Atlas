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
  capabilities?: string[] | null;
  availability_notes?: string | null;
  geographic_range?: string | null;
  onboarding_stage?: string | null;
  has_own_traps?: boolean;
  has_vehicle?: boolean;
  trapping_experience?: string | null;
}

interface EditTrapperDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  trapper: Trapper;
  onSaved: () => void;
}

const CAPABILITY_OPTIONS = [
  { value: "trapping", label: "Trapping" },
  { value: "transport", label: "Transport" },
  { value: "recon", label: "Recon / Scouting" },
  { value: "colony_care", label: "Colony Care" },
  { value: "mentoring", label: "Mentoring" },
];

const STAGE_OPTIONS = [
  { value: "interested", label: "Interested" },
  { value: "certified", label: "Certified" },
  { value: "field_ready", label: "Field Ready" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/**
 * Drawer for editing trapper profile — classification, capabilities, onboarding, equipment.
 */
export function EditTrapperDrawer({ isOpen, onClose, trapper, onSaved }: EditTrapperDrawerProps) {
  const [trapperType, setTrapperType] = useState(trapper.trapper_type);
  const [roleStatus, setRoleStatus] = useState(trapper.role_status);
  const [availability, setAvailability] = useState(trapper.availability_status);
  const [capabilities, setCapabilities] = useState<string[]>(trapper.capabilities || []);
  const [availabilityNotes, setAvailabilityNotes] = useState(trapper.availability_notes || "");
  const [geographicRange, setGeographicRange] = useState(trapper.geographic_range || "");
  const [onboardingStage, setOnboardingStage] = useState(trapper.onboarding_stage || "active");
  const [hasOwnTraps, setHasOwnTraps] = useState(trapper.has_own_traps || false);
  const [hasVehicle, setHasVehicle] = useState(trapper.has_vehicle || false);
  const [experience, setExperience] = useState(trapper.trapping_experience || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    trapperType !== trapper.trapper_type ||
    roleStatus !== trapper.role_status ||
    availability !== trapper.availability_status ||
    JSON.stringify(capabilities) !== JSON.stringify(trapper.capabilities || []) ||
    availabilityNotes !== (trapper.availability_notes || "") ||
    geographicRange !== (trapper.geographic_range || "") ||
    onboardingStage !== (trapper.onboarding_stage || "active") ||
    hasOwnTraps !== (trapper.has_own_traps || false) ||
    hasVehicle !== (trapper.has_vehicle || false) ||
    experience !== (trapper.trapping_experience || "");

  const toggleCap = (cap: string) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // PATCH classification fields via /api/trappers
      const classChanges: Array<{ action: string; value: string }> = [];
      if (trapperType !== trapper.trapper_type) classChanges.push({ action: "type", value: trapperType });
      if (roleStatus !== trapper.role_status) classChanges.push({ action: "status", value: roleStatus });
      if (availability !== trapper.availability_status) classChanges.push({ action: "availability", value: availability });

      for (const change of classChanges) {
        await postApi(
          "/api/trappers",
          { person_id: trapper.person_id, action: change.action, value: change.value },
          { method: "PATCH" },
        );
      }

      // PATCH profile fields via /api/people/[id]/trapper-profile
      const profileBody: Record<string, unknown> = {};
      if (JSON.stringify(capabilities) !== JSON.stringify(trapper.capabilities || [])) profileBody.capabilities = capabilities;
      if (availabilityNotes !== (trapper.availability_notes || "")) profileBody.availability_notes = availabilityNotes || null;
      if (geographicRange !== (trapper.geographic_range || "")) profileBody.geographic_range = geographicRange || null;
      if (onboardingStage !== (trapper.onboarding_stage || "active")) profileBody.onboarding_stage = onboardingStage;
      if (hasOwnTraps !== (trapper.has_own_traps || false)) profileBody.has_own_traps = hasOwnTraps;
      if (hasVehicle !== (trapper.has_vehicle || false)) profileBody.has_vehicle = hasVehicle;
      if (experience !== (trapper.trapping_experience || "")) profileBody.trapping_experience = experience || null;

      if (Object.keys(profileBody).length > 0) {
        await postApi(
          `/api/people/${trapper.person_id}/trapper-profile`,
          profileBody,
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
    border: "1px solid var(--border)",
    borderRadius: "6px",
    background: "var(--background)",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "0.25rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
  };

  const sectionStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    marginBottom: "0.75rem",
    paddingTop: "0.5rem",
    borderTop: "1px solid var(--border)",
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
              padding: "0.5rem 1rem", fontSize: "0.875rem",
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "6px", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            style={{
              padding: "0.5rem 1rem", fontSize: "0.875rem",
              background: hasChanges ? "var(--primary)" : "var(--border)",
              color: hasChanges ? "var(--primary-foreground)" : "var(--text-tertiary)",
              border: "none", borderRadius: "6px",
              cursor: hasChanges ? "pointer" : "not-allowed", fontWeight: 500,
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </>
      }
    >
      {error && (
        <div style={{
          padding: "0.5rem 0.75rem", marginBottom: "1rem",
          background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
          borderRadius: "6px", color: "var(--danger-text)", fontSize: "0.85rem",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Classification */}
        <div style={sectionStyle}>Classification</div>

        <div>
          <label style={labelStyle}>Trapper Type</label>
          <select value={trapperType} onChange={(e) => setTrapperType(e.target.value)} style={fieldStyle}>
            <option value="ffsc_volunteer">FFSC Volunteer</option>
            <option value="ffsc_staff">FFSC Staff</option>
            <option value="community_trapper">Community Trapper</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Status</label>
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

        <div>
          <label style={labelStyle}>Onboarding Stage</label>
          <select value={onboardingStage} onChange={(e) => setOnboardingStage(e.target.value)} style={fieldStyle}>
            {STAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Capabilities */}
        <div style={sectionStyle}>Capabilities</div>

        <div>
          <label style={labelStyle}>What can they do?</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {CAPABILITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleCap(opt.value)}
                style={{
                  padding: "0.3rem 0.65rem", borderRadius: "9999px", fontSize: "0.8rem",
                  border: "1px solid var(--border)",
                  background: capabilities.includes(opt.value) ? "var(--primary)" : "var(--card-bg)",
                  color: capabilities.includes(opt.value) ? "var(--primary-foreground)" : "var(--foreground)",
                  fontWeight: capabilities.includes(opt.value) ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Experience Level</label>
          <select value={experience} onChange={(e) => setExperience(e.target.value)} style={fieldStyle}>
            <option value="">Not specified</option>
            <option value="none">No prior experience</option>
            <option value="some">Some experience</option>
            <option value="experienced">Experienced</option>
          </select>
        </div>

        {/* Area & Availability */}
        <div style={sectionStyle}>Area & Availability</div>

        <div>
          <label style={labelStyle}>Geographic Range</label>
          <input
            type="text"
            value={geographicRange}
            onChange={(e) => setGeographicRange(e.target.value)}
            placeholder="e.g., Windsor, West Sonoma County"
            style={fieldStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Availability Notes</label>
          <input
            type="text"
            value={availabilityNotes}
            onChange={(e) => setAvailabilityNotes(e.target.value)}
            placeholder="e.g., Monday clinics only, weekends"
            style={fieldStyle}
          />
        </div>

        {/* Equipment */}
        <div style={sectionStyle}>Equipment</div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
            <input type="checkbox" checked={hasOwnTraps} onChange={(e) => setHasOwnTraps(e.target.checked)} style={{ width: 16, height: 16 }} />
            Has own traps
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
            <input type="checkbox" checked={hasVehicle} onChange={(e) => setHasVehicle(e.target.checked)} style={{ width: 16, height: 16 }} />
            Has vehicle for transport
          </label>
        </div>
      </div>
    </ActionDrawer>
  );
}
