"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { BackButton } from "@/components/BackButton";
import { EditHistory } from "@/components/EditHistory";
import { LegacyUpgradeWizard } from "@/components/LegacyUpgradeWizard";
import JournalSection, { JournalEntry } from "@/components/JournalSection";
import LogSiteVisitModal from "@/components/LogSiteVisitModal";
import CompleteRequestModal from "@/components/CompleteRequestModal";
import HoldRequestModal from "@/components/HoldRequestModal";
import { RedirectRequestModal } from "@/components/RedirectRequestModal";
import { HandoffRequestModal } from "@/components/HandoffRequestModal";
import { SendEmailModal } from "@/components/SendEmailModal";
import { CreateColonyModal } from "@/components/CreateColonyModal";
import ArchiveRequestModal from "@/components/modals/ArchiveRequestModal";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { PropertyTypeBadge } from "@/components/badges";
import { LinkedCatsSection } from "@/components/LinkedCatsSection";
import { NearbyEntities } from "@/components/NearbyEntities";
import { MediaGallery } from "@/components/MediaGallery";
import { TrapperAssignments } from "@/components/TrapperAssignments";
import { ColonyEstimates } from "@/components/ColonyEstimates";
import { ClassificationSuggestionBanner } from "@/components/ClassificationSuggestionBanner";
import ContactCard from "@/components/ContactCard";
import { SmartField, YesNoSmartField, isLegacySource } from "@/components/ui/SmartField";
import { formatPhone, formatAddress } from "@/lib/formatters";
import type { RequestDetail } from "./types";

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
    <span className="badge" style={{ background: "#e9ecef", color: "#495057", fontSize: "0.75rem", padding: "0.25rem 0.5rem", border: "1px solid #ced4da" }} title="Imported from Airtable">
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
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.025em" }}>
          {label}
        </span>
        {hint && <span style={{ fontSize: "0.65rem", color: "#9ca3af" }}>({hint})</span>}
        {editable && onEdit && (
          <button onClick={onEdit} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.7rem", color: "#6366f1", padding: 0, marginLeft: "auto" }}>
            Edit
          </button>
        )}
      </div>
      <div style={{ fontWeight: 500, color: isEmpty ? "#9ca3af" : "#1f2937", fontStyle: isEmpty ? "italic" : "normal" }}>
        {isEmpty ? "—" : value}
      </div>
    </div>
  );
}

// Yes/No/Unknown field
function YesNoField({ label, value, hint }: { label: string; value: boolean | null; hint?: string }) {
  const display = value === true ? "Yes" : value === false ? "No" : "Unknown";
  const color = value === true ? "#059669" : value === false ? "#dc2626" : "#9ca3af";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.025em" }}>
          {label}
        </span>
        {hint && <span style={{ fontSize: "0.65rem", color: "#9ca3af" }}>({hint})</span>}
      </div>
      <div style={{ fontWeight: 600, color }}>{display}</div>
    </div>
  );
}

