"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CaseSection, JournalSection, LinkedCatsSection, TrapperAssignments, ClinicNotesSection } from "@/components/sections";
import type { JournalEntry } from "@/components/sections";
import { EditHistory, ContactCard, NearbyEntities } from "@/components/common";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { useNavigationContext } from "@/hooks/useNavigationContext";
import { ErrorState } from "@/components/feedback/EmptyState";
import { RequestSection, GuidedActionBar, REQUEST_SECTIONS } from "@/components/request";
import { LegacyUpgradeWizard } from "@/components/forms";
import { LogSiteVisitModal, CompleteRequestModal, CloseRequestModal, HoldRequestModal, RedirectRequestModal, HandoffRequestModal, SendEmailModal, CreateColonyModal, ArchiveRequestModal, TripReportModal } from "@/components/modals";
import { StatusBadge, PriorityBadge, PropertyTypeBadge } from "@/components/badges";
import { MediaGallery } from "@/components/media";
import { ColonyEstimates } from "@/components/charts";
import { ClassificationSuggestionBanner } from "@/components/admin";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { SmartField, TabBar, TabPanel } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { UpdateSituationDrawer } from "@/components/request/UpdateSituationDrawer";
import { formatPhone, formatAddress } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";
import type { RequestDetail } from "./types";
import { RELATED_PERSON_RELATIONSHIP_OPTIONS, RELATED_PLACE_RELATIONSHIP_OPTIONS, LANGUAGE_OPTIONS, getLabel, getShortLabel } from "@/lib/form-options";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/components/forms/PlaceResolver";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { PersonReferencePicker } from "@/components/ui/PersonReferencePicker";
import type { PersonReference } from "@/components/ui/PersonReferencePicker";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, getStatusColor } from "@/lib/design-tokens";
import { getOutcomeLabel, getOutcomeColor, getReasonLabel, type ResolutionOutcome } from "@/lib/request-status";
import {
  PAGE_CONTAINER, WARNING_BANNER, ERROR_BANNER,
  MB_LG, SKELETON_LINE, SKELETON_BLOCK,
} from "../styles";

interface TripReportRow {
  report_id: string;
  trapper_name: string | null;
  visit_date: string;
  cats_trapped: number;
  cats_returned: number;
  traps_set: number | null;
  traps_retrieved: number | null;
  cats_seen: number | null;
  eartipped_seen: number | null;
  issues_encountered: string[];
  issue_details: string | null;
  site_notes: string | null;
  is_final_visit: boolean;
  submitted_from: string;
  created_at: string;
}

function LegacyBadge() {
  return (
    <span className="badge" style={{ background: COLORS.gray100, color: COLORS.gray600, fontSize: TYPOGRAPHY.size.xs, padding: `${SPACING.xs} ${SPACING.sm}`, border: `1px solid ${COLORS.gray300}` }} title="Imported from Airtable">
      Legacy
    </span>
  );
}


