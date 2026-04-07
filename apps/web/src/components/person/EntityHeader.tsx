"use client";

import { useState, ReactNode } from "react";
import { BackButton } from "@/components/common";
import { TrapperBadge, VolunteerBadge } from "@/components/badges";
import { ContactInfoCard } from "./ContactInfoCard";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { validatePersonName } from "@/lib/validation";
import { postApi } from "@/lib/api-client";

interface EntityHeaderProps {
  personId: string;
  displayName: string;
  /** Back button destination */
  backHref: string;
  /** Primary email (high-confidence) */
  email?: string | null;
  /** Primary phone */
  phone?: string | null;
  /** Badges to show after name */
  badges?: ReactNode;
  /** Availability status for trappers */
  availabilityStatus?: string | null;
  /** Aliases / previous names */
  aliases?: string[];
  /** Do Not Contact flag */
  doNotContact?: boolean;
  doNotContactReason?: string | null;
  /** Entity type warnings (site, business, unknown) */
  entityType?: string | null;
  /** Show name editing capability */
  allowNameEdit?: boolean;
  /** Action buttons (email, print, history, etc.) */
  actions?: ReactNode;
  /** Additional content below the header */
  children?: ReactNode;
  /** Callback after name or data changes */
  onDataChange?: () => void;
}

// Entity type badge
function EntityTypeBadge({ entityType }: { entityType: string | null }) {
  if (!entityType || entityType === "person") return null;

  const typeLabels: Record<string, { label: string; bg: string; color: string; title: string }> = {
    site: { label: "Site", bg: "#dc3545", color: "#fff", title: "This is a site/location, not a person" },
    business: { label: "Business", bg: "#fd7e14", color: "#000", title: "This is a business account, not a person" },
    unknown: { label: "Needs Review", bg: "#ffc107", color: "#000", title: "This record needs review - may be a site or duplicate" },
  };

  const info = typeLabels[entityType] || { label: entityType, bg: "#6c757d", color: "#fff", title: `Entity type: ${entityType}` };

  return (
    <span className="badge" style={{ background: info.bg, color: info.color, fontSize: "0.75rem" }} title={info.title}>
      {info.label}
    </span>
  );
}

// Data source badge
function DataSourceBadge({ dataSource }: { dataSource: string | null }) {
  if (!dataSource) return null;

  const sourceLabels: Record<string, { label: string; bg: string; color: string }> = {
    clinichq: { label: "ClinicHQ", bg: "#198754", color: "#fff" },
    petlink: { label: "PetLink", bg: "#0d6efd", color: "#fff" },
    legacy_import: { label: "Legacy", bg: "#ffc107", color: "#000" },
    volunteerhub: { label: "VolunteerHub", bg: "#6f42c1", color: "#fff" },
    airtable: { label: "Airtable", bg: "#ff6f00", color: "#fff" },
    web_intake: { label: "Web Intake", bg: "#3b82f6", color: "#fff" },
    atlas_ui: { label: "Beacon", bg: "#374151", color: "#fff" },
    shelterluv: { label: "ShelterLuv", bg: "#e91e63", color: "#fff" },
  };

  const info = sourceLabels[dataSource] || { label: dataSource, bg: "#6c757d", color: "#fff" };

  return (
    <span className="badge" style={{ background: info.bg, color: info.color, fontSize: "0.75rem" }} title={`Data source: ${dataSource}`}>
      {info.label}
    </span>
  );
}

export { EntityTypeBadge, DataSourceBadge };

/**
 * Unified header for person/trapper detail pages.
 * Handles name display/editing, badges, contact info, DNC warnings, and action buttons.
 */