// Section wrapper
function CaseSection({ title, icon, children, actions, color = "#166534", collapsed, onToggle }: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  color?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "0.75rem",
        paddingBottom: "0.5rem",
        borderBottom: `2px solid ${color}20`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {onToggle && (
            <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "0.9rem" }}>
              {collapsed ? "▶" : "▼"}
            </button>
          )}
          {icon && <span style={{ fontSize: "1.1rem" }}>{icon}</span>}
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color }}>{title}</h3>
        </div>
        {actions}
      </div>
      {!collapsed && children}
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

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);

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
    feeding_schedule: "",
    best_times_seen: "",
    handleability: "",
  });

  // Modal states
  const [showObservationModal, setShowObservationModal] = useState(false);
  const [showRedirectModal, setShowRedirectModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionTargetStatus, setCompletionTargetStatus] = useState<"completed" | "cancelled">("completed");
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showColonyModal, setShowColonyModal] = useState(false);
  const [showUpgradeWizard, setShowUpgradeWizard] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);

  // Collapsible sections
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

  // Map state
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  const fetchJournalEntries = useCallback(async () => {
    try {
      const response = await fetch(`/api/journal?request_id=${requestId}&include_related=true`);
      const data = await response.json();
      if (response.ok) {
        setJournalEntries(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch journal entries:", err);
    }
  }, [requestId]);

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const response = await fetch(`/api/requests/${requestId}`);
        if (!response.ok) {
          setError(response.status === 404 ? "Request not found" : "Failed to load request");
          return;
        }
        const result = await response.json();
        if (!result.success) {
          setError(result.error?.message || "Failed to load request");
          return;
        }
        const data = result.data;
        setRequest(data);
        initEditForm(data);
        if (data.place_coordinates) {
          setMapUrl(`https://maps.googleapis.com/maps/api/staticmap?center=${data.place_coordinates.lat},${data.place_coordinates.lng}&zoom=16&size=400x200&markers=color:green%7C${data.place_coordinates.lat},${data.place_coordinates.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`);
        }
      } catch (err) {
        setError("Failed to load request");
      } finally {
        setLoading(false);
      }
    };
    fetchRequest();
    fetchJournalEntries();
  }, [requestId, fetchJournalEntries]);

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
      feeding_schedule: data.feeding_schedule || "",
      best_times_seen: data.best_times_seen || "",
      handleability: data.handleability || "",
    });
  };

  const refreshRequest = async () => {
    const response = await fetch(`/api/requests/${requestId}`);
    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        setRequest(result.data);
        initEditForm(result.data);
      }
    }
  };

  const handleQuickStatusChange = async (newStatus: string) => {
    if (!request) return;
    if (newStatus === "completed") {
      setCompletionTargetStatus("completed");
      setShowCompleteModal(true);
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
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to update status");
        return;
      }
      setPreviousStatus(oldStatus);
      await refreshRequest();
    } catch (err) {
      setError("Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (!request) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/requests/${requestId}/archive`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error?.message || data.error || "Failed to restore request");
        return;
      }
      await refreshRequest();
    } catch (err) {
      setError("Failed to restore request");
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
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: renameValue.trim() }),
      });
      if (response.ok) {
        await refreshRequest();
        setRenaming(false);
      }
    } catch (err) {
      setError("Failed to rename");
    } finally {
      setSavingRename(false);
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
        feeding_schedule: editForm.feeding_schedule || null,
        best_times_seen: editForm.best_times_seen || null,
        handleability: editForm.handleability || null,
      };
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save changes");
        return;
      }
      await refreshRequest();
      setEditing(false);
    } catch (err) {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const getQuickStatusOptions = () => {
    if (!request) return [];
    switch (request.status) {
      case "new": return [
        { value: "working", label: "Start Working", color: "#f59e0b" },
        { value: "paused", label: "Pause", color: "#ec4899" },
        { value: "completed", label: "Complete", color: "#10b981" },
      ];
      case "working": return [
        { value: "completed", label: "Complete", color: "#10b981" },
        { value: "paused", label: "Pause", color: "#ec4899" },
      ];
      case "paused": return [
        { value: "working", label: "Resume", color: "#f59e0b" },
        { value: "completed", label: "Complete", color: "#10b981" },
      ];
      case "completed": case "cancelled": return [
        { value: "new", label: "Reopen", color: "#3b82f6" },
      ];
      case "triaged": return [
        { value: "working", label: "Start Working", color: "#f59e0b" },
        { value: "completed", label: "Complete", color: "#10b981" },
      ];
      case "scheduled": case "in_progress": return [
        { value: "completed", label: "Complete", color: "#10b981" },
        { value: "paused", label: "Pause", color: "#ec4899" },
      ];
      case "on_hold": return [
        { value: "working", label: "Resume", color: "#f59e0b" },
        { value: "completed", label: "Complete", color: "#10b981" },
      ];
      default: return [];
    }
  };

  const toggleSection = (key: string) => {
    setSectionsCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return (
      <div>
        <BackButton fallbackHref="/requests" />
        <div className="loading" style={{ marginTop: "2rem" }}>Loading request...</div>
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

  const isResolved = request.status === "completed" || request.status === "cancelled";

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
        {error && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{error}</div>}

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Status & Priority</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Status</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Priority</label>
              <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Case Summary</h3>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Title</label>
            <input type="text" value={editForm.summary} onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })} placeholder="Brief description of the request..." style={{ width: "100%", padding: "0.5rem" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Notes</label>
            <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Additional details about the situation..." rows={4} style={{ width: "100%", padding: "0.5rem" }} />
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Colony Assessment</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Adult Cats Needing TNR</label>
              <input type="number" value={editForm.estimated_cat_count} onChange={(e) => setEditForm({ ...editForm, estimated_cat_count: e.target.value ? Number(e.target.value) : "" })} min="0" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Eartipped</label>
              <input type="number" value={editForm.eartip_count} onChange={(e) => setEditForm({ ...editForm, eartip_count: e.target.value ? Number(e.target.value) : "" })} min="0" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Peak Count Observed</label>
              <input type="number" value={editForm.peak_count} onChange={(e) => setEditForm({ ...editForm, peak_count: e.target.value ? Number(e.target.value) : "" })} min="0" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Handleability</label>
              <select value={editForm.handleability} onChange={(e) => setEditForm({ ...editForm, handleability: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="friendly">Friendly / Carrier OK</option>
                <option value="trap_needed">Trap Needed</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Colony Duration</label>
              <select value={editForm.colony_duration} onChange={(e) => setEditForm({ ...editForm, colony_duration: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="less_than_1_month">Less than 1 month</option>
                <option value="1_to_6_months">1-6 months</option>
                <option value="6_months_to_2_years">6 months - 2 years</option>
                <option value="over_2_years">Over 2 years</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>County</label>
              <select value={editForm.county} onChange={(e) => setEditForm({ ...editForm, county: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
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
          <h3 style={{ marginBottom: "1rem" }}>Trapping Logistics</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Property Access</label>
              <select value={editForm.permission_status} onChange={(e) => setEditForm({ ...editForm, permission_status: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="granted">Granted</option>
                <option value="pending">Pending</option>
                <option value="denied">Denied</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Property Type</label>
              <select value={editForm.property_type} onChange={(e) => setEditForm({ ...editForm, property_type: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="house">House</option>
                <option value="apartment">Apartment</option>
                <option value="business">Business</option>
                <option value="rural">Rural / Farm</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Dogs on Site</label>
              <select value={editForm.dogs_on_site} onChange={(e) => setEditForm({ ...editForm, dogs_on_site: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="containable">Yes, but containable</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Trap-Savvy Cats</label>
              <select value={editForm.trap_savvy} onChange={(e) => setEditForm({ ...editForm, trap_savvy: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="some">Some</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Previous TNR</label>
              <select value={editForm.previous_tnr} onChange={(e) => setEditForm({ ...editForm, previous_tnr: e.target.value })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="partial">Partial</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Traps Safe Overnight</label>
              <select value={editForm.traps_overnight_safe === null ? "" : editForm.traps_overnight_safe ? "yes" : "no"} onChange={(e) => setEditForm({ ...editForm, traps_overnight_safe: e.target.value === "" ? null : e.target.value === "yes" })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Access Notes</label>
            <textarea value={editForm.access_notes} onChange={(e) => setEditForm({ ...editForm, access_notes: e.target.value })} placeholder="Gate codes, parking, hazards..." rows={2} style={{ width: "100%", padding: "0.5rem" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Best Times Seen</label>
              <input type="text" value={editForm.best_times_seen} onChange={(e) => setEditForm({ ...editForm, best_times_seen: e.target.value })} placeholder="e.g., Early morning, dusk" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Best Trapping Time</label>
              <input type="text" value={editForm.best_trapping_time} onChange={(e) => setEditForm({ ...editForm, best_trapping_time: e.target.value })} placeholder="e.g., Weekday mornings" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Feeding Information</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Being Fed?</label>
              <select value={editForm.is_being_fed === null ? "" : editForm.is_being_fed ? "yes" : "no"} onChange={(e) => setEditForm({ ...editForm, is_being_fed: e.target.value === "" ? null : e.target.value === "yes" })} style={{ width: "100%", padding: "0.5rem" }}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Feeder Name</label>
              <input type="text" value={editForm.feeder_name} onChange={(e) => setEditForm({ ...editForm, feeder_name: e.target.value })} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Feeding Schedule</label>
              <input type="text" value={editForm.feeding_schedule} onChange={(e) => setEditForm({ ...editForm, feeding_schedule: e.target.value })} placeholder="e.g., 7am and 5pm" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Feeding Location</label>
              <input type="text" value={editForm.feeding_location} onChange={(e) => setEditForm({ ...editForm, feeding_location: e.target.value })} placeholder="e.g., Back porch" style={{ width: "100%", padding: "0.5rem" }} />
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
              <textarea value={editForm.medical_description} onChange={(e) => setEditForm({ ...editForm, medical_description: e.target.value })} rows={2} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Scheduling</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Scheduled Date</label>
              <input type="date" value={editForm.scheduled_date} onChange={(e) => setEditForm({ ...editForm, scheduled_date: e.target.value })} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Time Range</label>
              <input type="text" value={editForm.scheduled_time_range} onChange={(e) => setEditForm({ ...editForm, scheduled_time_range: e.target.value })} placeholder="e.g., Morning, 8am-12pm" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
          </div>
        </div>

        {isResolved && (
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1rem", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <h3 style={{ marginBottom: "1rem", color: "#166534" }}>Resolution</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Cats Trapped</label>
                <input type="number" value={editForm.cats_trapped} onChange={(e) => setEditForm({ ...editForm, cats_trapped: e.target.value ? Number(e.target.value) : "" })} min="0" style={{ width: "100%", padding: "0.5rem" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Cats Returned</label>
                <input type="number" value={editForm.cats_returned} onChange={(e) => setEditForm({ ...editForm, cats_returned: e.target.value ? Number(e.target.value) : "" })} min="0" style={{ width: "100%", padding: "0.5rem" }} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Resolution Notes</label>
              <textarea value={editForm.resolution_notes} onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })} rows={3} style={{ width: "100%", padding: "0.5rem" }} />
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
              <PriorityBadge priority={request.priority} />
              {request.property_type && <PropertyTypeBadge type={request.property_type} />}
              {request.hold_reason && <span className="badge" style={{ background: "#ffc107", color: "#000" }}>Hold: {request.hold_reason.replace(/_/g, " ")}</span>}
              {request.is_archived && <span className="badge" style={{ background: "#6b7280", color: "#fff" }}>Archived</span>}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
            <a href={`/requests/${request.request_id}/trapper-sheet`} target="_blank" rel="noopener noreferrer" className="btn" style={{ fontSize: "0.85rem", background: "#166534", color: "#fff" }}>Trapper Sheet</a>
            <button onClick={() => setEditing(true)} className="btn btn-secondary" style={{ fontSize: "0.85rem" }}>Edit</button>
            <button onClick={() => setShowHistory(!showHistory)} className="btn btn-secondary" style={{ fontSize: "0.85rem" }}>{showHistory ? "Hide History" : "History"}</button>
          </div>
        </div>

        {/* Quick Status Actions */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Actions:</span>
          {getQuickStatusOptions().map((opt) => (
            <button key={opt.value} onClick={() => handleQuickStatusChange(opt.value)} disabled={saving} style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", background: opt.color, color: "#fff", border: "none", borderRadius: "4px", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {opt.label}
            </button>
          ))}
          {previousStatus && previousStatus !== request.status && (
            <button onClick={() => handleQuickStatusChange(previousStatus)} disabled={saving} style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", background: "transparent", color: "#6c757d", border: "1px dashed #6c757d", borderRadius: "4px", cursor: "pointer" }}>↩ Undo</button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setShowObservationModal(true)} className="btn btn-sm btn-secondary">Log Visit</button>
            {request.requester_email && <button onClick={() => setShowEmailModal(true)} className="btn btn-sm btn-secondary">Email</button>}
            {request.status !== "redirected" && request.status !== "handed_off" && !isResolved && (
              <>
                <button onClick={() => setShowRedirectModal(true)} className="btn btn-sm btn-secondary">Redirect</button>
                <button onClick={() => setShowHandoffModal(true)} className="btn btn-sm btn-secondary">Hand Off</button>
              </>
            )}
            {request.is_archived ? (
              <button onClick={handleRestore} disabled={saving} className="btn btn-sm" style={{ background: "#10b981", color: "#fff" }}>
                {saving ? "Restoring..." : "Restore"}
              </button>
            ) : (
              <button onClick={() => setShowArchiveModal(true)} className="btn btn-sm" style={{ background: "#6b7280", color: "#fff" }}>Archive</button>
            )}
          </div>
        </div>

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
                <a href={`/places/${request.place_id}`} style={{ fontWeight: 600, fontSize: "1.1rem", color: "var(--foreground)", textDecoration: "none" }}>
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
          <div style={{ marginTop: "1rem", padding: "0.5rem 0.75rem", background: "rgba(255, 193, 7, 0.15)", border: "1px solid #ffc107", borderRadius: "4px", fontSize: "0.85rem" }}>
            <span style={{ fontWeight: 500, color: "#856404" }}>⚠️ Safety: </span>
            {request.place_safety_concerns?.join(", ").replace(/_/g, " ")}
            {request.place_safety_notes && ` - ${request.place_safety_notes}`}
          </div>
        )}

        {/* Urgency/Emergency banner */}
        {(request.urgency_reasons?.length || request.is_emergency || request.has_medical_concerns) && (
          <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px" }}>
            <div style={{ fontWeight: 600, color: "#991b1b", marginBottom: "0.25rem" }}>
              {request.is_emergency ? "🚨 EMERGENCY" : "⚠️ URGENT"}
            </div>
            {request.urgency_reasons?.length && <div style={{ fontSize: "0.9rem", color: "#7f1d1d" }}>{request.urgency_reasons.map(r => r.replace(/_/g, " ")).join(" • ")}</div>}
            {request.has_medical_concerns && request.medical_description && <div style={{ fontSize: "0.9rem", color: "#7f1d1d", marginTop: "0.25rem" }}>Medical: {request.medical_description}</div>}
            {request.urgency_deadline && <div style={{ fontSize: "0.85rem", color: "#9a3412", marginTop: "0.25rem" }}>Deadline: {new Date(request.urgency_deadline).toLocaleDateString()}</div>}
          </div>
        )}
      </div>

      {/* Show history panel if open */}
      {showHistory && (
        <div className="card" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Edit History</h3>
          <EditHistory entityType="request" entityId={requestId} limit={20} />
        </div>
      )}

      {/* Two Column Layout for Main Content */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem" }}>
        {/* ═══════════════════════════════════════════════════════════════════════
            LEFT COLUMN - Main Case Information
            ═══════════════════════════════════════════════════════════════════════ */}
        <div>
          {/* ─────────────────────────────────────────────────────────────────────
              CASE SUMMARY
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title="Case Summary" icon="📋" color="#3b82f6">
            {request.notes ? (
              <div style={{ whiteSpace: "pre-wrap", fontSize: "0.95rem", lineHeight: 1.5 }}>{request.notes}</div>
            ) : (
              <p style={{ color: "var(--muted)", fontStyle: "italic" }}>No case notes yet. Click Edit to add details.</p>
            )}
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              COLONY ASSESSMENT - Structured intake fields (SmartField hides zeros)
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title="Colony Assessment" icon="🐱" color="#f59e0b">
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1rem", margin: 0 }}>
              <SmartField label="Adult Cats" value={request.estimated_cat_count} hint="needing TNR" showWhen="always" legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Eartipped" value={request.eartip_count} showWhen="nonzero" legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Peak Observed" value={request.peak_count} showWhen="nonzero" legacyMode={isLegacySource(request.source_system)} />
              <YesNoSmartField label="Has Kittens" value={request.has_kittens} legacyMode={isLegacySource(request.source_system)} />
              {request.has_kittens && <SmartField label="Kitten Count" value={request.kitten_count} showWhen="nonzero" />}
              <SmartField label="Handleability" value={request.handleability?.replace(/_/g, " ") || (request.cats_are_friendly === true ? "Friendly" : request.cats_are_friendly === false ? "Not Friendly" : null)} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Colony Duration" value={request.colony_duration?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="County" value={request.county} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Count Confidence" value={request.count_confidence?.replace(/_/g, " ")} legacyMode={isLegacySource(request.source_system)} />
            </dl>
            {request.location_description && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--muted-bg)", borderRadius: "6px", fontSize: "0.9rem" }}>
                <strong>Location Notes:</strong> {request.location_description}
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
              <SmartField label="Best Times Seen" value={request.best_times_seen} legacyMode={isLegacySource(request.source_system)} />
              <SmartField label="Best Trapping Time" value={request.best_trapping_time} legacyMode={isLegacySource(request.source_system)} />
            </dl>
            {request.access_notes && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#f0fdf4", borderRadius: "6px", fontSize: "0.9rem", borderLeft: "3px solid #166534" }}>
                <strong>Access Notes:</strong> {request.access_notes}
              </div>
            )}
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              FEEDING INFORMATION (only shows details if being fed)
              ───────────────────────────────────────────────────────────────────── */}
          {(request.is_being_fed || request.feeder_name || request.feeding_schedule || isLegacySource(request.source_system)) && (
            <CaseSection title="Feeding Information" icon="🍽️" color="#6366f1">
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1rem", margin: 0 }}>
                <YesNoSmartField label="Being Fed" value={request.is_being_fed} showWhen="defined" legacyMode={isLegacySource(request.source_system)} />
                {(request.is_being_fed || isLegacySource(request.source_system)) && (
                  <>
                    <SmartField label="Feeder" value={request.feeder_name} legacyMode={isLegacySource(request.source_system)} />
                    <SmartField label="Schedule" value={request.feeding_schedule} legacyMode={isLegacySource(request.source_system)} />
                    <SmartField label="Location" value={request.feeding_location} legacyMode={isLegacySource(request.source_system)} />
                  </>
                )}
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
              LINKED CATS
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title={`Linked Cats${request.linked_cat_count ? ` (${request.linked_cat_count})` : ""}`} icon="😺" color="#8b5cf6" collapsed={sectionsCollapsed.cats} onToggle={() => toggleSection("cats")}>
            <LinkedCatsSection cats={request.cats} context="request" emptyMessage="No cats linked yet" showCount={false} title="" />
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              PHOTOS & MEDIA
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title="Photos & Media" icon="📷" color="#64748b" collapsed={sectionsCollapsed.photos} onToggle={() => toggleSection("photos")}>
            <MediaGallery entityType="request" entityId={requestId} allowUpload={true} includeRelated={true} showCatDescription={true} defaultMediaType="cat_photo" allowedMediaTypes={["cat_photo", "site_photo", "evidence"]} />
          </CaseSection>

          {/* ─────────────────────────────────────────────────────────────────────
              ACTIVITY / JOURNAL
              ───────────────────────────────────────────────────────────────────── */}
          <CaseSection title={`Activity (${journalEntries.length})`} icon="📝" color="#0ea5e9" collapsed={sectionsCollapsed.activity} onToggle={() => toggleSection("activity")}>
            <JournalSection entityType="request" entityId={requestId} entries={journalEntries} onEntryAdded={() => { refreshRequest(); fetchJournalEntries(); }} />
          </CaseSection>
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

          {/* Admin Section (Collapsed) */}
          <CaseSection title="Admin" icon="⚙️" color="#64748b" collapsed={sectionsCollapsed.admin} onToggle={() => toggleSection("admin")}>
            {request.place_coordinates && <NearbyEntities requestId={requestId} />}
            {request.source_system?.startsWith("airtable") && (
              <button onClick={() => setShowUpgradeWizard(true)} className="btn btn-secondary" style={{ width: "100%", marginTop: "1rem" }}>
                Upgrade Legacy Data
              </button>
            )}
          </CaseSection>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODALS
          ═══════════════════════════════════════════════════════════════════════ */}
      {showObservationModal && (
        <LogSiteVisitModal
          requestId={requestId}
          placeId={request.place_id || undefined}
          placeName={request.place_name || undefined}
          onClose={() => setShowObservationModal(false)}
          onSuccess={() => { setShowObservationModal(false); refreshRequest(); fetchJournalEntries(); }}
        />
      )}
      {showCompleteModal && (
        <CompleteRequestModal
          requestId={requestId}
          targetStatus={completionTargetStatus}
          currentCatsTrapped={request.cats_trapped}
          currentCatsReturned={request.cats_returned}
          onClose={() => setShowCompleteModal(false)}
          onComplete={() => { setShowCompleteModal(false); refreshRequest(); }}
        />
      )}
      {showHoldModal && (
        <HoldRequestModal
          requestId={requestId}
          currentReason={request.hold_reason}
          currentNotes={request.hold_reason_notes}
          onClose={() => setShowHoldModal(false)}
          onHold={() => { setShowHoldModal(false); refreshRequest(); }}
        />
      )}
      {showRedirectModal && (
        <RedirectRequestModal
          requestId={requestId}
          onClose={() => setShowRedirectModal(false)}
          onRedirect={() => { setShowRedirectModal(false); refreshRequest(); }}
        />
      )}
      {showHandoffModal && (
        <HandoffRequestModal
          requestId={requestId}
          onClose={() => setShowHandoffModal(false)}
          onHandoff={() => { setShowHandoffModal(false); refreshRequest(); }}
        />
      )}
      {showEmailModal && request.requester_email && (
        <SendEmailModal
          requestId={requestId}
          recipientEmail={request.requester_email}
          recipientName={request.requester_name || undefined}
          requestSummary={request.summary || request.place_name || undefined}
          onClose={() => setShowEmailModal(false)}
          onSent={() => { setShowEmailModal(false); refreshRequest(); }}
        />
      )}
      {showColonyModal && request.place_id && (
        <CreateColonyModal
          placeId={request.place_id}
          placeName={request.place_name || undefined}
          initialEstimate={request.estimated_cat_count || undefined}
          onClose={() => setShowColonyModal(false)}
          onCreated={() => { setShowColonyModal(false); refreshRequest(); }}
        />
      )}
      {showUpgradeWizard && (
        <LegacyUpgradeWizard
          requestId={requestId}
          onClose={() => setShowUpgradeWizard(false)}
          onUpgrade={() => { setShowUpgradeWizard(false); refreshRequest(); }}
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
    </div>
  );
}
