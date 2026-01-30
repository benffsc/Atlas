"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { EditHistory } from "@/components/EditHistory";
import { AlterationStatsCard } from "@/components/AlterationStatsCard";
import { LegacyUpgradeWizard } from "@/components/LegacyUpgradeWizard";
import { TrapperAssignments } from "@/components/TrapperAssignments";
import JournalSection, { JournalEntry } from "@/components/JournalSection";
import { LinkedCatsSection } from "@/components/LinkedCatsSection";
import LogSiteVisitModal from "@/components/LogSiteVisitModal";
import CompleteRequestModal from "@/components/CompleteRequestModal";
import HoldRequestModal from "@/components/HoldRequestModal";
import { ColonyEstimates } from "@/components/ColonyEstimates";
import { ClassificationSuggestionBanner } from "@/components/ClassificationSuggestionBanner";
import { MediaGallery } from "@/components/MediaGallery";
import { RedirectRequestModal } from "@/components/RedirectRequestModal";
import { HandoffRequestModal } from "@/components/HandoffRequestModal";
import { NearbyEntities } from "@/components/NearbyEntities";
import { QuickActions, useRequestQuickActionState } from "@/components/QuickActions";
import { SendEmailModal } from "@/components/SendEmailModal";
import { CreateColonyModal } from "@/components/CreateColonyModal";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";

interface RequestDetail {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  assigned_to: string | null;
  assigned_trapper_type: string | null;
  assigned_at: string | null;
  assignment_notes: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Enhanced intake fields
  permission_status: string | null;
  property_owner_contact: string | null;
  access_notes: string | null;
  traps_overnight_safe: boolean | null;
  access_without_contact: boolean | null;
  property_type: string | null;
  colony_duration: string | null;
  location_description: string | null;
  eartip_count: number | null;
  eartip_estimate: string | null;
  count_confidence: string | null;
  is_being_fed: boolean | null;
  feeder_name: string | null;
  feeding_schedule: string | null;
  best_times_seen: string | null;
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
  urgency_notes: string | null;
  best_contact_times: string | null;
  // Hold tracking
  hold_reason: string | null;
  hold_reason_notes: string | null;
  hold_started_at: string | null;
  // Activity tracking
  last_activity_at: string | null;
  last_activity_type: string | null;
  // Place info
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_kind: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates: { lat: number; lng: number } | null;
  place_safety_notes: string | null;
  place_safety_concerns: string[] | null;
  place_service_zone: string | null;
  // Requester info
  requester_person_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  // Linked cats & verification
  cats: { cat_id: string; cat_name: string | null; link_purpose: string; microchip: string | null; altered_status: string | null; linked_at: string }[] | null;
  linked_cat_count: number | null;
  verified_altered_count: number | null;
  verified_intact_count: number | null;
  // Computed scores
  readiness_score: number | null;
  urgency_score: number | null;
  // Kitten assessment fields
  kitten_count: number | null;
  kitten_age_weeks: number | null;
  kitten_assessment_status: string | null;
  kitten_assessment_outcome: string | null;
  kitten_foster_readiness: string | null;
  kitten_urgency_factors: string[] | null;
  kitten_assessment_notes: string | null;
  not_assessing_reason: string | null;
  kitten_assessed_by: string | null;
  kitten_assessed_at: string | null;
  // Redirect fields
  redirected_to_request_id: string | null;
  redirected_from_request_id: string | null;
  transfer_type: string | null;
  redirect_reason: string | null;
  redirect_at: string | null;
  // MIG_534 cat count semantic fields
  total_cats_reported: number | null;
  cat_count_semantic: string | null;
  // MIG_562 colony summary
  colony_size_estimate: number | null;
  colony_verified_altered: number | null;
  colony_work_remaining: number | null;
  colony_alteration_rate: number | null;
  colony_estimation_method: string | null;
  colony_has_override: boolean | null;
  colony_override_note: string | null;
  colony_verified_exceeds_reported: boolean | null;
  // Email batching (MIG_605)
  ready_to_email: boolean;
  email_summary: string | null;
  email_batch_id: string | null;
  // Classification suggestion (MIG_622)
  suggested_classification: string | null;
  classification_confidence: number | null;
  classification_signals: Record<string, { value: string | number | boolean; weight: number; toward: string; note?: string }> | null;
  classification_disposition: string | null;
  classification_suggested_at: string | null;
  classification_reviewed_at: string | null;
  classification_reviewed_by: string | null;
  current_place_classification: string | null;
}

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

const KITTEN_ASSESSMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending Assessment" },
  { value: "assessed", label: "Assessed" },
  { value: "follow_up", label: "Needs Follow-up" },
  { value: "not_assessing", label: "Not Assessing" },
];

const NOT_ASSESSING_REASON_OPTIONS = [
  { value: "older_kittens", label: "Older kittens (6+ months) - no capacity" },
  { value: "no_foster_capacity", label: "No foster capacity currently" },
  { value: "feral_unsuitable", label: "Feral/unsocialized - unsuitable for foster" },
  { value: "health_concerns", label: "Health concerns preclude foster" },
  { value: "owner_keeping", label: "Owner plans to keep" },
  { value: "already_altered", label: "Already altered - no intervention needed" },
  { value: "other", label: "Other (specify in notes)" },
];

