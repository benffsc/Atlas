"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { formatPhone, formatDateLocal } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { TnrProgressBar } from "@/components/ui/TnrProgressBar";
import { TrapperAssignments } from "@/components/sections/TrapperAssignments";
import { COLORS } from "@/lib/design-tokens";
import type { RequestStatus } from "@/lib/request-status";
import { mapToPrimaryStatus } from "@/lib/request-status";
import type { RequestDetail } from "@/hooks/useEntityDetail";
import type { JournalEntry } from "@/components/sections";
import dynamic from "next/dynamic";

const CompleteRequestModal = dynamic(() => import("@/components/modals/CompleteRequestModal"), { ssr: false });
const HoldRequestModal = dynamic(() => import("@/components/modals/HoldRequestModal"), { ssr: false });

interface RequestPreviewContentProps {
  request: RequestDetail;
  onClose: () => void;
  /** Called after a status change so the parent can refresh the list */
  onRequestUpdated?: () => void;
}

// --- Collapsible Section ---

function CollapsibleSection({ title, defaultOpen = true, open: controlledOpen, onToggle, children }: {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const handleToggle = onToggle || (() => setInternalOpen(!internalOpen));

  return (
    <div style={{ marginBottom: "1rem" }}>
      <button
        type="button"
        onClick={handleToggle}
        style={{
          display: "flex", alignItems: "center", gap: "0.35rem", width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: isOpen ? "0.5rem" : 0,
          fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted, #9ca3af)",
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>
          <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        {title}
      </button>
      {isOpen && children}
    </div>
  );
}

// --- Quick Action Buttons ---

function QuickActions({ request, onStatusChange, onOpenComplete, onOpenHold }: {
  request: RequestDetail;
  onStatusChange: (status: string) => void;
  onOpenComplete: () => void;
  onOpenHold: () => void;
}) {
  const primary = mapToPrimaryStatus(request.status as RequestStatus);
  const isTerminal = primary === "completed";

  if (isTerminal) return null;

  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {/* Primary action: Start Working or Resume */}
      {primary === "new" && (
        <Button variant="primary" size="sm" onClick={() => onStatusChange("working")}>
          Start Working
        </Button>
      )}
      {primary === "paused" && (
        <Button variant="primary" size="sm" onClick={() => onStatusChange("working")}>
          Resume
        </Button>
      )}
      {/* Secondary: Pause (only when not already paused) */}
      {primary !== "paused" && (
        <Button variant="outline" size="sm" onClick={onOpenHold} style={{ color: COLORS.warningDark, borderColor: COLORS.warning }}>
          Pause
        </Button>
      )}
      {/* Tertiary: Complete (opens confirmation modal) */}
      <Button variant="outline" size="sm" onClick={onOpenComplete} style={{ color: COLORS.successDark, borderColor: COLORS.successLight }}>
        Complete
      </Button>
    </div>
  );
}

// --- Main Component ---

/**
 * Rich request preview panel for the split-view on the requests list page.
 * Shows contact info, colony stats, trapping logistics, and quick actions
 * so staff can triage without opening the full page.
 */
export function RequestPreviewContent({ request: r, onClose, onRequestUpdated }: RequestPreviewContentProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [showComplete, setShowComplete] = useState(false);
  const [showHold, setShowHold] = useState(false);
  const [allExpanded, setAllExpanded] = useState<boolean | null>(null); // null = use defaults

  // Quick note state
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Priority state
  const [savingPriority, setSavingPriority] = useState(false);

  // Journal entries
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState(true);

  const fetchJournal = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(`/api/journal?request_id=${r.request_id}&include_related=true`);
      setJournalEntries(data.entries || []);
    } catch {
      // Non-critical
    } finally {
      setJournalLoading(false);
    }
  }, [r.request_id]);

  useEffect(() => {
    fetchJournal();
  }, [fetchJournal]);

  const createdDate = new Date(r.created_at);
  const endDate = r.resolved_at ? new Date(r.resolved_at) : new Date();
  const daysOpen = Math.max(0, Math.floor((endDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));

  const altRate = r.colony_alteration_rate != null ? `${Math.round(r.colony_alteration_rate * 100)}%` : null;

  // Graduated aging color
  const agingColor = r.resolved_at ? undefined : daysOpen > 60 ? COLORS.errorDark : daysOpen > 30 ? COLORS.error : daysOpen > 14 ? COLORS.warningDark : undefined;

  const stats = [
    { label: "Est. Cats", value: r.estimated_cat_count ?? "\u2014" },
    { label: "Linked Cats", value: r.linked_cat_count ?? 0 },
    { label: r.resolved_at ? "Duration" : "Days Open", value: `${daysOpen}d`, color: agingColor },
    ...(r.eartip_count != null ? [{ label: "Eartipped", value: r.eartip_count }] : []),
  ];

  const badges = (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", flexWrap: "wrap" }}>
      <StatusBadge status={r.status} />
      <select
        value={r.priority || "normal"}
        onChange={(e) => handlePriorityChange(e.target.value)}
        disabled={savingPriority}
        style={{
          fontSize: "0.65rem", fontWeight: 600, padding: "2px 4px",
          border: "1px solid var(--border)", borderRadius: "4px",
          background: "var(--background)", cursor: "pointer",
          color: r.priority === "urgent" ? COLORS.errorDark : r.priority === "high" ? COLORS.warningDark : "var(--text-secondary)",
        }}
        title="Change priority"
      >
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="normal">Normal</option>
        <option value="low">Low</option>
      </select>
      {r.is_emergency && <span className="badge" style={{ background: COLORS.errorDark, color: COLORS.white, fontSize: "0.65rem" }}>EMERGENCY</span>}
      {r.has_kittens && <span className="badge" style={{ background: COLORS.warning, color: COLORS.black, fontSize: "0.65rem" }}>KITTENS</span>}
      {r.has_medical_concerns && <span className="badge" style={{ background: COLORS.errorDark, color: COLORS.white, fontSize: "0.65rem" }}>MEDICAL</span>}
    </div>
  );

  const contact = {
    phone: r.requester_phone || r.site_contact_phone || null,
    email: r.requester_email || r.site_contact_email || null,
  };

  // Quick status change (no modal needed)
  const handleQuickStatus = useCallback(async (newStatus: string) => {
    try {
      await postApi(`/api/requests/${r.request_id}`, { status: newStatus }, { method: "PATCH" });
      toastSuccess(`Request moved to ${newStatus}`);
      onRequestUpdated?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update status");
    }
  }, [r.request_id, toastSuccess, toastError, onRequestUpdated]);

  const handleModalSuccess = useCallback(() => {
    setShowComplete(false);
    setShowHold(false);
    onRequestUpdated?.();
  }, [onRequestUpdated]);

  // Quick note handler
  const handleAddNote = useCallback(async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      await postApi("/api/journal", {
        request_id: r.request_id,
        entry_kind: "note",
        body: noteText.trim(),
      });
      setNoteText("");
      toastSuccess("Note added");
      fetchJournal();
      onRequestUpdated?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setAddingNote(false);
    }
  }, [noteText, r.request_id, toastSuccess, toastError, onRequestUpdated, fetchJournal]);

  // Priority change handler
  const handlePriorityChange = useCallback(async (newPriority: string) => {
    if (newPriority === r.priority) return;
    setSavingPriority(true);
    try {
      await postApi(`/api/requests/${r.request_id}`, { priority: newPriority }, { method: "PATCH" });
      toastSuccess(`Priority set to ${newPriority}`);
      onRequestUpdated?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update priority");
    } finally {
      setSavingPriority(false);
    }
  }, [r.request_id, r.priority, toastSuccess, toastError, onRequestUpdated]);

  // Build actions for the header
  const actions = (
    <QuickActions
      request={r}
      onStatusChange={handleQuickStatus}
      onOpenComplete={() => setShowComplete(true)}
      onOpenHold={() => setShowHold(true)}
    />
  );

  // --- Build sections with collapsibility ---

  // Section open state: null = use defaults, true/false = override all
  const sectionOpen = (defaultOpen: boolean) => allExpanded !== null ? allExpanded : defaultOpen;

  const sectionElements = (
    <>
      {/* TNR Progress Bar — the most important visual */}
      <TnrProgressBar
        fixed={r.linked_cat_count ?? 0}
        total={r.total_cats_reported ?? r.colony_size_estimate ?? null}
        remaining={r.estimated_cat_count}
      />

      {/* Expand/Collapse All toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button
          type="button"
          onClick={() => setAllExpanded(allExpanded === true ? false : true)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: "0.7rem", color: "var(--primary, #3b82f6)", fontWeight: 500,
          }}
        >
          {allExpanded === true ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {/* Notes */}
      {r.notes && (
        <CollapsibleSection title="Notes" key={`notes-${allExpanded}`} defaultOpen={sectionOpen(true)}>
          <ExpandableText text={r.notes} limit={300} />
        </CollapsibleSection>
      )}

      {/* Quick Note Entry */}
      <CollapsibleSection title="Add Note" key={`addnote-${allExpanded}`} defaultOpen={sectionOpen(!r.notes)}>
        <div>
          <textarea
            ref={noteRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Quick note..."
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && noteText.trim()) {
                e.preventDefault();
                handleAddNote();
              }
            }}
            style={{
              width: "100%", resize: "vertical", fontSize: "0.85rem",
              padding: "0.5rem", borderRadius: "6px",
              border: "1px solid var(--border)", background: "var(--background)",
              fontFamily: "inherit", minHeight: "3.5rem",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.35rem" }}>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              {noteText.trim() ? "\u2318\u23CE to save" : ""}
            </span>
            <Button variant="primary" size="sm" onClick={handleAddNote} disabled={!noteText.trim() || addingNote}>
              {addingNote ? "Saving..." : "Add Note"}
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      {/* Journal Entries */}
      <CollapsibleSection
        title={`Journal${journalEntries.length > 0 ? ` (${journalEntries.length})` : ""}`}
        key={`journal-${allExpanded}`}
        defaultOpen={sectionOpen(journalEntries.length > 0 && journalEntries.length <= 5)}
      >
        {journalLoading ? (
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Loading...</span>
        ) : (
          <JournalPreview entries={journalEntries.slice(0, 8)} />
        )}
        {journalEntries.length > 8 && (
          <a
            href={`/requests/${r.request_id}`}
            style={{ display: "block", fontSize: "0.75rem", color: "var(--primary)", marginTop: "0.5rem", textDecoration: "none" }}
          >
            View all {journalEntries.length} entries →
          </a>
        )}
      </CollapsibleSection>

      {/* Contact */}
      <CollapsibleSection title="Contact" key={`contact-${allExpanded}`} defaultOpen={sectionOpen(true)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
          {r.requester_name && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>{r.requester_name}</span>
                {r.requester_role_at_submission && r.requester_role_at_submission !== "unknown" && (
                  <span className="badge" style={{ fontSize: "0.6rem", background: r.requester_role_at_submission.includes("trapper") ? COLORS.warningLight : COLORS.infoLight, color: r.requester_role_at_submission.includes("trapper") ? COLORS.warningDark : COLORS.primaryDark }}>
                    {r.requester_role_at_submission.replace(/_/g, " ").toUpperCase()}
                  </span>
                )}
                {r.requester_is_site_contact && <span className="badge" style={{ fontSize: "0.6rem", background: COLORS.successLight, color: COLORS.successDark }}>Site Contact</span>}
              </div>
              {r.requester_phone && <div><a href={`tel:${r.requester_phone}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{formatPhone(r.requester_phone)}</a></div>}
              {r.requester_email && <div style={{ wordBreak: "break-all", color: "var(--text-secondary)" }}>{r.requester_email}</div>}
            </div>
          )}
          {r.site_contact_name && !r.requester_is_site_contact && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>{r.site_contact_name}</span>
                <span className="badge" style={{ fontSize: "0.6rem", background: COLORS.successLight, color: COLORS.successDark }}>Site Contact</span>
              </div>
              {r.site_contact_phone && <div><a href={`tel:${r.site_contact_phone}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{formatPhone(r.site_contact_phone)}</a></div>}
              {r.site_contact_email && <div style={{ wordBreak: "break-all", color: "var(--text-secondary)" }}>{r.site_contact_email}</div>}
            </div>
          )}
          {!r.site_contact_name && !r.requester_is_site_contact && r.requester_role_at_submission?.includes("trapper") && (
            <div style={{ color: COLORS.warningDark, fontSize: "0.8rem", fontWeight: 500 }}>Site contact needed</div>
          )}
        </div>
      </CollapsibleSection>

      {/* Location */}
      <CollapsibleSection title="Location" key={`location-${allExpanded}`} defaultOpen={sectionOpen(true)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {r.place_name && <div style={{ fontWeight: 600 }}>{r.place_name}</div>}
          {r.place_address && <div style={{ color: "var(--text-secondary)" }}>{r.place_address}</div>}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {r.place_kind && r.place_kind !== "unknown" && <span className="badge" style={{ fontSize: "0.65rem", background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>{r.place_kind.replace(/_/g, " ")}</span>}
            {r.place_service_zone && <span className="badge" style={{ fontSize: "0.65rem", background: COLORS.primaryLight, color: COLORS.primaryDark }}>Zone: {r.place_service_zone}</span>}
            {r.place_city && <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{r.place_city}</span>}
          </div>
          {r.place_coordinates && (
            <a href={`/map?lat=${r.place_coordinates.lat}&lng=${r.place_coordinates.lng}&zoom=17`}
              style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "none" }}>
              View on Map
            </a>
          )}
        </div>
      </CollapsibleSection>

      {/* Colony Assessment */}
      {(r.colony_size_estimate != null || r.colony_duration || r.handleability || r.count_confidence) && (
        <CollapsibleSection title="Colony Assessment" key={`colony-${allExpanded}`} defaultOpen={sectionOpen(true)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
            {r.colony_size_estimate != null && <FieldCell label="Colony Size" value={String(r.colony_size_estimate)} />}
            {r.colony_verified_altered != null && <FieldCell label="Altered" value={String(r.colony_verified_altered)} />}
            {r.colony_work_remaining != null && <FieldCell label="Remaining" value={String(r.colony_work_remaining)} highlight={r.colony_work_remaining > 0} />}
            {altRate && <FieldCell label="Coverage" value={altRate} />}
            {r.handleability && <FieldCell label="Handleability" value={r.handleability.replace(/_/g, " ")} />}
            {r.count_confidence && <FieldCell label="Count Confidence" value={r.count_confidence.replace(/_/g, " ")} />}
            {r.cats_are_friendly != null && <FieldCell label="Cats Friendly" value={r.cats_are_friendly ? "Yes" : "No"} />}
          </div>
        </CollapsibleSection>
      )}

      {/* Trapping Logistics */}
      {(r.dogs_on_site || r.trap_savvy || r.previous_tnr || r.traps_overnight_safe != null || r.permission_status || r.best_times_seen) && (
        <CollapsibleSection title="Trapping Logistics" key={`trapping-${allExpanded}`} defaultOpen={sectionOpen(true)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
            {r.dogs_on_site && <FieldCell label="Dogs on Site" value={r.dogs_on_site} highlight={r.dogs_on_site.toLowerCase() === "yes"} />}
            {r.trap_savvy && <FieldCell label="Trap-Savvy" value={r.trap_savvy} highlight={r.trap_savvy.toLowerCase() === "yes"} />}
            {r.previous_tnr && <FieldCell label="Previous TNR" value={r.previous_tnr} />}
            {r.traps_overnight_safe != null && <FieldCell label="Traps Overnight" value={r.traps_overnight_safe ? "Yes" : "No"} good={r.traps_overnight_safe} />}
            {r.permission_status && <FieldCell label="Permission" value={r.permission_status.replace(/_/g, " ")} />}
            {r.property_type && <FieldCell label="Property Type" value={r.property_type.replace(/_/g, " ")} />}
            {r.best_times_seen && <FieldCell label="Best Times Seen" value={r.best_times_seen} />}
            {r.best_trapping_time && <FieldCell label="Best Trap Time" value={r.best_trapping_time} />}
          </div>
        </CollapsibleSection>
      )}

      {/* Urgency — always expanded if present */}
      {(r.is_emergency || (r.urgency_reasons && r.urgency_reasons.length > 0) || r.urgency_notes || r.medical_description) && (
        <CollapsibleSection title="Urgency & Medical" key={`urgency-${allExpanded}`} defaultOpen={sectionOpen(true)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
            {r.urgency_reasons && r.urgency_reasons.length > 0 && (
              <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                {r.urgency_reasons.map((reason, i) => (
                  <span key={i} className="badge" style={{ fontSize: "0.65rem", background: COLORS.errorLight, color: COLORS.errorDark }}>{reason.replace(/_/g, " ")}</span>
                ))}
              </div>
            )}
            {r.urgency_notes && <p style={{ margin: 0, color: "var(--text-secondary)" }}>{r.urgency_notes}</p>}
            {r.medical_description && <p style={{ margin: 0, color: COLORS.errorDark }}>{r.medical_description}</p>}
          </div>
        </CollapsibleSection>
      )}

      {/* Trapper Assignment — full management inline */}
      <CollapsibleSection title="Trappers" key={`trappers-${allExpanded}`} defaultOpen={sectionOpen(true)}>
        <TrapperAssignments
          requestId={r.request_id}
          placeId={r.place_id}
          onAssignmentChange={() => onRequestUpdated?.()}
        />
      </CollapsibleSection>

      {/* Linked Cats — collapsed by default to save space */}
      {r.cats && r.cats.length > 0 && (
        <CollapsibleSection title={`Linked Cats (${r.cats.length})`} key={`cats-${allExpanded}`} defaultOpen={sectionOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
            {r.cats.slice(0, 6).map((cat) => (
              <div key={cat.cat_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <a href={`/cats/${cat.cat_id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{cat.cat_name || "Unnamed"}</a>
                {cat.altered_status && (
                  <span className="badge" style={{ fontSize: "0.6rem", background: cat.altered_status.toLowerCase() === "yes" || cat.altered_status.toLowerCase() === "spayed" || cat.altered_status.toLowerCase() === "neutered" ? COLORS.successLight : COLORS.errorLight, color: cat.altered_status.toLowerCase() === "yes" || cat.altered_status.toLowerCase() === "spayed" || cat.altered_status.toLowerCase() === "neutered" ? COLORS.successDark : COLORS.errorDark }}>
                    {cat.altered_status}
                  </span>
                )}
                {cat.microchip && <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{cat.microchip.slice(-6)}</span>}
              </div>
            ))}
            {r.cats.length > 6 && <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>+{r.cats.length - 6} more...</span>}
          </div>
        </CollapsibleSection>
      )}

      {/* Feeding — collapsed by default */}
      {(r.is_being_fed != null || r.feeder_name) && (
        <CollapsibleSection title="Feeding" key={`feeding-${allExpanded}`} defaultOpen={sectionOpen(false)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
            <FieldCell label="Being Fed" value={r.is_being_fed ? "Yes" : r.is_being_fed === false ? "No" : "\u2014"} good={r.is_being_fed ?? undefined} />
            {r.feeder_name && <FieldCell label="Feeder" value={r.feeder_name} />}
            {r.feeding_frequency && <FieldCell label="Frequency" value={r.feeding_frequency.replace(/_/g, " ")} />}
            {r.feeding_time && <FieldCell label="Time" value={r.feeding_time} />}
          </div>
        </CollapsibleSection>
      )}

      {/* Record — collapsed by default */}
      <CollapsibleSection title="Record" key={`record-${allExpanded}`} defaultOpen={sectionOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          <div>Created: {formatDateLocal(r.created_at)}</div>
          {r.resolved_at && <div>Resolved: {formatDateLocal(r.resolved_at)}</div>}
          <div>Assignment: {(r.assignment_status || "pending").replace(/_/g, " ")}</div>
        </div>
      </CollapsibleSection>
    </>
  );

  return (
    <>
      <EntityPreviewPanel
        title={r.summary || r.place_name || "Request"}
        detailHref={`/requests/${r.request_id}`}
        onClose={onClose}
        badges={badges}
        stats={stats}
        contact={contact}
        actions={actions}
      >
        {sectionElements}
      </EntityPreviewPanel>

      {/* Modals */}
      {showComplete && (
        <CompleteRequestModal
          isOpen={showComplete}
          onClose={() => setShowComplete(false)}
          requestId={r.request_id}
          placeId={r.place_id ?? undefined}
          placeName={r.place_name ?? undefined}
          onSuccess={handleModalSuccess}
        />
      )}
      {showHold && (
        <HoldRequestModal
          isOpen={showHold}
          onClose={() => setShowHold(false)}
          requestId={r.request_id}
          onSuccess={handleModalSuccess}
        />
      )}
    </>
  );
}

// --- Sub-components ---

function FieldCell({ label, value, highlight, good }: { label: string; value: string; highlight?: boolean; good?: boolean }) {
  const valueColor = good === true ? COLORS.successDark : good === false ? COLORS.errorDark : highlight ? COLORS.warningDark : undefined;
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>{label}</div>
      <div style={{ fontWeight: 500, color: valueColor }}>{value}</div>
    </div>
  );
}

/** Show/hide long text with a toggle link. */
function ExpandableText({ text, limit = 300 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > limit;

  return (
    <div>
      <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--foreground)" }}>
        {needsTruncation && !expanded ? text.slice(0, limit) + "\u2026" : text}
      </p>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: "0.75rem", color: "var(--primary, #3b82f6)", fontWeight: 500,
            marginTop: "0.25rem",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Compact journal entry display for the preview panel. */
function JournalPreview({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No journal entries yet</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {entries.map((entry) => {
        const kindColor = entry.entry_kind === "communication" || entry.entry_kind === "contact_attempt"
          ? COLORS.primaryLight : entry.entry_kind === "system" ? "var(--section-bg)" : undefined;
        const kindLabel = entry.entry_kind === "communication" || entry.entry_kind === "contact_attempt"
          ? "Contact" : entry.entry_kind === "system" ? "System" : null;

        return (
          <div key={entry.id} style={{
            borderLeft: `3px solid ${entry.is_pinned ? COLORS.warning : "var(--border)"}`,
            paddingLeft: "0.5rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.15rem" }}>
              {entry.is_pinned && <span style={{ fontSize: "0.6rem" }} title="Pinned">📌</span>}
              {kindLabel && (
                <span className="badge" style={{ fontSize: "0.55rem", background: kindColor, color: "var(--text-secondary)", padding: "1px 4px" }}>
                  {kindLabel}
                </span>
              )}
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                {entry.created_by_staff_name || "Staff"} · {formatDateLocal(entry.created_at)}
              </span>
            </div>
            <ExpandableText text={entry.body} limit={200} />
          </div>
        );
      })}
    </div>
  );
}
