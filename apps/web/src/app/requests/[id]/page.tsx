"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { BackButton } from "@/components/BackButton";
import { EditHistory } from "@/components/EditHistory";
import { LegacyUpgradeWizard } from "@/components/LegacyUpgradeWizard";
import { JournalEntry } from "@/components/JournalSection";
import LogSiteVisitModal from "@/components/LogSiteVisitModal";
import CompleteRequestModal from "@/components/CompleteRequestModal";
import HoldRequestModal from "@/components/HoldRequestModal";
import { RedirectRequestModal } from "@/components/RedirectRequestModal";
import { HandoffRequestModal } from "@/components/HandoffRequestModal";
import { SendEmailModal } from "@/components/SendEmailModal";
import { CreateColonyModal } from "@/components/CreateColonyModal";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { ProfileLayout } from "@/components/ProfileLayout";
import { CaseSummaryTab } from "./tabs/CaseSummaryTab";
import { DetailsTab } from "./tabs/DetailsTab";
import { CatsEvidenceTab } from "./tabs/CatsEvidenceTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { NearbyTab } from "./tabs/NearbyTab";
import { LegacyTab } from "./tabs/LegacyTab";
import type { RequestDetail } from "./types";

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "triaged", label: "Triaged" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "on_hold", label: "On Hold" },
  { value: "redirected", label: "Redirected" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];


