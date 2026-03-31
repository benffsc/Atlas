"use client";

import { useState, useCallback } from "react";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { postApi } from "@/lib/api-client";
import { formatPhone, formatAddress } from "@/lib/formatters";
import type { RequestDetail } from "@/app/requests/[id]/types";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParseResult {
  extracted_fields: Record<string, unknown>;
  categorized: Record<string, Array<{ key: string; label: string; value: unknown; type: string }>>;
  unmapped_text: string | null;
  confidence: string;
  field_count: number;
}

interface UpdateSituationDrawerProps {
  isOpen: boolean;
  requestId: string;
  request: RequestDetail;
  onClose: () => void;
  onSuccess: () => void;
}

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
    <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: "8px", marginBottom: "0.75rem" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: "0.5rem",
          padding: "0.75rem 1rem", background: "none", border: "none", cursor: "pointer",
          fontSize: "0.9rem", fontWeight: 600, textAlign: "left",
        }}
      >
        <span style={{ fontSize: "0.85rem", opacity: 0.5 }}>{open ? "▼" : "▶"}</span>
        <span>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {!open && summary && (
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 400, maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {summary}
          </span>
        )}
      </button>
      {open && <div style={{ padding: "0 1rem 1rem" }}>{children}</div>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function UpdateSituationDrawer({
  isOpen,
  requestId,
  request,
  onClose,
  onSuccess,
}: UpdateSituationDrawerProps) {
  // Location state
  const [changingLocation, setChangingLocation] = useState(false);
  const [newPlace, setNewPlace] = useState<ResolvedPlace | null>(null);
  const [locationDesc, setLocationDesc] = useState(request.location_description || "");

  // Contact state
  const [editPhone, setEditPhone] = useState(request.requester_phone || "");
  const [editEmail, setEditEmail] = useState(request.requester_email || "");
  const [contactDirty, setContactDirty] = useState(false);
  const [contactWarnings, setContactWarnings] = useState<string[]>([]);

  // Preserve home address state (when changing cat location away from requester's home)
  const [saveOldAsHome, setSaveOldAsHome] = useState(true);

  // Situation state
  const [hasKittens, setHasKittens] = useState<boolean | null>(request.has_kittens);
  const [hasMedical, setHasMedical] = useState<boolean | null>(request.has_medical_concerns);
  const [isBeingFed, setIsBeingFed] = useState<boolean | null>(request.is_being_fed);
  const [isEmergency, setIsEmergency] = useState<boolean | null>(request.is_emergency);
  const [catCount, setCatCount] = useState<string>(request.estimated_cat_count?.toString() || "");
  const [totalCats, setTotalCats] = useState<string>(request.total_cats_reported?.toString() || "");
  const [catDescription, setCatDescription] = useState(request.cat_description || "");
  const [medicalDesc, setMedicalDesc] = useState(request.medical_description || "");

  // AI extraction state
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Global state
  const [sourceType, setSourceType] = useState("phone_call");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentAddress = request.place_name || formatAddress({
    place_address: request.place_address,
    place_city: request.place_city,
    place_postal_code: request.place_postal_code,
  }, { short: true });

  const requesterHomeIsDifferent = request.requester_home_place_id
    && request.requester_home_place_id !== request.place_id;

  // ─── AI Extraction ──────────────────────────────────────────────────────

  const handleExtract = useCallback(async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const result = await postApi<ParseResult>(
        `/api/requests/${requestId}/parse-enrichment`,
        { text: pasteText.trim(), source_type: sourceType }
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
      if (result.unmapped_text) setNotes((prev) => prev ? `${prev}\n${result.unmapped_text}` : result.unmapped_text!);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to extract fields");
    } finally {
      setParsing(false);
    }
  }, [pasteText, requestId, sourceType]);

  // ─── Save All ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      // 1. Patch request fields
      const requestPatch: Record<string, unknown> = {};

      if (newPlace?.place_id && newPlace.place_id !== request.place_id) {
        requestPatch.place_id = newPlace.place_id;
      }
      if (locationDesc !== (request.location_description || "")) {
        requestPatch.location_description = locationDesc || null;
      }
      if (hasKittens !== request.has_kittens) requestPatch.has_kittens = hasKittens;
      if (hasMedical !== request.has_medical_concerns) requestPatch.has_medical_concerns = hasMedical;
      if (isBeingFed !== request.is_being_fed) requestPatch.is_being_fed = isBeingFed;
      if (isEmergency !== request.is_emergency) requestPatch.is_emergency = isEmergency;

      const newCatCount = catCount ? parseInt(catCount) : null;
      if (newCatCount !== request.estimated_cat_count) requestPatch.estimated_cat_count = newCatCount;

      const newTotalCats = totalCats ? parseInt(totalCats) : null;
      if (newTotalCats !== request.total_cats_reported) requestPatch.total_cats_reported = newTotalCats;

      if (catDescription !== (request.cat_description || "")) requestPatch.cat_description = catDescription || null;
      if (medicalDesc !== (request.medical_description || "")) requestPatch.medical_description = medicalDesc || null;

      // Apply any remaining AI-extracted fields not covered by explicit state
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

      if (Object.keys(requestPatch).length > 0) {
        await postApi(`/api/requests/${requestId}`, requestPatch, { method: "PATCH" });
      }

      // 1b. Preserve old address as requester's home when changing cat location
      if (
        requestPatch.place_id &&
        request.place_id &&
        request.requester_person_id &&
        saveOldAsHome
      ) {
        try {
          await postApi(`/api/people/${request.requester_person_id}/places`, {
            place_id: request.place_id,
            relationship_type: "resident",
            is_staff_verified: true,
          });
        } catch (err) {
          console.error("Failed to save requester home address:", err);
          // Non-blocking — request update still succeeded
        }
      }

      // 2. Update contact info
      if (contactDirty && request.requester_person_id) {
        const identPatch: Record<string, string | null> = {};
        if (editEmail !== (request.requester_email || "")) {
          identPatch.email = editEmail.trim() || null;
        }
        if (editPhone !== (request.requester_phone || "")) {
          identPatch.phone = editPhone.trim() || null;
        }
        if (Object.keys(identPatch).length > 0) {
          try {
            const identResult = await postApi<{ results: Array<{ field: string; status: string; warning?: string }> }>(
              `/api/people/${request.requester_person_id}/identifiers`,
              identPatch,
              { method: "PATCH" }
            );
            const warnings = identResult.results
              .filter((r) => r.warning)
              .map((r) => r.warning!);
            if (warnings.length > 0) setContactWarnings(warnings);
          } catch (err) {
            console.error("Contact update failed:", err);
            // Non-blocking — request update still succeeded
          }
        }
      }

      // 3. Create journal entry
      const journalParts: string[] = [];
      if (Object.keys(requestPatch).length > 0) {
        journalParts.push(`Updated fields: ${Object.keys(requestPatch).join(", ")}`);
      }
      if (contactDirty) journalParts.push("Updated contact information");
      if (pasteText.trim()) journalParts.push(`Original text:\n${pasteText.trim().slice(0, 2000)}`);
      if (notes.trim()) journalParts.push(notes.trim());

      if (journalParts.length > 0) {
        postApi("/api/journal", {
          request_id: requestId,
          entry_kind: "communication",
          tags: ["situation_update", sourceType],
          body: journalParts.join("\n\n"),
        }).catch(() => {});
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  // Check if anything has changed
  const hasChanges =
    (newPlace?.place_id && newPlace.place_id !== request.place_id) ||
    locationDesc !== (request.location_description || "") ||
    hasKittens !== request.has_kittens ||
    hasMedical !== request.has_medical_concerns ||
    isBeingFed !== request.is_being_fed ||
    isEmergency !== request.is_emergency ||
    catCount !== (request.estimated_cat_count?.toString() || "") ||
    totalCats !== (request.total_cats_reported?.toString() || "") ||
    catDescription !== (request.cat_description || "") ||
    medicalDesc !== (request.medical_description || "") ||
    contactDirty ||
    notes.trim().length > 0;

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Update Situation"
      width="lg"
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            {contactWarnings.map((w, i) => (
              <div key={i} style={{ color: "#b45309" }}>{w}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="btn"
              style={{ background: "#166534", color: "#fff", opacity: hasChanges ? 1 : 0.5 }}
            >
              {saving ? "Saving..." : "Save All"}
            </button>
          </div>
        </div>
      }
    >
      {error && (
        <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", color: "#991b1b", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}

      {/* ─── Cat Location ──────────────────────────────────────────────── */}
      <Section
        title="Cat Location"
        icon="📍"
        defaultOpen
        summary={currentAddress}
      >
        <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          Current: <strong>{currentAddress || "No location"}</strong>
        </div>

        {requesterHomeIsDifferent && (
          <div style={{ fontSize: "0.8rem", color: "#6366f1", marginBottom: "0.5rem", padding: "0.35rem 0.6rem", background: "#eef2ff", borderRadius: "4px" }}>
            Requester lives at: {request.requester_home_address}
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
            {request.place_id && request.requester_person_id && (
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
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem", resize: "vertical" }}
          />
        </div>
      </Section>

      {/* ─── Contact Info ──────────────────────────────────────────────── */}
      <Section
        title="Contact Info"
        icon="👤"
        summary={request.requester_name ? `${request.requester_name}${request.requester_phone ? ` \u00b7 ${formatPhone(request.requester_phone)}` : ""}` : undefined}
      >
        {request.requester_person_id ? (
          <div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              {request.requester_name || "Unknown"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Phone</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => { setEditPhone(e.target.value); setContactDirty(true); }}
                  placeholder="(707) 555-1234"
                  style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => { setEditEmail(e.target.value); setContactDirty(true); }}
                  placeholder="email@example.com"
                  style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem" }}
                />
              </div>
            </div>

            {request.requester_home_address && !requesterHomeIsDifferent && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                Home: {request.requester_home_address}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic" }}>
            No requester linked to this request
          </div>
        )}
      </Section>

      {/* ─── Situation Changed ─────────────────────────────────────────── */}
      <Section
        title="Situation Changed"
        icon="🔄"
        summary={catCount ? `${catCount} cats` : undefined}
      >
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <ToggleChip label="Has Kittens" value={hasKittens} onChange={setHasKittens} />
          <ToggleChip label="Medical Concerns" value={hasMedical} onChange={setHasMedical} />
          <ToggleChip label="Being Fed" value={isBeingFed} onChange={setIsBeingFed} />
          <ToggleChip label="Emergency" value={isEmergency} onChange={setIsEmergency} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Cats Needing TNR</label>
            <input
              type="number"
              value={catCount}
              onChange={(e) => setCatCount(e.target.value)}
              min={0}
              style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem" }}
            />
          </div>
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Total Cats at Location</label>
            <input
              type="number"
              value={totalCats}
              onChange={(e) => setTotalCats(e.target.value)}
              min={0}
              style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem" }}
            />
          </div>
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Cat Description</label>
          <textarea
            value={catDescription}
            onChange={(e) => setCatDescription(e.target.value)}
            placeholder="Physical descriptions, distinguishing features..."
            rows={2}
            style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem", resize: "vertical" }}
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
              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem", resize: "vertical" }}
            />
          </div>
        )}
      </Section>

      {/* ─── Paste Info (AI) ───────────────────────────────────────────── */}
      <Section title="Paste Info" icon="🤖" summary={parseResult ? `${parseResult.field_count} fields extracted` : undefined}>
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.5rem 0" }}>
          Paste email, call notes, or trapper report. AI extracts fields into the sections above.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste text here..."
          rows={6}
          style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem", resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
          <button
            onClick={handleExtract}
            disabled={!pasteText.trim() || parsing}
            className="btn btn-sm"
            style={{ background: "#7c3aed", color: "#fff" }}
          >
            {parsing ? "Extracting..." : "Extract Fields"}
          </button>
          {parseResult && (
            <span style={{
              fontSize: "0.8rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
              background: parseResult.confidence === "high" ? "#dcfce7" : "#fef3c7",
              color: parseResult.confidence === "high" ? "#166534" : "#92400e",
            }}>
              {parseResult.field_count} fields extracted ({parseResult.confidence})
            </span>
          )}
        </div>
        {parseError && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#991b1b" }}>{parseError}</div>
        )}
      </Section>

      {/* ─── Source & Notes ─────────────────────────────────────────────── */}
      <div style={{ marginTop: "0.5rem" }}>
        <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.35rem" }}>Source</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {[
            { value: "phone_call", label: "Call" },
            { value: "email", label: "Email" },
            { value: "trapper_visit", label: "Trapper" },
            { value: "site_visit", label: "Site Visit" },
            { value: "other", label: "Other" },
          ].map((opt) => (
            <label
              key={opt.value}
              style={{
                display: "flex", alignItems: "center", gap: "0.25rem",
                padding: "0.3rem 0.6rem", borderRadius: "6px", cursor: "pointer",
                border: `1px solid ${sourceType === opt.value ? "#7c3aed" : "var(--border)"}`,
                background: sourceType === opt.value ? "#f5f3ff" : "transparent",
                fontSize: "0.8rem",
              }}
            >
              <input
                type="radio"
                name="source"
                value={opt.value}
                checked={sourceType === opt.value}
                onChange={() => setSourceType(opt.value)}
                style={{ display: "none" }}
              />
              {opt.label}
            </label>
          ))}
        </div>

        <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional context..."
          rows={2}
          style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "0.85rem", resize: "vertical" }}
        />
      </div>
    </ActionDrawer>
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
      {isOn ? "✓ " : ""}{label}
    </button>
  );
}
