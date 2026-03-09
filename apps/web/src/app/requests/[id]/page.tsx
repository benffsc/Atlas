"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CaseSection, JournalSection, LinkedCatsSection, TrapperAssignments, ClinicNotesSection } from "@/components/sections";
import type { JournalEntry } from "@/components/sections";
import { BackButton, EditHistory, ContactCard, NearbyEntities } from "@/components/common";
import { LegacyUpgradeWizard } from "@/components/forms";
import { LogSiteVisitModal, CompleteRequestModal, CloseRequestModal, HoldRequestModal, RedirectRequestModal, HandoffRequestModal, SendEmailModal, CreateColonyModal, ArchiveRequestModal, TripReportModal } from "@/components/modals";
import { StatusBadge, PriorityBadge, PropertyTypeBadge } from "@/components/badges";
import { MediaGallery } from "@/components/media";
import { ColonyEstimates } from "@/components/charts";
import { ClassificationSuggestionBanner } from "@/components/admin";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { SmartField, YesNoSmartField, isLegacySource, TabBar, TabPanel } from "@/components/ui";
import { formatPhone, formatAddress } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";
import type { RequestDetail } from "./types";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, REQUEST_STATUS_COLORS, getStatusColor } from "@/lib/design-tokens";
import { getOutcomeLabel, getOutcomeColor, getReasonLabel, type ResolutionOutcome } from "@/lib/request-status";
import {
  PAGE_CONTAINER, FIELD_LABEL, FIELD_HINT, FIELD_VALUE, FIELD_VALUE_EMPTY,
  INPUT, GRID_2COL, GRID_3COL, GRID_AUTO, FLEX_CENTER, FLEX_CENTER_SM,
  FLEX_BETWEEN, FLEX_WRAP_SM, ACTIONS_ROW, WARNING_BANNER, ERROR_BANNER,
  MB_LG, MT_LG, SKELETON_LINE, SKELETON_BLOCK, quickStatusButton,
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

// MIG_2530: Simplified 4-state status system
const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "working", label: "Working" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "redirected", label: "Redirected" },
  { value: "handed_off", label: "Handed Off" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

function LegacyBadge() {
  return (
    <span className="badge" style={{ background: COLORS.gray100, color: COLORS.gray600, fontSize: TYPOGRAPHY.size.xs, padding: `${SPACING.xs} ${SPACING.sm}`, border: `1px solid ${COLORS.gray300}` }} title="Imported from Airtable">
      Legacy
    </span>
  );
}

// Field display component for consistent styling
function Field({ label, value, hint, fullWidth, editable, onEdit }: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  fullWidth?: boolean;
  editable?: boolean;
  onEdit?: () => void;
}) {
  const isEmpty = value === null || value === undefined || value === "" || value === "Unknown";
  return (
    <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <div style={{ ...FLEX_CENTER_SM, marginBottom: SPACING.xs }}>
        <span style={FIELD_LABEL}>{label}</span>
        {hint && <span style={FIELD_HINT}>({hint})</span>}
        {editable && onEdit && (
          <button onClick={onEdit} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.7rem", color: "#6366f1", padding: 0, marginLeft: "auto" }}>
            Edit
          </button>
        )}
      </div>
      <div style={isEmpty ? FIELD_VALUE_EMPTY : FIELD_VALUE}>
        {isEmpty ? "\u2014" : value}
      </div>
    </div>
  );
}

