"use client";

import { useState, useCallback } from "react";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/components/forms/PlaceResolver";
import { postApi, patchRequest } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { RELATED_PERSON_RELATIONSHIP_OPTIONS } from "@/lib/form-options";

/**
 * LogUpdateDrawer — unified "what happened?" action for request/site updates.
 *
 * Replaces the need to choose between Update Situation, Journal Entry,
 * Add Field Contact, or inline section edits. Staff types what happened,
 * optionally adds contacts/addresses/status changes, and the system
 * routes everything to the right tables.
 *
 * One Save creates:
 * - A journal entry (always)
 * - Related person records (if contacts added)
 * - Place links to site (if addresses added)
 * - Status change on request (if status toggled)
 * - Site timeline event (via trigger)
 */

interface LogUpdateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  siteId?: string | null;
  placeId?: string | null;
  onSaved: () => void;
}

interface InlineContact {
  id: string; // local key
  name: string;
  phone: string;
  role: string;
}

interface InlineAddress {
  id: string;
  place: ResolvedPlace | null;
}

const UPDATE_TYPES = [
  { value: "note", label: "Note", icon: "pencil" },
  { value: "contact_attempt", label: "Phone Call", icon: "phone" },
  { value: "field_visit", label: "Field Visit", icon: "map-pin" },
  { value: "trap_event", label: "Trapping Event", icon: "target" },
] as const;