export function EntityHeader({
  personId,
  displayName,
  backHref,
  email,
  phone,
  badges,
  availabilityStatus,
  aliases,
  doNotContact,
  doNotContactReason,
  entityType,
  allowNameEdit = false,
  actions,
  children,
  onDataChange,
}: EntityHeaderProps) {
  // Name editing state
  const [editingName, setEditingName] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameWarning, setNameWarning] = useState<string | null>(null);

  const startEditingName = () => {
    const name = displayName || "";
    const spaceIdx = name.indexOf(" ");
    setEditFirstName(spaceIdx > 0 ? name.substring(0, spaceIdx) : name);
    setEditLastName(spaceIdx > 0 ? name.substring(spaceIdx + 1) : "");
    setNameError(null);
    setNameWarning(null);
    setEditingName(true);
  };

  const handleSaveName = async () => {
    const combinedName = `${editFirstName.trim()} ${editLastName.trim()}`.trim();
    const validation = validatePersonName(combinedName);
    if (!validation.valid) {
      setNameError(validation.error || "Invalid name");
      setNameWarning(null);
      return;
    }

    if (combinedName === displayName) {
      setEditingName(false);
      return;
    }

    setSavingName(true);
    setNameError(null);
    setNameWarning(null);

    try {
      await postApi(`/api/people/${personId}`, {
        display_name: combinedName,
        change_reason: "name_correction",
      }, { method: "PATCH" });

      setNameWarning(`Previous name "${displayName}" preserved as alias.`);
      setEditingName(false);
      onDataChange?.();
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Network error while saving");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div>
      <BackButton fallbackHref={backHref} />

      <div style={{ marginTop: "1rem" }}>
        {/* Name row with edit */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          {editingName ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  placeholder="First name"
                  style={{ fontSize: "1.25rem", fontWeight: 700, padding: "0.25rem 0.5rem", width: "160px" }}
                  autoFocus
                />
                <input
                  type="text"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  placeholder="Last name"
                  style={{ fontSize: "1.25rem", fontWeight: 700, padding: "0.25rem 0.5rem", width: "200px" }}
                />
                <button onClick={handleSaveName} disabled={savingName} style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}>
                  {savingName ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setEditingName(false); setNameError(null); setNameWarning(null); }}
                  disabled={savingName}
                  style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent", border: "1px solid var(--border)" }}
                >
                  Cancel
                </button>
              </div>
              {nameError && <div style={{ color: "#dc3545", fontSize: "0.8rem" }}>{nameError}</div>}
            </div>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{displayName}</h1>
              {allowNameEdit && (
                <button
                  onClick={startEditingName}
                  style={{
                    padding: "0.125rem 0.5rem", fontSize: "0.75rem", background: "transparent",
                    border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer",
                  }}
                  title="Edit name"
                >
                  Edit
                </button>
              )}
              {badges}
              {availabilityStatus && availabilityStatus !== "available" && (
                <AvailabilityBadge status={availabilityStatus} />
              )}
              {entityType && <EntityTypeBadge entityType={entityType} />}
            </>
          )}
        </div>

        {/* Aliases */}
        {aliases && aliases.length > 0 && !editingName && (
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
            Also known as: {aliases.join(", ")}
          </div>
        )}

        {/* Do Not Contact Warning */}
        {doNotContact && (
          <div style={{
            background: "#dc3545", color: "#fff", padding: "0.625rem 1rem",
            borderRadius: "6px", marginBottom: "0.75rem",
            display: "flex", alignItems: "center", gap: "0.5rem",
            fontWeight: 600, fontSize: "0.875rem",
          }}>
            <span style={{ fontSize: "1.1rem" }}>&#x26D4;</span>
            <span>DO NOT CONTACT</span>
            {doNotContactReason && (
              <span style={{ fontWeight: 400, opacity: 0.9 }}>— {doNotContactReason}</span>
            )}
          </div>
        )}

        {/* Warnings */}
        {nameWarning && (
          <div style={{ fontSize: "0.8rem", color: "#198754", marginBottom: "0.25rem" }}>{nameWarning}</div>
        )}
        {entityType === "site" && (
          <p className="text-muted text-sm" style={{ color: "#dc3545", marginBottom: "0.25rem" }}>
            This is a site/location account from ClinicHQ, not a person.
          </p>
        )}
        {entityType === "unknown" && (
          <p className="text-muted text-sm" style={{ color: "#ffc107", marginBottom: "0.25rem" }}>
            This record needs review - may be a site, business, or duplicate entry.
          </p>
        )}

        {/* Contact info */}
        {(email || phone) && (
          <div style={{ marginTop: "0.5rem" }}>
            <ContactInfoCard email={email} phone={phone} showCopy />
          </div>
        )}

        {/* ID */}
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>ID: {personId}</p>

        {/* Action buttons */}
        {actions && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {actions}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
