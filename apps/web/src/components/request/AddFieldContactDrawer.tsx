"use client";

import { useState, useCallback } from "react";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Button } from "@/components/ui/Button";
import { RELATED_PERSON_RELATIONSHIP_OPTIONS } from "@/lib/form-options";
import { postApi } from "@/lib/api-client";
import type { RelatedPersonDisplay } from "@/hooks/useRequestDetail";

interface AddFieldContactDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  onContactAdded: () => void;
  existingPeople?: RelatedPersonDisplay[];
}

export function AddFieldContactDrawer({
  isOpen,
  onClose,
  requestId,
  onContactAdded,
  existingPeople = [],
}: AddFieldContactDrawerProps) {
  const [name, setName] = useState("");
  const [showLastName, setShowLastName] = useState(false);
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [relationshipType, setRelationshipType] = useState("neighbor");
  const [notes, setNotes] = useState("");
  const [setAsSiteContact, setSetAsSiteContact] = useState(false);
  const [referredByPersonId, setReferredByPersonId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setShowLastName(false);
    setLastName("");
    setPhone("");
    setPhone2("");
    setEmail("");
    setAddress("");
    setRelationshipType("neighbor");
    setNotes("");
    setSetAsSiteContact(false);
    setReferredByPersonId("");
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Split name into first/last — explicit lastName field overrides
  const parsedFirst = name.trim().split(/\s+/)[0] || "";
  const parsedLast = lastName.trim() || name.trim().split(/\s+/).slice(1).join(" ") || "";

  const hasName = !!name.trim();
  const hasIdentifier = !!phone.trim() || !!email.trim();
  const isNameOnly = hasName && !hasIdentifier;
  const canSubmit = hasName;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await postApi(`/api/requests/${requestId}/field-contacts`, {
        first_name: parsedFirst,
        last_name: parsedLast,
        phone: phone.trim(),
        phone2: phone2.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        relationship_type: relationshipType,
        notes: notes.trim() || undefined,
        set_as_site_contact: setAsSiteContact,
        referred_by_person_id: referredByPersonId || undefined,
      });
      onContactAdded();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setSaving(false);
    }
  }, [canSubmit, requestId, parsedFirst, parsedLast, phone, phone2, email, address, relationshipType, notes, setAsSiteContact, referredByPersonId, onContactAdded, handleClose]);

  const inputStyle = {
    width: "100%",
    padding: "6px 8px",
    fontSize: "0.85rem",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  };

  const labelStyle = {
    display: "block" as const,
    marginBottom: "4px",
    fontSize: "0.8rem",
    fontWeight: 500 as const,
  };

  // Only resolved people can be referrers (FK requires person_id)
  const referrablePeople = existingPeople.filter((p) => p.display_name && p.person_id);

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Field Contact"
      width="sm"
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" size="sm" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={saving || !canSubmit} loading={saving}>
            Add Contact
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
        {error && (
          <div style={{ padding: "0.5rem", background: "#fef2f2", color: "#991b1b", borderRadius: "6px", fontSize: "0.8rem" }}>
            {error}
          </div>
        )}

        <div>
          <label style={labelStyle}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ruben, or Ruben Garcia"
            style={inputStyle}
            autoFocus
          />
          {hasName && !parsedLast && !showLastName && (
            <button
              type="button"
              onClick={() => setShowLastName(true)}
              style={{
                marginTop: "4px", fontSize: "0.75rem", color: "var(--primary)",
                background: "none", border: "none", cursor: "pointer", padding: 0,
              }}
            >
              + Add last name
            </button>
          )}
        </div>

        {showLastName && (
          <div>
            <label style={labelStyle}>Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Garcia"
              style={inputStyle}
            />
          </div>
        )}

        <div>
          <label style={labelStyle}>Phone 1</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="707-568-3041"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Phone 2</label>
          <input
            type="tel"
            value={phone2}
            onChange={(e) => setPhone2(e.target.value)}
            placeholder="707-318-3103"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="linda@example.com"
            style={inputStyle}
          />
        </div>

        {isNameOnly && (
          <div style={{
            padding: "0.5rem", background: "#fffbeb", color: "#92400e",
            borderRadius: "6px", fontSize: "0.8rem", border: "1px solid #fde68a",
          }}>
            No phone or email — this contact will be saved as name-only and will need follow-up to get contact info.
          </div>
        )}

        <div>
          <label style={labelStyle}>Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="2430 Teaberry St, Santa Rosa, CA 95404"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Relationship</label>
          <select
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value)}
            style={inputStyle}
          >
            {RELATED_PERSON_RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {referrablePeople.length > 0 && (
          <div>
            <label style={labelStyle}>Referred by</label>
            <select
              value={referredByPersonId}
              onChange={(e) => setReferredByPersonId(e.target.value)}
              style={inputStyle}
            >
              <option value="">— none —</option>
              {referrablePeople.map((p) => (
                <option key={p.person_id!} value={p.person_id!}>{p.display_name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., neighbor called ahead of trapping, has seen 5 cats in backyard..."
            rows={3}
            style={{ ...inputStyle, resize: "vertical" as const }}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={setAsSiteContact}
            onChange={(e) => setSetAsSiteContact(e.target.checked)}
          />
          Set as site contact for this request
        </label>
      </div>
    </ActionDrawer>
  );
}
