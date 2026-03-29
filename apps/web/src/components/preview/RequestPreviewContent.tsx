"use client";

import { useState, useCallback } from "react";
import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { formatPhone, formatDateLocal } from "@/lib/formatters";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import type { RequestStatus } from "@/lib/request-status";
import { mapToPrimaryStatus } from "@/lib/request-status";
import type { RequestDetail } from "@/hooks/useEntityDetail";
import dynamic from "next/dynamic";

const CompleteRequestModal = dynamic(() => import("@/components/modals/CompleteRequestModal"), { ssr: false });
const HoldRequestModal = dynamic(() => import("@/components/modals/HoldRequestModal"), { ssr: false });

interface RequestPreviewContentProps {
  request: RequestDetail;
  onClose: () => void;
  /** Called after a status change so the parent can refresh the list */
  onRequestUpdated?: () => void;
}

// --- TNR Progress Bar ---

function TnrProgressBar({ fixed, estimated }: { fixed: number; estimated: number | null }) {
  if (!estimated || estimated <= 0) return null;
  const pct = Math.min(100, Math.round((fixed / estimated) * 100));
  const color = pct >= 70 ? "#16a34a" : pct >= 30 ? "#d97706" : "#dc2626";
  const bgColor = pct >= 70 ? "#dcfce7" : pct >= 30 ? "#fef3c7" : "#fef2f2";

  return (
    <div style={{ marginBottom: "1rem" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${fixed} of ${estimated} cats fixed, ${pct}% complete`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color }}>
          {fixed} / {estimated} cats fixed
        </span>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: "8px", borderRadius: "4px", background: bgColor, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "4px", transition: "width 0.3s ease" }} />
      </div>
    </div>
  );
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

  const btnBase: React.CSSProperties = {
    padding: "4px 10px", borderRadius: "6px",
    fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  };
  // Primary action = filled, strongest visual weight
  const btnPrimary: React.CSSProperties = { ...btnBase, background: "#2563eb", color: "#fff", border: "none" };
  // Secondary = outline
  const btnSecondary: React.CSSProperties = { ...btnBase, background: "transparent", color: "#92400e", border: "1px solid #fbbf24" };
  // Tertiary/complete = ghost outline (opens modal anyway)
  const btnTertiary: React.CSSProperties = { ...btnBase, background: "transparent", color: "#166534", border: "1px solid #86efac" };

  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {/* Primary action: Start Working or Resume */}
      {primary === "new" && (
        <button type="button" onClick={() => onStatusChange("working")} style={btnPrimary}>
          Start Working
        </button>
      )}
      {primary === "paused" && (
        <button type="button" onClick={() => onStatusChange("working")} style={btnPrimary}>
          Resume
        </button>
      )}
      {/* Secondary: Pause (only when not already paused) */}
      {primary !== "paused" && (
        <button type="button" onClick={onOpenHold} style={btnSecondary}>
          Pause
        </button>
      )}
      {/* Tertiary: Complete (opens confirmation modal) */}
      <button type="button" onClick={onOpenComplete} style={btnTertiary}>
        Complete
      </button>
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

  const createdDate = new Date(r.created_at);
  const endDate = r.resolved_at ? new Date(r.resolved_at) : new Date();
  const daysOpen = Math.max(0, Math.floor((endDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));

  const altRate = r.colony_alteration_rate != null ? `${Math.round(r.colony_alteration_rate * 100)}%` : null;

  // Graduated aging color
  const agingColor = r.resolved_at ? undefined : daysOpen > 60 ? "#dc2626" : daysOpen > 30 ? "#ea580c" : daysOpen > 14 ? "#d97706" : undefined;

  const stats = [
    { label: "Est. Cats", value: r.estimated_cat_count ?? "\u2014" },
    { label: "Linked Cats", value: r.linked_cat_count ?? 0 },
    { label: r.resolved_at ? "Duration" : "Days Open", value: `${daysOpen}d`, color: agingColor },
    ...(r.eartip_count != null ? [{ label: "Eartipped", value: r.eartip_count }] : []),
  ];

  const badges = (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", flexWrap: "wrap" }}>
      <StatusBadge status={r.status} />
      {r.priority && <PriorityBadge priority={r.priority} />}
      {r.is_emergency && <span className="badge" style={{ background: "#dc2626", color: "#fff", fontSize: "0.65rem" }}>EMERGENCY</span>}
      {r.has_kittens && <span className="badge" style={{ background: "#f59e0b", color: "#000", fontSize: "0.65rem" }}>KITTENS</span>}
      {r.has_medical_concerns && <span className="badge" style={{ background: "#dc2626", color: "#fff", fontSize: "0.65rem" }}>MEDICAL</span>}
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
      <TnrProgressBar fixed={r.linked_cat_count ?? 0} estimated={r.estimated_cat_count} />

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
          <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--foreground)" }}>
            {r.notes.length > 300 ? r.notes.slice(0, 300) + "\u2026" : r.notes}
          </p>
        </CollapsibleSection>
      )}

      {/* Contact */}
      <CollapsibleSection title="Contact" key={`contact-${allExpanded}`} defaultOpen={sectionOpen(true)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
          {r.requester_name && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>{r.requester_name}</span>
                {r.requester_role_at_submission && r.requester_role_at_submission !== "unknown" && (
                  <span className="badge" style={{ fontSize: "0.6rem", background: r.requester_role_at_submission.includes("trapper") ? "#fef3c7" : "#e0e7ff", color: r.requester_role_at_submission.includes("trapper") ? "#92400e" : "#3730a3" }}>
                    {r.requester_role_at_submission.replace(/_/g, " ").toUpperCase()}
                  </span>
                )}
                {r.requester_is_site_contact && <span className="badge" style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534" }}>Site Contact</span>}
              </div>
              {r.requester_phone && <div><a href={`tel:${r.requester_phone}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{formatPhone(r.requester_phone)}</a></div>}
              {r.requester_email && <div style={{ wordBreak: "break-all", color: "var(--text-secondary)" }}>{r.requester_email}</div>}
            </div>
          )}
          {r.site_contact_name && !r.requester_is_site_contact && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>{r.site_contact_name}</span>
                <span className="badge" style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534" }}>Site Contact</span>
              </div>
              {r.site_contact_phone && <div><a href={`tel:${r.site_contact_phone}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{formatPhone(r.site_contact_phone)}</a></div>}
              {r.site_contact_email && <div style={{ wordBreak: "break-all", color: "var(--text-secondary)" }}>{r.site_contact_email}</div>}
            </div>
          )}
          {!r.site_contact_name && !r.requester_is_site_contact && r.requester_role_at_submission?.includes("trapper") && (
            <div style={{ color: "#92400e", fontSize: "0.8rem", fontWeight: 500 }}>Site contact needed</div>
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
            {r.place_service_zone && <span className="badge" style={{ fontSize: "0.65rem", background: "#dbeafe", color: "#1d4ed8" }}>Zone: {r.place_service_zone}</span>}
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
                  <span key={i} className="badge" style={{ fontSize: "0.65rem", background: "#fef2f2", color: "#dc2626" }}>{reason.replace(/_/g, " ")}</span>
                ))}
              </div>
            )}
            {r.urgency_notes && <p style={{ margin: 0, color: "var(--text-secondary)" }}>{r.urgency_notes}</p>}
            {r.medical_description && <p style={{ margin: 0, color: "#dc2626" }}>{r.medical_description}</p>}
          </div>
        </CollapsibleSection>
      )}

      {/* Assigned Trappers */}
      {(r.current_trappers && r.current_trappers.length > 0) ? (
        <CollapsibleSection title="Assigned Trappers" key={`trappers-${allExpanded}`} defaultOpen={sectionOpen(true)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
            {r.current_trappers.map((t) => (
              <div key={t.trapper_person_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <a href={`/trappers/${t.trapper_person_id}`} style={{ fontWeight: 500, color: "var(--primary)", textDecoration: "none" }}>{t.trapper_name}</a>
                {t.is_primary && <span className="badge" style={{ fontSize: "0.6rem", background: "#dbeafe", color: "#1d4ed8" }}>Primary</span>}
                {t.is_ffsc_trapper && <span className="badge" style={{ fontSize: "0.6rem", background: "#dcfce7", color: "#166534" }}>FFSC</span>}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : r.primary_trapper_name ? (
        <CollapsibleSection title="Trapper" key={`trapper-single-${allExpanded}`} defaultOpen={sectionOpen(true)}>
          <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{r.primary_trapper_name}</div>
        </CollapsibleSection>
      ) : null}

      {/* Linked Cats — collapsed by default to save space */}
      {r.cats && r.cats.length > 0 && (
        <CollapsibleSection title={`Linked Cats (${r.cats.length})`} key={`cats-${allExpanded}`} defaultOpen={sectionOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
            {r.cats.slice(0, 6).map((cat) => (
              <div key={cat.cat_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <a href={`/cats/${cat.cat_id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{cat.cat_name || "Unnamed"}</a>
                {cat.altered_status && (
                  <span className="badge" style={{ fontSize: "0.6rem", background: cat.altered_status.toLowerCase() === "yes" || cat.altered_status.toLowerCase() === "spayed" || cat.altered_status.toLowerCase() === "neutered" ? "#dcfce7" : "#fef2f2", color: cat.altered_status.toLowerCase() === "yes" || cat.altered_status.toLowerCase() === "spayed" || cat.altered_status.toLowerCase() === "neutered" ? "#166534" : "#dc2626" }}>
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
  const valueColor = good === true ? "#16a34a" : good === false ? "#dc2626" : highlight ? "#d97706" : undefined;
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>{label}</div>
      <div style={{ fontWeight: 500, color: valueColor }}>{value}</div>
    </div>
  );
}
