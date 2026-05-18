"use client";

import { useState, useCallback } from "react";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { CaseSection, JournalSection, LinkedCatsSection, TrapperAssignments, ClinicNotesSection } from "@/components/sections";
import { EditHistory, ContactCard } from "@/components/common";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { useNavigationContext } from "@/hooks/useNavigationContext";
import { ErrorState } from "@/components/feedback/EmptyState";
import { RequestSection, REQUEST_SECTIONS } from "@/components/request";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { StatusDropdown } from "./StatusDropdown";
import { Button } from "@/components/ui/Button";
import { isTerminalStatus } from "@/lib/request-status";
import { StatusBadge, PriorityBadge, PropertyTypeBadge } from "@/components/badges";
import { MediaGallery } from "@/components/media";
import { SmartField, TabBar, TabPanel } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { formatPhone, formatAddress } from "@/lib/formatters";
import { fetchApi, postApi, patchRequest } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";
import { LANGUAGE_OPTIONS, getLabel, getShortLabel } from "@/lib/form-options";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, getStatusColor } from "@/lib/design-tokens";
import { getOutcomeLabel, getOutcomeColor } from "@/lib/request-status";
import {
  PAGE_CONTAINER, WARNING_BANNER, ERROR_BANNER,
  MB_LG, SKELETON_LINE, SKELETON_BLOCK,
} from "@/app/requests/styles";
import { useRequestDetail } from "@/hooks/useRequestDetail";
import { useRequestModals } from "./RequestModals";
import { LogUpdateDrawer } from "./LogUpdateDrawer";
import { ResolutionBanner } from "./sections/ResolutionBanner";
import { RelatedPeopleSection } from "./sections/RelatedPeopleSection";
import { ColonyContextSection } from "./sections/ColonyContextSection";
import { TripReportsTab } from "./sections/TripReportsTab";
import { IntelligenceSection } from "./sections/IntelligenceSection";
import { RequestAdminTab } from "./sections/RequestAdminTab";

function LegacyBadge() {
  return (
    <span className="badge" style={{ background: COLORS.gray100, color: COLORS.gray600, fontSize: TYPOGRAPHY.size.xs, padding: `${SPACING.xs} ${SPACING.sm}`, border: `1px solid ${COLORS.gray300}` }} title="Imported from Airtable">
      Legacy
    </span>
  );
}

interface RequestDetailShellProps {
  id: string;
  mode?: "page" | "panel";
  onClose?: () => void;
  onRequestUpdated?: () => void;
}