export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previousStatus, setPreviousStatus] = useState<string | null>(null);
  const preview = useEntityPreviewModal();
  const requestTitle = request?.summary || request?.place_name || "FFR Request";
  const { breadcrumbs } = useNavigationContext(requestTitle);

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);


  // Status change saving state
  const [saving, setSaving] = useState(false);

  // Modal states
  const [showObservationModal, setShowObservationModal] = useState(false);
  const [showRedirectModal, setShowRedirectModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [completionTargetStatus, setCompletionTargetStatus] = useState<"completed" | "cancelled">("completed");
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showColonyModal, setShowColonyModal] = useState(false);
  const [showUpgradeWizard, setShowUpgradeWizard] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showTripReportModal, setShowTripReportModal] = useState(false);

  // Site contact editing state (FFS-442)
  const [savingSiteContact, setSavingSiteContact] = useState(false);

  // Update Situation drawer (FFS-1028, replaces FFS-1015 Add Info + Location Edit)
  const [showSituation, setShowSituation] = useState(false);

  // Footer tab state (replaces collapsible sections)
  const [activeTab, setActiveTab] = useState<string>("cats");


  // Session/Staff info
  const { user: currentUser } = useCurrentUser();
  const currentStaffId = currentUser?.staff_id || null;
  const currentStaffName = currentUser?.display_name || null;

  // Journal entries
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);

  // Trip reports
  const [tripReports, setTripReports] = useState<TripReportRow[]>([]);

  // Related people
  interface RelatedPersonDisplay {
    id: string;
    person_id: string;
    relationship_type: string;
    relationship_notes: string | null;
    notify_before_release: boolean;
    preferred_language: string | null;
    display_name: string | null;
    email: string | null;
    phone: string | null;
  }
  const [relatedPeople, setRelatedPeople] = useState<RelatedPersonDisplay[]>([]);

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

  const fetchRelatedPeople = useCallback(async () => {
    try {
      const data = await fetchApi<{ related_people: RelatedPersonDisplay[] }>(`/api/requests/${requestId}/related-people`);
      setRelatedPeople(data.related_people || []);
    } catch {
      // Non-critical
    }
  }, [requestId]);

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

  // Related places
  interface RelatedPlaceDisplay {
    id: string;
    place_id: string;
    relationship_type: string;
    relationship_notes: string | null;
    is_primary_trapping_site: boolean;
    display_name: string | null;
    formatted_address: string | null;
    locality: string | null;
    place_kind: string | null;
  }
  const [relatedPlaces, setRelatedPlaces] = useState<RelatedPlaceDisplay[]>([]);

  const [showAddPlaceDrawer, setShowAddPlaceDrawer] = useState(false);
  const [addPlaceResolved, setAddPlaceResolved] = useState<ResolvedPlace | null>(null);
  const [addPlaceRelType, setAddPlaceRelType] = useState("");
  const [addPlaceNotes, setAddPlaceNotes] = useState("");
  const [addPlacePrimary, setAddPlacePrimary] = useState(false);
  const [addPlaceSaving, setAddPlaceSaving] = useState(false);

  const resetAddPlaceForm = useCallback(() => {
    setAddPlaceResolved(null);
    setAddPlaceRelType("");
    setAddPlaceNotes("");
    setAddPlacePrimary(false);
  }, []);

  const fetchRelatedPlaces = useCallback(async () => {
    try {
      const data = await fetchApi<{ related_places: RelatedPlaceDisplay[] }>(`/api/requests/${requestId}/related-places`);
      setRelatedPlaces(data.related_places || []);
    } catch {
      // Non-critical
    }
  }, [requestId]);

  const handleAddPlace = useCallback(async () => {
    if (!addPlaceResolved) return;
    setAddPlaceSaving(true);
    try {
      await postApi(`/api/requests/${requestId}/related-places`, {
        place_id: addPlaceResolved.place_id,
        relationship_type: addPlaceRelType || "other",
        relationship_notes: addPlaceNotes || undefined,
        is_primary_trapping_site: addPlacePrimary,
      });
      fetchRelatedPlaces();
      resetAddPlaceForm();
      setShowAddPlaceDrawer(false);
    } catch {
      // Non-critical
    } finally {
      setAddPlaceSaving(false);
    }
  }, [requestId, addPlaceResolved, addPlaceRelType, addPlaceNotes, addPlacePrimary, fetchRelatedPlaces, resetAddPlaceForm]);

  // Map state
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  const fetchTripReports = useCallback(async () => {
    try {
      const data = await fetchApi<{ reports: TripReportRow[] }>(`/api/requests/${requestId}/trip-report`);
      setTripReports(data.reports || []);
    } catch (err) {
      console.error("Failed to fetch trip reports:", err);
    }
  }, [requestId]);

  const fetchJournalEntries = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(`/api/journal?request_id=${requestId}&include_related=true`);
      setJournalEntries(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch journal entries:", err);
    }
  }, [requestId]);

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const data = await fetchApi<RequestDetail>(`/api/requests/${requestId}`);
        setRequest(data);
        if (data.place_coordinates) {
          setMapUrl(`https://maps.googleapis.com/maps/api/staticmap?center=${data.place_coordinates.lat},${data.place_coordinates.lng}&zoom=16&size=400x200&markers=color:green%7C${data.place_coordinates.lat},${data.place_coordinates.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`);
        }
      } catch (err) {
        const apiErr = err as ApiError;
        setError(apiErr.code === 404 ? "Request not found" : apiErr.message || "Failed to load request");
      } finally {
        setLoading(false);
      }
    };
    fetchRequest();
    fetchJournalEntries();
    fetchTripReports();
    fetchRelatedPeople();
    fetchRelatedPlaces();
  }, [requestId, fetchJournalEntries, fetchTripReports, fetchRelatedPeople, fetchRelatedPlaces]);

  const refreshRequest = async () => {
    try {
      const data = await fetchApi<RequestDetail>(`/api/requests/${requestId}`);
      setRequest(data);
    } catch {
      /* optional: refresh failure is non-critical, keep existing data */
    }
  };

  const handleQuickStatusChange = async (newStatus: string) => {
    if (!request) return;
    if (newStatus === "completed") {
      setShowCloseModal(true);
      return;
    }
    if (newStatus === "paused" || newStatus === "on_hold") {
      setShowHoldModal(true);
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
      await postApi(`/api/requests/${requestId}`, { status: newStatus }, { method: "PATCH" });
      setPreviousStatus(oldStatus);
      await refreshRequest();
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
      await refreshRequest();
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
      await postApi(`/api/requests/${requestId}`, { summary: renameValue.trim() }, { method: "PATCH" });
      await refreshRequest();
      setRenaming(false);
    } catch (err) {
      setError("Failed to rename");
    } finally {
      setSavingRename(false);
    }
  };

  // FFS-442: Site contact change handler
  const handleSiteContactChange = async (personId: string | null) => {
    setSavingSiteContact(true);
    try {
      await postApi(`/api/requests/${requestId}`, { site_contact_person_id: personId }, { method: "PATCH" });
      // Journal audit (fire-and-forget)
      postApi("/api/journal", {
        request_id: requestId,
        entry_kind: "system",
        tags: ["contact_change"],
        body: personId ? `Set site contact` : `Removed site contact`,
      }).catch(() => {});
      await refreshRequest();
    } catch (err) {
      console.error("Failed to update site contact:", err);
    } finally {
      setSavingSiteContact(false);
    }
  };


  if (loading) {
    return (
      <div style={PAGE_CONTAINER}>
        <Breadcrumbs items={breadcrumbs} />
        <div style={{ marginTop: SPACING['2xl'] }}>
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

  if (error && !request) {
    return (
      <div>
        <Breadcrumbs items={breadcrumbs} />
        <ErrorState title="Request not found" description={error || undefined} />
      </div>
    );
  }

  if (!request) return null;

  const isResolved = request.status === "completed" || request.status === "cancelled" || request.status === "partial";

  // ═══════════════════════════════════════════════════════════════════════════
  // Helper: modal handler for GuidedActionBar
  // ═══════════════════════════════════════════════════════════════════════════
  const handleOpenModal = (modal: "close" | "hold" | "observation" | "trip-report") => {
    switch (modal) {
      case "close": setShowCloseModal(true); break;
      case "hold": setShowHoldModal(true); break;
      case "observation": setShowObservationModal(true); break;
      case "trip-report": setShowTripReportModal(true); break;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN VIEW RENDER (Case File Layout — inline section editing)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "1rem" }}>
      <Breadcrumbs items={breadcrumbs} />

      {/* ═══════════════════════════════════════════════════════════════════════
          CASE HEADER - Title, Status, Contact, Address all visible
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ marginTop: "1rem", marginBottom: "1.5rem", padding: "1.25rem" }}>
        {/* Top Row: Title + Status + Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              {renaming ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }} autoFocus style={{ fontSize: "1.5rem", fontWeight: 700, padding: "0.25rem 0.5rem", border: "2px solid var(--primary)", borderRadius: "4px", width: "400px" }} />
                  <button onClick={handleRename} disabled={savingRename} className="btn btn-sm">{savingRename ? "..." : "Save"}</button>
                  <button onClick={() => setRenaming(false)} className="btn btn-sm btn-secondary">Cancel</button>
                </div>
              ) : (
                <>
                  <h1 style={{ margin: 0, fontSize: "1.5rem", lineHeight: 1.2 }}>{request.summary || request.place_name || "FFR Request"}</h1>
                  <button onClick={startRename} title="Rename" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem", color: "var(--muted)", opacity: 0.7 }}><Icon name="pencil" size={14} /></button>
                </>
              )}
              {request.source_system?.startsWith("airtable") && <LegacyBadge />}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
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
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
            <button onClick={() => setShowHistory(!showHistory)} className="btn btn-secondary" style={{ fontSize: "0.85rem" }}>{showHistory ? "Hide History" : "History"}</button>
          </div>
        </div>

        {/* Guided Action Bar — status-aware guidance + quick actions */}
        <GuidedActionBar
          request={request}
          saving={saving}
          onStatusChange={handleQuickStatusChange}
          onOpenModal={handleOpenModal}
        />

        {/* Secondary actions row */}
        <div style={{ display: "flex", gap: SPACING.sm, flexWrap: "wrap", marginBottom: SPACING.lg }}>
          <button onClick={() => setShowSituation(true)} className="btn btn-sm" style={{ background: "#7c3aed", color: "#fff" }}>Update Situation</button>
          {request.requester_email && <button onClick={() => setShowEmailModal(true)} className="btn btn-sm btn-secondary">Email</button>}
          {request.status !== "redirected" && request.status !== "handed_off" && !isResolved && (
            <>
              <button onClick={() => setShowRedirectModal(true)} className="btn btn-sm btn-secondary">Redirect</button>
              <button onClick={() => setShowHandoffModal(true)} className="btn btn-sm btn-secondary">Hand Off</button>
            </>
          )}
          {previousStatus && previousStatus !== request.status && (
            <button onClick={() => handleQuickStatusChange(previousStatus)} disabled={saving} style={{ padding: `0.35rem ${SPACING.md}`, fontSize: TYPOGRAPHY.size.sm, background: "transparent", color: COLORS.gray500, border: `1px dashed ${COLORS.gray500}`, borderRadius: BORDERS.radius.md, cursor: "pointer" }}>Undo</button>
          )}
          <div style={{ marginLeft: "auto" }}>
            {request.is_archived ? (
              <button onClick={handleRestore} disabled={saving} className="btn btn-sm" style={{ background: COLORS.success, color: COLORS.white }}>
                {saving ? "Restoring..." : "Restore"}
              </button>
            ) : (
              <button onClick={() => setShowArchiveModal(true)} className="btn btn-sm" style={{ background: COLORS.gray500, color: COLORS.white }}>Archive</button>
            )}
          </div>
        </div>

        {/* Resolution Banner — only shown for resolved requests */}
        {isResolved && (() => {
          const isLegacy = !request.resolution_outcome && request.source_system?.startsWith("airtable");
          const hasOutcome = !!request.resolution_outcome;
          const outcomeColors = hasOutcome ? getOutcomeColor(request.resolution_outcome!) : null;
          const resolvedDate = request.resolved_at || request.source_created_at;

          const formatRelativeDate = (dateStr: string) => {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return "today";
            if (diffDays === 1) return "yesterday";
            if (diffDays < 30) return `${diffDays} days ago`;
            if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
            return `${Math.floor(diffDays / 365)} years ago`;
          };

          // Determine banner style
          let bannerBg: string;
          let bannerBorder: string;
          let bannerColor: string;
          let bannerIcon: string;

          if (hasOutcome && outcomeColors) {
            bannerBg = outcomeColors.bg;
            bannerBorder = outcomeColors.border;
            bannerColor = outcomeColors.color;
            bannerIcon = request.resolution_outcome === "successful" ? "✓" : "●";
          } else if (isLegacy) {
            bannerBg = "#f3f4f6";
            bannerBorder = "#d1d5db";
            bannerColor = "#6b7280";
            bannerIcon = "📋";
          } else {
            bannerBg = "#f9fafb";
            bannerBorder = "#e5e7eb";
            bannerColor = "#6b7280";
            bannerIcon = "●";
          }

          return (
            <div style={{
              marginTop: "1rem",
              padding: "1rem 1.25rem",
              background: bannerBg,
              border: `1px solid ${bannerBorder}`,
              borderRadius: "10px",
            }}>
              {hasOutcome ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: request.resolution_reason || request.resolution_notes ? "0.5rem" : 0 }}>
                    <span style={{ fontSize: "1.1rem" }}>{bannerIcon}</span>
                    <span style={{ fontWeight: 600, fontSize: "0.95rem", color: bannerColor }}>
                      {getOutcomeLabel(request.resolution_outcome!)}
                    </span>
                    {resolvedDate && (
                      <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: bannerColor, opacity: 0.8 }}>
                        Closed {formatRelativeDate(resolvedDate)} — {new Date(resolvedDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {request.resolution_reason && (
                    <div style={{ fontSize: "0.85rem", color: bannerColor, opacity: 0.9, marginBottom: request.resolution_notes ? "0.25rem" : 0 }}>
                      {getReasonLabel(request.resolution_reason)}
                    </div>
                  )}
                  {request.resolution_notes && (
                    <div style={{ fontSize: "0.85rem", color: bannerColor, opacity: 0.8, fontStyle: "italic" }}>
                      {request.resolution_notes}
                    </div>
                  )}
                </>
              ) : isLegacy ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "1rem" }}>{bannerIcon}</span>
                    <span style={{ fontWeight: 600, fontSize: "0.95rem", color: bannerColor }}>Legacy Import</span>
                    {resolvedDate && (
                      <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: bannerColor, opacity: 0.8 }}>
                        {formatRelativeDate(resolvedDate)} — {new Date(resolvedDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: bannerColor, opacity: 0.8, marginTop: "0.25rem" }}>
                    Closed in Airtable — no resolution details available
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "1rem" }}>{bannerIcon}</span>
                    <span style={{ fontWeight: 600, fontSize: "0.95rem", color: bannerColor }}>Closed without resolution details</span>
                    {resolvedDate && (
                      <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: bannerColor, opacity: 0.8 }}>
                        {formatRelativeDate(resolvedDate)} — {new Date(resolvedDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Contact Card - Prominent display */}
        <div style={{ marginTop: "1rem" }}>
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
            onEmailClick={() => setShowEmailModal(true)}
            onSiteContactChange={handleSiteContactChange}
            savingSiteContact={savingSiteContact}
            onPersonClick={(personId, e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              preview.open("person", personId);
            }}
          />
          {/* Language badge on requester */}
          {request.preferred_language && request.preferred_language !== "en" && (
            <div style={{ marginTop: "0.5rem", display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "10px",
                background: "#eef2ff",
                color: "#4338ca",
                textTransform: "uppercase",
              }}>
                {getShortLabel(LANGUAGE_OPTIONS, request.preferred_language)} — {getLabel(LANGUAGE_OPTIONS, request.preferred_language)}
              </span>
            </div>
          )}
        </div>

        {/* Related People */}
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
                  {/* Name + link */}
                  <a
                    href={`/people/${rp.person_id}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) return;
                      e.preventDefault();
                      preview.open("person", rp.person_id);
                    }}
                    style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--foreground)", textDecoration: "none", minWidth: "120px" }}
                  >
                    {rp.display_name || "Unknown"}
                  </a>

                  {/* Relationship badge */}
                  <span style={{
                    fontSize: "0.7rem",
                    fontWeight: 500,
                    padding: "1px 8px",
                    borderRadius: "10px",
                    background: "var(--bg-tertiary, #f3f4f6)",
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}>
                    {getLabel(RELATED_PERSON_RELATIONSHIP_OPTIONS, rp.relationship_type)}
                  </span>

                  {/* Language pill */}
                  {rp.preferred_language && rp.preferred_language !== "en" && (
                    <span style={{
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "8px",
                      background: "#eef2ff",
                      color: "#4338ca",
                      textTransform: "uppercase",
                    }}>
                      {getShortLabel(LANGUAGE_OPTIONS, rp.preferred_language)}
                    </span>
                  )}

                  {/* Notify icon */}
                  {rp.notify_before_release && (
                    <span title="Notify before release" style={{ fontSize: "0.75rem", color: "#f59e0b" }}>
                      <Icon name="bell" size={14} />
                    </span>
                  )}

                  {/* Contact info */}
                  <div style={{ flex: 1, display: "flex", gap: "0.75rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {rp.phone && <span>{formatPhone(rp.phone)}</span>}
                    {rp.email && <span>{rp.email}</span>}
                  </div>

                  {/* Notes */}
                  {rp.relationship_notes && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={rp.relationship_notes}
                    >
                      {rp.relationship_notes}
                    </span>
                  )}

                  {/* Row action: Remove */}
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

        {/* Add Related Person Drawer */}
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

        {/* Related Locations */}
        <div style={{ marginTop: "1rem", background: "var(--card-bg, #fff)", border: "1px solid var(--border, #e5e7eb)", borderRadius: "12px", overflow: "hidden" }}>
          <div style={{ padding: "0.625rem 1rem", background: "var(--bg-secondary, #f9fafb)", borderBottom: relatedPlaces.length > 0 ? "1px solid var(--border, #e5e7eb)" : "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Icon name="map-pin" size={16} color="var(--text-muted)" />
            <h3 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
              Related Locations
            </h3>
            {relatedPlaces.length > 0 && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>({relatedPlaces.length})</span>
            )}
            <button
              type="button"
              onClick={() => { resetAddPlaceForm(); setShowAddPlaceDrawer(true); }}
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
          {relatedPlaces.length > 0 && (
            <div style={{ padding: "0.5rem" }}>
              {relatedPlaces.map((rpl) => (
                <div
                  key={rpl.id}
                  style={{
                    padding: "0.5rem 0.75rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    borderBottom: "1px solid var(--border-light, #f3f4f6)",
                  }}
                >
                  {/* Place name + link */}
                  <a
                    href={`/places/${rpl.place_id}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) return;
                      e.preventDefault();
                      preview.open("place", rpl.place_id);
                    }}
                    style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--foreground)", textDecoration: "none", minWidth: "120px" }}
                  >
                    {rpl.display_name || rpl.formatted_address || "Unknown"}
                  </a>

                  {/* Relationship badge */}
                  <span style={{
                    fontSize: "0.7rem",
                    fontWeight: 500,
                    padding: "1px 8px",
                    borderRadius: "10px",
                    background: "var(--bg-tertiary, #f3f4f6)",
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}>
                    {getLabel(RELATED_PLACE_RELATIONSHIP_OPTIONS, rpl.relationship_type)}
                  </span>

                  {/* Primary trapping site pill */}
                  {rpl.is_primary_trapping_site && (
                    <span style={{
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "8px",
                      background: "#dcfce7",
                      color: "#166534",
                      textTransform: "uppercase",
                    }}>
                      Primary
                    </span>
                  )}

                  {/* Locality */}
                  <div style={{ flex: 1, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {rpl.locality || rpl.formatted_address || ""}
                  </div>

                  {/* Notes */}
                  {rpl.relationship_notes && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={rpl.relationship_notes}
                    >
                      {rpl.relationship_notes}
                    </span>
                  )}

                  {/* Row action: Remove */}
                  <RowActionMenu
                    actions={[
                      {
                        label: "Remove",
                        variant: "danger",
                        onClick: async () => {
                          try {
                            await fetchApi(`/api/requests/${requestId}/related-places?related_place_id=${rpl.id}`, { method: "DELETE" });
                            fetchRelatedPlaces();
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
          {relatedPlaces.length === 0 && (
            <div style={{ padding: "0.75rem 1rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              No related locations yet. Click Add to link a suspected source, trapping site, or colony extent.
            </div>
          )}
        </div>

        {/* Add Related Place Drawer */}
        <ActionDrawer
          isOpen={showAddPlaceDrawer}
          onClose={() => setShowAddPlaceDrawer(false)}
          title="Add Related Location"
          width="sm"
          footer={
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowAddPlaceDrawer(false)}
                style={{ padding: "6px 16px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "6px", background: "transparent", cursor: "pointer", color: "var(--text-secondary)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddPlace}
                disabled={addPlaceSaving || !addPlaceResolved}
                style={{
                  padding: "6px 16px", fontSize: "0.85rem", fontWeight: 500,
                  border: "none", borderRadius: "6px", cursor: addPlaceSaving ? "wait" : "pointer",
                  background: "var(--primary)", color: "#fff",
                  opacity: addPlaceSaving || !addPlaceResolved ? 0.5 : 1,
                }}
              >
                {addPlaceSaving ? "Saving..." : "Add Location"}
              </button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500 }}>Location</label>
              <PlaceResolver
                value={addPlaceResolved}
                onChange={setAddPlaceResolved}
                placeholder="Search for an address..."
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500 }}>Relationship</label>
              <select
                value={addPlaceRelType}
                onChange={(e) => setAddPlaceRelType(e.target.value)}
                style={{ width: "100%", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              >
                <option value="">Select relationship...</option>
                {RELATED_PLACE_RELATIONSHIP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", cursor: "pointer" }}>
              <input type="checkbox" checked={addPlacePrimary} onChange={(e) => setAddPlacePrimary(e.target.checked)} />
              Primary trapping site
            </label>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500 }}>Notes</label>
              <input
                type="text"
                value={addPlaceNotes}
                onChange={(e) => setAddPlaceNotes(e.target.value)}
                placeholder="e.g., feeder lives here, cats seen crossing from here..."
                style={{ width: "100%", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
          </div>
        </ActionDrawer>

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
                <a href={`/places/${request.place_id}`} onClick={preview.handleClick("place", request.place_id)} style={{ fontWeight: 600, fontSize: "1.1rem", color: "var(--foreground)", textDecoration: "none" }}>
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
                {/* Dual display: requester lives somewhere else */}
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

        {/* Safety concerns */}
        {(request.place_safety_concerns?.length || request.place_safety_notes) && (
          <div style={WARNING_BANNER}>
            <span style={{ fontWeight: TYPOGRAPHY.weight.medium, color: getStatusColor('warning').text }}>Safety: </span>
            {request.place_safety_concerns?.join(", ").replace(/_/g, " ")}
            {request.place_safety_notes && ` - ${request.place_safety_notes}`}
          </div>
        )}

        {/* Urgency/Emergency banner */}
        {(request.urgency_reasons?.length || request.is_emergency || request.has_medical_concerns) && (
          <div style={ERROR_BANNER}>
            <div style={{ fontWeight: TYPOGRAPHY.weight.semibold, color: getStatusColor('error').text, marginBottom: SPACING.xs }}>
              {request.is_emergency ? "EMERGENCY" : "URGENT"}
            </div>
            {request.urgency_reasons?.length && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: getStatusColor('error').text }}>{request.urgency_reasons.map(r => r.replace(/_/g, " ")).join(" \u2022 ")}</div>}
            {request.has_medical_concerns && request.medical_description && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: getStatusColor('error').text, marginTop: SPACING.xs }}>Medical: {request.medical_description}</div>}
            {request.urgency_deadline && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: '#9a3412', marginTop: SPACING.xs }}>Deadline: {new Date(request.urgency_deadline).toLocaleDateString()}</div>}
            {request.urgency_notes && <div style={{ fontSize: TYPOGRAPHY.size.sm, color: getStatusColor('error').text, marginTop: SPACING.xs }}>{request.urgency_notes}</div>}
          </div>
        )}
      </div>

      {/* Show history panel if open */}
      {showHistory && (
        <div className="card" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
          <h3 style={MB_LG}>Edit History</h3>
          <EditHistory entityType="request" entityId={requestId} limit={20} />
        </div>
      )}

      {/* ClinicHQ Notes for associated place */}
      {request.place_id && <ClinicNotesSection placeId={request.place_id} />}

      {/* Two Column Layout for Main Content */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem" }}>
        {/* ═══════════════════════════════════════════════════════════════════════
            LEFT COLUMN - Main Case Information
            ═══════════════════════════════════════════════════════════════════════ */}
        <div>
          {/* ═══════════════════════════════════════════════════════════════════
              INLINE SECTION EDITING — Config-driven RequestSection components
              ═══════════════════════════════════════════════════════════════════ */}
          {REQUEST_SECTIONS.map((sectionConfig) => (
            <RequestSection
              key={sectionConfig.id}
              config={sectionConfig}
              request={request}
              onSaved={refreshRequest}
            />
          ))}

          {/* ─────────────────────────────────────────────────────────────────────
              INTAKE EXTENDED DATA (fields preserved from intake without dedicated columns)
              ───────────────────────────────────────────────────────────────────── */}
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

          {/* ─────────────────────────────────────────────────────────────────────
              ASSIGNED TRAPPERS
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title="Assigned Trappers" icon="user" color="#ec4899">
            <TrapperAssignments requestId={requestId} placeId={request.place_id} onAssignmentChange={refreshRequest} />
            {request.scheduled_date && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef3c7", borderRadius: "6px", display: "flex", gap: "1rem", alignItems: "center" }}>
                <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><Icon name="calendar" size={14} /> Scheduled:</span>
                <span>{new Date(request.scheduled_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                {request.scheduled_time_range && <span style={{ color: "var(--muted)" }}>({request.scheduled_time_range})</span>}
              </div>
            )}
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              TABBED SECONDARY CONTENT
              ───────────────────────────────────────────────────────────────────── */}
          <div style={{ marginTop: "1.5rem" }}>
            <TabBar
              tabs={[
                { id: "cats", label: "Linked Cats", icon: "cat", count: request.linked_cat_count || 0 },
                { id: "trip-reports", label: "Trip Reports", icon: "clipboard-list", count: tripReports.length },
                { id: "photos", label: "Photos", icon: "camera" },
                { id: "activity", label: "Activity", icon: "pencil", count: journalEntries.length },
                { id: "admin", label: "Admin", icon: "settings" },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />

            <TabPanel tabId="cats" activeTab={activeTab}>
              <LinkedCatsSection cats={request.cats} context="request" emptyMessage="No cats linked yet" showCount={false} title="" onEntityClick={(t, id) => preview.open(t as "cat", id)} />
            </TabPanel>

            <TabPanel tabId="trip-reports" activeTab={activeTab}>
              <div style={{ padding: "0.5rem 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    {tripReports.length} report{tripReports.length !== 1 ? "s" : ""}
                    {tripReports.length > 0 && (() => {
                      const totalTrapped = tripReports.reduce((sum, r) => sum + (r.cats_trapped || 0), 0);
                      const totalReturned = tripReports.reduce((sum, r) => sum + (r.cats_returned || 0), 0);
                      return totalTrapped > 0 ? ` — ${totalTrapped} trapped, ${totalReturned} returned` : "";
                    })()}
                  </span>
                  <button
                    onClick={() => setShowTripReportModal(true)}
                    className="btn btn-sm btn-primary"
                    style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                  >
                    + Log Session
                  </button>
                </div>

                {tripReports.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
                    <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>No trip reports yet</p>
                    <p style={{ margin: 0, fontSize: "0.8rem" }}>Log your first trapping session to track progress.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {tripReports.map((report) => (
                      <div
                        key={report.report_id}
                        style={{
                          padding: "0.75rem 1rem",
                          background: report.is_final_visit ? "var(--success-bg)" : "var(--muted-bg)",
                          borderRadius: "8px",
                          border: report.is_final_visit ? "1px solid #86efac" : "1px solid var(--border)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.375rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                              {new Date(report.visit_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                            {report.trapper_name && (
                              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                                by {report.trapper_name}
                              </span>
                            )}
                            {report.is_final_visit && (
                              <span style={{
                                fontSize: "0.7rem",
                                fontWeight: 600,
                                padding: "0.125rem 0.375rem",
                                borderRadius: "4px",
                                background: "#166534",
                                color: "#fff",
                              }}>
                                FINAL VISIT
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                            {report.submitted_from === "airtable" ? "Airtable" : "Beacon"}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                          {(report.cats_trapped > 0 || report.cats_returned > 0) && (
                            <span>Trapped: <strong>{report.cats_trapped}</strong> | Returned: <strong>{report.cats_returned}</strong></span>
                          )}
                          {report.traps_set != null && (
                            <span>Traps: <strong>{report.traps_set}</strong> set{report.traps_retrieved != null ? `, ${report.traps_retrieved} retrieved` : ""}</span>
                          )}
                          {report.cats_seen != null && (
                            <span>Seen: <strong>{report.cats_seen}</strong>{report.eartipped_seen != null ? ` (${report.eartipped_seen} eartipped)` : ""}</span>
                          )}
                        </div>

                        {report.issues_encountered && report.issues_encountered.length > 0 && (
                          <div style={{ marginTop: "0.375rem", fontSize: "0.8rem", color: "#b45309" }}>
                            Issues: {report.issues_encountered.join(", ")}
                            {report.issue_details && ` — ${report.issue_details}`}
                          </div>
                        )}

                        {report.site_notes && (
                          <div style={{ marginTop: "0.375rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                            {report.site_notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabPanel>

            <TabPanel tabId="photos" activeTab={activeTab}>
              <MediaGallery entityType="request" entityId={requestId} allowUpload={true} includeRelated={true} showCatDescription={true} defaultMediaType="cat_photo" allowedMediaTypes={["cat_photo", "site_photo", "evidence"]} />
            </TabPanel>

            <TabPanel tabId="activity" activeTab={activeTab}>
              <JournalSection entityType="request" entityId={requestId} entries={journalEntries} onEntryAdded={() => { refreshRequest(); fetchJournalEntries(); }} />
            </TabPanel>

            <TabPanel tabId="admin" activeTab={activeTab}>
              <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 1rem 0", fontSize: "0.95rem", fontWeight: 600, color: "var(--text-secondary)" }}>Admin Tools</h4>
                {request.place_coordinates && <NearbyEntities requestId={requestId} />}
                {request.source_system?.startsWith("airtable") && (
                  <button onClick={() => setShowUpgradeWizard(true)} className="btn btn-secondary" style={{ width: "100%", marginTop: "1rem" }}>
                    Upgrade Legacy Data
                  </button>
                )}
                {!request.place_coordinates && !request.source_system?.startsWith("airtable") && (
                  <p style={{ color: "#6b7280", fontStyle: "italic", margin: 0 }}>No admin tools available for this request.</p>
                )}
              </div>
            </TabPanel>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            RIGHT COLUMN - Sidebar Stats
            ═══════════════════════════════════════════════════════════════════════ */}
        <div>
          {/* Colony Stats Card */}
          <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem", fontWeight: 700, color: COLORS.successDark }}>Colony Summary</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.successDark }}>{request.colony_size_estimate ?? "?"}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Estimated</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.success }}>{request.colony_verified_altered ?? 0}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Altered</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.warning }}>{request.colony_work_remaining ?? "?"}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Remaining</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.primary }}>
                  {request.colony_alteration_rate != null ? `${Math.round(request.colony_alteration_rate)}%` : "—"}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Coverage</div>
              </div>
            </div>
            {request.place_id && (
              <div style={{ marginTop: "0.75rem" }}>
                <ColonyEstimates placeId={request.place_id} />
              </div>
            )}
          </div>

          {/* Map Preview */}
          {mapUrl && (
            <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", fontWeight: 700 }}>Location</h4>
              <img src={mapUrl} alt="Map" style={{ width: "100%", height: "150px", objectFit: "cover", borderRadius: "6px" }} />
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                <a href={`https://www.google.com/maps/search/?api=1&query=${request.place_coordinates?.lat},${request.place_coordinates?.lng}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ flex: 1, fontSize: "0.75rem" }}>Google Maps</a>
                <a href={`/map?lat=${request.place_coordinates?.lat}&lng=${request.place_coordinates?.lng}&zoom=17`} className="btn btn-sm btn-secondary" style={{ flex: 1, fontSize: "0.75rem" }}>Beacon Map</a>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem", fontWeight: 700 }}>Quick Actions</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <a href={`/requests/${request.request_id}/trapper-sheet`} target="_blank" rel="noopener noreferrer" className="btn" style={{ width: "100%", fontSize: "0.85rem", background: "#166534" }}>Print Trapper Sheet</a>
              <a href={`/requests/${request.request_id}/print`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ width: "100%", fontSize: "0.85rem" }}>Print Summary</a>
              {request.place_id && <button onClick={() => setShowColonyModal(true)} className="btn btn-secondary" style={{ width: "100%", fontSize: "0.85rem" }}>Create Colony</button>}
            </div>
          </div>

          {/* Metadata */}
          <div className="card" style={{ padding: "1rem", fontSize: "0.8rem", color: "var(--muted)" }}>
            <div style={{ marginBottom: "0.5rem" }}><strong>Created:</strong> {new Date(request.created_at).toLocaleString()}</div>
            <div style={{ marginBottom: "0.5rem" }}><strong>Updated:</strong> {new Date(request.updated_at).toLocaleString()}</div>
            {request.source_system && <div style={{ marginBottom: "0.5rem" }}><strong>Source:</strong> {request.source_system}</div>}
            <div><strong>ID:</strong> {request.request_id.slice(0, 8)}...</div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODALS
          ═══════════════════════════════════════════════════════════════════════ */}
      {showObservationModal && request.place_id && (
        <LogSiteVisitModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id}
          placeName={request.place_name || ""}
          onClose={() => setShowObservationModal(false)}
          onSuccess={() => { setShowObservationModal(false); refreshRequest(); fetchJournalEntries(); }}
        />
      )}
      {showTripReportModal && (() => {
        const primaryTrapper = request.current_trappers?.find(t => t.is_primary) || request.current_trappers?.[0];
        return (
          <TripReportModal
            isOpen={true}
            requestId={requestId}
            trapperPersonId={primaryTrapper?.trapper_person_id}
            trapperName={primaryTrapper?.trapper_name}
            estimatedCatCount={request.estimated_cat_count}
            placeId={request.place_id}
            placeName={request.place_name}
            onClose={() => setShowTripReportModal(false)}
            onSuccess={() => { setShowTripReportModal(false); refreshRequest(); fetchJournalEntries(); fetchTripReports(); }}
          />
        );
      })()}
      {showCompleteModal && (
        <CompleteRequestModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id || undefined}
          placeName={request.place_name || undefined}
          onClose={() => setShowCompleteModal(false)}
          onSuccess={() => { setShowCompleteModal(false); refreshRequest(); }}
        />
      )}
      {showCloseModal && (
        <CloseRequestModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id || undefined}
          placeName={request.place_name || undefined}
          onClose={() => setShowCloseModal(false)}
          onSuccess={() => { setShowCloseModal(false); refreshRequest(); fetchJournalEntries(); }}
        />
      )}
      {showHoldModal && (
        <HoldRequestModal
          isOpen={true}
          requestId={requestId}
          onClose={() => setShowHoldModal(false)}
          onSuccess={() => { setShowHoldModal(false); refreshRequest(); }}
        />
      )}
      {showRedirectModal && (
        <RedirectRequestModal
          isOpen={true}
          requestId={requestId}
          originalSummary={request.summary || ""}
          originalAddress={request.place_address}
          originalRequesterName={request.requester_name}
          onClose={() => setShowRedirectModal(false)}
          onSuccess={() => { setShowRedirectModal(false); refreshRequest(); }}
        />
      )}
      {showHandoffModal && (
        <HandoffRequestModal
          isOpen={true}
          requestId={requestId}
          originalSummary={request.summary || ""}
          originalAddress={request.place_address}
          originalRequesterName={request.requester_name}
          onClose={() => setShowHandoffModal(false)}
          onSuccess={() => { setShowHandoffModal(false); refreshRequest(); }}
        />
      )}
      {showEmailModal && request.requester_email && (
        <SendEmailModal
          isOpen={true}
          requestId={requestId}
          defaultTo={request.requester_email}
          defaultToName={request.requester_name || undefined}
          onClose={() => setShowEmailModal(false)}
          onSuccess={() => { setShowEmailModal(false); refreshRequest(); }}
        />
      )}
      {showColonyModal && request.place_id && (
        <CreateColonyModal
          isOpen={true}
          requestId={requestId}
          placeId={request.place_id}
          onClose={() => setShowColonyModal(false)}
          onSuccess={() => { setShowColonyModal(false); refreshRequest(); }}
        />
      )}
      {showUpgradeWizard && (
        <LegacyUpgradeWizard
          request={request}
          onComplete={() => { setShowUpgradeWizard(false); refreshRequest(); }}
          onCancel={() => setShowUpgradeWizard(false)}
        />
      )}
      {showArchiveModal && (
        <ArchiveRequestModal
          requestId={requestId}
          requestSummary={request.summary || request.place_name || undefined}
          onComplete={() => { setShowArchiveModal(false); router.push("/requests"); }}
          onCancel={() => setShowArchiveModal(false)}
        />
      )}

      {/* Entity Preview Modal */}
      <EntityPreviewModal
        isOpen={preview.isOpen}
        onClose={preview.close}
        entityType={preview.entityType}
        entityId={preview.entityId}
      />

      {/* Update Situation Drawer (FFS-1028) */}
      <UpdateSituationDrawer
        isOpen={showSituation}
        requestId={requestId}
        request={request}
        onClose={() => setShowSituation(false)}
        onSuccess={() => { setShowSituation(false); refreshRequest(); fetchJournalEntries(); }}
      />
    </div>
  );
}
