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
import { TwoColumnLayout, Section, StatsSidebar } from "@/components/layouts";
import { PropertyTypeBadge, PlaceKindBadge } from "@/components/badges";
import { LinkedCatsSection } from "@/components/LinkedCatsSection";
import { NearbyEntities } from "@/components/NearbyEntities";
import { MediaGallery } from "@/components/MediaGallery";
import { TrapperAssignments } from "@/components/TrapperAssignments";
import { ColonyEstimates } from "@/components/ColonyEstimates";
import { ClassificationSuggestionBanner } from "@/components/ClassificationSuggestionBanner";
import { formatPhone } from "@/lib/formatters";
import { DetailsTab } from "./tabs/DetailsTab";
import { ActivityTab } from "./tabs/ActivityTab";
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
      Legacy
    </span>
  );
}

// Tab component for the bottom section
function TabNav({
  tabs,
  activeTab,
  onTabChange
}: {
  tabs: { id: string; label: string; count?: number; show?: boolean }[];
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  const visibleTabs = tabs.filter(t => t.show !== false);

  return (
    <div style={{
      display: "flex",
      gap: "0.25rem",
      borderBottom: "1px solid var(--border)",
      marginBottom: "1rem",
    }}>
      {visibleTabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            padding: "0.75rem 1rem",
            background: activeTab === tab.id ? "var(--card-bg)" : "transparent",
            border: "none",
            borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
            color: activeTab === tab.id ? "var(--foreground)" : "var(--muted)",
            cursor: "pointer",
            fontWeight: activeTab === tab.id ? 600 : 400,
            fontSize: "0.9rem",
          }}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span style={{
              marginLeft: "0.5rem",
              padding: "0.1rem 0.4rem",
              background: "var(--muted-bg)",
              borderRadius: "10px",
              fontSize: "0.75rem",
            }}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
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

  // Modal states
  const [showObservationModal, setShowObservationModal] = useState(false);
  const [pendingCompletion, setPendingCompletion] = useState(false);
  const [showRedirectModal, setShowRedirectModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionTargetStatus, setCompletionTargetStatus] = useState<"completed" | "cancelled">("completed");
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showColonyModal, setShowColonyModal] = useState(false);

  // Session/Staff info
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

  // Tab state for bottom tabs
  const [activeTab, setActiveTab] = useState("details");

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

  const refreshRequest = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${requestId}`);
      if (response.ok) {
        const data = await response.json();
        setRequest(data);
      }
    } catch {
      // silent
    }
  }, [requestId]);

  // Fetch map when request has coordinates
  useEffect(() => {
    const fetchMap = async () => {
      if (!request?.place_coordinates) return;
      try {
        const response = await fetch(`/api/requests/${requestId}/map?width=400&height=200&zoom=15&scale=2`);
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

  // Pre-fetch nearby counts
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

  // Email handlers
  const handleToggleReadyToEmail = async () => {
    if (!request) return;
    setSavingEmail(true);
    setError(null);

    const newValue = !request.ready_to_email;

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready_to_email: newValue }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to update ready to email");
        return;
      }

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

  const handleSaveEmailSummary = async () => {
    setSavingEmail(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_summary: emailSummaryDraft }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save email summary");
        return;
      }

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

  // Quick status change handler
  const handleQuickStatusChange = async (newStatus: string) => {
    if (!request) return;

    if (newStatus === "completed" || newStatus === "cancelled") {
      setCompletionTargetStatus(newStatus as "completed" | "cancelled");
      setShowCompleteModal(true);
      return;
    }

    if (newStatus === "on_hold") {
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

  const handleObservationModalClose = () => {
    setShowObservationModal(false);
    if (pendingCompletion) {
      executeStatusChange("completed");
      setPendingCompletion(false);
    }
  };

  const handleUndoStatusChange = async () => {
    if (!previousStatus) return;
    await handleQuickStatusChange(previousStatus);
    setPreviousStatus(null);
  };

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

  // Build sidebar content
  const sidebarContent = (
    <div className="space-y-4">
      {/* Quick Stats */}
      <StatsSidebar
        stats={[
          {
            label: "Colony Size",
            value: request.colony_size_estimate ?? "Unknown",
            icon: "🐱",
          },
          {
            label: "Altered",
            value: request.colony_verified_altered ?? 0,
            icon: "✂️",
          },
          {
            label: "Remaining",
            value: request.colony_work_remaining ?? "Unknown",
            icon: "📋",
          },
          {
            label: "Coverage",
            value: request.colony_alteration_rate != null
              ? `${Math.round(request.colony_alteration_rate * 100)}%`
              : "N/A",
            icon: "📊",
          },
        ]}
        sections={[
          // Map preview section
          ...(request.place_coordinates && mapUrl ? [{
            title: "Location",
            content: (
              <div>
                <img
                  src={mapUrl}
                  alt="Location map"
                  style={{
                    width: "100%",
                    height: "140px",
                    objectFit: "cover",
                    borderRadius: "6px",
                    marginBottom: "0.5rem",
                  }}
                />
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${request.place_coordinates.lat},${request.place_coordinates.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-sm"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  >
                    Google Maps
                  </a>
                  <a
                    href={`/map?lat=${request.place_coordinates.lat}&lng=${request.place_coordinates.lng}&zoom=17`}
                    className="btn btn-sm btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  >
                    Atlas Map
                  </a>
                </div>
              </div>
            ),
          }] : []),
          // Nearby summary
          ...(nearbyCounts ? [{
            title: "Nearby",
            content: (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.85rem" }}>
                <div>
                  <span className="text-muted">Requests:</span>{" "}
                  <strong>{nearbyCounts.requests}</strong>
                </div>
                <div>
                  <span className="text-muted">Places:</span>{" "}
                  <strong>{nearbyCounts.places}</strong>
                </div>
                <div>
                  <span className="text-muted">People:</span>{" "}
                  <strong>{nearbyCounts.people}</strong>
                </div>
                <div>
                  <span className="text-muted">Cats:</span>{" "}
                  <strong>{nearbyCounts.cats}</strong>
                </div>
              </div>
            ),
          }] : []),
          // Quick actions
          {
            title: "Quick Actions",
            content: (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <button
                  onClick={() => setShowObservationModal(true)}
                  className="btn btn-sm"
                  style={{ width: "100%", fontSize: "0.85rem" }}
                >
                  Log Site Visit
                </button>
                {request.requester_email && (
                  <button
                    onClick={() => setShowEmailModal(true)}
                    className="btn btn-sm btn-secondary"
                    style={{ width: "100%", fontSize: "0.85rem" }}
                  >
                    Email Requester
                  </button>
                )}
                {request.place_id && (
                  <button
                    onClick={() => setShowColonyModal(true)}
                    className="btn btn-sm btn-secondary"
                    style={{ width: "100%", fontSize: "0.85rem" }}
                  >
                    Create Colony
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );

  // Build main content
  const mainContent = (
    <>
      {/* Location Card */}
      <Section title="Location" className="mb-4">
        {request.place_id ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <a href={`/places/${request.place_id}`} style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                {request.place_name || request.place_address}
              </a>
              {request.place_kind && <PlaceKindBadge kind={request.place_kind} />}
              {request.property_type && <PropertyTypeBadge type={request.property_type} size="sm" />}
            </div>
            {request.place_address && request.place_name !== request.place_address && (
              <p className="text-muted text-sm" style={{ margin: "0.25rem 0" }}>
                {request.place_address}
              </p>
            )}
            {request.place_city && (
              <p className="text-muted text-sm" style={{ margin: "0.25rem 0" }}>
                {request.place_city}{request.place_postal_code ? `, ${request.place_postal_code}` : ""}
              </p>
            )}
            {request.place_service_zone && (
              <span className="badge" style={{ background: "#6f42c1", color: "#fff", marginTop: "0.5rem" }}>
                Zone: {request.place_service_zone}
              </span>
            )}
            {/* Safety concerns */}
            {(request.place_safety_concerns?.length || request.place_safety_notes) && (
              <div style={{
                marginTop: "0.75rem",
                padding: "0.5rem 0.75rem",
                background: "rgba(255, 193, 7, 0.15)",
                border: "1px solid #ffc107",
                borderRadius: "4px",
                fontSize: "0.85rem",
              }}>
                <span style={{ fontWeight: 500, color: "#856404" }}>Safety: </span>
                {request.place_safety_concerns?.join(", ").replace(/_/g, " ")}
                {request.place_safety_notes && ` - ${request.place_safety_notes}`}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted">No location linked</p>
        )}
      </Section>

      {/* Requester Card */}
      <Section
        title="Requester"
        actions={request.requester_email && (
          <button
            onClick={() => setShowEmailModal(true)}
            className="btn btn-sm btn-secondary"
            style={{ fontSize: "0.8rem" }}
          >
            Email
          </button>
        )}
        className="mb-4"
      >
        {request.requester_person_id ? (
          <div>
            <a href={`/people/${request.requester_person_id}`} style={{ fontWeight: 500 }}>
              {request.requester_name}
            </a>
            {(request.requester_email || request.requester_phone) && (
              <div style={{ marginTop: "0.25rem", fontSize: "0.9rem" }}>
                {request.requester_phone && (
                  <a href={`tel:${request.requester_phone}`} style={{ color: "var(--foreground)", marginRight: "1rem" }}>
                    {formatPhone(request.requester_phone)}
                  </a>
                )}
                {request.requester_email && (
                  <a href={`mailto:${request.requester_email}`} style={{ color: "var(--foreground)" }}>
                    {request.requester_email}
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted">No requester linked</p>
        )}
      </Section>

      {/* Assigned Trappers */}
      <Section title="Assigned Trappers" className="mb-4">
        <TrapperAssignments requestId={requestId} onAssignmentChange={refreshRequest} />
      </Section>

      {/* Linked Cats (inline, not a tab) */}
      <Section
        title={`Cats${request.linked_cat_count ? ` (${request.linked_cat_count})` : ""}`}
        className="mb-4"
      >
        <LinkedCatsSection
          cats={request.cats}
          context="request"
          emptyMessage="No cats linked to this request yet"
          showCount={false}
          title=""
        />
      </Section>

      {/* Photos & Media */}
      <Section title="Photos & Media" className="mb-4" defaultCollapsed>
        <MediaGallery
          entityType="request"
          entityId={requestId}
          allowUpload={true}
          includeRelated={true}
          showCatDescription={true}
          defaultMediaType="cat_photo"
          allowedMediaTypes={["cat_photo", "site_photo", "evidence"]}
        />
      </Section>

      {/* Colony Status (if place linked) */}
      {request.place_id && (
        <Section title="Colony Status" className="mb-4">
          {request.colony_verified_exceeds_reported && (
            <div style={{
              padding: "0.5rem 0.75rem",
              marginBottom: "0.75rem",
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
              borderRadius: "6px",
              fontSize: "0.85rem",
            }}>
              <strong style={{ color: "var(--info-text)" }}>Data Reconciled:</strong>{" "}
              {request.colony_verified_altered} cats altered (exceeds reported {request.total_cats_reported})
            </div>
          )}
          {request.suggested_classification && (
            <ClassificationSuggestionBanner
              requestId={request.request_id}
              placeId={request.place_id}
              suggestion={{
                suggested_classification: request.suggested_classification,
                classification_confidence: request.classification_confidence,
                classification_signals: request.classification_signals,
                classification_disposition: request.classification_disposition,
                classification_reviewed_at: request.classification_reviewed_at,
                classification_reviewed_by: request.classification_reviewed_by,
              }}
              currentPlaceClassification={request.current_place_classification}
              onUpdate={() => window.location.reload()}
            />
          )}
          <ColonyEstimates placeId={request.place_id} />
        </Section>
      )}

      {/* Bottom Tabs: Details | Activity | Admin */}
      <div className="card" style={{ padding: "1rem", marginTop: "1.5rem" }}>
        <TabNav
          tabs={[
            { id: "details", label: "Details" },
            { id: "activity", label: "Activity", count: journalEntries.length },
            { id: "admin", label: "Admin", show: true },
            { id: "legacy", label: "Legacy", show: !!request.source_system?.startsWith("airtable") },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {activeTab === "details" && (
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
        )}

        {activeTab === "activity" && (
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
        )}

        {activeTab === "admin" && (
          <div>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Edit History</h3>
            <EditHistory
              entityType="request"
              entityId={requestId}
              limit={50}
            />

            {/* Nearby Entities (full version) */}
            {request.place_coordinates && (
              <div style={{ marginTop: "1.5rem" }}>
                <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Nearby Entities</h3>
                <NearbyEntities
                  requestId={requestId}
                  onCountsLoaded={setNearbyCounts}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "legacy" && request.source_system?.startsWith("airtable") && (
          <LegacyTab
            request={request}
            onShowUpgradeWizard={() => setShowUpgradeWizard(true)}
            onSwitchToDetails={() => setActiveTab("details")}
          />
        )}
      </div>
    </>
  );

  // Build header
  const headerContent = (
    <div style={{ marginBottom: "1.5rem" }}>
      <BackButton fallbackHref="/requests" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
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
                    border: "2px solid var(--primary)",
                    borderRadius: "4px",
                    width: "300px",
                  }}
                />
                <button onClick={handleRename} disabled={savingRename} className="btn btn-sm">
                  {savingRename ? "..." : "Save"}
                </button>
                <button onClick={() => setRenaming(false)} className="btn btn-sm btn-secondary">
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <h1 style={{ margin: 0, fontSize: "1.75rem" }}>
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
                      fontSize: "0.9rem",
                      color: "var(--muted)",
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

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge status={request.status} size="lg" />
            <PriorityBadge priority={request.priority} />
            {request.property_type && <PropertyTypeBadge type={request.property_type} />}
            {request.hold_reason && (
              <span className="badge" style={{ background: "#ffc107", color: "#000" }}>
                Hold: {request.hold_reason.replace(/_/g, " ")}
              </span>
            )}
          </div>

          {/* Quick Actions */}
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
                  }}
                >
                  ↩ Undo
                </button>
              )}
            </div>
          )}
        </div>

        {!editing && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <a
              href={`/requests/${request.request_id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ fontSize: "0.85rem" }}
            >
              Print
            </a>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={showHistory ? "btn" : "btn btn-secondary"}
              style={{ fontSize: "0.85rem" }}
            >
              History
            </button>
            <button onClick={() => setEditing(true)} className="btn" style={{ fontSize: "0.85rem" }}>
              Edit
            </button>
            {request.status !== "redirected" && request.status !== "handed_off" && request.status !== "completed" && request.status !== "cancelled" && (
              <>
                <button
                  onClick={() => setShowRedirectModal(true)}
                  className="btn btn-secondary"
                  style={{ fontSize: "0.85rem", color: "#6f42c1", borderColor: "#6f42c1" }}
                >
                  Redirect
                </button>
                <button
                  onClick={() => setShowHandoffModal(true)}
                  className="btn btn-secondary"
                  style={{ fontSize: "0.85rem", color: "#0d9488", borderColor: "#0d9488" }}
                >
                  Hand Off
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Redirect/Handoff Banners */}
      {request.redirected_to_request_id && request.transfer_type === 'handoff' && (
        <div style={{
          padding: "12px 16px",
          background: "#d1fae5",
          borderRadius: "8px",
          marginTop: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}>
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
        <div style={{
          padding: "12px 16px",
          background: "#e8daff",
          borderRadius: "8px",
          marginTop: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}>
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

      {request.redirected_from_request_id && (
        <div style={{
          padding: "12px 16px",
          background: request.transfer_type === 'handoff' ? "#ccfbf1" : "#f0f0f0",
          borderRadius: "8px",
          marginTop: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}>
          <span style={{ fontSize: "1.25rem" }}>{request.transfer_type === 'handoff' ? '🔄' : '↩️'}</span>
          <div>
            <strong style={{ color: request.transfer_type === 'handoff' ? "#0f766e" : "inherit" }}>
              {request.transfer_type === 'handoff' ? 'Continuation from previous caretaker' : 'Created from a redirect'}
            </strong>
            <p style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
              <a href={`/requests/${request.redirected_from_request_id}`} style={{ color: request.transfer_type === 'handoff' ? "#0d9488" : "#6f42c1" }}>
                ← View the original request
              </a>
            </p>
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "#dc3545", marginTop: "1rem", padding: "0.75rem", background: "#f8d7da", borderRadius: "6px" }}>
          {error}
        </div>
      )}
    </div>
  );

  // If in editing mode, show the edit form instead of the two-column layout
  if (editing) {
    return (
      <div>
        {headerContent}

        <div className="card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Edit Request</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Status</label>
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
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Priority</label>
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
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Request Title</label>
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
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Adult Cats Needing TNR</label>
                <input
                  type="number"
                  min="0"
                  value={editForm.estimated_cat_count}
                  onChange={(e) => setEditForm({ ...editForm, estimated_cat_count: e.target.value ? parseInt(e.target.value) : "" })}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Kittens</label>
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
              </div>
              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Assigned To</label>
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
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Scheduled Date</label>
                <input
                  type="date"
                  value={editForm.scheduled_date}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_date: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Time Range</label>
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
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Notes</label>
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
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Resolution Notes</label>
                  <textarea
                    value={editForm.resolution_notes}
                    onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })}
                    rows={3}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Cats Trapped</label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.cats_trapped}
                      onChange={(e) => setEditForm({ ...editForm, cats_trapped: e.target.value ? parseInt(e.target.value) : "" })}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Cats Returned</label>
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
            <button onClick={handleSave} disabled={saving} className="btn">
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button type="button" onClick={handleCancel} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TwoColumnLayout
        header={headerContent}
        main={mainContent}
        sidebar={sidebarContent}
        sidebarWidth="35%"
        stickyHeader={false}
        stickySidebar={true}
      />

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
        staffName={undefined}
        onSuccess={(result) => {
          setShowColonyModal(false);
          alert(`Colony "${result.colony_name}" created successfully!`);
        }}
      />
    </div>
  );
}