// Yes/No/Unknown field
function YesNoField({ label, value, hint }: { label: string; value: boolean | null; hint?: string }) {
  const display = value === true ? "Yes" : value === false ? "No" : "Unknown";
  const color = value === true ? COLORS.successDark : value === false ? COLORS.errorDark : COLORS.textMuted;
  return (
    <div>
      <div style={{ ...FLEX_CENTER_SM, marginBottom: SPACING.xs }}>
        <span style={FIELD_LABEL}>{label}</span>
        {hint && <span style={FIELD_HINT}>({hint})</span>}
      </div>
      <div style={{ fontWeight: TYPOGRAPHY.weight.semibold, color }}>{display}</div>
    </div>
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

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  // Inline notes editing state
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    status: "",
    priority: "",
    summary: "",
    notes: "",
    estimated_cat_count: "" as number | "",
    kitten_count: "" as number | "",
    has_kittens: false,
    cats_are_friendly: null as boolean | null,
    assigned_to: "",
    scheduled_date: "",
    scheduled_time_range: "",
    resolution_notes: "",
    cats_trapped: "" as number | "",
    cats_returned: "" as number | "",
    peak_count: "" as number | "",
    awareness_duration: "",
    county: "",
    feeding_location: "",
    feeding_time: "",
    is_emergency: null as boolean | null,
    has_medical_concerns: false,
    medical_description: "",
    is_third_party_report: null as boolean | null,
    third_party_relationship: "",
    dogs_on_site: "",
    trap_savvy: "",
    previous_tnr: "",
    best_trapping_time: "",
    eartip_count: "" as number | "",
    permission_status: "",
    access_notes: "",
    traps_overnight_safe: null as boolean | null,
    property_type: "",
    colony_duration: "",
    is_being_fed: null as boolean | null,
    feeder_name: "",
    feeding_frequency: "",
    best_times_seen: "",
    handleability: "",
  });

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

  // Footer tab state (replaces collapsible sections)
  const [activeTab, setActiveTab] = useState<string>("cats");

  // Collapsible sections (keeping for edit mode compatibility)
  const [sectionsCollapsed, setSectionsCollapsed] = useState<Record<string, boolean>>({
    cats: false,
    photos: true,
    colony: false,
    activity: false,
    admin: true,
  });

  // Session/Staff info
  const { user: currentUser } = useCurrentUser();
  const currentStaffId = currentUser?.staff_id || null;
  const currentStaffName = currentUser?.display_name || null;

  // Journal entries
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);

  // Trip reports
  const [tripReports, setTripReports] = useState<TripReportRow[]>([]);

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
        initEditForm(data);
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
  }, [requestId, fetchJournalEntries, fetchTripReports]);

  const initEditForm = (data: RequestDetail) => {
    setEditForm({
      status: data.status,
      priority: data.priority,
      summary: data.summary || "",
      notes: data.notes || "",
      estimated_cat_count: data.estimated_cat_count ?? "",
      kitten_count: data.kitten_count ?? "",
      has_kittens: data.has_kittens,
      cats_are_friendly: data.cats_are_friendly,
      assigned_to: data.assigned_to || "",
      scheduled_date: data.scheduled_date || "",
      scheduled_time_range: data.scheduled_time_range || "",
      resolution_notes: data.resolution_notes || "",
      cats_trapped: data.cats_trapped ?? "",
      cats_returned: data.cats_returned ?? "",
      peak_count: data.peak_count ?? "",
      awareness_duration: data.awareness_duration || "",
      county: data.county || "",
      feeding_location: data.feeding_location || "",
      feeding_time: data.feeding_time || "",
      is_emergency: data.is_emergency,
      has_medical_concerns: data.has_medical_concerns ?? false,
      medical_description: data.medical_description || "",
      is_third_party_report: data.is_third_party_report,
      third_party_relationship: data.third_party_relationship || "",
      dogs_on_site: data.dogs_on_site || "",
      trap_savvy: data.trap_savvy || "",
      previous_tnr: data.previous_tnr || "",
      best_trapping_time: data.best_trapping_time || "",
      eartip_count: data.eartip_count ?? "",
      permission_status: data.permission_status || "",
      access_notes: data.access_notes || "",
      traps_overnight_safe: data.traps_overnight_safe,
      property_type: data.property_type || "",
      colony_duration: data.colony_duration || "",
      is_being_fed: data.is_being_fed,
      feeder_name: data.feeder_name || "",
      feeding_frequency: data.feeding_frequency || "",
      best_times_seen: data.best_times_seen || "",
      handleability: data.handleability || "",
    });
  };

  const refreshRequest = async () => {
    try {
      const data = await fetchApi<RequestDetail>(`/api/requests/${requestId}`);
      setRequest(data);
      initEditForm(data);
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

  const startEditNotes = () => {
    setNotesValue(request?.notes || "");
    setEditingNotes(true);
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await postApi(`/api/requests/${requestId}`, { notes: notesValue.trim() || null }, { method: "PATCH" });
      await refreshRequest();
      setEditingNotes(false);
    } catch (err) {
      setError("Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        status: editForm.status,
        priority: editForm.priority,
        summary: editForm.summary || null,
        notes: editForm.notes || null,
        estimated_cat_count: editForm.estimated_cat_count === "" ? null : Number(editForm.estimated_cat_count),
        kitten_count: editForm.kitten_count === "" ? null : Number(editForm.kitten_count),
        has_kittens: editForm.has_kittens,
        cats_are_friendly: editForm.cats_are_friendly,
        assigned_to: editForm.assigned_to || null,
        scheduled_date: editForm.scheduled_date || null,
        scheduled_time_range: editForm.scheduled_time_range || null,
        resolution_notes: editForm.resolution_notes || null,
        cats_trapped: editForm.cats_trapped === "" ? null : Number(editForm.cats_trapped),
        cats_returned: editForm.cats_returned === "" ? null : Number(editForm.cats_returned),
        peak_count: editForm.peak_count === "" ? null : Number(editForm.peak_count),
        awareness_duration: editForm.awareness_duration || null,
        county: editForm.county || null,
        feeding_location: editForm.feeding_location || null,
        feeding_time: editForm.feeding_time || null,
        is_emergency: editForm.is_emergency,
        has_medical_concerns: editForm.has_medical_concerns,
        medical_description: editForm.medical_description || null,
        is_third_party_report: editForm.is_third_party_report,
        third_party_relationship: editForm.third_party_relationship || null,
        dogs_on_site: editForm.dogs_on_site || null,
        trap_savvy: editForm.trap_savvy || null,
        previous_tnr: editForm.previous_tnr || null,
        best_trapping_time: editForm.best_trapping_time || null,
        eartip_count: editForm.eartip_count === "" ? null : Number(editForm.eartip_count),
        permission_status: editForm.permission_status || null,
        access_notes: editForm.access_notes || null,
        traps_overnight_safe: editForm.traps_overnight_safe,
        property_type: editForm.property_type || null,
        colony_duration: editForm.colony_duration || null,
        is_being_fed: editForm.is_being_fed,
        feeder_name: editForm.feeder_name || null,
        feeding_frequency: editForm.feeding_frequency || null,
        best_times_seen: editForm.best_times_seen || null,
        handleability: editForm.handleability || null,
      };
      await postApi(`/api/requests/${requestId}`, payload, { method: "PATCH" });
      await refreshRequest();
      setEditing(false);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const getQuickStatusOptions = () => {
    if (!request) return [];
    const working = { value: "working", label: "Start Working", color: REQUEST_STATUS_COLORS.working.border };
    const resume = { value: "working", label: "Resume", color: REQUEST_STATUS_COLORS.working.border };
    const pause = { value: "paused", label: "Pause", color: REQUEST_STATUS_COLORS.paused.border };
    const complete = { value: "completed", label: "Close Case", color: REQUEST_STATUS_COLORS.completed.border };
    const reopen = { value: "new", label: "Reopen", color: REQUEST_STATUS_COLORS.new.border };
    switch (request.status) {
      case "new": return [working, pause, complete];
      case "working": return [complete, pause];
      case "paused": return [resume, complete];
      case "completed": case "cancelled": return [reopen];
      case "triaged": return [working, complete];
      case "scheduled": case "in_progress": return [complete, pause];
      case "on_hold": return [resume, complete];
      default: return [];
    }
  };

  const toggleSection = (key: string) => {
    setSectionsCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return (
      <div style={PAGE_CONTAINER}>
        <BackButton fallbackHref="/requests" />
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
        <BackButton fallbackHref="/requests" />
        <div className="empty" style={{ marginTop: "2rem" }}><p>{error}</p></div>
      </div>
    );
  }

  if (!request) return null;

  const isResolved = request.status === "completed" || request.status === "cancelled" || request.status === "partial";

  // ═══════════════════════════════════════════════════════════════════════════
  // EDIT MODE RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  if (editing) {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "1rem" }}>
        <BackButton fallbackHref="/requests" />
        <div style={{ marginTop: "1rem", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Edit Request</h1>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => { setEditing(false); if (request) initEditForm(request); }} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn">{saving ? "Saving..." : "Save Changes"}</button>
          </div>
        </div>
        {error && <div className="alert alert-error" style={MB_LG}>{error}</div>}

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={MB_LG}>Status & Priority</h3>
          <div style={GRID_2COL}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Status</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} style={INPUT}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Priority</label>
              <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })} style={INPUT}>
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={MB_LG}>Case Summary</h3>
          <div style={MB_LG}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Title</label>
            <input type="text" value={editForm.summary} onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })} placeholder="Brief description of the request..." style={INPUT} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Notes</label>
            <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Additional details about the situation..." rows={4} style={INPUT} />
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={MB_LG}>Colony Assessment</h3>
          <div style={GRID_3COL}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Adult Cats Needing TNR</label>
              <input type="number" value={editForm.estimated_cat_count} onChange={(e) => setEditForm({ ...editForm, estimated_cat_count: e.target.value ? Number(e.target.value) : "" })} min="0" style={INPUT} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Eartipped</label>
              <input type="number" value={editForm.eartip_count} onChange={(e) => setEditForm({ ...editForm, eartip_count: e.target.value ? Number(e.target.value) : "" })} min="0" style={INPUT} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Peak Count Observed</label>
              <input type="number" value={editForm.peak_count} onChange={(e) => setEditForm({ ...editForm, peak_count: e.target.value ? Number(e.target.value) : "" })} min="0" style={INPUT} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Handleability</label>
              <select value={editForm.handleability} onChange={(e) => setEditForm({ ...editForm, handleability: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="friendly">Friendly / Carrier OK</option>
                <option value="trap_needed">Trap Needed</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Colony Duration</label>
              <select value={editForm.colony_duration} onChange={(e) => setEditForm({ ...editForm, colony_duration: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="less_than_1_month">Less than 1 month</option>
                <option value="1_to_6_months">1-6 months</option>
                <option value="6_months_to_2_years">6 months - 2 years</option>
                <option value="over_2_years">Over 2 years</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>County</label>
              <select value={editForm.county} onChange={(e) => setEditForm({ ...editForm, county: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="sonoma">Sonoma</option>
                <option value="marin">Marin</option>
                <option value="napa">Napa</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={editForm.has_kittens} onChange={(e) => setEditForm({ ...editForm, has_kittens: e.target.checked })} />
              <span style={{ fontWeight: 500 }}>Has Kittens</span>
            </label>
            {editForm.has_kittens && (
              <div style={{ marginTop: "0.5rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Kitten Count</label>
                <input type="number" value={editForm.kitten_count} onChange={(e) => setEditForm({ ...editForm, kitten_count: e.target.value ? Number(e.target.value) : "" })} min="0" style={{ width: "120px", padding: "0.5rem" }} />
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={MB_LG}>Trapping Logistics</h3>
          <div style={GRID_3COL}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Property Access</label>
              <select value={editForm.permission_status} onChange={(e) => setEditForm({ ...editForm, permission_status: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="granted">Granted</option>
                <option value="pending">Pending</option>
                <option value="denied">Denied</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Property Type</label>
              <select value={editForm.property_type} onChange={(e) => setEditForm({ ...editForm, property_type: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="house">House</option>
                <option value="apartment">Apartment</option>
                <option value="business">Business</option>
                <option value="rural">Rural / Farm</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Dogs on Site</label>
              <select value={editForm.dogs_on_site} onChange={(e) => setEditForm({ ...editForm, dogs_on_site: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="containable">Yes, but containable</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Trap-Savvy Cats</label>
              <select value={editForm.trap_savvy} onChange={(e) => setEditForm({ ...editForm, trap_savvy: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="some">Some</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Previous TNR</label>
              <select value={editForm.previous_tnr} onChange={(e) => setEditForm({ ...editForm, previous_tnr: e.target.value })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="partial">Partial</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Traps Safe Overnight</label>
              <select value={editForm.traps_overnight_safe === null ? "" : editForm.traps_overnight_safe ? "yes" : "no"} onChange={(e) => setEditForm({ ...editForm, traps_overnight_safe: e.target.value === "" ? null : e.target.value === "yes" })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Access Notes</label>
            <textarea value={editForm.access_notes} onChange={(e) => setEditForm({ ...editForm, access_notes: e.target.value })} placeholder="Gate codes, parking, hazards..." rows={2} style={INPUT} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Best Times Seen</label>
              <input type="text" value={editForm.best_times_seen} onChange={(e) => setEditForm({ ...editForm, best_times_seen: e.target.value })} placeholder="e.g., Early morning, dusk" style={INPUT} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Best Trapping Time</label>
              <input type="text" value={editForm.best_trapping_time} onChange={(e) => setEditForm({ ...editForm, best_trapping_time: e.target.value })} placeholder="e.g., Weekday mornings" style={INPUT} />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={MB_LG}>Feeding Information</h3>
          <div style={GRID_3COL}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Being Fed?</label>
              <select value={editForm.is_being_fed === null ? "" : editForm.is_being_fed ? "yes" : "no"} onChange={(e) => setEditForm({ ...editForm, is_being_fed: e.target.value === "" ? null : e.target.value === "yes" })} style={INPUT}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Feeder Name</label>
              <input type="text" value={editForm.feeder_name} onChange={(e) => setEditForm({ ...editForm, feeder_name: e.target.value })} style={INPUT} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Feeding Frequency</label>
              <select value={editForm.feeding_frequency} onChange={(e) => setEditForm({ ...editForm, feeding_frequency: e.target.value })} style={INPUT}>
                <option value="">Select frequency...</option>
                <option value="daily">Daily</option>
                <option value="few_times_week">A few times a week</option>
                <option value="occasionally">Occasionally</option>
                <option value="rarely">Rarely / Not at all</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Feeding Location</label>
              <input type="text" value={editForm.feeding_location} onChange={(e) => setEditForm({ ...editForm, feeding_location: e.target.value })} placeholder="e.g., Back porch" style={INPUT} />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem", background: "#fef2f2", border: "1px solid #fecaca" }}>
          <h3 style={{ marginBottom: "1rem", color: "#991b1b" }}>Medical & Emergency</h3>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={editForm.is_emergency === true} onChange={(e) => setEditForm({ ...editForm, is_emergency: e.target.checked ? true : null })} />
              <span style={{ fontWeight: 500 }}>Emergency Situation</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={editForm.has_medical_concerns} onChange={(e) => setEditForm({ ...editForm, has_medical_concerns: e.target.checked })} />
              <span style={{ fontWeight: 500 }}>Medical Concerns</span>
            </label>
          </div>
          {editForm.has_medical_concerns && (
            <div style={{ marginTop: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Describe Medical Concerns</label>
              <textarea value={editForm.medical_description} onChange={(e) => setEditForm({ ...editForm, medical_description: e.target.value })} rows={2} style={INPUT} />
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={MB_LG}>Scheduling</h3>
          <div style={GRID_2COL}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Scheduled Date</label>
              <input type="date" value={editForm.scheduled_date} onChange={(e) => setEditForm({ ...editForm, scheduled_date: e.target.value })} style={INPUT} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Time Range</label>
              <input type="text" value={editForm.scheduled_time_range} onChange={(e) => setEditForm({ ...editForm, scheduled_time_range: e.target.value })} placeholder="e.g., Morning, 8am-12pm" style={INPUT} />
            </div>
          </div>
        </div>

        {isResolved && (
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <h3 style={{ marginBottom: "1rem", color: "#166534" }}>Resolution</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Cats Trapped</label>
                <input type="number" value={editForm.cats_trapped} onChange={(e) => setEditForm({ ...editForm, cats_trapped: e.target.value ? Number(e.target.value) : "" })} min="0" style={INPUT} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Cats Returned</label>
                <input type="number" value={editForm.cats_returned} onChange={(e) => setEditForm({ ...editForm, cats_returned: e.target.value ? Number(e.target.value) : "" })} min="0" style={INPUT} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Resolution Notes</label>
              <textarea value={editForm.resolution_notes} onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })} rows={3} style={INPUT} />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN VIEW RENDER (Case File Layout)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "1rem" }}>
      <BackButton fallbackHref="/requests" />

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
                  <button onClick={startRename} title="Rename" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem", color: "var(--muted)", opacity: 0.7 }}>✏️</button>
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
            <button onClick={() => setEditing(true)} className="btn btn-secondary" style={{ fontSize: "0.85rem" }}>Edit</button>
            <button onClick={() => setShowHistory(!showHistory)} className="btn btn-secondary" style={{ fontSize: "0.85rem" }}>{showHistory ? "Hide History" : "History"}</button>
          </div>
        </div>

        {/* Quick Status Actions */}
        <div style={{ ...ACTIONS_ROW, marginBottom: SPACING.lg }}>
          <span style={{ fontSize: TYPOGRAPHY.size.sm, color: "var(--muted)" }}>Actions:</span>
          {getQuickStatusOptions().map((opt) => (
            <button key={opt.value} onClick={() => handleQuickStatusChange(opt.value)} disabled={saving} style={quickStatusButton(opt.color, saving)}>
              {opt.label}
            </button>
          ))}
          {previousStatus && previousStatus !== request.status && (
            <button onClick={() => handleQuickStatusChange(previousStatus)} disabled={saving} style={{ padding: `0.35rem ${SPACING.md}`, fontSize: TYPOGRAPHY.size.sm, background: "transparent", color: COLORS.gray500, border: `1px dashed ${COLORS.gray500}`, borderRadius: BORDERS.radius.md, cursor: "pointer" }}>Undo</button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: SPACING.sm }}>
            <button onClick={() => setShowObservationModal(true)} className="btn btn-sm btn-secondary">Log Visit</button>
            <button onClick={() => setShowTripReportModal(true)} className="btn btn-sm btn-secondary">Log Session</button>
            {request.requester_email && <button onClick={() => setShowEmailModal(true)} className="btn btn-sm btn-secondary">Email</button>}
            {request.status !== "redirected" && request.status !== "handed_off" && !isResolved && (
              <>
                <button onClick={() => setShowRedirectModal(true)} className="btn btn-sm btn-secondary">Redirect</button>
                <button onClick={() => setShowHandoffModal(true)} className="btn btn-sm btn-secondary">Hand Off</button>
              </>
            )}
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
            onPersonClick={(personId, e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              preview.open("person", personId);
            }}
          />
        </div>

        {/* Location Card */}
        <div style={{ marginTop: "1rem", background: "var(--card-bg, #fff)", border: "1px solid var(--border, #e5e7eb)", borderRadius: "12px", overflow: "hidden" }}>
          <div style={{ padding: "0.75rem 1rem", background: "linear-gradient(135deg, #166534 0%, #22c55e 100%)", color: "#fff" }}>
            <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1rem" }}>📍</span>
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
                  {request.place_service_zone && <span className="badge" style={{ background: "#6f42c1", color: "#fff", fontSize: "0.7rem" }}>Zone: {request.place_service_zone}</span>}
                </div>
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
          {/* ─────────────────────────────────────────────────────────────────────
              CASE SUMMARY
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title="Case Summary" icon="📋" color="#3b82f6"
            actions={!editing && !editingNotes ? (
              <button onClick={startEditNotes} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem", color: "#6366f1", fontWeight: 500 }}>Edit</button>
            ) : undefined}
          >
            {editingNotes ? (
              <div>
                <textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  placeholder="Add case notes..."
                  rows={6}
                  autoFocus
                  style={{ ...INPUT, width: "100%", resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button onClick={handleSaveNotes} disabled={savingNotes} className="btn btn-sm">{savingNotes ? "Saving..." : "Save"}</button>
                  <button onClick={() => setEditingNotes(false)} className="btn btn-sm btn-secondary">Cancel</button>
                </div>
              </div>
            ) : request.notes ? (
              <div style={{ whiteSpace: "pre-wrap", fontSize: "0.95rem", lineHeight: 1.5 }}>{request.notes}</div>
            ) : (
              <p onClick={startEditNotes} style={{ color: "var(--muted)", fontStyle: "italic", cursor: "pointer" }}>Add notes...</p>
            )}
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              COLONY ASSESSMENT - Structured intake fields (SmartField hides zeros)
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title="Colony Assessment" icon="🐱" color="#f59e0b">
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1rem", margin: 0 }}>
              <SmartField label="Adult Cats" value={request.estimated_cat_count} hint="needing TNR" showWhen="always" legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Eartipped" value={request.eartip_count} showWhen="nonzero" legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Eartip Estimate" value={request.eartip_estimate?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Peak Observed" value={request.peak_count} showWhen="nonzero" legacyMode={isLegacySource(request.source_system)} />
              <YesNoSmartField label="Has Kittens" value={request.has_kittens} legacyMode={isLegacySource(request.source_system)} />
              {request.has_kittens && <SmartField label="Kitten Count" value={request.kitten_count} showWhen="nonzero" />}
              {request.has_kittens && <SmartField label="Kitten Age (weeks)" value={request.kitten_age_weeks} showWhen="nonzero" />}
              {request.wellness_cat_count != null && request.wellness_cat_count > 0 && <SmartField label="Wellness Cat Count" value={request.wellness_cat_count} showWhen="nonzero" />}
              <YesNoSmartField label="Cats Are Friendly" value={request.cats_are_friendly} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Handleability" value={request.handleability?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Colony Duration" value={request.colony_duration?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="County" value={request.county} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Count Confidence" value={request.count_confidence?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
            </dl>
            {request.location_description && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--muted-bg)", borderRadius: "6px", fontSize: "0.9rem" }}>
                <strong>Location Notes:</strong> {request.location_description}
              </div>
            )}
            {request.kitten_notes && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef3c7", borderRadius: "6px", fontSize: "0.9rem", borderLeft: "3px solid #f59e0b" }}>
                <strong>Kitten Notes:</strong> {request.kitten_notes}
              </div>
            )}
            {request.kitten_mixed_ages_description && (
              <div style={{ marginTop: "0.5rem", padding: "0.75rem", background: "#fef3c7", borderRadius: "6px", fontSize: "0.9rem", borderLeft: "3px solid #f59e0b" }}>
                <strong>Mixed Ages:</strong> {request.kitten_mixed_ages_description}
              </div>
            )}
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              TRAPPING LOGISTICS (SmartField hides empty values)
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title="Trapping Logistics" icon="🪤" color="#166534">
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1rem", margin: 0 }}>
              <SmartField label="Property Access" value={request.permission_status?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Property Type" value={request.property_type?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Dogs on Site" value={request.dogs_on_site?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Trap-Savvy" value={request.trap_savvy?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Previous TNR" value={request.previous_tnr?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <YesNoSmartField label="Traps Safe Overnight" value={request.traps_overnight_safe} legacyMode={isLegacySource(request.source_system)} />
              <YesNoSmartField label="Access Without Contact" value={request.access_without_contact} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Best Times Seen" value={request.best_times_seen} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Best Contact Times" value={request.best_contact_times} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Best Trapping Time" value={request.best_trapping_time} legacyMode={isLegacySource(request.source_system)} />
            </dl>
            {request.is_property_owner === false && (request.property_owner_name || request.property_owner_phone) && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#eff6ff", borderRadius: "6px", fontSize: "0.9rem", borderLeft: "3px solid #3b82f6" }}>
                <strong>Property Owner:</strong>{" "}
                {request.property_owner_name}{request.property_owner_phone ? ` — ${formatPhone(request.property_owner_phone)}` : ""}
                {request.authorization_pending && <span className="badge" style={{ background: COLORS.warning, color: COLORS.black, marginLeft: "0.5rem", fontSize: "0.75rem" }}>Authorization Pending</span>}
              </div>
            )}
            {request.access_notes && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#f0fdf4", borderRadius: "6px", fontSize: "0.9rem", borderLeft: "3px solid #166534" }}>
                <strong>Access Notes:</strong> {request.access_notes}
              </div>
            )}
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              FEEDING INFORMATION (only shows details if being fed)
              ───────────────────────────────────────────────────────────────────── */}
          {(request.is_being_fed || request.feeder_name || request.feeding_frequency || isLegacySource(request.source_system)) && (
            <CaseSection title="Feeding Information" icon="🍽️" color="#6366f1">
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1rem", margin: 0 }}>
                <YesNoSmartField label="Being Fed" value={request.is_being_fed} showWhen="defined" legacyMode={isLegacySource(request.source_system)} />
                {(request.is_being_fed || isLegacySource(request.source_system)) && (
                  <>
                    <SmartField label="Feeder" value={request.feeder_name} legacyMode={isLegacySource(request.source_system)} />
                    <SmartField label="Frequency" value={request.feeding_frequency ? request.feeding_frequency.replace(/_/g, " ") : null} legacyMode={isLegacySource(request.source_system)} />
                    <SmartField label="Feeding Time" value={request.feeding_time} legacyMode={isLegacySource(request.source_system)} />
                    <SmartField label="Location" value={request.feeding_location} legacyMode={isLegacySource(request.source_system)} />
                  </>
                )}
              </dl>
            </CaseSection>
          )}

          {/* ─────────────────────────────────────────────────────────────────────
              INTAKE EXTENDED DATA (fields preserved from intake without dedicated columns)
              ───────────────────────────────────────────────────────────────────── */}
          {request.intake_extended_data && Object.keys(request.intake_extended_data).length > 0 && (
            <CaseSection title="Intake Details" icon="📝" color="#8b5cf6">
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
          <CaseSection title="Assigned Trappers" icon="👤" color="#ec4899">
            <TrapperAssignments requestId={requestId} onAssignmentChange={refreshRequest} />
            {request.scheduled_date && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef3c7", borderRadius: "6px", display: "flex", gap: "1rem", alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>📅 Scheduled:</span>
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
                { id: "cats", label: "Linked Cats", icon: "😺", count: request.linked_cat_count || 0 },
                { id: "trip-reports", label: "Trip Reports", icon: "📋", count: tripReports.length },
                { id: "photos", label: "Photos", icon: "📷" },
                { id: "activity", label: "Activity", icon: "📝", count: journalEntries.length },
                { id: "admin", label: "Admin", icon: "⚙️" },
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
                          background: report.is_final_visit ? "#f0fdf4" : "var(--muted-bg)",
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
                            {report.submitted_from === "airtable" ? "Airtable" : "Atlas"}
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
              <div style={{ padding: "1rem", background: "#f9fafb", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 1rem 0", fontSize: "0.95rem", fontWeight: 600, color: "#374151" }}>Admin Tools</h4>
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
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem", fontWeight: 700, color: "#166534" }}>Colony Summary</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#166534" }}>{request.colony_size_estimate ?? "?"}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Estimated</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#059669" }}>{request.colony_verified_altered ?? 0}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Altered</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#f59e0b" }}>{request.colony_work_remaining ?? "?"}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Remaining</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#6366f1" }}>
                  {request.colony_alteration_rate != null ? `${Math.round(request.colony_alteration_rate * 100)}%` : "—"}
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
                <a href={`/map?lat=${request.place_coordinates?.lat}&lng=${request.place_coordinates?.lng}&zoom=17`} className="btn btn-sm btn-secondary" style={{ flex: 1, fontSize: "0.75rem" }}>Atlas Map</a>
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
    </div>
  );
}