function LegacyBadge() {
  return (
    <span
      className="badge"
      style={{
        background: "#e9ecef",
        color: "#495057",
        fontSize: "0.75rem",
        padding: "0.25rem 0.5rem",
        border: "1px solid #ced4da",
      }}
      title="This request was imported from Airtable"
    >
      Legacy (Airtable)
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

  // Track previous status for undo functionality
  const [previousStatus, setPreviousStatus] = useState<string | null>(null);

  // Rename state (quick inline rename)
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
  });

  // Observation modal state
  const [showObservationModal, setShowObservationModal] = useState(false);
  const [pendingCompletion, setPendingCompletion] = useState(false); // Track if we're completing after observation
  const [showRedirectModal, setShowRedirectModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionTargetStatus, setCompletionTargetStatus] = useState<"completed" | "cancelled">("completed");
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showColonyModal, setShowColonyModal] = useState(false);

  // Session/Staff info for auto-fill (used by modals; JournalSection self-resolves)
  const { user: currentUser } = useCurrentUser();
  const currentStaffId = currentUser?.staff_id || null;
  const currentStaffName = currentUser?.display_name || null;

  // Kitten assessment state
  const [editingKittens, setEditingKittens] = useState(false);
  const [savingKittens, setSavingKittens] = useState(false);
  const [kittenForm, setKittenForm] = useState({
    kitten_count: "" as number | "",
    kitten_age_weeks: "" as number | "",
    kitten_assessment_status: "",
    kitten_assessment_outcome: "",
    kitten_foster_readiness: "",
    kitten_urgency_factors: [] as string[],
    kitten_assessment_notes: "",
    not_assessing_reason: "",
  });

  // Edit history panel
  const [showHistory, setShowHistory] = useState(false);

  // Journal entries
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);

  // Legacy upgrade wizard
  const [showUpgradeWizard, setShowUpgradeWizard] = useState(false);

  // Nearby tab badge count
  const [nearbyCounts, setNearbyCounts] = useState<{ requests: number; places: number; people: number; cats: number } | null>(null);

  // Map state
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapNearbyCount, setMapNearbyCount] = useState<number>(0);

  // Ready to Email state (MIG_605)
  const [editingEmailSummary, setEditingEmailSummary] = useState(false);
  const [emailSummaryDraft, setEmailSummaryDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const fetchJournalEntries = useCallback(async () => {
    try {
      const response = await fetch(`/api/journal?request_id=${requestId}&include_related=true`);
      if (response.ok) {
        const data = await response.json();
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
          if (response.status === 404) {
            setError("Request not found");
          } else {
            setError("Failed to load request");
          }
          return;
        }
        const data = await response.json();
        setRequest(data);
        // Initialize edit form
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
        });
        // Initialize kitten form
        setKittenForm({
          kitten_count: data.kitten_count ?? "",
          kitten_age_weeks: data.kitten_age_weeks ?? "",
          kitten_assessment_status: data.kitten_assessment_status || "",
          kitten_assessment_outcome: data.kitten_assessment_outcome || "",
          kitten_foster_readiness: data.kitten_foster_readiness || "",
          kitten_urgency_factors: data.kitten_urgency_factors || [],
          kitten_assessment_notes: data.kitten_assessment_notes || "",
          not_assessing_reason: data.not_assessing_reason || "",
        });
      } catch (err) {
        setError("Failed to load request");
      } finally {
        setLoading(false);
      }
    };

    fetchRequest();
    fetchJournalEntries();
  }, [requestId, fetchJournalEntries]);

  // Lightweight refresh: updates request data (badges, trapper info) without resetting form state
  const refreshRequest = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${requestId}`);
      if (response.ok) {
        const data = await response.json();
        setRequest(data);
      }
    } catch {
      // silent — this is a background refresh
    }
  }, [requestId]);

  // Staff info now comes from useCurrentUser() hook (cached, shared across components)

  // Fetch map when request has coordinates
  useEffect(() => {
    const fetchMap = async () => {
      if (!request?.place_coordinates) return;
      try {
        const response = await fetch(`/api/requests/${requestId}/map?width=600&height=300&zoom=15&scale=2`);
        if (response.ok) {
          const data = await response.json();
          setMapUrl(data.map_url);
          setMapNearbyCount(data.nearby_count || 0);
        }
      } catch (err) {
        console.error("Failed to fetch map:", err);
      }
    };
    fetchMap();
  }, [requestId, request?.place_coordinates]);

  // Pre-fetch nearby counts for tab label
  useEffect(() => {
    const fetchNearbyCounts = async () => {
      if (!request?.place_coordinates) return;
      try {
        const response = await fetch(`/api/requests/${requestId}/nearby?radius=5000`);
        if (response.ok) {
          const data = await response.json();
          if (data.summary) {
            setNearbyCounts({
              requests: data.summary.total_requests,
              places: data.summary.total_places,
              people: data.summary.total_people,
              cats: data.summary.total_cats,
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch nearby counts:", err);
      }
    };
    fetchNearbyCounts();
  }, [requestId, request?.place_coordinates]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editForm.status,
          priority: editForm.priority,
          summary: editForm.summary || null,
          notes: editForm.notes || null,
          estimated_cat_count: editForm.estimated_cat_count || null,
          kitten_count: editForm.kitten_count || null,
          has_kittens: editForm.has_kittens,
          cats_are_friendly: editForm.cats_are_friendly,
          assigned_to: editForm.assigned_to || null,
          scheduled_date: editForm.scheduled_date || null,
          scheduled_time_range: editForm.scheduled_time_range || null,
          resolution_notes: editForm.resolution_notes || null,
          cats_trapped: editForm.cats_trapped || null,
          cats_returned: editForm.cats_returned || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save changes");
        return;
      }

      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
      }

      setEditing(false);
    } catch (err) {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (request) {
      setEditForm({
        status: request.status,
        priority: request.priority,
        summary: request.summary || "",
        notes: request.notes || "",
        estimated_cat_count: request.estimated_cat_count ?? "",
        kitten_count: request.kitten_count ?? "",
        has_kittens: request.has_kittens,
        cats_are_friendly: request.cats_are_friendly,
        assigned_to: request.assigned_to || "",
        scheduled_date: request.scheduled_date || "",
        scheduled_time_range: request.scheduled_time_range || "",
        resolution_notes: request.resolution_notes || "",
        cats_trapped: request.cats_trapped ?? "",
        cats_returned: request.cats_returned ?? "",
      });
    }
    setEditing(false);
  };

  const handleRename = async () => {
    if (!renameValue.trim()) {
      setRenaming(false);
      return;
    }

    setSavingRename(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: renameValue.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to rename request");
        return;
      }

      // Update local state
      if (request) {
        setRequest({ ...request, summary: renameValue.trim() });
      }
      setRenaming(false);
    } catch (err) {
      setError("Failed to rename request");
    } finally {
      setSavingRename(false);
    }
  };

  const startRename = () => {
    setRenameValue(request?.summary || request?.place_name || "");
    setRenaming(true);
  };

  const handleSaveKittens = async () => {
    setSavingKittens(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kitten_count: kittenForm.kitten_count || null,
          kitten_age_weeks: kittenForm.kitten_age_weeks || null,
          kitten_assessment_status: kittenForm.kitten_assessment_status || null,
          kitten_assessment_outcome: kittenForm.kitten_assessment_outcome || null,
          kitten_foster_readiness: kittenForm.kitten_foster_readiness || null,
          kitten_urgency_factors: kittenForm.kitten_urgency_factors.length > 0 ? kittenForm.kitten_urgency_factors : null,
          kitten_assessment_notes: kittenForm.kitten_assessment_notes || null,
          not_assessing_reason: kittenForm.kitten_assessment_status === "not_assessing" ? kittenForm.not_assessing_reason || null : null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save kitten assessment");
        return;
      }

      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
      }

      setEditingKittens(false);
    } catch (err) {
      setError("Failed to save kitten assessment");
    } finally {
      setSavingKittens(false);
    }
  };

  const handleCancelKittens = () => {
    if (request) {
      setKittenForm({
        kitten_count: request.kitten_count ?? "",
        kitten_age_weeks: request.kitten_age_weeks ?? "",
        kitten_assessment_status: request.kitten_assessment_status || "",
        kitten_assessment_outcome: request.kitten_assessment_outcome || "",
        kitten_foster_readiness: request.kitten_foster_readiness || "",
        kitten_urgency_factors: request.kitten_urgency_factors || [],
        kitten_assessment_notes: request.kitten_assessment_notes || "",
        not_assessing_reason: request.not_assessing_reason || "",
      });
    }
    setEditingKittens(false);
  };

  const toggleUrgencyFactor = (factor: string) => {
    setKittenForm(prev => ({
      ...prev,
      kitten_urgency_factors: prev.kitten_urgency_factors.includes(factor)
        ? prev.kitten_urgency_factors.filter(f => f !== factor)
        : [...prev.kitten_urgency_factors, factor]
    }));
  };

  // Ready-to-Email handlers (MIG_605)
  const handleToggleReadyToEmail = async () => {
    if (!request) return;
    setSavingEmail(true);
    setError(null);

    const newValue = !request.ready_to_email;

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ready_to_email: newValue,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to update ready to email");
        return;
      }

      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
      }
    } catch {
      setError("Failed to update ready to email");
    } finally {
      setSavingEmail(false);
    }
  };

  const handleStartEditEmailSummary = () => {
    setEmailSummaryDraft(request?.email_summary || "");
    setEditingEmailSummary(true);
  };

  const handleSaveEmailSummary = async () => {
    setSavingEmail(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_summary: emailSummaryDraft,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save email summary");
        return;
      }

      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
      }

      setEditingEmailSummary(false);
    } catch {
      setError("Failed to save email summary");
    } finally {
      setSavingEmail(false);
    }
  };

  const handleCancelEmailSummary = () => {
    setEmailSummaryDraft(request?.email_summary || "");
    setEditingEmailSummary(false);
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
        <div className="empty" style={{ marginTop: "2rem" }}>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!request) return null;

  const isResolved = request.status === "completed" || request.status === "cancelled";

  // Quick status change handler (without entering edit mode)
  const handleQuickStatusChange = async (newStatus: string) => {
    if (!request) return;

    // For completed or cancelled, show the CompleteRequestModal
    if (newStatus === "completed" || newStatus === "cancelled") {
      setCompletionTargetStatus(newStatus as "completed" | "cancelled");
      setShowCompleteModal(true);
      return;
    }

    // For on_hold, show the HoldRequestModal
    if (newStatus === "on_hold") {
      setShowHoldModal(true);
      return;
    }

    await executeStatusChange(newStatus);
  };

  // Actually perform the status change (called directly or after observation)
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
      // Track previous status for undo
      setPreviousStatus(oldStatus);
      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
        setEditForm(prev => ({ ...prev, status: data.status }));
      }
    } catch (err) {
      setError("Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  // Handle observation modal close (either after logging or skipping)
  const handleObservationModalClose = () => {
    setShowObservationModal(false);
    if (pendingCompletion) {
      // Proceed with completing the request
      executeStatusChange("completed");
      setPendingCompletion(false);
    }
  };

  // Undo status change
  const handleUndoStatusChange = async () => {
    if (!previousStatus) return;
    await handleQuickStatusChange(previousStatus);
    setPreviousStatus(null); // Clear after undo
  };

  // Get next logical status options based on current status
  const getQuickStatusOptions = () => {
    switch (request.status) {
      case "new":
        return [
          { value: "triaged", label: "Triage", color: "#6610f2" },
          { value: "scheduled", label: "Schedule", color: "#198754" },
          { value: "cancelled", label: "Cancel", color: "#6c757d" },
        ];
      case "triaged":
        return [
          { value: "scheduled", label: "Schedule", color: "#198754" },
          { value: "in_progress", label: "Start", color: "#fd7e14" },
          { value: "on_hold", label: "Hold", color: "#ffc107" },
        ];
      case "scheduled":
        return [
          { value: "in_progress", label: "Start", color: "#fd7e14" },
          { value: "on_hold", label: "Hold", color: "#ffc107" },
          { value: "completed", label: "Complete", color: "#20c997" },
        ];
      case "in_progress":
        return [
          { value: "completed", label: "Complete", color: "#20c997" },
          { value: "on_hold", label: "Hold", color: "#ffc107" },
          { value: "partial", label: "Partial", color: "#17a2b8" },
        ];
      case "on_hold":
        return [
          { value: "triaged", label: "Resume", color: "#6610f2" },
          { value: "in_progress", label: "Start", color: "#fd7e14" },
          { value: "cancelled", label: "Cancel", color: "#6c757d" },
        ];
      case "completed":
      case "cancelled":
        return [
          { value: "new", label: "Reopen", color: "#0d6efd" },
        ];
      default:
        return [];
    }
  };

  return (
    <div>
      <BackButton fallbackHref="/requests" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {renaming ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  autoFocus
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    padding: "0.25rem 0.5rem",
                    border: "2px solid var(--primary, #0d6efd)",
                    borderRadius: "4px",
                    width: "300px",
                  }}
                  placeholder="Request name..."
                />
                <button
                  onClick={handleRename}
                  disabled={savingRename}
                  style={{
                    padding: "0.35rem 0.75rem",
                    background: "var(--primary, #0d6efd)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: savingRename ? "not-allowed" : "pointer",
                  }}
                >
                  {savingRename ? "..." : "Save"}
                </button>
                <button
                  onClick={() => setRenaming(false)}
                  style={{
                    padding: "0.35rem 0.75rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <h1 style={{ margin: 0 }}>
                  {request.summary || request.place_name || "FFR Request"}
                </h1>
                {!editing && (
                  <button
                    onClick={startRename}
                    title="Rename request"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "0.25rem",
                      fontSize: "0.9rem",
                      color: "var(--muted, #6c757d)",
                      opacity: 0.7,
                    }}
                  >
                    ✏️
                  </button>
                )}
              </>
            )}
            {request.source_system?.startsWith("airtable") && <LegacyBadge />}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
            <StatusBadge status={request.status} size="lg" />
            <PriorityBadge priority={request.priority} />
            {request.hold_reason && (
              <span className="badge" style={{ background: "#ffc107", color: "#000" }}>
                Hold: {request.hold_reason.replace(/_/g, " ")}
              </span>
            )}
          </div>
          {/* Quick Actions - always visible without edit mode */}
          {!editing && (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)", marginRight: "0.25rem" }}>Quick:</span>
              {getQuickStatusOptions().map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleQuickStatusChange(opt.value)}
                  disabled={saving}
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.85rem",
                    background: opt.color,
                    color: ["#ffc107", "#20c997", "#fd7e14"].includes(opt.color) ? "#000" : "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {opt.label}
                </button>
              ))}
              {/* Undo button - shows when there's a previous status to revert to */}
              {previousStatus && previousStatus !== request.status && (
                <button
                  onClick={handleUndoStatusChange}
                  disabled={saving}
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.85rem",
                    background: "transparent",
                    color: "#6c757d",
                    border: "1px dashed #6c757d",
                    borderRadius: "4px",
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.6 : 1,
                    marginLeft: "0.5rem",
                  }}
                  title={`Undo: revert to "${previousStatus.replace(/_/g, " ")}"`}
                >
                  ↩ Undo
                </button>
              )}
            </div>
          )}
        </div>
        {!editing && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <a
              href={`/requests/${request.request_id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                color: "inherit",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Print
            </a>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                padding: "0.5rem 1rem",
                background: showHistory ? "var(--primary)" : "transparent",
                color: showHistory ? "white" : "inherit",
                border: showHistory ? "none" : "1px solid var(--border)",
              }}
            >
              History
            </button>
            <button onClick={() => setEditing(true)} style={{ padding: "0.5rem 1rem" }}>
              Edit
            </button>
            {request.status !== "redirected" && request.status !== "handed_off" && request.status !== "completed" && request.status !== "cancelled" && (
              <>
                <button
                  onClick={() => setShowRedirectModal(true)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "transparent",
                    color: "#6f42c1",
                    border: "1px solid #6f42c1",
                  }}
                  title="Redirect this request to a new address/contact"
                >
                  Redirect
                </button>
                <button
                  onClick={() => setShowHandoffModal(true)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "transparent",
                    color: "#0d9488",
                    border: "1px solid #0d9488",
                  }}
                  title="Hand off to a new caretaker at a different location"
                >
                  Hand Off
                </button>
              </>
            )}
            {request.place_id && (
              <button
                onClick={() => setShowColonyModal(true)}
                style={{
                  padding: "0.5rem 1rem",
                  background: "transparent",
                  color: "#059669",
                  border: "1px solid #059669",
                }}
                title="Create a colony from this request location"
              >
                Create Colony
              </button>
            )}
          </div>
        )}
      </div>

      {/* Redirect/Handoff Banners */}
      {request.redirected_to_request_id && request.transfer_type === 'handoff' && (
        <div
          style={{
            padding: "12px 16px",
            background: "#d1fae5",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>🤝</span>
          <div>
            <strong style={{ color: "#065f46" }}>This request was handed off</strong>
            <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "#047857" }}>
              {request.redirect_reason && <span>{request.redirect_reason}. </span>}
              <a href={`/requests/${request.redirected_to_request_id}`} style={{ color: "#0d9488", fontWeight: 500 }}>
                View the new caretaker&apos;s request →
              </a>
            </p>
          </div>
        </div>
      )}

      {request.redirected_to_request_id && request.transfer_type !== 'handoff' && (
        <div
          style={{
            padding: "12px 16px",
            background: "#e8daff",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>↪️</span>
          <div>
            <strong>This request was redirected</strong>
            <p style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
              {request.redirect_reason && <span>{request.redirect_reason}. </span>}
              <a href={`/requests/${request.redirected_to_request_id}`} style={{ color: "#6f42c1", fontWeight: 500 }}>
                View the new request →
              </a>
            </p>
          </div>
        </div>
      )}

      {request.redirected_from_request_id && request.transfer_type === 'handoff' && (
        <div
          style={{
            padding: "12px 16px",
            background: "#ccfbf1",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>🔄</span>
          <div>
            <strong style={{ color: "#0f766e" }}>Continuation from previous caretaker</strong>
            <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "#115e59" }}>
              <a href={`/requests/${request.redirected_from_request_id}`} style={{ color: "#0d9488" }}>
                ← View the original request
              </a>
            </p>
          </div>
        </div>
      )}

      {request.redirected_from_request_id && request.transfer_type !== 'handoff' && (
        <div
          style={{
            padding: "12px 16px",
            background: "#f0f0f0",
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>↩️</span>
          <div>
            <strong>This request was created from a redirect</strong>
            <p style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
              <a href={`/requests/${request.redirected_from_request_id}`} style={{ color: "#6f42c1" }}>
                ← View the original request
              </a>
            </p>
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "#dc3545", marginBottom: "1rem", padding: "0.75rem", background: "#f8d7da", borderRadius: "6px" }}>
          {error}
        </div>
      )}




      {editing ? (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Edit Request</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Status
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  style={{ width: "100%" }}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Priority
                </label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                  style={{ width: "100%" }}
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Request Title
              </label>
              <input
                type="text"
                value={editForm.summary}
                onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                placeholder="e.g., '5 cats at Oak Street colony'"
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 150px" }}>
                <label
                  style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}
                  title="Adult cats still needing spay/neuter at this location (not kittens, not total colony)"
                >
                  Adult Cats Needing TNR
                </label>
                <input
                  type="number"
                  min="0"
                  value={editForm.estimated_cat_count}
                  onChange={(e) => setEditForm({ ...editForm, estimated_cat_count: e.target.value ? parseInt(e.target.value) : "" })}
                  style={{ width: "100%" }}
                />
                <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "4px" }}>
                  Adults only - kittens tracked separately
                </div>
              </div>

              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Kittens
                </label>
                <input
                  type="number"
                  min="0"
                  value={editForm.kitten_count}
                  onChange={(e) => {
                    const count = e.target.value ? parseInt(e.target.value) : "";
                    setEditForm({
                      ...editForm,
                      kitten_count: count,
                      has_kittens: count !== "" && count > 0 ? true : editForm.has_kittens
                    });
                  }}
                  style={{ width: "100%" }}
                />
                <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "4px" }}>
                  Under 8 weeks
                </div>
              </div>

              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Assigned To
                </label>
                <input
                  type="text"
                  value={editForm.assigned_to}
                  onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editForm.has_kittens}
                  onChange={(e) => setEditForm({ ...editForm, has_kittens: e.target.checked })}
                />
                Has kittens
              </label>

              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <span>Cats friendly?</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === true}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: true })}
                  />
                  Yes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === false}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: false })}
                  />
                  No
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === null}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: null })}
                  />
                  Unknown
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Scheduled Date
                </label>
                <input
                  type="date"
                  value={editForm.scheduled_date}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_date: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Time Range
                </label>
                <input
                  type="text"
                  value={editForm.scheduled_time_range}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_time_range: e.target.value })}
                  placeholder="e.g., morning, 9am-12pm"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Notes
              </label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={4}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            {(editForm.status === "completed" || editForm.status === "cancelled") && (
              <>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Resolution Notes
                  </label>
                  <textarea
                    value={editForm.resolution_notes}
                    onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })}
                    rows={3}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Cats Trapped
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.cats_trapped}
                      onChange={(e) => setEditForm({ ...editForm, cats_trapped: e.target.value ? parseInt(e.target.value) : "" })}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Cats Returned
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.cats_returned}
                      onChange={(e) => setEditForm({ ...editForm, cats_returned: e.target.value ? parseInt(e.target.value) : "" })}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "inherit" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <ProfileLayout
          header={null}
          tabs={[
            {
              id: "summary",
              label: "Case Summary",
              content: (
                <CaseSummaryTab
                  request={request}
                  requestId={requestId}
                  mapUrl={mapUrl}
                  mapNearbyCount={mapNearbyCount}
                  onLogSiteVisit={() => setShowObservationModal(true)}
                  onShowEmail={() => setShowEmailModal(true)}
                  editingEmailSummary={editingEmailSummary}
                  emailSummaryDraft={emailSummaryDraft}
                  savingEmail={savingEmail}
                  onToggleReadyToEmail={handleToggleReadyToEmail}
                  onStartEditEmailSummary={() => {
                    setEmailSummaryDraft(request.email_summary || "");
                    setEditingEmailSummary(true);
                  }}
                  onSaveEmailSummary={handleSaveEmailSummary}
                  onCancelEmailSummary={handleCancelEmailSummary}
                  onEmailSummaryChange={setEmailSummaryDraft}
                  onAssignmentChange={refreshRequest}
                />
              ),
            },
            {
              id: "details",
              label: "Details",
              content: (
                <DetailsTab
                  request={request}
                  requestId={requestId}
                  editingKittens={editingKittens}
                  savingKittens={savingKittens}
                  kittenForm={kittenForm}
                  onStartEditKittens={() => setEditingKittens(true)}
                  onSaveKittens={handleSaveKittens}
                  onCancelKittens={handleCancelKittens}
                  onKittenFormChange={setKittenForm}
                  onToggleUrgencyFactor={toggleUrgencyFactor}
                  onShowUpgradeWizard={() => setShowUpgradeWizard(true)}
                />
              ),
            },
            {
              id: "cats",
              label: `Cats & Evidence${request.linked_cat_count ? ` (${request.linked_cat_count})` : ""}`,
              content: (
                <CatsEvidenceTab
                  requestId={requestId}
                  cats={request.cats}
                />
              ),
            },
            {
              id: "activity",
              label: `Activity${journalEntries.length ? ` (${journalEntries.length})` : ""}`,
              content: (
                <ActivityTab
                  requestId={requestId}
                  journalEntries={journalEntries}
                  onEntryAdded={() => {
                    fetch(`/api/requests/${requestId}`)
                      .then((r) => r.ok ? r.json() : null)
                      .then((d) => { if (d) setRequest(d); });
                    fetch(`/api/journal?request_id=${requestId}&include_related=true`)
                      .then((r) => r.ok ? r.json() : null)
                      .then((d) => { if (d) setJournalEntries(d.entries || []); });
                  }}
                />
              ),
            },
            {
              id: "actions",
              label: "Actions",
              content: (
                <EditHistory
                  entityType="request"
                  entityId={requestId}
                  limit={100}
                />
              ),
            },
            {
              id: "nearby",
              label: `Nearby${nearbyCounts ? ` (${nearbyCounts.requests + nearbyCounts.places + nearbyCounts.people + nearbyCounts.cats})` : ""}`,
              show: !!request.place_coordinates,
              content: (
                <NearbyTab
                  requestId={requestId}
                  onCountsLoaded={setNearbyCounts}
                />
              ),
            },
            {
              id: "legacy",
              label: "Legacy Info (Airtable)",
              show: !!request.source_system?.startsWith("airtable"),
              content: (
                <LegacyTab
                  request={request}
                  onShowUpgradeWizard={() => setShowUpgradeWizard(true)}
                  onSwitchToDetails={() => {/* ProfileLayout handles tab switching via URL */}}
                />
              ),
            },
          ]}
          defaultTab="summary"
        />
      )}


      {/* Edit History Panel */}
      {showHistory && (
        <div style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "400px",
          background: "var(--card-bg)",
          borderLeft: "1px solid var(--border)",
          padding: "1.5rem",
          overflowY: "auto",
          zIndex: 100,
          boxShadow: "-4px 0 10px rgba(0,0,0,0.2)"
        }}>
          <EditHistory
            entityType="request"
            entityId={requestId}
            limit={50}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}

      {/* Legacy Upgrade Wizard */}
      {showUpgradeWizard && request && (
        <LegacyUpgradeWizard
          request={{
            request_id: request.request_id,
            summary: request.summary,
            place_name: request.place_name,
            requester_name: request.requester_name,
            estimated_cat_count: request.estimated_cat_count,
            has_kittens: request.has_kittens,
          }}
          onComplete={(newRequestId) => {
            setShowUpgradeWizard(false);
            // Navigate to the new request
            router.push(`/requests/${newRequestId}`);
          }}
          onCancel={() => setShowUpgradeWizard(false)}
        />
      )}

      {/* Site Observation Modal */}
      {request?.place_id && (
        <LogSiteVisitModal
          isOpen={showObservationModal}
          onClose={handleObservationModalClose}
          placeId={request.place_id}
          placeName={request.place_name || request.place_address || 'This location'}
          requestId={request.request_id}
          staffId={currentStaffId || undefined}
          staffName={currentStaffName || undefined}
          isCompletionFlow={pendingCompletion}
          onSkip={pendingCompletion ? handleObservationModalClose : undefined}
        />
      )}

      {/* Complete Request Modal */}
      <CompleteRequestModal
        isOpen={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        requestId={request.request_id}
        placeId={request.place_id || undefined}
        placeName={request.place_name || request.place_address || undefined}
        staffId={currentStaffId || undefined}
        staffName={currentStaffName || undefined}
        targetStatus={completionTargetStatus}
        onSuccess={() => {
          setShowCompleteModal(false);
          // Reload request data
          fetch(`/api/requests/${requestId}`)
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
              if (data) {
                setRequest(data);
                setEditForm(prev => ({ ...prev, status: data.status }));
              }
            });
        }}
      />

      {/* Hold Request Modal */}
      <HoldRequestModal
        isOpen={showHoldModal}
        onClose={() => setShowHoldModal(false)}
        requestId={request.request_id}
        staffName={currentStaffName || undefined}
        onSuccess={() => {
          setShowHoldModal(false);
          // Reload request data
          fetch(`/api/requests/${requestId}`)
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
              if (data) {
                setRequest(data);
                setEditForm(prev => ({ ...prev, status: data.status }));
              }
            });
        }}
      />

      {/* Redirect Request Modal */}
      <RedirectRequestModal
        isOpen={showRedirectModal}
        onClose={() => setShowRedirectModal(false)}
        requestId={request.request_id}
        originalSummary={request.summary || "FFR Request"}
        originalAddress={request.place_address || null}
        originalRequesterName={request.requester_name || null}
        onSuccess={(newRequestId) => {
          router.push(`/requests/${newRequestId}`);
        }}
      />

      {/* Handoff Request Modal */}
      <HandoffRequestModal
        isOpen={showHandoffModal}
        onClose={() => setShowHandoffModal(false)}
        requestId={request.request_id}
        originalSummary={request.summary || "FFR Request"}
        originalAddress={request.place_address || null}
        originalRequesterName={request.requester_name || null}
        onSuccess={(newRequestId) => {
          router.push(`/requests/${newRequestId}`);
        }}
      />

      {/* Email Requester Modal */}
      <SendEmailModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        defaultTo={request.requester_email || ""}
        defaultToName={request.requester_name || ""}
        personId={request.requester_person_id || undefined}
        requestId={request.request_id}
        placeholders={{
          first_name: request.requester_name?.split(" ")[0] || "",
          address: request.place_address || "",
        }}
      />

      {/* Create Colony Modal */}
      <CreateColonyModal
        isOpen={showColonyModal}
        onClose={() => setShowColonyModal(false)}
        requestId={request.request_id}
        placeId={request.place_id || undefined}
        staffName={undefined} // TODO: Get from session
        onSuccess={(result) => {
          setShowColonyModal(false);
          // Show success notification
          alert(`Colony "${result.colony_name}" created successfully!`);
          // Optionally navigate to colony page
          // router.push(`/colonies/${result.colony_id}`);
        }}
      />
    </div>
  );
}
