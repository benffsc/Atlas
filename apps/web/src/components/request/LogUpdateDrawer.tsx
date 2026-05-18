"use client";

import { useState, useCallback, useEffect } from "react";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/components/forms/PlaceResolver";
import { postApi, patchRequest } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { RELATED_PERSON_RELATIONSHIP_OPTIONS } from "@/lib/form-options";
import { formatPhone, formatAddress } from "@/lib/formatters";
import type { RequestDetail } from "@/app/requests/[id]/types";

/**
 * LogUpdateDrawer — unified "what happened?" action for request updates.
 *
 * Merges the old LogUpdate + UpdateSituation into one narrative-first drawer.
 * Staff writes what happened, then optionally expands collapsible sections
 * to update location, contacts, cat situation, or quick-action toggles.
 *
 * One Save creates:
 * - A journal entry (always, if body non-empty)
 * - Composite PATCH of request fields (location, situation, AI-extracted)
 * - Related person records (if contacts added)
 * - Place links to site (if addresses added)
 * - Contact identifier updates (if phone/email changed)
 * - Old address preserved as requester home (if location changed + checkbox)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface LogUpdateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  request: RequestDetail;
  siteId?: string | null;
  placeId?: string | null;
  fixedCount?: number;
  initialSection?: string;
  onSaved: () => void;
}

interface InlineContact {
  id: string;
  name: string;
  phone: string;
  role: string;
  isTrapper: boolean;
}

interface InlineAddress {
  id: string;
  place: ResolvedPlace | null;
}

interface ParseResult {
  extracted_fields: Record<string, unknown>;
  categorized: Record<string, Array<{ key: string; label: string; value: unknown; type: string }>>;
  unmapped_text: string | null;
  confidence: string;
  field_count: number;
}

const UPDATE_TYPES = [
  { value: "note", label: "Note", icon: "pencil" },
  { value: "phone_call", label: "Phone Call", icon: "phone" },
  { value: "email", label: "Email", icon: "mail" },
  { value: "field_visit", label: "Field Visit", icon: "map-pin" },
  { value: "trap_event", label: "Trapping Event", icon: "target" },
  { value: "other", label: "Other", icon: "more-horizontal" },
] as const;

// ─── Collapsible Section ────────────────────────────────────────────────────

function Section({
  title,
  icon,
  defaultOpen = false,
  summary,
  children,
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: "8px" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: "0.5rem",
          padding: "0.6rem 0.75rem", background: "none", border: "none", cursor: "pointer",
          fontSize: "0.85rem", fontWeight: 600, textAlign: "left",
        }}
      >
        <span style={{ fontSize: "0.8rem", opacity: 0.5 }}>{open ? "\u25BC" : "\u25B6"}</span>
        <Icon name={icon} size={14} color="var(--text-muted)" />
        <span style={{ flex: 1 }}>{title}</span>
        {!open && summary && (
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 400, maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {summary}
          </span>
        )}
      </button>
      {open && <div style={{ padding: "0 0.75rem 0.75rem" }}>{children}</div>}
    </div>
  );
}

// ─── Toggle Chip ────────────────────────────────────────────────────────────

function ToggleChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const isOn = value === true;
  return (
    <button
      type="button"
      onClick={() => onChange(!isOn)}
      style={{
        padding: "0.3rem 0.6rem", borderRadius: "9999px", cursor: "pointer",
        border: `1px solid ${isOn ? "#166534" : "var(--border)"}`,
        background: isOn ? "#dcfce7" : "transparent",
        color: isOn ? "#166534" : "var(--muted)",
        fontSize: "0.8rem", fontWeight: 500,
      }}
    >
      {isOn ? "\u2713 " : ""}{label}
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function LogUpdateDrawer({
  isOpen,
  onClose,
  requestId,
  request,
  siteId,
  placeId,
  fixedCount = 0,
  initialSection,
  onSaved,
}: LogUpdateDrawerProps) {
  const toast = useToast();

  // Core narrative
  const [body, setBody] = useState("");
  const [updateType, setUpdateType] = useState<string>("note");
  const [saving, setSaving] = useState(false);

  // Inline contacts
  const [contacts, setContacts] = useState<InlineContact[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);

  // Inline addresses (add to site)
  const [addresses, setAddresses] = useState<InlineAddress[]>([]);
  const [showAddAddress, setShowAddAddress] = useState(false);

  // ── Location section (from UpdateSituation) ──
  const [changingLocation, setChangingLocation] = useState(false);
  const [newPlace, setNewPlace] = useState<ResolvedPlace | null>(null);
  const [locationDesc, setLocationDesc] = useState("");
  const [saveOldAsHome, setSaveOldAsHome] = useState(true);

  // ── Contact editing section (from UpdateSituation) ──
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [contactDirty, setContactDirty] = useState(false);

  // ── Cat situation section (from UpdateSituation) ──
  const [hasKittens, setHasKittens] = useState<boolean | null>(null);
  const [hasMedical, setHasMedical] = useState<boolean | null>(null);
  const [isBeingFed, setIsBeingFed] = useState<boolean | null>(null);
  const [isEmergency, setIsEmergency] = useState<boolean | null>(null);
  const [totalCats, setTotalCats] = useState("");
  const [catCount, setCatCount] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [medicalDesc, setMedicalDesc] = useState("");

  // ── AI extraction (from UpdateSituation) ──
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // ── Quick actions (preserved from old LogUpdate) ──
  const [changeStatus, setChangeStatus] = useState(false);
  const [newStatus, setNewStatus] = useState("working");
  const [grantPermission, setGrantPermission] = useState(false);

  // Initialize section state from request when drawer opens
  useEffect(() => {
    if (!isOpen || !request) return;
    setLocationDesc(request.location_description || "");
    setEditPhone(request.requester_phone || "");
    setEditEmail(request.requester_email || "");
    setHasKittens(request.has_kittens);
    setHasMedical(request.has_medical_concerns);
    setIsBeingFed(request.is_being_fed);
    setIsEmergency(request.is_emergency);
    setTotalCats(request.total_cats_reported?.toString() || "");
    setCatCount(request.estimated_cat_count?.toString() || "");
    setCatDescription(request.cat_description || "");
    setMedicalDesc(request.medical_description || "");
  }, [isOpen, request?.request_id]);

  const currentAddress = request?.place_name || formatAddress({
    place_address: request?.place_address,
    place_city: request?.place_city,
    place_postal_code: request?.place_postal_code,
  }, { short: true });

  const requesterHomeIsDifferent = request?.requester_home_place_id
    && request.requester_home_place_id !== request.place_id;

  // ── Helpers ──

  const reset = useCallback(() => {
    setBody("");
    setUpdateType("note");
    setContacts([]);
    setShowAddContact(false);
    setAddresses([]);
    setShowAddAddress(false);
    setChangingLocation(false);
    setNewPlace(null);
    setSaveOldAsHome(true);
    setContactDirty(false);
    setHasKittens(null);
    setHasMedical(null);
    setIsBeingFed(null);
    setIsEmergency(null);
    setTotalCats("");
    setCatCount("");
    setCatDescription("");
    setMedicalDesc("");
    setPasteText("");
    setParsing(false);
    setParseResult(null);
    setParseError(null);
    setChangeStatus(false);
    setNewStatus("working");
    setGrantPermission(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Check if any structural fields have changed (beyond the narrative)
  const hasStructuralChanges =
    (newPlace?.place_id && newPlace.place_id !== request?.place_id) ||
    locationDesc !== (request?.location_description || "") ||
    hasKittens !== request?.has_kittens ||
    hasMedical !== request?.has_medical_concerns ||
    isBeingFed !== request?.is_being_fed ||
    isEmergency !== request?.is_emergency ||
    catCount !== (request?.estimated_cat_count?.toString() || "") ||
    totalCats !== (request?.total_cats_reported?.toString() || "") ||
    catDescription !== (request?.cat_description || "") ||
    medicalDesc !== (request?.medical_description || "") ||
    contactDirty ||
    changeStatus ||
    grantPermission;

  const canSave = body.trim().length > 0 || hasStructuralChanges;

  // ── AI Extraction ──

  const handleExtract = useCallback(async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const result = await postApi<ParseResult>(
        `/api/requests/${requestId}/parse-enrichment`,
        { text: pasteText.trim(), source_type: updateType }
      );
      setParseResult(result);

      // Auto-populate fields from extraction
      const f = result.extracted_fields;
      if (f.estimated_cat_count != null) setCatCount(String(f.estimated_cat_count));
      if (f.total_cats_reported != null) setTotalCats(String(f.total_cats_reported));
      if (f.cat_description != null) setCatDescription(String(f.cat_description));
      if (f.has_kittens != null) setHasKittens(f.has_kittens as boolean);
      if (f.has_medical_concerns != null) setHasMedical(f.has_medical_concerns as boolean);
      if (f.medical_description != null) setMedicalDesc(String(f.medical_description));
      if (f.is_being_fed != null) setIsBeingFed(f.is_being_fed as boolean);
      if (f.location_description != null) setLocationDesc(String(f.location_description));
      if (result.unmapped_text) setBody(prev => prev ? `${prev}\n${result.unmapped_text}` : result.unmapped_text!);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to extract fields");
    } finally {
      setParsing(false);
    }
  }, [pasteText, requestId, updateType]);

  // ── Merged Save ──

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);

    try {
      // 1. Create journal entry (if body non-empty)
      if (body.trim()) {
        const journalParts: string[] = [body.trim()];
        if (pasteText.trim()) journalParts.push(`\nOriginal text:\n${pasteText.trim().slice(0, 2000)}`);

        await postApi("/api/journal", {
          request_id: requestId,
          entry_kind: updateType,
          body: journalParts.join("\n"),
          tags: ["log_update"],
        });
      }

      // 2. Composite PATCH of request fields
      const requestPatch: Record<string, unknown> = {};

      // Location
      if (newPlace?.place_id && newPlace.place_id !== request?.place_id) {
        requestPatch.place_id = newPlace.place_id;
      }
      if (locationDesc !== (request?.location_description || "")) {
        requestPatch.location_description = locationDesc || null;
      }

      // Situation toggles
      if (hasKittens !== request?.has_kittens) requestPatch.has_kittens = hasKittens;
      if (hasMedical !== request?.has_medical_concerns) requestPatch.has_medical_concerns = hasMedical;
      if (isBeingFed !== request?.is_being_fed) requestPatch.is_being_fed = isBeingFed;
      if (isEmergency !== request?.is_emergency) requestPatch.is_emergency = isEmergency;

      // Cat counts
      const newCatCount = catCount ? parseInt(catCount) : null;
      if (newCatCount !== request?.estimated_cat_count) requestPatch.estimated_cat_count = newCatCount;
      const newTotalCats = totalCats ? parseInt(totalCats) : null;
      if (newTotalCats !== request?.total_cats_reported) requestPatch.total_cats_reported = newTotalCats;

      // Descriptions
      if (catDescription !== (request?.cat_description || "")) requestPatch.cat_description = catDescription || null;
      if (medicalDesc !== (request?.medical_description || "")) requestPatch.medical_description = medicalDesc || null;

      // AI-extracted fields not covered by explicit state
      if (parseResult?.extracted_fields) {
        const autoFields = ["feeding_frequency", "feeding_time", "feeding_location", "feeder_name",
          "best_times_seen", "best_trapping_time", "urgency_notes", "access_notes",
          "handleability", "dogs_on_site", "trap_savvy", "previous_tnr", "colony_duration",
          "kitten_count", "kitten_age_estimate"];
        for (const key of autoFields) {
          const val = parseResult.extracted_fields[key];
          if (val != null && requestPatch[key] === undefined) {
            requestPatch[key] = val;
          }
        }
      }

      // Status change
      if (changeStatus) requestPatch.status = newStatus;

      // Permission
      if (grantPermission) requestPatch.permission_status = "granted";

      if (Object.keys(requestPatch).length > 0) {
        await patchRequest(requestId, requestPatch);
      }

      // 3. Preserve old address as requester's home (if location changed + checkbox)
      if (
        requestPatch.place_id &&
        request?.place_id &&
        request.requester_person_id &&
        saveOldAsHome
      ) {
        try {
          await postApi(`/api/people/${request.requester_person_id}/places`, {
            place_id: request.place_id,
            relationship_type: "resident",
            is_staff_verified: true,
          });
        } catch {
          // Non-blocking
        }
      }

      // 4. Update requester contact identifiers (if phone/email changed)
      if (contactDirty && request?.requester_person_id) {
        const identPatch: Record<string, string | null> = {};
        if (editEmail !== (request.requester_email || "")) {
          identPatch.email = editEmail.trim() || null;
        }
        if (editPhone !== (request.requester_phone || "")) {
          identPatch.phone = editPhone.trim() || null;
        }
        if (Object.keys(identPatch).length > 0) {
          try {
            await postApi(
              `/api/people/${request.requester_person_id}/identifiers`,
              identPatch,
              { method: "PATCH" }
            );
          } catch {
            // Non-blocking
          }
        }
      }

      // 5. Create related person records (if any contacts added)
      for (const contact of contacts) {
        if (!contact.name.trim()) continue;
        try {
          const result = await postApi<{ person_id?: string }>(`/api/requests/${requestId}/field-contacts`, {
            first_name: contact.name.trim().split(/\s+/)[0],
            last_name: contact.name.trim().split(/\s+/).slice(1).join(" ") || undefined,
            phone: contact.phone.trim() || undefined,
            relationship_type: contact.role,
          });
          if (contact.isTrapper && result?.person_id) {
            try {
              await postApi("/api/trappers", {
                person_id: result.person_id,
                trapper_type: "community_trapper",
                reason: "promoted_via_log_update",
              });
            } catch {
              // Non-blocking
            }
          }
        } catch {
          // Non-blocking
        }
      }

      // 6. Add addresses to site (if any)
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

      toast.success("Update logged");
      handleClose();
      onSaved();
    } catch {
      toast.error("Failed to save update");
    } finally {
      setSaving(false);
    }
  }, [body, updateType, pasteText, contacts, addresses, newPlace, locationDesc, saveOldAsHome,
    hasKittens, hasMedical, isBeingFed, isEmergency, catCount, totalCats, catDescription,
    medicalDesc, parseResult, changeStatus, newStatus, grantPermission, contactDirty,
    editEmail, editPhone, canSave, requestId, request, siteId, handleClose, onSaved, toast]);

  // ── Contact helpers ──

  const addContact = useCallback(() => {
    setContacts(prev => [...prev, { id: `c-${Date.now()}`, name: "", phone: "", role: "neighbor", isTrapper: false }]);
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

  // Build section summaries
  const locationSummary = currentAddress || "No location";
  const contactSummary = request?.requester_name
    ? `${request.requester_name}${request.requester_phone ? ` \u00b7 ${formatPhone(request.requester_phone)}` : ""}`
    : undefined;
  const catSummary = [
    catCount ? `${catCount} cats` : null,
    hasKittens ? "kittens" : null,
  ].filter(Boolean).join(" \u00b7 ") || undefined;

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Log Update"
      width="lg"
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" size="sm" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!canSave || saving} loading={saving}>
            Save Update
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {/* 1. Update type selector */}
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

        {/* 2. Main textarea */}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            updateType === "phone_call" ? "Who did you call? What did they say?" :
            updateType === "email" ? "Summary of the email exchange..." :
            updateType === "field_visit" ? "What did you see on site? Cat count, conditions, access..." :
            updateType === "trap_event" ? "How many traps set? Cats caught? Any issues?" :
            "What happened? Any new info about this case..."
          }
          rows={4}
          autoFocus
          style={{ ...inputStyle, resize: "vertical" as const, lineHeight: 1.4 }}
        />

        {/* 3. Paste & Extract */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
          <input
            type="text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste email/notes to auto-extract fields..."
            style={{ ...inputStyle, flex: 1 }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExtract}
            disabled={!pasteText.trim() || parsing}
            loading={parsing}
          >
            Extract
          </Button>
        </div>
        {parseResult && (
          <span style={{
            fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "4px", alignSelf: "flex-start",
            background: parseResult.confidence === "high" ? "#dcfce7" : "#fef3c7",
            color: parseResult.confidence === "high" ? "#166534" : "#92400e",
          }}>
            {parseResult.field_count} fields extracted ({parseResult.confidence})
          </span>
        )}
        {parseError && (
          <div style={{ fontSize: "0.8rem", color: "#991b1b" }}>{parseError}</div>
        )}

        {/* 4. Location section (collapsed) */}
        <Section
          title="Location"
          icon="map-pin"
          defaultOpen={initialSection === "location"}
          summary={locationSummary}
        >
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
            Current: <strong>{currentAddress || "No location"}</strong>
          </div>

          {requesterHomeIsDifferent && (
            <div style={{ fontSize: "0.8rem", color: "#6366f1", marginBottom: "0.5rem", padding: "0.35rem 0.6rem", background: "#eef2ff", borderRadius: "4px" }}>
              Requester lives at: {request?.requester_home_address}
            </div>
          )}

          {!changingLocation ? (
            <button
              onClick={() => setChangingLocation(true)}
              className="btn btn-sm btn-secondary"
              style={{ fontSize: "0.8rem" }}
            >
              Change to different address
            </button>
          ) : (
            <div style={{ marginTop: "0.25rem" }}>
              <PlaceResolver value={newPlace} onChange={setNewPlace} placeholder="Search for the cat location..." />
              {request?.place_id && request.requester_person_id && (
                <label style={{
                  display: "flex", alignItems: "flex-start", gap: "0.4rem", marginTop: "0.5rem",
                  fontSize: "0.8rem", color: "#4338ca", cursor: "pointer",
                  padding: "0.4rem 0.6rem", background: "#eef2ff", borderRadius: "6px",
                }}>
                  <input
                    type="checkbox"
                    checked={saveOldAsHome}
                    onChange={(e) => setSaveOldAsHome(e.target.checked)}
                    style={{ marginTop: "0.15rem", accentColor: "#4338ca" }}
                  />
                  <span>
                    Save <strong>{currentAddress}</strong> as {request.requester_name || "requester"}&apos;s verified home address
                  </span>
                </label>
              )}
            </div>
          )}

          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
              Additional locations
            </label>
            <textarea
              value={locationDesc}
              onChange={(e) => setLocationDesc(e.target.value)}
              placeholder="Cross-street info, landmarks, additional addresses where cats are seen"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
        </Section>

        {/* 5. Contacts section (collapsed) */}
        <Section
          title="Contacts"
          icon="users"
          summary={contactSummary}
        >
          {/* Requester phone/email editing */}
          {request?.requester_person_id && (
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                {request.requester_name || "Requester"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Phone</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => { setEditPhone(e.target.value); setContactDirty(true); }}
                    placeholder="(707) 555-1234"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Email</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => { setEditEmail(e.target.value); setContactDirty(true); }}
                    placeholder="email@example.com"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Field contacts */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--foreground)" }}>Field contacts</span>
            <button
              onClick={addContact}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: "0.8rem", fontWeight: 500 }}
            >
              + Add
            </button>
          </div>
          {contacts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {contacts.map(c => (
                <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <input type="text" value={c.name} onChange={(e) => updateContact(c.id, "name", e.target.value)} placeholder="Name" style={{ ...inputStyle, flex: 2 }} />
                    <input type="tel" value={c.phone} onChange={(e) => updateContact(c.id, "phone", e.target.value)} placeholder="Phone" style={{ ...inputStyle, flex: 2 }} />
                    <select value={c.role} onChange={(e) => updateContact(c.id, "role", e.target.value)} style={{ ...inputStyle, flex: 1.5 }}>
                      {RELATED_PERSON_RELATIONSHIP_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button onClick={() => removeContact(c.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "1rem" }}>&times;</button>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--text-muted)", paddingLeft: "0.25rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={c.isTrapper} onChange={(e) => setContacts(prev => prev.map(ct => ct.id === c.id ? { ...ct, isTrapper: e.target.checked } : ct))} />
                    Is a community trapper
                  </label>
                </div>
              ))}
            </div>
          )}
          {contacts.length === 0 && (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Talked to someone new? Add their name and phone so it&apos;s on file for the trapper.
            </div>
          )}
        </Section>

        {/* 6. Cat Situation section (collapsed) */}
        <Section
          title="Cat Situation"
          icon="cat"
          summary={catSummary}
        >
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <ToggleChip label="Has Kittens" value={hasKittens} onChange={setHasKittens} />
            <ToggleChip label="Medical Concerns" value={hasMedical} onChange={setHasMedical} />
            <ToggleChip label="Being Fed" value={isBeingFed} onChange={setIsBeingFed} />
            <ToggleChip label="Emergency" value={isEmergency} onChange={setIsEmergency} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Total Cats</label>
              <input
                type="number"
                value={totalCats}
                onChange={(e) => {
                  setTotalCats(e.target.value);
                  const newTotal = parseInt(e.target.value);
                  if (!isNaN(newTotal)) {
                    setCatCount(String(Math.max(0, newTotal - fixedCount)));
                  }
                }}
                min={0}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem", color: "var(--text-muted)" }}>Confirmed Fixed</label>
              <div style={{ padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem", background: "var(--section-bg, #f9fafb)", color: "var(--text-muted)" }}>
                {fixedCount}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>From clinic records</div>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem", color: "var(--text-muted)" }}>Remaining</label>
              <div style={{
                padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem",
                background: "var(--section-bg, #f9fafb)",
                color: catCount && parseInt(catCount) > 0 ? "var(--warning-text, #92400e)" : "var(--success-text, #166534)",
                fontWeight: 600,
              }}>
                {catCount || "0"}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>Auto-calculated</div>
            </div>
          </div>

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Cat Description</label>
            <textarea
              value={catDescription}
              onChange={(e) => setCatDescription(e.target.value)}
              placeholder="Physical descriptions, distinguishing features..."
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {hasMedical && (
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Medical Description</label>
              <textarea
                value={medicalDesc}
                onChange={(e) => setMedicalDesc(e.target.value)}
                placeholder="Describe medical concerns..."
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          )}
        </Section>

        {/* 7. Quick Actions section (collapsed) */}
        <Section
          title="Quick Actions"
          icon="zap"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
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

            {/* Permission granted */}
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
              <input type="checkbox" checked={grantPermission} onChange={(e) => setGrantPermission(e.target.checked)} />
              Permission granted
            </label>

            {/* Add addresses to site */}
            {siteId && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.85rem" }}>Add address to site</span>
                  <button onClick={addAddress} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: "0.8rem", fontWeight: 500 }}>
                    + Add
                  </button>
                </div>
                {addresses.map(a => (
                  <div key={a.id} style={{ paddingLeft: "1.5rem" }}>
                    <PlaceResolver
                      value={a.place}
                      onChange={(place: ResolvedPlace | null) => {
                        setAddresses(prev => prev.map(addr => addr.id === a.id ? { ...addr, place } : addr));
                      }}
                      placeholder="Search for an address..."
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </Section>

        {/* 8. Source type (always visible) */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>Source:</span>
          {[
            { value: "phone_call", label: "Call" },
            { value: "email", label: "Email" },
            { value: "trapper_visit", label: "Trapper" },
            { value: "site_visit", label: "Site Visit" },
            { value: "other", label: "Other" },
          ].map(opt => (
            <label
              key={opt.value}
              style={{
                display: "flex", alignItems: "center", gap: "0.25rem",
                padding: "0.2rem 0.5rem", borderRadius: "6px", cursor: "pointer",
                border: `1px solid ${updateType === opt.value ? "var(--primary)" : "var(--border)"}`,
                background: updateType === opt.value ? "var(--primary-bg, #f0fdf4)" : "transparent",
                fontSize: "0.75rem",
              }}
            >
              <input
                type="radio"
                name="source"
                value={opt.value}
                checked={updateType === opt.value}
                onChange={() => setUpdateType(opt.value)}
                style={{ display: "none" }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    </ActionDrawer>
  );
}
