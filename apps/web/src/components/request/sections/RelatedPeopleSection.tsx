"use client";

import { useState, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { PersonReferencePicker } from "@/components/ui/PersonReferencePicker";
import type { PersonReference } from "@/components/ui/PersonReferencePicker";
import { RELATED_PERSON_RELATIONSHIP_OPTIONS, LANGUAGE_OPTIONS, getLabel, getShortLabel } from "@/lib/form-options";
import { formatPhone } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import type { RelatedPersonDisplay } from "@/hooks/useRequestDetail";

interface RelatedPeopleSectionProps {
  requestId: string;
  relatedPeople: RelatedPersonDisplay[];
  fetchRelatedPeople: () => Promise<void>;
  onPersonClick: (personId: string, e: React.MouseEvent) => void;
}

export function RelatedPeopleSection({
  requestId,
  relatedPeople,
  fetchRelatedPeople,
  onPersonClick,
}: RelatedPeopleSectionProps) {
  const [showAddPersonDrawer, setShowAddPersonDrawer] = useState(false);
  const [addPersonRef, setAddPersonRef] = useState<PersonReference>({ person_id: null, display_name: "", is_resolved: false });
  const [addPersonRelType, setAddPersonRelType] = useState("");
  const [addPersonLanguage, setAddPersonLanguage] = useState("");
  const [addPersonNotify, setAddPersonNotify] = useState(false);
  const [addPersonNotes, setAddPersonNotes] = useState("");
  const [addPersonSaving, setAddPersonSaving] = useState(false);

  const resetAddPersonForm = useCallback(() => {
    setAddPersonRef({ person_id: null, display_name: "", is_resolved: false });
    setAddPersonRelType("");
    setAddPersonLanguage("");
    setAddPersonNotify(false);
    setAddPersonNotes("");
  }, []);

  const handleAddPerson = useCallback(async () => {
    if (!addPersonRef.is_resolved && !addPersonRef.display_name) return;
    setAddPersonSaving(true);
    try {
      await postApi(`/api/requests/${requestId}/related-people`, {
        person_id: addPersonRef.person_id || undefined,
        raw_name: addPersonRef.display_name || undefined,
        relationship_type: addPersonRelType || "other",
        relationship_notes: addPersonNotes || undefined,
        preferred_language: addPersonLanguage || undefined,
        notify_before_release: addPersonNotify,
      });
      fetchRelatedPeople();
      resetAddPersonForm();
      setShowAddPersonDrawer(false);
    } catch {
      // Non-critical
    } finally {
      setAddPersonSaving(false);
    }
  }, [requestId, addPersonRef, addPersonRelType, addPersonLanguage, addPersonNotify, addPersonNotes, fetchRelatedPeople, resetAddPersonForm]);

  return (
    <>
      <div style={{ marginTop: "1rem", background: "var(--card-bg, #fff)", border: "1px solid var(--border, #e5e7eb)", borderRadius: "12px", overflow: "hidden" }}>
        <div style={{ padding: "0.625rem 1rem", background: "var(--bg-secondary, #f9fafb)", borderBottom: relatedPeople.length > 0 ? "1px solid var(--border, #e5e7eb)" : "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Icon name="users" size={16} color="var(--text-muted)" />
          <h3 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
            Other People Involved
          </h3>
          {relatedPeople.length > 0 && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>({relatedPeople.length})</span>
          )}
          <button
            type="button"
            onClick={() => { resetAddPersonForm(); setShowAddPersonDrawer(true); }}
            style={{
              marginLeft: "auto", padding: "2px 10px", fontSize: "0.75rem", fontWeight: 500,
              color: "var(--primary)", background: "transparent",
              border: "1px solid var(--primary)", borderRadius: "5px", cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: "4px",
            }}
          >
            <Icon name="plus" size={12} /> Add
          </button>
        </div>
        {relatedPeople.length > 0 && (
          <div style={{ padding: "0.5rem" }}>
            {relatedPeople.map((rp) => (
              <div
                key={rp.id}
                style={{
                  padding: "0.5rem 0.75rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  borderBottom: "1px solid var(--border-light, #f3f4f6)",
                }}
              >
                <a
                  href={`/people/${rp.person_id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) return;
                    e.preventDefault();
                    onPersonClick(rp.person_id, e);
                  }}
                  style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--foreground)", textDecoration: "none", minWidth: "120px" }}
                >
                  {rp.display_name || "Unknown"}
                </a>

                <span style={{
                  fontSize: "0.7rem", fontWeight: 500, padding: "1px 8px", borderRadius: "10px",
                  background: "var(--bg-tertiary, #f3f4f6)", color: "var(--text-secondary)", whiteSpace: "nowrap",
                }}>
                  {getLabel(RELATED_PERSON_RELATIONSHIP_OPTIONS, rp.relationship_type)}
                </span>

                {rp.preferred_language && rp.preferred_language !== "en" && (
                  <span style={{
                    fontSize: "0.65rem", fontWeight: 600, padding: "1px 6px", borderRadius: "8px",
                    background: "#eef2ff", color: "#4338ca", textTransform: "uppercase",
                  }}>
                    {getShortLabel(LANGUAGE_OPTIONS, rp.preferred_language)}
                  </span>
                )}

                {rp.notify_before_release && (
                  <span title="Notify before release" style={{ fontSize: "0.75rem", color: "#f59e0b" }}>
                    <Icon name="bell" size={14} />
                  </span>
                )}

                <div style={{ flex: 1, display: "flex", gap: "0.75rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {rp.phone && <span>{formatPhone(rp.phone)}</span>}
                  {rp.email && <span>{rp.email}</span>}
                </div>

                {rp.relationship_notes && (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={rp.relationship_notes}
                  >
                    {rp.relationship_notes}
                  </span>
                )}

                <RowActionMenu
                  actions={[
                    {
                      label: "Remove",
                      variant: "danger",
                      onClick: async () => {
                        try {
                          await fetchApi(`/api/requests/${requestId}/related-people?related_person_id=${rp.id}`, { method: "DELETE" });
                          fetchRelatedPeople();
                        } catch {
                          // Non-critical
                        }
                      },
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
        {relatedPeople.length === 0 && (
          <div style={{ padding: "0.75rem 1rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            No related people yet. Click Add to link a cat owner, neighbor, or other contact.
          </div>
        )}
      </div>

      <ActionDrawer
        isOpen={showAddPersonDrawer}
        onClose={() => setShowAddPersonDrawer(false)}
        title="Add Related Person"
        width="sm"
        footer={
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setShowAddPersonDrawer(false)}
              style={{ padding: "6px 16px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "6px", background: "transparent", cursor: "pointer", color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddPerson}
              disabled={addPersonSaving || (!addPersonRef.is_resolved && !addPersonRef.display_name)}
              style={{
                padding: "6px 16px", fontSize: "0.85rem", fontWeight: 500,
                border: "none", borderRadius: "6px", cursor: addPersonSaving ? "wait" : "pointer",
                background: "var(--primary)", color: "#fff",
                opacity: addPersonSaving || (!addPersonRef.is_resolved && !addPersonRef.display_name) ? 0.5 : 1,
              }}
            >
              {addPersonSaving ? "Saving..." : "Add Person"}
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500 }}>Person</label>
            <PersonReferencePicker
              value={addPersonRef}
              onChange={setAddPersonRef}
              placeholder="Search or create person..."
              allowCreate
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500 }}>Relationship</label>
            <select
              value={addPersonRelType}
              onChange={(e) => setAddPersonRelType(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            >
              <option value="">Select relationship...</option>
              {RELATED_PERSON_RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500 }}>Language</label>
            <select
              value={addPersonLanguage}
              onChange={(e) => setAddPersonLanguage(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            >
              <option value="">English (default)</option>
              {LANGUAGE_OPTIONS.filter((o) => o.value !== "en").map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", cursor: "pointer" }}>
            <input type="checkbox" checked={addPersonNotify} onChange={(e) => setAddPersonNotify(e.target.checked)} />
            Notify before cat release
          </label>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500 }}>Notes</label>
            <input
              type="text"
              value={addPersonNotes}
              onChange={(e) => setAddPersonNotes(e.target.value)}
              placeholder="e.g., microchip owner, speaks only Spanish..."
              style={{ width: "100%", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            />
          </div>
        </div>
      </ActionDrawer>
    </>
  );
}