const KITTEN_OUTCOME_OPTIONS = [
  { value: "foster_intake", label: "Foster Intake" },
  { value: "tnr_candidate", label: "FFR Candidate (unhandleable/older)" },
  { value: "pending_space", label: "Pending Foster Space" },
  { value: "return_to_colony", label: "Return to Colony" },
  { value: "declined", label: "Declined / Not Suitable" },
];

const FOSTER_READINESS_OPTIONS = [
  { value: "high", label: "High - Ready for foster" },
  { value: "medium", label: "Medium - Some concerns" },
  { value: "low", label: "Low - Not ready / needs intervention" },
];

const URGENCY_FACTOR_OPTIONS = [
  { value: "very_young", label: "Very young (bottle babies)" },
  { value: "medical_concern", label: "Medical concern" },
  { value: "exposed_danger", label: "Exposed to danger" },
  { value: "cold_weather", label: "Cold weather risk" },
  { value: "hot_weather", label: "Hot weather risk" },
  { value: "mom_missing", label: "Mom missing/dead" },
  { value: "construction", label: "Construction/demolition" },
  { value: "eviction", label: "Eviction/displacement" },
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

  // Session/Staff info for auto-fill
  const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);
  const [currentStaffName, setCurrentStaffName] = useState<string | null>(null);

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

  // Tab state for Details, Nearby, and Legacy Info
  const [activeTab, setActiveTab] = useState<"details" | "nearby" | "legacy">("details");
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
      const response = await fetch(`/api/journal?request_id=${requestId}`);
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

  // Fetch current session/staff info for auto-fill
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated && data.staff) {
          setCurrentStaffId(data.staff.staff_id);
          setCurrentStaffName(data.staff.display_name);
        }
      })
      .catch(() => {
        // Ignore errors - staff info is optional
      });
  }, []);

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

      {/* Tab Navigation - show for all requests */}
      {!editing && (
        <div className="profile-tabs">
          {[
            { id: "details" as const, label: "Details", show: true },
            {
              id: "nearby" as const,
              label: `Nearby${nearbyCounts ? ` (${nearbyCounts.requests + nearbyCounts.places + nearbyCounts.people + nearbyCounts.cats})` : ""}`,
              show: !!request.place_coordinates,
            },
            { id: "legacy" as const, label: "Legacy Info (Airtable)", show: request.source_system?.startsWith("airtable") },
          ]
            .filter((tab) => tab.show)
            .map((tab) => (
              <button
                key={tab.id}
                className={`profile-tab${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
        </div>
      )}

      {/* Nearby Tab Content */}
      {activeTab === "nearby" && request.place_coordinates && !editing && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Nearby Entities</h2>
          <NearbyEntities
            requestId={requestId}
            onCountsLoaded={(counts) => setNearbyCounts(counts)}
          />
        </div>
      )}

      {/* Legacy Info Tab Content */}
      {activeTab === "legacy" && request.source_system?.startsWith("airtable") && !editing && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Legacy Airtable Data</h2>
          <div style={{
            background: "#f8f9fa",
            border: "1px solid #e9ecef",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}>
            This data was imported from Airtable on {new Date(request.created_at).toLocaleDateString()}.
            Some fields may have been migrated to new Atlas fields.
          </div>

          <div style={{ display: "grid", gap: "1rem" }}>
            {/* Source Info */}
            <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "0.5rem" }}>
              <strong>Source System:</strong>
              <span>{request.source_system}</span>
              <strong>Airtable ID:</strong>
              <span>
                {request.source_record_id ? (
                  <a
                    href={`https://airtable.com/appl6zLrRFDvsz0dh/tblc1bva7jFzg8DVF/${request.source_record_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {request.source_record_id}
                  </a>
                ) : (
                  "N/A"
                )}
              </span>
              <strong>Data Source:</strong>
              <span>{request.data_source || "N/A"}</span>
              <strong>Created:</strong>
              <span>{new Date(request.created_at).toLocaleString()}</span>
            </div>

            {/* Legacy Notes */}
            {request.legacy_notes && (
              <div>
                <strong style={{ display: "block", marginBottom: "0.5rem" }}>Internal Notes (from Airtable):</strong>
                <pre style={{
                  background: "#2d3748",
                  color: "#e2e8f0",
                  padding: "1rem",
                  borderRadius: "8px",
                  whiteSpace: "pre-wrap",
                  wordWrap: "break-word",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  margin: 0,
                  maxHeight: "400px",
                  overflow: "auto",
                }}>
                  {request.legacy_notes}
                </pre>
              </div>
            )}

            {/* Original Place/Address Info */}
            <div>
              <strong style={{ display: "block", marginBottom: "0.5rem" }}>Location Info:</strong>
              <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
                <p style={{ margin: "0 0 0.25rem 0" }}><strong>Place:</strong> {request.place_name || "N/A"}</p>
                <p style={{ margin: "0 0 0.25rem 0" }}><strong>Address:</strong> {request.place_address || "N/A"}</p>
                <p style={{ margin: "0 0 0.25rem 0" }}><strong>City:</strong> {request.place_city || "N/A"}</p>
                <p style={{ margin: 0 }}><strong>Requester:</strong> {request.requester_name || "N/A"}</p>
              </div>
            </div>

            {/* Original Request Details */}
            <div>
              <strong style={{ display: "block", marginBottom: "0.5rem" }}>Original Request Details:</strong>
              <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
                <p style={{ margin: "0 0 0.25rem 0" }}><strong>Request Title:</strong> {request.summary || "N/A"}</p>
                <p style={{ margin: "0 0 0.25rem 0" }}><strong>Cats Needing TNR:</strong> {request.estimated_cat_count ?? "N/A"}</p>
                <p style={{ margin: "0 0 0.25rem 0" }}><strong>Has Kittens:</strong> {request.has_kittens ? "Yes" : "No"}</p>
                <p style={{ margin: 0 }}><strong>Original Notes:</strong> {request.notes || "N/A"}</p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => setShowUpgradeWizard(true)}
              style={{
                padding: "0.5rem 1rem",
                background: "#0d6efd",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
              }}
            >
              Upgrade to Full Request
            </button>
            <button
              onClick={() => setActiveTab("details")}
              style={{ padding: "0.5rem 1rem" }}
            >
              Back to Details
            </button>
          </div>
        </div>
      )}

      {activeTab === "details" && editing ? (
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
      ) : activeTab === "details" ? (
        <>
          {/* Location Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Location</h2>
            {request.place_id ? (
              <div>
                <a href={`/places/${request.place_id}`} style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                  {request.place_name}
                </a>
                {request.place_address && (
                  <p className="text-muted" style={{ margin: "0.25rem 0 0" }}>
                    {request.place_address}
                  </p>
                )}
                {request.place_city && (
                  <p className="text-muted text-sm" style={{ margin: "0.25rem 0 0" }}>
                    {request.place_city}{request.place_postal_code ? `, ${request.place_postal_code}` : ""}
                  </p>
                )}
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {request.place_kind && (
                    <span className="badge">
                      {request.place_kind}
                    </span>
                  )}
                  {request.place_service_zone && (
                    <span className="badge" style={{ background: "#6f42c1", color: "#fff" }}>
                      Zone: {request.place_service_zone}
                    </span>
                  )}
                </div>
                {/* Safety concerns */}
                {(request.place_safety_concerns?.length || request.place_safety_notes) && (
                  <div style={{
                    marginTop: "1rem",
                    padding: "0.75rem",
                    background: "rgba(255, 193, 7, 0.15)",
                    border: "1px solid #ffc107",
                    borderRadius: "4px"
                  }}>
                    <div style={{ fontWeight: 500, color: "#856404", marginBottom: "0.5rem" }}>Safety Notes</div>
                    {request.place_safety_concerns && request.place_safety_concerns.length > 0 && (
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: request.place_safety_notes ? "0.5rem" : 0 }}>
                        {request.place_safety_concerns.map((concern, idx) => (
                          <span key={idx} style={{
                            background: "#ffc107",
                            color: "#000",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "3px",
                            fontSize: "0.8rem"
                          }}>
                            {concern.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                    {request.place_safety_notes && (
                      <div style={{ fontSize: "0.9rem" }}>{request.place_safety_notes}</div>
                    )}
                  </div>
                )}

                {/* Map Preview */}
                {request.place_coordinates && (
                  <div style={{ marginTop: "1rem" }}>
                    {mapUrl ? (
                      <div style={{ position: "relative" }}>
                        <img
                          src={mapUrl}
                          alt="Location map"
                          style={{
                            width: "100%",
                            height: "200px",
                            objectFit: "cover",
                            borderRadius: "8px",
                            border: "1px solid var(--border)",
                          }}
                        />
                        {mapNearbyCount > 0 && (
                          <div
                            style={{
                              position: "absolute",
                              bottom: "8px",
                              left: "8px",
                              background: "rgba(0,0,0,0.7)",
                              color: "#fff",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                            }}
                          >
                            {mapNearbyCount} nearby request{mapNearbyCount > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "200px",
                          background: "var(--card-border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "8px",
                        }}
                      >
                        <div className="loading-spinner" />
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${request.place_coordinates.lat},${request.place_coordinates.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.5rem 1rem",
                          background: "#4285F4",
                          color: "#fff",
                          borderRadius: "6px",
                          textDecoration: "none",
                          fontSize: "0.9rem",
                        }}
                      >
                        View in Google Maps
                      </a>
                      <a
                        href={`/map?lat=${request.place_coordinates.lat}&lng=${request.place_coordinates.lng}&zoom=17`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.5rem 1rem",
                          background: "#6366f1",
                          color: "#fff",
                          borderRadius: "6px",
                          textDecoration: "none",
                          fontSize: "0.9rem",
                        }}
                      >
                        View on Atlas Map
                      </a>
                      <button
                        onClick={() => setShowObservationModal(true)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.5rem 1rem",
                          background: "#28a745",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "0.9rem",
                          cursor: "pointer",
                        }}
                      >
                        Log Site Visit
                      </button>
                    </div>
                  </div>
                )}

                {/* Log Site Visit button (when no map) */}
                {!request.place_coordinates && (
                  <button
                    onClick={() => setShowObservationModal(true)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginTop: "1rem",
                      padding: "0.5rem 1rem",
                      background: "#28a745",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "0.9rem",
                      cursor: "pointer",
                    }}
                  >
                    Log Site Visit
                  </button>
                )}
              </div>
            ) : (
              <p className="text-muted">No location linked</p>
            )}
          </div>

          {/* Colony Estimates Card */}
          {request.place_id && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Colony Status</h2>

              {/* Reconciliation Notice when verified > reported (MIG_562) */}
              {request.colony_verified_exceeds_reported && (
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    marginBottom: "1rem",
                    background: "var(--info-bg)",
                    border: "1px solid var(--info-border)",
                    borderRadius: "8px",
                    fontSize: "0.875rem",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "var(--info-text)" }}>
                    Data Reconciled
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    <strong>{request.colony_verified_altered}</strong> cats have been altered at clinic,
                    which exceeds the originally reported estimate of <strong>{request.total_cats_reported}</strong>.
                    {request.cat_count_semantic === "needs_tnr" && request.estimated_cat_count !== null && (
                      <>
                        {" "}Staff indicated <strong>{request.estimated_cat_count}</strong> cat{request.estimated_cat_count === 1 ? "" : "s"} still need{request.estimated_cat_count === 1 ? "s" : ""} TNR.
                      </>
                    )}
                    {request.colony_estimation_method === "Staff Override" && (
                      <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", fontStyle: "italic" }}>
                        Colony size has been auto-reconciled based on verified data.
                        {request.colony_override_note && ` (${request.colony_override_note})`}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Classification Suggestion Banner (MIG_622) */}
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
                  onUpdate={async () => {
                    // Refetch request after classification update
                    try {
                      const response = await fetch(`/api/requests/${request.request_id}`);
                      if (response.ok) {
                        const data = await response.json();
                        setRequest(data);
                      }
                    } catch (err) {
                      console.error("Failed to refetch request:", err);
                    }
                  }}
                />
              )}

              <ColonyEstimates placeId={request.place_id} />
            </div>
          )}

          {/* Requester Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Requester</h2>
              {request.requester_email && (
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="btn btn-secondary"
                  style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
                >
                  <span>✉️</span>
                  Email Requester
                </button>
              )}
            </div>
            {request.requester_person_id ? (
              <div>
                <a href={`/people/${request.requester_person_id}`} style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                  {request.requester_name}
                </a>
                {(request.requester_email || request.requester_phone) && (
                  <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {request.requester_phone && (
                      <a href={`tel:${request.requester_phone}`} className="text-sm" style={{ color: "var(--foreground)" }}>
                        {request.requester_phone}
                      </a>
                    )}
                    {request.requester_email && (
                      <a href={`mailto:${request.requester_email}`} className="text-sm" style={{ color: "var(--foreground)" }}>
                        {request.requester_email}
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted">No requester linked</p>
            )}
          </div>

          {/* Assigned Trappers Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Assigned Trappers</h2>
            <TrapperAssignments requestId={request.request_id} />
          </div>

          {/* Ready to Email Card (MIG_605) */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Email Batch</h2>
              {request.email_batch_id && (
                <a
                  href="/admin/email-batches"
                  style={{
                    fontSize: "0.85rem",
                    color: "#6366f1",
                  }}
                >
                  View Batch →
                </a>
              )}
            </div>

            {/* Ready to Email Toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={request.ready_to_email || false}
                  onChange={handleToggleReadyToEmail}
                  disabled={savingEmail || !!request.email_batch_id}
                  style={{ width: "18px", height: "18px" }}
                />
                <span style={{ fontWeight: 500 }}>Ready to Email</span>
              </label>
              {request.email_batch_id && (
                <span
                  style={{
                    padding: "0.25rem 0.5rem",
                    background: "#dbeafe",
                    color: "#1e40af",
                    fontSize: "0.75rem",
                    borderRadius: "4px",
                  }}
                >
                  Added to batch
                </span>
              )}
              {savingEmail && <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Saving...</span>}
            </div>

            {/* Email Summary */}
            {(request.ready_to_email || request.email_summary) && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <span className="text-muted text-sm">Summary for Trapper Email</span>
                  {!editingEmailSummary && (
                    <button
                      onClick={handleStartEditEmailSummary}
                      style={{
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.75rem",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingEmailSummary ? (
                  <div>
                    <textarea
                      value={emailSummaryDraft}
                      onChange={(e) => setEmailSummaryDraft(e.target.value)}
                      rows={4}
                      placeholder="Brief summary of this assignment for the trapper (appears in batch emails)..."
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        resize: "vertical",
                        fontSize: "0.9rem",
                      }}
                    />
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                      <button
                        onClick={handleSaveEmailSummary}
                        disabled={savingEmail}
                        style={{
                          padding: "0.35rem 0.75rem",
                          fontSize: "0.85rem",
                          background: "#3b82f6",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          cursor: savingEmail ? "not-allowed" : "pointer",
                        }}
                      >
                        {savingEmail ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={handleCancelEmailSummary}
                        style={{
                          padding: "0.35rem 0.75rem",
                          fontSize: "0.85rem",
                          background: "transparent",
                          color: "inherit",
                          border: "1px solid var(--border)",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "0.75rem",
                      background: "var(--surface)",
                      borderRadius: "6px",
                      fontSize: "0.9rem",
                      whiteSpace: "pre-wrap",
                      minHeight: "60px",
                      color: request.email_summary ? "inherit" : "var(--muted)",
                    }}
                  >
                    {request.email_summary || "No summary written yet. Click Edit to add one."}
                  </div>
                )}
              </div>
            )}

            {!request.ready_to_email && !request.email_summary && (
              <p style={{ fontSize: "0.9rem", color: "var(--muted)", margin: 0 }}>
                Check &quot;Ready to Email&quot; to include this request in a trapper batch email.
              </p>
            )}
          </div>

          {/* Details Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Details</h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <div className="text-muted text-sm" title="Adult cats still needing spay/neuter (kittens tracked separately)">Adult Cats Needing TNR</div>
                <div style={{ fontWeight: 500 }}>
                  {request.estimated_cat_count ?? "Unknown"}
                </div>
              </div>

              {request.has_kittens && (
                <div>
                  <div className="text-muted text-sm" title="Kittens (under 8 weeks) tracked separately">Kittens</div>
                  <div style={{ fontWeight: 500, color: "#fd7e14" }}>
                    {request.kitten_count ?? "Yes (count unknown)"}
                  </div>
                </div>
              )}

              <div>
                <div className="text-muted text-sm">Cats Friendly</div>
                <div style={{ fontWeight: 500 }}>
                  {request.cats_are_friendly === true ? "Yes" : request.cats_are_friendly === false ? "No" : "Unknown"}
                </div>
              </div>

              <div>
                <div className="text-muted text-sm">Assigned To</div>
                <div style={{ fontWeight: 500 }}>
                  {request.assigned_to || "Unassigned"}
                </div>
              </div>

              <div>
                <div className="text-muted text-sm">Scheduled</div>
                <div style={{ fontWeight: 500 }}>
                  {request.scheduled_date ? (
                    <>
                      {new Date(request.scheduled_date).toLocaleDateString()}
                      {request.scheduled_time_range && ` (${request.scheduled_time_range})`}
                    </>
                  ) : (
                    "Not scheduled"
                  )}
                </div>
              </div>
            </div>

            {request.notes && (
              <div style={{ marginTop: "1.5rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Notes</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{request.notes}</div>
              </div>
            )}
          </div>

          {/* Kitten Assessment Card (when has_kittens is true) */}
          {request.has_kittens && (
            <div className="card" style={{
              padding: "1.5rem",
              marginBottom: "1.5rem",
              background: "rgba(33, 150, 243, 0.1)",
              border: "1px solid #2196f3"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1.25rem", margin: 0, color: "#1565c0" }}>
                  Kitten Assessment
                </h2>
                {!editingKittens && (
                  <button
                    onClick={() => setEditingKittens(true)}
                    style={{ padding: "0.5rem 1rem" }}
                  >
                    {request.kitten_assessment_status ? "Edit Assessment" : "Assess Kittens"}
                  </button>
                )}
              </div>

              {editingKittens ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {/* Kitten Count and Age */}
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 150px" }}>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Kitten Count
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={kittenForm.kitten_count}
                        onChange={(e) => setKittenForm({ ...kittenForm, kitten_count: e.target.value ? parseInt(e.target.value) : "" })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div style={{ flex: "1 1 150px" }}>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Age (weeks)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={kittenForm.kitten_age_weeks}
                        onChange={(e) => setKittenForm({ ...kittenForm, kitten_age_weeks: e.target.value ? parseInt(e.target.value) : "" })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>

                  {/* Assessment Status */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Assessment Status
                    </label>
                    <select
                      value={kittenForm.kitten_assessment_status}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_assessment_status: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select status...</option>
                      {KITTEN_ASSESSMENT_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Not Assessing Reason - shown when status is not_assessing */}
                  {kittenForm.kitten_assessment_status === "not_assessing" && (
                    <div style={{
                      padding: "1rem",
                      background: "var(--section-bg)",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                    }}>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Reason Not Assessing
                      </label>
                      <select
                        value={kittenForm.not_assessing_reason}
                        onChange={(e) => setKittenForm({ ...kittenForm, not_assessing_reason: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="">Select reason...</option>
                        {NOT_ASSESSING_REASON_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                        This indicates these kittens won&apos;t be evaluated for foster placement.
                      </p>
                    </div>
                  )}

                  {/* Outcome */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Outcome Decision
                    </label>
                    <select
                      value={kittenForm.kitten_assessment_outcome}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_assessment_outcome: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select outcome...</option>
                      {KITTEN_OUTCOME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Foster Readiness */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Foster Readiness
                    </label>
                    <select
                      value={kittenForm.kitten_foster_readiness}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_foster_readiness: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select readiness...</option>
                      {FOSTER_READINESS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Urgency Factors */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                      Urgency Factors
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {URGENCY_FACTOR_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.5rem 0.75rem",
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            cursor: "pointer",
                            background: kittenForm.kitten_urgency_factors.includes(opt.value)
                              ? "rgba(33, 150, 243, 0.2)"
                              : "transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={kittenForm.kitten_urgency_factors.includes(opt.value)}
                            onChange={() => toggleUrgencyFactor(opt.value)}
                            style={{ marginRight: "0.25rem" }}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Assessment Notes */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Assessment Notes
                    </label>
                    <textarea
                      value={kittenForm.kitten_assessment_notes}
                      onChange={(e) => setKittenForm({ ...kittenForm, kitten_assessment_notes: e.target.value })}
                      rows={3}
                      style={{ width: "100%", resize: "vertical" }}
                      placeholder="Notes about the kittens, socialization level, health observations, etc."
                    />
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                    <button onClick={handleSaveKittens} disabled={savingKittens}>
                      {savingKittens ? "Saving..." : "Save Assessment"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelKittens}
                      style={{ background: "transparent", border: "1px solid var(--border)", color: "inherit" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Display existing assessment */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
                    <div>
                      <div className="text-muted text-sm">Kitten Count</div>
                      <div style={{ fontWeight: 500, fontSize: "1.25rem" }}>
                        {request.kitten_count ?? "Not recorded"}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted text-sm">Age</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_age_weeks
                          ? `~${request.kitten_age_weeks} weeks`
                          : "Unknown"}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted text-sm">Assessment Status</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_assessment_status ? (
                          <span style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            background: request.kitten_assessment_status === "assessed"
                              ? "#198754"
                              : request.kitten_assessment_status === "follow_up"
                                ? "#ffc107"
                                : request.kitten_assessment_status === "not_assessing"
                                  ? "#6366f1"
                                  : "#6c757d",
                            color: request.kitten_assessment_status === "follow_up" ? "#000" : "#fff",
                            fontSize: "0.85rem"
                          }}>
                            {request.kitten_assessment_status.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span style={{ color: "#dc3545" }}>Pending</span>
                        )}
                      </div>
                      {/* Show not assessing reason */}
                      {request.kitten_assessment_status === "not_assessing" && request.not_assessing_reason && (
                        <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                          Reason: {NOT_ASSESSING_REASON_OPTIONS.find(o => o.value === request.not_assessing_reason)?.label || request.not_assessing_reason.replace(/_/g, " ")}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-muted text-sm">Outcome</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_assessment_outcome
                          ? request.kitten_assessment_outcome.replace(/_/g, " ")
                          : "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted text-sm">Foster Readiness</div>
                      <div style={{ fontWeight: 500 }}>
                        {request.kitten_foster_readiness ? (
                          <span style={{
                            color: request.kitten_foster_readiness === "high"
                              ? "#198754"
                              : request.kitten_foster_readiness === "medium"
                                ? "#ffc107"
                                : "#dc3545"
                          }}>
                            {request.kitten_foster_readiness}
                          </span>
                        ) : "—"}
                      </div>
                    </div>
                  </div>

                  {request.kitten_urgency_factors && request.kitten_urgency_factors.length > 0 && (
                    <div style={{ marginTop: "1rem" }}>
                      <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Urgency Factors</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                        {request.kitten_urgency_factors.map((factor) => (
                          <span
                            key={factor}
                            style={{
                              background: "#dc3545",
                              color: "#fff",
                              padding: "0.25rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.85rem"
                            }}
                          >
                            {factor.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {request.kitten_assessment_notes && (
                    <div style={{ marginTop: "1rem" }}>
                      <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Assessment Notes</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{request.kitten_assessment_notes}</div>
                    </div>
                  )}

                  {request.kitten_assessed_by && (
                    <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                      Assessed by {request.kitten_assessed_by}
                      {request.kitten_assessed_at && (
                        <> on {new Date(request.kitten_assessed_at).toLocaleDateString()}</>
                      )}
                    </div>
                  )}

                  {!request.kitten_assessment_status && (
                    <div style={{
                      marginTop: "1rem",
                      padding: "1rem",
                      background: "rgba(255, 193, 7, 0.15)",
                      borderRadius: "6px",
                      border: "1px dashed #ffc107"
                    }}>
                      <p style={{ margin: 0, color: "#856404" }}>
                        This request has kittens that need to be assessed by the foster coordinator.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Resolution Card (if resolved) */}
          {isResolved && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Resolution</h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
                <div>
                  <div className="text-muted text-sm">Resolved</div>
                  <div style={{ fontWeight: 500 }}>
                    {request.resolved_at ? new Date(request.resolved_at).toLocaleDateString() : "—"}
                  </div>
                </div>

                <div>
                  <div className="text-muted text-sm">Cats Trapped</div>
                  <div style={{ fontWeight: 500 }}>{request.cats_trapped ?? "—"}</div>
                </div>

                <div>
                  <div className="text-muted text-sm">Cats Returned</div>
                  <div style={{ fontWeight: 500 }}>{request.cats_returned ?? "—"}</div>
                </div>
              </div>

              {request.resolution_notes && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Resolution Notes</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{request.resolution_notes}</div>
                </div>
              )}
            </div>
          )}

          {/* Legacy Internal Notes Card (for Airtable imports) */}
          {request.legacy_notes && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem", background: "var(--card-bg, #1a1a1a)", border: "1px solid var(--border)" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>📋</span>
                Internal Notes (from Airtable)
              </h2>
              <div style={{
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: "0.9rem",
                background: "var(--code-bg, #0d0d0d)",
                color: "var(--foreground)",
                padding: "1rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                maxHeight: "400px",
                overflowY: "auto"
              }}>
                {request.legacy_notes}
              </div>
              <p className="text-muted text-sm" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
                These notes were imported from Airtable and are read-only. Future notes will use the new journal system.
              </p>
            </div>
          )}

          {/* Linked Cats Card */}
          <LinkedCatsSection
            cats={request.cats}
            context="request"
            emptyMessage="No cats linked to this request yet"
          />

          {/* Journal / Notes Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Journal</h2>
            <JournalSection
              entries={journalEntries}
              entityType="request"
              entityId={request.request_id}
              onEntryAdded={fetchJournalEntries}
              currentStaffId={currentStaffId || undefined}
              currentStaffName={currentStaffName || undefined}
            />
          </div>

          {/* Photos & Media Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Photos & Media</h2>
            <MediaGallery
              entityType="request"
              entityId={request.request_id}
              allowUpload={true}
              showCatDescription={true}
              defaultMediaType="cat_photo"
              allowedMediaTypes={["cat_photo", "site_photo", "evidence"]}
            />
          </div>

          {/* Trapping Logistics Card */}
          {((request.permission_status && request.permission_status !== "unknown") || request.access_notes || request.traps_overnight_safe !== null || request.access_without_contact !== null || request.best_times_seen || request.property_owner_contact) && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Trapping Logistics</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                {request.permission_status && request.permission_status !== "unknown" && (
                  <div>
                    <div className="text-muted text-sm">Permission Status</div>
                    <div style={{ fontWeight: 500 }}>
                      <span style={{
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        background: request.permission_status === "yes" ? "#198754"
                          : request.permission_status === "pending" ? "#ffc107"
                          : request.permission_status === "no" ? "#dc3545"
                          : request.permission_status === "not_needed" ? "#6c757d"
                          : "#6c757d",
                        color: request.permission_status === "pending" ? "#000" : "#fff",
                        fontSize: "0.85rem",
                      }}>
                        {request.permission_status === "yes" ? "Permission Granted"
                          : request.permission_status === "no" ? "Permission Denied"
                          : request.permission_status === "pending" ? "Pending Response"
                          : request.permission_status === "not_needed" ? "Not Needed (Public)"
                          : request.permission_status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                )}
                {request.property_owner_contact && (
                  <div>
                    <div className="text-muted text-sm">Property Owner Contact</div>
                    <div style={{ fontWeight: 500 }}>{request.property_owner_contact}</div>
                  </div>
                )}
                {request.traps_overnight_safe !== null && (
                  <div>
                    <div className="text-muted text-sm">Traps Safe Overnight?</div>
                    <div style={{ fontWeight: 500, color: request.traps_overnight_safe ? "#198754" : "#dc3545" }}>
                      {request.traps_overnight_safe ? "Yes" : "No"}
                    </div>
                  </div>
                )}
                {request.access_without_contact !== null && (
                  <div>
                    <div className="text-muted text-sm">Access Without Contact?</div>
                    <div style={{ fontWeight: 500, color: request.access_without_contact ? "#198754" : "#6c757d" }}>
                      {request.access_without_contact ? "Yes" : "No"}
                    </div>
                  </div>
                )}
                {request.best_times_seen && (
                  <div>
                    <div className="text-muted text-sm">Best Times Cats Seen</div>
                    <div style={{ fontWeight: 500 }}>{request.best_times_seen}</div>
                  </div>
                )}
              </div>
              {request.access_notes && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Access Notes</div>
                  <div style={{ whiteSpace: "pre-wrap", background: "var(--bg-muted)", padding: "0.75rem", borderRadius: "4px" }}>
                    {request.access_notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Colony Information Card */}
          {(request.property_type || request.colony_duration || request.location_description || request.eartip_count !== null || request.count_confidence || request.is_being_fed !== null) && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Colony Information</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                {request.property_type && (
                  <div>
                    <div className="text-muted text-sm">Property Type</div>
                    <div style={{ fontWeight: 500 }}>{request.property_type.replace(/_/g, " ")}</div>
                  </div>
                )}
                {request.colony_duration && (
                  <div>
                    <div className="text-muted text-sm">Colony Duration</div>
                    <div style={{ fontWeight: 500 }}>{request.colony_duration.replace(/_/g, " ")}</div>
                  </div>
                )}
                {request.eartip_count !== null && (
                  <div>
                    <div className="text-muted text-sm">Already Eartipped</div>
                    <div style={{ fontWeight: 500 }}>
                      {request.eartip_count}
                      {request.eartip_estimate && ` (${request.eartip_estimate})`}
                    </div>
                  </div>
                )}
                {request.count_confidence && (
                  <div>
                    <div className="text-muted text-sm">Count Confidence</div>
                    <div style={{ fontWeight: 500 }}>{request.count_confidence}</div>
                  </div>
                )}
                {request.is_being_fed !== null && (
                  <div>
                    <div className="text-muted text-sm">Colony Being Fed?</div>
                    <div style={{ fontWeight: 500, color: request.is_being_fed ? "#198754" : "#6c757d" }}>
                      {request.is_being_fed ? "Yes" : "No / Unknown"}
                    </div>
                  </div>
                )}
                {request.feeder_name && (
                  <div>
                    <div className="text-muted text-sm">Feeder</div>
                    <div style={{ fontWeight: 500 }}>{request.feeder_name}</div>
                  </div>
                )}
                {request.feeding_schedule && (
                  <div>
                    <div className="text-muted text-sm">Feeding Schedule</div>
                    <div style={{ fontWeight: 500 }}>{request.feeding_schedule}</div>
                  </div>
                )}
              </div>
              {request.location_description && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Location Description</div>
                  <div style={{ whiteSpace: "pre-wrap", background: "var(--bg-muted)", padding: "0.75rem", borderRadius: "4px" }}>
                    {request.location_description}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Urgency Information Card */}
          {(request.urgency_reasons?.length || request.urgency_deadline || request.urgency_notes) && (
            <div className="card" style={{
              padding: "1.5rem",
              marginBottom: "1.5rem",
              background: "rgba(220, 53, 69, 0.1)",
              border: "1px solid #dc3545"
            }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "#dc3545" }}>Urgency Details</h2>
              {request.urgency_reasons && request.urgency_reasons.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>Urgency Reasons</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {request.urgency_reasons.map((reason, idx) => (
                      <span
                        key={idx}
                        style={{
                          background: "#dc3545",
                          color: "#fff",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.85rem"
                        }}
                      >
                        {reason.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {request.urgency_deadline && (
                <div style={{ marginBottom: "1rem" }}>
                  <div className="text-muted text-sm">Deadline</div>
                  <div style={{ fontWeight: 500, color: "#dc3545" }}>
                    {new Date(request.urgency_deadline).toLocaleDateString()}
                  </div>
                </div>
              )}
              {request.urgency_notes && (
                <div>
                  <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Urgency Notes</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{request.urgency_notes}</div>
                </div>
              )}
            </div>
          )}

          {/* Readiness & Urgency Scores (if computed) */}
          {(request.readiness_score !== null || request.urgency_score !== null) && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Computed Scores</h2>
              <div style={{ display: "flex", gap: "2rem" }}>
                {request.readiness_score !== null && (
                  <div>
                    <div className="text-muted text-sm">Readiness Score</div>
                    <div style={{
                      fontSize: "1.5rem",
                      fontWeight: 700,
                      color: request.readiness_score >= 70 ? "#198754" : request.readiness_score >= 40 ? "#ffc107" : "#dc3545"
                    }}>
                      {request.readiness_score}
                    </div>
                  </div>
                )}
                {request.urgency_score !== null && (
                  <div>
                    <div className="text-muted text-sm">Urgency Score</div>
                    <div style={{
                      fontSize: "1.5rem",
                      fontWeight: 700,
                      color: request.urgency_score >= 70 ? "#dc3545" : request.urgency_score >= 40 ? "#ffc107" : "#198754"
                    }}>
                      {request.urgency_score}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Clinic Statistics (Alteration Rate) */}
          <AlterationStatsCard
            requestId={request.request_id}
            onUpgradeClick={() => setShowUpgradeWizard(true)}
          />

          {/* Metadata Card */}
          <div className="card" style={{ padding: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Metadata</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <div className="text-muted text-sm">Created</div>
                <div>{new Date(request.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted text-sm">Updated</div>
                <div>{new Date(request.updated_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted text-sm">Source</div>
                <div>{request.data_source}{request.source_system && ` (${request.source_system})`}</div>
              </div>
              {request.created_by && (
                <div>
                  <div className="text-muted text-sm">Created By</div>
                  <div>{request.created_by}</div>
                </div>
              )}
              {request.last_activity_at && (
                <div>
                  <div className="text-muted text-sm">Last Activity</div>
                  <div>
                    {new Date(request.last_activity_at).toLocaleString()}
                    {request.last_activity_type && ` (${request.last_activity_type})`}
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: "1rem" }}>
              <div className="text-muted text-sm">Request ID</div>
              <code style={{ fontSize: "0.8rem" }}>{request.request_id}</code>
            </div>
            {request.source_system?.startsWith("airtable") && request.source_record_id && (
              <div style={{ marginTop: "1rem" }}>
                <a
                  href={`https://airtable.com/appl6zLrRFDvsz0dh/tblc1bva7jFzg8DVF/${request.source_record_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "0.875rem" }}
                >
                  View in Airtable &rarr;
                </a>
              </div>
            )}
          </div>
        </>
      ) : null}

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