export function RequestDetailShell({ id, mode = "page", onClose, onRequestUpdated }: RequestDetailShellProps) {
  const requestId = id;
  const data = useRequestDetail(requestId);
  const { request, loading, error, previousStatus, journalEntries, tripReports, relatedPeople, tippyTickets, mapUrl, refreshRequest, fetchJournalEntries, fetchTripReports, fetchRelatedPeople, setPreviousStatus, setError } = data;

  const { ref: containerRef, isNarrow } = useContainerWidth();
  const isPanel = mode === "panel";

  // Wrap refreshRequest to also notify parent list of mutations
  const refreshAndNotify = useCallback(async () => {
    await refreshRequest();
    onRequestUpdated?.();
  }, [refreshRequest, onRequestUpdated]);

  const modals = useRequestModals({ requestId, request, refreshRequest: refreshAndNotify, fetchJournalEntries, fetchTripReports });

  const requestTitle = request?.summary || request?.place_name || "FFR Request";
  const { breadcrumbs } = useNavigationContext(requestTitle);

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  // Status change saving state
  const [saving, setSaving] = useState(false);

  // History toggle
  const [showHistory, setShowHistory] = useState(false);

  // Geocode state
  const [geocoding, setGeocoding] = useState(false);

  // Site contact editing state
  const [savingSiteContact, setSavingSiteContact] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<string>("case");
  const [copied, setCopied] = useState(false);
  const [showLogUpdate, setShowLogUpdate] = useState(false);
  const [logUpdateInitialSection, setLogUpdateInitialSection] = useState<string | undefined>(undefined);

  const copyForText = useCallback(() => {
    if (!request) return;
    const lines: string[] = [];

    // Title + address
    const summary = request.summary || request.place_name || "Request";
    lines.push(summary);
    const addr = formatAddress({ place_address: request.place_address, place_city: request.place_city, place_postal_code: request.place_postal_code });
    if (addr) lines.push(addr);
    if (request.location_description) lines.push(request.location_description);

    // Contacts — start with all names from the summary (e.g. "Heather/Debra")
    // then add requester + site contact with phone numbers
    lines.push("");
    const shownNames = new Set<string>();

    if (request.requester_name) {
      const contactParts = [request.requester_name];
      if (request.requester_phone) contactParts.push(formatPhone(request.requester_phone));
      lines.push(`Contact: ${contactParts.join(" — ")}`);
      shownNames.add(request.requester_name.toLowerCase());
    }

    if (request.site_contact_name && !request.requester_is_site_contact) {
      const siteParts = [request.site_contact_name];
      if (request.site_contact_phone) siteParts.push(formatPhone(request.site_contact_phone));
      lines.push(`Site: ${siteParts.join(" — ")}`);
      shownNames.add(request.site_contact_name.toLowerCase());
    }

    // Extract additional names from summary (split by / or &)
    // e.g. "Heather Ausburne/Debra Ziehm Hessel Road" → "Debra Ziehm"
    if (summary) {
      const nameParts = summary.split(/[\/&]/).map(s => s.trim());
      if (nameParts.length > 1) {
        for (const part of nameParts) {
          // Strip trailing location words (Road, St, Ave, Dr, etc.)
          const cleaned = part.replace(/\s+(road|rd|street|st|ave|avenue|dr|drive|ln|lane|way|blvd|ct|court)\.?\s*$/i, "").trim();
          if (cleaned && !shownNames.has(cleaned.toLowerCase()) && /^[A-Z]/.test(cleaned)) {
            lines.push(`Also: ${cleaned}`);
            shownNames.add(cleaned.toLowerCase());
          }
        }
      }
    }

    // Cat info
    const catParts: string[] = [];
    if (request.estimated_cat_count != null) catParts.push(`${request.estimated_cat_count} cats`);
    if (request.eartip_count != null && request.eartip_count > 0) catParts.push(`${request.eartip_count} eartipped`);
    if (request.has_kittens) catParts.push("kittens present");
    if (catParts.length > 0) lines.push(`Cats: ${catParts.join(", ")}`);

    // Key logistics
    if (request.dogs_on_site === "yes") lines.push("Dogs on site");
    if (request.traps_overnight_safe === false) lines.push("Traps NOT safe overnight");
    if (request.permission_status === "pending") lines.push("Permission: PENDING");

    // Field contacts
    if (relatedPeople.length > 0) {
      lines.push("");
      for (const rp of relatedPeople) {
        if (shownNames.has((rp.display_name || "").toLowerCase())) continue;
        const rpParts = [`${rp.display_name || "Unknown"} (${rp.relationship_type.replace(/_/g, " ")})`];
        if (rp.phone) rpParts.push(formatPhone(rp.phone));
        lines.push(rpParts.join(" — "));
      }
    }

    // Notes — full text, not truncated
    if (request.notes) {
      lines.push("");
      lines.push(request.notes);
    }

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [request, relatedPeople]);

  const handleQuickStatusChange = async (newStatus: string) => {
    if (!request) return;
    if (newStatus === "completed") {
      modals.open("close");
      return;
    }
    if (newStatus === "paused" || newStatus === "on_hold") {
      modals.open("hold");
      return;
    }
    await executeStatusChange(newStatus);
  };

  const executeStatusChange = async (newStatus: string) => {
    if (!request) return;
    const oldStatus = request.status;
    setSaving(true);
    setError(null);
    try {
      await patchRequest(requestId, { status: newStatus });
      setPreviousStatus(oldStatus);
      await refreshAndNotify();
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (!request) return;
    setSaving(true);
    setError(null);
    try {
      await fetchApi(`/api/requests/${requestId}/archive`, { method: "DELETE" });
      await refreshAndNotify();
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Failed to restore request");
    } finally {
      setSaving(false);
    }
  };

  const startRename = () => {
    setRenameValue(request?.summary || request?.place_name || "");
    setRenaming(true);
  };

  const handleRename = async () => {
    if (!renameValue.trim()) return;
    setSavingRename(true);
    try {
      await patchRequest(requestId, { summary: renameValue.trim() });
      await refreshAndNotify();
      setRenaming(false);
    } catch {
      setError("Failed to rename");
    } finally {
      setSavingRename(false);
    }
  };

  const handleSiteContactChange = async (personId: string | null) => {
    setSavingSiteContact(true);
    try {
      await patchRequest(requestId, { site_contact_person_id: personId });
      postApi("/api/journal", {
        request_id: requestId,
        entry_kind: "system",
        tags: ["contact_change"],
        body: personId ? `Set site contact` : `Removed site contact`,
      }).catch(() => {});
      await refreshAndNotify();
    } catch (err) {
      console.error("Failed to update site contact:", err);
    } finally {
      setSavingSiteContact(false);
    }
  };

  const handleGeocode = async () => {
    if (!request?.place_id) return;
    setGeocoding(true);
    try {
      await postApi(`/api/places/${request.place_id}/geocode`, {});
      await refreshAndNotify();
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Failed to geocode");
    } finally {
      setGeocoding(false);
    }
  };

  // ─── Loading ───
  if (loading) {
    return (
      <div style={isPanel ? { padding: "0.5rem" } : PAGE_CONTAINER}>
        {!isPanel && <Breadcrumbs items={breadcrumbs} />}
        <div style={{ marginTop: isPanel ? SPACING.md : SPACING['2xl'] }}>
          <div style={{ ...SKELETON_LINE, width: '40%', height: '1.5rem', marginBottom: SPACING.lg }} />
          <div style={{ display: 'flex', gap: SPACING.sm, marginBottom: SPACING.xl }}>
            <div style={{ ...SKELETON_LINE, width: '5rem', borderRadius: BORDERS.radius.full }} />
            <div style={{ ...SKELETON_LINE, width: '4rem', borderRadius: BORDERS.radius.full }} />
          </div>
          <div style={{ ...SKELETON_BLOCK, marginBottom: SPACING.lg }} />
          <div style={{ ...SKELETON_BLOCK, height: '4rem', marginBottom: SPACING.lg }} />
          <div style={{ ...SKELETON_BLOCK, marginBottom: SPACING.lg }} />
        </div>
      </div>
    );
  }

  // ─── Error ───
  if (error && !request) {
    return (
      <div>
        {!isPanel && <Breadcrumbs items={breadcrumbs} />}
        <ErrorState title="Request not found" description={error || undefined} />
      </div>
    );
  }

  if (!request) return null;

  const isResolved = request.status === "completed" || request.status === "cancelled" || request.status === "partial";

  // ─── Hero attribute grid data ───
  const locationDisplay = request.place_name || (request.place_address ? formatAddress({ place_address: request.place_address, place_city: request.place_city, place_postal_code: request.place_postal_code }, { short: true }) : null);
  const heroAttributes = [
    { label: "Location", value: locationDisplay, href: request.place_id ? `/places/${request.place_id}` : undefined, editable: true },
    { label: "Zone", value: request.place_service_zone },
    { label: "Requester", value: request.requester_name, href: request.requester_person_id ? `/people/${request.requester_person_id}` : undefined },
    { label: "Contact", value: request.requester_phone ? formatPhone(request.requester_phone) : request.requester_email },
    { label: "Est. Colony", value: request.colony_size_estimate != null ? String(request.colony_size_estimate) : null },
    { label: "Coverage", value: request.colony_alteration_rate != null ? `${Math.round(request.colony_alteration_rate)}%` : null },
    { label: "Created", value: new Date(request.created_at).toLocaleDateString() },
    { label: "Source", value: request.source_system?.replace(/_/g, " ") },
  ];

  // Build overflow menu actions
  const overflowActions = [
    // Logging (only for active requests with place)
    ...(request.place_id && !isTerminalStatus(request.status) ? [
      { label: "Log Visit", onClick: () => modals.open("observation") },
      { label: "Log Session", onClick: () => modals.open("tripReport") },
    ] : []),
    // Communication
    ...(request.requester_email ? [
      { label: "Email Requester", onClick: () => modals.open("email"), dividerBefore: true as const },
    ] : []),
    { label: copied ? "Copied!" : "Copy for Text", onClick: copyForText, dividerBefore: !request.requester_email },
    { label: "Trapper Sheet", onClick: () => window.open(`/requests/${requestId}/trapper-sheet`, "_blank") },
    // Utility
    { label: showHistory ? "Hide History" : "Edit History", onClick: () => setShowHistory(!showHistory), dividerBefore: true as const },
    // Danger zone
    ...(request.is_archived
      ? [{ label: "Restore", onClick: handleRestore, dividerBefore: true as const }]
      : [{ label: "Archive", onClick: () => modals.open("archive"), variant: "danger" as const, dividerBefore: true as const }]),
  ];

  return (
    <div ref={containerRef} style={{ maxWidth: isPanel ? undefined : "900px", margin: "0 auto", padding: isNarrow ? "0.5rem" : "0.75rem" }}>
      {/* Breadcrumbs (page mode only) */}
      {!isPanel && (
        <div style={{ marginBottom: "0.75rem" }}>
          <Breadcrumbs items={breadcrumbs} />
        </div>
      )}

      {/* ═══ Hero Card ═══ */}
      <div className="card" style={{ padding: isNarrow ? "0.75rem" : "1.25rem", marginBottom: "1rem" }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", gap: isNarrow ? "0.5rem" : "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {renaming ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%" }}>
              <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }} autoFocus style={{ fontSize: isNarrow ? "1.1rem" : "1.5rem", fontWeight: 700, padding: "0.25rem 0.5rem", border: "2px solid var(--primary)", borderRadius: "4px", width: "100%" }} />
              <button onClick={handleRename} disabled={savingRename} className="btn btn-sm">{savingRename ? "..." : "Save"}</button>
              <button onClick={() => setRenaming(false)} className="btn btn-sm btn-secondary">Cancel</button>
            </div>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: isNarrow ? "1.1rem" : "1.5rem", lineHeight: 1.2 }}>{request.summary || request.place_name || "FFR Request"}</h1>
              <button onClick={startRename} title="Rename" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem", color: "var(--muted)", opacity: 0.7 }}><Icon name="pencil" size={14} /></button>
            </>
          )}
          {request.source_system?.startsWith("airtable") && <LegacyBadge />}
          <StatusBadge status={request.status} size="lg" />
          {request.resolution_outcome && (() => {
            const oc = getOutcomeColor(request.resolution_outcome);
            return (
              <span className="badge" style={{ background: oc.bg, color: oc.color, border: `1px solid ${oc.border}` }}>
                {getOutcomeLabel(request.resolution_outcome)}
              </span>
            );
          })()}
          <PriorityBadge priority={request.priority} />
          {request.request_purpose && <span className="badge" style={{ background: "#7c3aed", color: "#fff", textTransform: "capitalize" }}>{request.request_purpose.replace(/_/g, " ")}</span>}
          {request.property_type && <PropertyTypeBadge type={request.property_type} />}
          {request.hold_reason && <span className="badge" style={{ background: COLORS.warning, color: COLORS.black }}>Hold: {request.hold_reason.replace(/_/g, " ")}</span>}
          {request.is_archived && <span className="badge" style={{ background: COLORS.gray500, color: COLORS.white }}>Archived</span>}
        </div>

        {/* Consolidated action row */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <Button variant="primary" size="sm" onClick={() => setShowLogUpdate(true)} icon="pencil">
            Log Update
          </Button>
          <StatusDropdown
            request={request}
            saving={saving}
            previousStatus={previousStatus}
            onStatusChange={handleQuickStatusChange}
            onOpenModal={(modal) => {
              if (modal === "close") modals.open("close");
              else if (modal === "hold") modals.open("hold");
              else if (modal === "redirect") modals.open("redirect");
              else if (modal === "handoff") modals.open("handoff");
            }}
            onUndo={() => previousStatus && handleQuickStatusChange(previousStatus)}
          />
          <div style={{ marginLeft: "auto" }}>
            <RowActionMenu actions={overflowActions} />
          </div>
        </div>

        {/* Inline error banner for status changes */}
        {error && request && (
          <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.5rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", color: "#991b1b", fontSize: "0.8rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#991b1b", fontWeight: 600, padding: "0 0.25rem" }}>&times;</button>
          </div>
        )}

        {/* Attribute grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem", padding: "0.75rem 0", borderTop: "1px solid var(--border)" }}>
          {heroAttributes.map((attr) => (
            <div key={attr.label}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "0.25rem" }}>{attr.label}</div>
              {attr.label === "Location" ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  {attr.href && attr.value ? (
                    <a href={attr.href} onClick={request.place_id ? (e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); modals.preview.open("place", request.place_id!); } } : undefined} style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--primary)", textDecoration: "none" }}>
                      {attr.value}
                    </a>
                  ) : (
                    <span style={{ fontSize: "0.85rem", fontWeight: 500, color: attr.value ? "var(--foreground)" : "var(--text-muted)" }}>{attr.value || "—"}</span>
                  )}
                  <button onClick={() => { setShowLogUpdate(true); setLogUpdateInitialSection("location"); }} title="Change location" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", opacity: 0.7, padding: 0 }}><Icon name="pencil" size={12} /></button>
                  {request.place_id && !request.place_coordinates && (
                    <button onClick={handleGeocode} disabled={geocoding} title="Geocode this address" className="btn btn-sm" style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}>{geocoding ? "..." : "Geocode"}</button>
                  )}
                </div>
              ) : attr.href && attr.value ? (
                <a href={attr.href} onClick={attr.label === "Requester" && request.requester_person_id ? (e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); modals.preview.open("person", request.requester_person_id!); } } : undefined} style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--primary)", textDecoration: "none" }}>
                  {attr.value}
                </a>
              ) : (
                <div style={{ fontSize: "0.85rem", fontWeight: 500, color: attr.value ? "var(--foreground)" : "var(--text-muted)" }}>
                  {attr.value || "—"}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Resolution Banner */}
      <ResolutionBanner
        status={request.status}
        resolutionOutcome={request.resolution_outcome}
        resolutionReason={request.resolution_reason}
        resolutionNotes={request.resolution_notes}
        resolvedAt={request.resolved_at}
        sourceCreatedAt={request.source_created_at}
        sourceSystem={request.source_system}
      />

      {/* Safety concerns */}
      {(request.place_safety_concerns?.length || request.place_safety_notes) && (
        <div style={{ ...WARNING_BANNER, marginTop: "0.75rem" }}>
          <span style={{ fontWeight: TYPOGRAPHY.weight.medium, color: getStatusColor('warning').text }}>Safety: </span>
          {request.place_safety_concerns?.join(", ").replace(/_/g, " ")}
          {request.place_safety_notes && ` - ${request.place_safety_notes}`}
        </div>
      )}

      {/* Urgency/Emergency banner */}
      {(request.urgency_reasons?.length || request.is_emergency || request.has_medical_concerns) && (
        <div style={{ ...ERROR_BANNER, marginTop: "0.75rem" }}>
          <div style={{ fontWeight: TYPOGRAPHY.weight.semibold, color: getStatusColor('error').text, marginBottom: SPACING.xs }}>
            {request.is_emergency ? "EMERGENCY" : "URGENT"}
          </div>
          {request.urgency_reasons?.length && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: getStatusColor('error').text }}>{request.urgency_reasons.map(r => r.replace(/_/g, " ")).join(" \u2022 ")}</div>}
          {request.has_medical_concerns && request.medical_description && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: getStatusColor('error').text, marginTop: SPACING.xs }}>Medical: {request.medical_description}</div>}
          {request.urgency_deadline && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: '#9a3412', marginTop: SPACING.xs }}>Deadline: {new Date(request.urgency_deadline).toLocaleDateString()}</div>}
          {request.urgency_notes && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: getStatusColor('error').text, marginTop: SPACING.xs }}>{request.urgency_notes}</div>}
        </div>
      )}

      {/* Edit History panel */}
      {showHistory && (
        <div className="card" style={{ marginTop: "1rem", marginBottom: "1rem", padding: "1rem" }}>
          <h3 style={MB_LG}>Edit History</h3>
          <EditHistory entityType="request" entityId={requestId} limit={20} />
        </div>
      )}

      {/* ClinicHQ Notes */}
      {request.place_id && <ClinicNotesSection placeId={request.place_id} />}

      {/* Colony / Corridor Context — shows only when place is in a colony or corridor */}
      {request.place_id && (
        <ColonyContextSection
          placeId={request.place_id}
          currentRequestId={requestId}
          onPlaceClick={(pid) => modals.preview.open("place", pid)}
          onCreateColony={() => modals.open("colony")}
        />
      )}

      {isPanel ? (
        /* ═══ Panel Layout: no tabs, single scrollable column ═══ */
        <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Journal — always visible, top priority for triage */}
          <JournalSection entityType="request" entityId={requestId} entries={journalEntries} onEntryAdded={() => { refreshAndNotify(); fetchJournalEntries(); }} />

          {/* Contact */}
          <ContactCard
            requester={request.requester_person_id ? {
              personId: request.requester_person_id,
              name: request.requester_name,
              email: request.requester_email,
              phone: request.requester_phone,
              role: request.requester_role_at_submission,
              isSiteContact: request.requester_is_site_contact,
            } : undefined}
            siteContact={request.site_contact_person_id && !request.requester_is_site_contact ? {
              personId: request.site_contact_person_id,
              name: request.site_contact_name,
              email: request.site_contact_email,
              phone: request.site_contact_phone,
            } : undefined}
            onEmailClick={() => modals.open("email")}
            onSiteContactChange={handleSiteContactChange}
            savingSiteContact={savingSiteContact}
            onPersonClick={(personId, e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              modals.preview.open("person", personId);
            }}
          />

          {/* Field contacts — visible in panel for trapper handoff */}
          <RelatedPeopleSection
            requestId={requestId}
            relatedPeople={relatedPeople}
            fetchRelatedPeople={fetchRelatedPeople}
            onPersonClick={(personId) => modals.preview.open("person", personId)}
            briefingContext={request}
            briefingJournal={journalEntries}
          />

          {/* Field Intelligence (tippy tickets) */}
          <IntelligenceSection tickets={tippyTickets} />

          {/* Trappers */}
          <CaseSection title="Assigned Trappers" icon="user" color="#ec4899">
            <TrapperAssignments requestId={requestId} placeId={request.place_id} onAssignmentChange={refreshAndNotify} />
            {request.scheduled_date && (
              <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef3c7", borderRadius: "6px", display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.85rem" }}>
                <span style={{ fontWeight: 600 }}>Scheduled:</span>
                <span>{new Date(request.scheduled_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                {request.scheduled_time_range && <span style={{ color: "var(--muted)" }}>({request.scheduled_time_range})</span>}
              </div>
            )}
          </CaseSection>

          {/* Case fields */}
          {REQUEST_SECTIONS.map((sectionConfig) => (
            <RequestSection
              key={sectionConfig.id}
              config={sectionConfig}
              request={request}
              onSaved={refreshAndNotify}
            />
          ))}

          {/* Linked cats summary row */}
          {(request.linked_cat_count || 0) > 0 && (
            <a href={`/requests/${requestId}?from=requests`} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0.6rem 0.75rem", background: "var(--section-bg, #f9fafb)",
              border: "1px solid var(--border)", borderRadius: "8px",
              textDecoration: "none", color: "var(--foreground)", fontSize: "0.85rem",
            }}>
              <span><strong>{request.linked_cat_count}</strong> linked cat{request.linked_cat_count === 1 ? "" : "s"}</span>
              <span style={{ color: "var(--primary)", fontSize: "0.8rem" }}>View →</span>
            </a>
          )}

          {/* Trip reports summary row */}
          {tripReports.length > 0 && (
            <a href={`/requests/${requestId}?from=requests`} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0.6rem 0.75rem", background: "var(--section-bg, #f9fafb)",
              border: "1px solid var(--border)", borderRadius: "8px",
              textDecoration: "none", color: "var(--foreground)", fontSize: "0.85rem",
            }}>
              <span><strong>{tripReports.length}</strong> trip report{tripReports.length === 1 ? "" : "s"}</span>
              <span style={{ color: "var(--primary)", fontSize: "0.8rem" }}>View →</span>
            </a>
          )}
        </div>
      ) : (
        /* ═══ Full Page: tabs ═══ */
        <div style={{ marginTop: "1.5rem" }}>
          <TabBar
            tabs={[
              { id: "case", label: "Case" },
              { id: "people", label: "People", count: (relatedPeople.length || 0) + (request.requester_person_id ? 1 : 0) },
              { id: "cats", label: "Cats", count: request.linked_cat_count || 0 },
              { id: "trip-reports", label: "Trip Reports", count: tripReports.length },
              { id: "photos", label: "Photos" },
              { id: "activity", label: "Activity", count: journalEntries.length },
              { id: "admin", label: "Admin" },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {/* Case Tab */}
          <TabPanel tabId="case" activeTab={activeTab}>
            {REQUEST_SECTIONS.map((sectionConfig) => (
              <RequestSection
                key={sectionConfig.id}
                config={sectionConfig}
                request={request}
                onSaved={refreshAndNotify}
              />
            ))}

            {request.intake_extended_data && Object.keys(request.intake_extended_data).length > 0 && (
              <CaseSection title="Intake Details" icon="file-text" color="#8b5cf6">
                <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", margin: 0 }}>
                  {Object.entries(request.intake_extended_data)
                    .filter(([, v]) => v != null && v !== "" && v !== false)
                    .map(([key, value]) => (
                      <SmartField
                        key={key}
                        label={key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                        value={typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
                      />
                    ))}
                </dl>
              </CaseSection>
            )}

            <CaseSection title="Assigned Trappers" icon="user" color="#ec4899">
              <TrapperAssignments requestId={requestId} placeId={request.place_id} onAssignmentChange={refreshAndNotify} />
              {request.scheduled_date && (
                <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef3c7", borderRadius: "6px", display: "flex", gap: "1rem", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><Icon name="calendar" size={14} /> Scheduled:</span>
                  <span>{new Date(request.scheduled_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                  {request.scheduled_time_range && <span style={{ color: "var(--muted)" }}>({request.scheduled_time_range})</span>}
                </div>
              )}
            </CaseSection>
          </TabPanel>

          {/* People Tab */}
          <TabPanel tabId="people" activeTab={activeTab}>
            <ContactCard
              requester={request.requester_person_id ? {
                personId: request.requester_person_id,
                name: request.requester_name,
                email: request.requester_email,
                phone: request.requester_phone,
                role: request.requester_role_at_submission,
                isSiteContact: request.requester_is_site_contact,
              } : undefined}
              siteContact={request.site_contact_person_id && !request.requester_is_site_contact ? {
                personId: request.site_contact_person_id,
                name: request.site_contact_name,
                email: request.site_contact_email,
                phone: request.site_contact_phone,
              } : undefined}
              onEmailClick={() => modals.open("email")}
              onSiteContactChange={handleSiteContactChange}
              savingSiteContact={savingSiteContact}
              onPersonClick={(personId, e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                modals.preview.open("person", personId);
              }}
            />
            {request.preferred_language && request.preferred_language !== "en" && (
              <div style={{ marginTop: "0.5rem", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <span style={{
                  fontSize: "0.7rem", fontWeight: 600, padding: "2px 8px", borderRadius: "10px",
                  background: "#eef2ff", color: "#4338ca", textTransform: "uppercase",
                }}>
                  {getShortLabel(LANGUAGE_OPTIONS, request.preferred_language)} — {getLabel(LANGUAGE_OPTIONS, request.preferred_language)}
                </span>
              </div>
            )}

            {/* Location Card */}
            <div style={{ marginTop: "1rem", background: "var(--card-bg, #fff)", border: "1px solid var(--border, #e5e7eb)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1rem", background: "linear-gradient(135deg, #166534 0%, #22c55e 100%)", color: "#fff" }}>
                <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Icon name="map-pin" size={16} color="#fff" />
                  Location
                </h3>
              </div>
              <div style={{ padding: "1rem" }}>
                {request.place_id ? (
                  <div>
                    <a href={`/places/${request.place_id}`} onClick={modals.preview.handleClick("place", request.place_id)} style={{ fontWeight: 600, fontSize: "1.1rem", color: "var(--foreground)", textDecoration: "none" }}>
                      {request.place_name || formatAddress({ place_address: request.place_address, place_city: request.place_city, place_postal_code: request.place_postal_code }, { short: true })}
                    </a>
                    <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
                      {formatAddress({ place_address: request.place_address, place_city: request.place_city, place_postal_code: request.place_postal_code })}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                      {request.place_service_zone && <span className="badge" style={{ background: COLORS.primaryDark, color: "#fff", fontSize: "0.7rem" }}>Zone: {request.place_service_zone}</span>}
                    </div>
                    {request.location_description && (
                      <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic" }}>
                        {request.location_description}
                      </div>
                    )}
                    {request.requester_home_place_id && request.requester_home_place_id !== request.place_id && request.requester_home_address && (
                      <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "#eef2ff", borderRadius: "6px", fontSize: "0.8rem", color: "#4338ca" }}>
                        <span style={{ fontWeight: 600 }}>Requester lives at:</span> {request.requester_home_address}
                      </div>
                    )}
                    {request.place_coordinates && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <a href={`https://www.google.com/maps/search/?api=1&query=${request.place_coordinates.lat},${request.place_coordinates.lng}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem", color: "#166534", textDecoration: "none" }}>
                          Open in Google Maps →
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ color: "var(--muted)", margin: 0, fontStyle: "italic" }}>No location linked</p>
                )}
              </div>
            </div>

            <RelatedPeopleSection
              requestId={requestId}
              relatedPeople={relatedPeople}
              fetchRelatedPeople={fetchRelatedPeople}
              onPersonClick={(personId) => modals.preview.open("person", personId)}
              briefingContext={request}
              briefingJournal={journalEntries}
            />

            {/* Field Intelligence (tippy tickets) */}
            <IntelligenceSection tickets={tippyTickets} />
          </TabPanel>

          {/* Cats Tab */}
          <TabPanel tabId="cats" activeTab={activeTab}>
            <LinkedCatsSection cats={request.cats} context="request" emptyMessage="No cats linked yet" showCount={false} title="" onEntityClick={(t, id) => modals.preview.open(t as "cat", id)} />
          </TabPanel>

          {/* Trip Reports Tab */}
          <TabPanel tabId="trip-reports" activeTab={activeTab}>
            <TripReportsTab tripReports={tripReports} onLogSession={() => modals.open("tripReport")} />
          </TabPanel>

          {/* Photos Tab */}
          <TabPanel tabId="photos" activeTab={activeTab}>
            <MediaGallery entityType="request" entityId={requestId} allowUpload={true} includeRelated={true} showCatDescription={true} defaultMediaType="cat_photo" allowedMediaTypes={["cat_photo", "site_photo", "evidence"]} />
          </TabPanel>

          {/* Activity Tab */}
          <TabPanel tabId="activity" activeTab={activeTab}>
            <JournalSection entityType="request" entityId={requestId} entries={journalEntries} onEntryAdded={() => { refreshAndNotify(); fetchJournalEntries(); }} />
          </TabPanel>

          {/* Admin Tab */}
          <TabPanel tabId="admin" activeTab={activeTab}>
            <RequestAdminTab
              request={request}
              mapUrl={mapUrl}
              onUpgradeLegacy={() => modals.open("upgrade")}
              onCreateColony={() => modals.open("colony")}
            />
          </TabPanel>
        </div>
      )}

      {/* All modals rendered by hook */}
      {modals.element}

      {/* Log Update drawer */}
      <LogUpdateDrawer
        isOpen={showLogUpdate}
        onClose={() => { setShowLogUpdate(false); setLogUpdateInitialSection(undefined); }}
        requestId={requestId}
        request={request}
        siteId={request.site_id}
        placeId={request.place_id}
        fixedCount={request.colony_verified_altered ?? 0}
        initialSection={logUpdateInitialSection}
        onSaved={() => { refreshAndNotify(); fetchJournalEntries(); fetchRelatedPeople(); }}
      />
    </div>
  );
}