export function LogUpdateDrawer({ isOpen, onClose, requestId, siteId, placeId, onSaved }: LogUpdateDrawerProps) {
  const toast = useToast();

  // Core
  const [body, setBody] = useState("");
  const [updateType, setUpdateType] = useState<string>("note");
  const [saving, setSaving] = useState(false);

  // Inline contacts
  const [contacts, setContacts] = useState<InlineContact[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);

  // Inline addresses
  const [addresses, setAddresses] = useState<InlineAddress[]>([]);
  const [showAddAddress, setShowAddAddress] = useState(false);

  // Optional status change
  const [changeStatus, setChangeStatus] = useState(false);
  const [newStatus, setNewStatus] = useState("working");

  // Optional cat count update
  const [updateCats, setUpdateCats] = useState(false);
  const [catCount, setCatCount] = useState("");

  const reset = useCallback(() => {
    setBody("");
    setUpdateType("note");
    setContacts([]);
    setShowAddContact(false);
    setAddresses([]);
    setShowAddAddress(false);
    setChangeStatus(false);
    setNewStatus("working");
    setUpdateCats(false);
    setCatCount("");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSave = useCallback(async () => {
    if (!body.trim()) return;
    setSaving(true);

    try {
      // 1. Create journal entry (always)
      await postApi("/api/journal", {
        request_id: requestId,
        entry_kind: updateType,
        body: body.trim(),
        tags: ["log_update"],
      });

      // 2. Create related person records (if any contacts added)
      for (const contact of contacts) {
        if (!contact.name.trim()) continue;
        try {
          await postApi(`/api/requests/${requestId}/field-contacts`, {
            first_name: contact.name.trim().split(/\s+/)[0],
            last_name: contact.name.trim().split(/\s+/).slice(1).join(" ") || undefined,
            phone: contact.phone.trim() || undefined,
            relationship_type: contact.role,
          });
        } catch {
          // Non-blocking — contact creation failure shouldn't stop the update
        }
      }

      // 3. Add addresses to site (if any)
      for (const addr of addresses) {
        if (!addr.place || !siteId) continue;
        try {
          await postApi(`/api/colonies/${siteId}/places`, {
            place_id: addr.place.place_id,
            relationship_type: "core_site",
            is_primary: false,
            added_by: "web_user",
          });
        } catch {
          // Non-blocking
        }
      }

      // 4. Status change (if toggled)
      if (changeStatus) {
        try {
          await patchRequest(requestId, { status: newStatus });
        } catch {
          // Non-blocking — journal entry is the critical path
        }
      }

      // 5. Cat count update (if toggled)
      if (updateCats && catCount) {
        try {
          await patchRequest(requestId, { estimated_cat_count: parseInt(catCount) });
        } catch {
          // Non-blocking
        }
      }

      toast.success("Update logged");
      handleClose();
      onSaved();
    } catch (err) {
      toast.error("Failed to save update");
    } finally {
      setSaving(false);
    }
  }, [body, updateType, contacts, addresses, changeStatus, newStatus, updateCats, catCount, requestId, siteId, handleClose, onSaved, toast]);

  const addContact = useCallback(() => {
    setContacts(prev => [...prev, { id: `c-${Date.now()}`, name: "", phone: "", role: "neighbor" }]);
    setShowAddContact(true);
  }, []);

  const updateContact = useCallback((id: string, field: keyof InlineContact, value: string) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  }, []);

  const removeContact = useCallback((id: string) => {
    setContacts(prev => prev.filter(c => c.id !== id));
  }, []);

  const addAddress = useCallback(() => {
    setAddresses(prev => [...prev, { id: `a-${Date.now()}`, place: null }]);
    setShowAddAddress(true);
  }, []);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "6px 8px", fontSize: "0.85rem",
    border: "1px solid var(--border)", borderRadius: "6px",
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Log Update"
      width="md"
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" size="sm" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!body.trim() || saving} loading={saving}>
            Save Update
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Update type selector */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {UPDATE_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setUpdateType(t.value)}
              style={{
                display: "flex", alignItems: "center", gap: "0.3rem",
                padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.8rem",
                border: updateType === t.value ? "2px solid var(--primary)" : "1px solid var(--border)",
                background: updateType === t.value ? "var(--primary-bg, #f0fdf4)" : "transparent",
                fontWeight: updateType === t.value ? 600 : 400,
                cursor: "pointer", color: "var(--foreground)",
              }}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Main text area */}
        <div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              updateType === "contact_attempt" ? "Who did you call? What did they say?" :
              updateType === "field_visit" ? "What did you see on site? Cat count, conditions, access..." :
              updateType === "trap_event" ? "How many traps set? Cats caught? Any issues?" :
              "What happened? Any new info about this case..."
            }
            rows={4}
            autoFocus
            style={{ ...inputStyle, resize: "vertical" as const, lineHeight: 1.4 }}
          />
        </div>

        {/* ── People mentioned ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--foreground)" }}>Contacts mentioned</span>
            <button
              onClick={addContact}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: "0.8rem", fontWeight: 500 }}
            >
              + Add contact
            </button>
          </div>
          {contacts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {contacts.map(c => (
                <div key={c.id} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <input
                    type="text"
                    value={c.name}
                    onChange={(e) => updateContact(c.id, "name", e.target.value)}
                    placeholder="Name"
                    style={{ ...inputStyle, flex: 2 }}
                  />
                  <input
                    type="tel"
                    value={c.phone}
                    onChange={(e) => updateContact(c.id, "phone", e.target.value)}
                    placeholder="Phone"
                    style={{ ...inputStyle, flex: 2 }}
                  />
                  <select
                    value={c.role}
                    onChange={(e) => updateContact(c.id, "role", e.target.value)}
                    style={{ ...inputStyle, flex: 1.5 }}
                  >
                    {RELATED_PERSON_RELATIONSHIP_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeContact(c.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "1rem" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
          {contacts.length === 0 && (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Talked to someone new? Add their name and phone so it's on file for the trapper.
            </div>
          )}
        </div>

        {/* ── Addresses mentioned ── */}
        {siteId && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--foreground)" }}>Addresses to add to site</span>
              <button
                onClick={addAddress}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: "0.8rem", fontWeight: 500 }}
              >
                + Add address
              </button>
            </div>
            {addresses.map(a => (
              <div key={a.id} style={{ marginBottom: "0.5rem" }}>
                <PlaceResolver
                  value={a.place}
                  onChange={(place: ResolvedPlace | null) => {
                    setAddresses(prev => prev.map(addr => addr.id === a.id ? { ...addr, place } : addr));
                  }}
                  placeholder="Search for an address..."
                />
              </div>
            ))}
            {addresses.length === 0 && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Learned about a neighboring address with cats? Add it to this site.
              </div>
            )}
          </div>
        )}

        {/* ── Quick toggles ── */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {/* Status change */}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
            <input type="checkbox" checked={changeStatus} onChange={(e) => setChangeStatus(e.target.checked)} />
            Change status to:
            {changeStatus && (
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                <option value="working">Working</option>
                <option value="paused">Paused</option>
                <option value="new">New</option>
                <option value="completed">Completed</option>
              </select>
            )}
          </label>

          {/* Cat count update */}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
            <input type="checkbox" checked={updateCats} onChange={(e) => setUpdateCats(e.target.checked)} />
            Update cat count:
            {updateCats && (
              <input
                type="number"
                value={catCount}
                onChange={(e) => setCatCount(e.target.value)}
                placeholder="#"
                min="0"
                style={{ ...inputStyle, width: "60px" }}
              />
            )}
          </label>
        </div>
      </div>
    </ActionDrawer>
  );
}
