"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import CreateRequestWizard from "@/components/CreateRequestWizard";
import PlaceResolver from "@/components/PlaceResolver";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { formatPhone, isValidPhone, extractPhone, extractPhones } from "@/lib/formatters";

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  first_name?: string;  // Optional - may come from detail fetch
  last_name?: string;   // Optional - may come from detail fetch
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  cats_zip: string | null;
  ownership_status: string;
  cat_count_estimate: number | null;
  fixed_status: string;
  has_kittens: boolean | null;
  kitten_count: number | null;
  has_property_access: boolean | null;
  has_medical_concerns: boolean | null;
  is_emergency: boolean;
  situation_description: string | null;
  triage_category: string | null;
  triage_score: number | null;
  triage_reasons: string[] | null;
  // Unified status (primary)
  submission_status: string | null;
  appointment_date: string | null;
  priority_override: string | null;
  // Native status (kept for transition)
  native_status: string;
  final_category: string | null;
  created_request_id: string | null;
  age: string;
  overdue: boolean;
  is_third_party_report: boolean | null;
  third_party_relationship: string | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  property_owner_email: string | null;
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  legacy_notes: string | null;
  legacy_source_id: string | null;
  review_notes: string | null;
  matched_person_id: string | null;
  intake_source: string | null;
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_confidence: string | null;
  last_contacted_at: string | null;
  contact_attempt_count: number | null;
  is_test: boolean;
}

interface CommunicationLog {
  log_id: string;
  submission_id: string;
  contact_method: string;
  contact_result: string;
  notes: string | null;
  contacted_at: string;
  contacted_by: string | null;
  // New fields from journal integration
  entry_kind?: string;
  created_by_staff_name?: string | null;
  created_by_staff_role?: string | null;
}

interface StaffMember {
  staff_id: string;
  display_name: string;
  role: string;
}

// Contact method options
const CONTACT_METHODS = [
  { value: "phone", label: "Phone Call" },
  { value: "email", label: "Email" },
  { value: "text", label: "Text Message" },
  { value: "voicemail", label: "Voicemail" },
  { value: "in_person", label: "In Person" },
];

// Contact result options
const CONTACT_RESULTS = [
  { value: "answered", label: "Answered / Spoke" },
  { value: "no_answer", label: "No Answer" },
  { value: "left_voicemail", label: "Left Voicemail" },
  { value: "sent", label: "Sent (email/text)" },
  { value: "scheduled", label: "Scheduled Appointment" },
  { value: "other", label: "Other" },
];

// Contact status options (for tracking outreach)
const CONTACT_STATUSES = [
  { value: "", label: "(none)" },
  { value: "Contacted", label: "Contacted" },
  { value: "Contacted multiple times", label: "Contacted multiple times" },
  { value: "Call/Email/No response", label: "No response" },
  { value: "An appointment has been booked", label: "Appointment booked" },
  { value: "Out of County - no appts avail", label: "Out of County" },
  { value: "Sent to Diane/Out of County", label: "Sent to Diane" },
];

// Submission status options (legacy workflow state)
const SUBMISSION_STATUSES = [
  { value: "", label: "(none)" },
  { value: "Pending Review", label: "Pending Review" },
  { value: "Booked", label: "Booked" },
  { value: "Declined", label: "Declined" },
  { value: "Complete", label: "Complete" },
];

// Unified submission status options (new workflow)
const UNIFIED_STATUSES = [
  { value: "new", label: "New", description: "Just submitted, needs attention" },
  { value: "in_progress", label: "In Progress", description: "Being worked on" },
  { value: "scheduled", label: "Scheduled", description: "Appointment booked" },
  { value: "complete", label: "Complete", description: "Done" },
  { value: "archived", label: "Archived", description: "Hidden from queue" },
];

// Priority override options
const PRIORITY_OPTIONS = [
  { value: "", label: "Auto", description: "Use triage score" },
  { value: "high", label: "High", description: "Prioritize this request" },
  { value: "normal", label: "Normal", description: "Standard priority" },
  { value: "low", label: "Low", description: "Lower priority" },
];

// Reasons for removing urgent/emergency flag
// These cover 99% of situations where someone incorrectly marks as urgent
const URGENT_DOWNGRADE_REASONS = [
  {
    value: "not_tnr_related",
    label: "Not TNR-related",
    description: "Request is for services outside our spay/neuter mission (parasite treatment, vaccines, general vet care)",
  },
  {
    value: "needs_emergency_vet",
    label: "Needs emergency vet",
    description: "True emergency (injury, illness, poisoning) - referred to pet hospital",
  },
  {
    value: "stable_situation",
    label: "Situation is stable",
    description: "Cats are being fed, no immediate danger - can be scheduled normally",
  },
  {
    value: "routine_spay_neuter",
    label: "Routine spay/neuter",
    description: "Owned pet or single cat needing standard scheduling, not urgent",
  },
  {
    value: "already_altered",
    label: "Cat(s) already altered",
    description: "Cat is already fixed - no TNR needed, may need other services",
  },
  {
    value: "duplicate_request",
    label: "Duplicate request",
    description: "Same cats/location already being handled in another submission",
  },
  {
    value: "misunderstood_form",
    label: "Form misunderstanding",
    description: "Requester misunderstood what 'urgent' means - normal priority is fine",
  },
];

type TabType = "attention" | "scheduled" | "recent" | "complete" | "all" | "legacy" | "test";

function TriageBadge({ category, score, isLegacy }: { category: string | null; score: number | null; isLegacy: boolean }) {
  if (!category && isLegacy) {
    return (
      <span
        className="badge"
        style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}
      >
        Legacy
      </span>
    );
  }

  if (!category) return null;

  const colors: Record<string, { bg: string; color: string }> = {
    high_priority_tnr: { bg: "#dc3545", color: "#fff" },
    standard_tnr: { bg: "#0d6efd", color: "#fff" },
    wellness_only: { bg: "#20c997", color: "#000" },
    owned_cat_low: { bg: "#6c757d", color: "#fff" },
    out_of_county: { bg: "#adb5bd", color: "#000" },
    needs_review: { bg: "#ffc107", color: "#000" },
  };
  const style = colors[category] || { bg: "#6c757d", color: "#fff" };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span className="badge" style={{ background: style.bg, color: style.color }}>
        {category.replace(/_/g, " ")}
      </span>
      {score !== null && (
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {score}
        </span>
      )}
    </div>
  );
}

// Unified status badge for the new submission_status field
function SubmissionStatusBadge({ status }: { status: string | null }) {
  const colors: Record<string, { bg: string; color: string; label: string }> = {
    "new": { bg: "#0d6efd", color: "#fff", label: "New" },
    "in_progress": { bg: "#fd7e14", color: "#000", label: "In Progress" },
    "scheduled": { bg: "#198754", color: "#fff", label: "Scheduled" },
    "complete": { bg: "#20c997", color: "#000", label: "Complete" },
    "archived": { bg: "#6c757d", color: "#fff", label: "Archived" },
  };
  const style = colors[status || "new"] || { bg: "#6c757d", color: "#fff", label: status || "Unknown" };

  return (
    <span className="badge" style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}>
      {style.label}
    </span>
  );
}

function LegacyStatusBadge({ status }: { status: string | null }) {
  // Show "New" for null/empty status instead of nothing
  const displayStatus = status || "New";

  const colors: Record<string, { bg: string; color: string }> = {
    "New": { bg: "#0dcaf0", color: "#000" },
    "Pending Review": { bg: "#ffc107", color: "#000" },
    "Booked": { bg: "#198754", color: "#fff" },
    "Declined": { bg: "#dc3545", color: "#fff" },
    "Complete": { bg: "#20c997", color: "#000" },
  };
  const style = colors[displayStatus] || { bg: "#6c757d", color: "#fff" };

  return (
    <span className="badge" style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}>
      {displayStatus}
    </span>
  );
}

function ContactStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const shortLabel: Record<string, string> = {
    "Contacted": "Contacted",
    "Contacted multiple times": "Multiple attempts",
    "Call/Email/No response": "No response",
    "An appointment has been booked": "Appt booked",
    "Out of County - no appts avail": "Out of County",
    "Sent to Diane/Out of County": "Sent to Diane",
  };

  return (
    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
      {shortLabel[status] || status}
    </span>
  );
}

function formatAge(age: unknown): string {
  if (!age) return "";
  const ageStr = typeof age === "string" ? age : String(age);

  const daysMatch = ageStr.match(/(\d+)\s+days?/);
  const timeMatch = ageStr.match(/(\d+):(\d+):(\d+)/);

  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    if (days >= 7) return `${Math.floor(days / 7)}w ${days % 7}d`;
    return `${days}d`;
  }

  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h`;
    return `${parseInt(timeMatch[2])}m`;
  }

  return ageStr;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString();
}

function normalizeName(name: string | null): string {
  if (!name) return "";
  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    return name
      .toLowerCase()
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return name;
}

function IntakeQueueContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const openSubmissionId = searchParams.get("open");

  const [submissions, setSubmissions] = useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const { filters, setFilter } = useUrlFilters({
    tab: "attention",
    category: "",
    q: "",
    sort: "date",
    order: "desc",
    group: "",
  });
  const activeTab = filters.tab as TabType;
  const setActiveTab = (v: TabType) => setFilter("tab", v);
  const categoryFilter = filters.category;
  const setCategoryFilter = (v: string) => setFilter("category", v);
  const searchQuery = filters.q;
  const [searchInput, setSearchInput] = useState(filters.q);
  const sortBy = filters.sort as "date" | "category" | "type";
  const setSortBy = (v: "date" | "category" | "type") => setFilter("sort", v);
  const sortOrder = filters.order as "asc" | "desc";
  const setSortOrder = (v: "asc" | "desc") => setFilter("order", v);
  const groupBy = filters.group as "" | "category" | "type" | "status";
  const setGroupBy = (v: "" | "category" | "type" | "status") => setFilter("group", v);
  const [selectedSubmission, setSelectedSubmission] = useState<IntakeSubmission | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusEdits, setStatusEdits] = useState({
    // Unified status fields (primary)
    submission_status: "",
    appointment_date: "",
    priority_override: "",
    // Legacy fields (for backward compatibility)
    legacy_status: "",
    legacy_submission_status: "",
    legacy_appointment_date: "",
    legacy_notes: "",
  });
  const [initialOpenHandled, setInitialOpenHandled] = useState(false);

  // Communication log state
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactModalSubmission, setContactModalSubmission] = useState<IntakeSubmission | null>(null);
  const [communicationLogs, setCommunicationLogs] = useState<CommunicationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Urgent downgrade state
  const [showUrgentDowngrade, setShowUrgentDowngrade] = useState(false);
  const [urgentDowngradeReason, setUrgentDowngradeReason] = useState("");
  const [savingUrgentDowngrade, setSavingUrgentDowngrade] = useState(false);
  const [contactForm, setContactForm] = useState({
    contact_method: "phone",
    contact_result: "answered",
    notes: "",
    contacted_by: "",
    is_journal_only: false,
  });
  const [showInlineContactForm, setShowInlineContactForm] = useState<"note" | "call" | null>(null);

  // Staff list for dropdown
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Create Request wizard state
  const [showRequestWizard, setShowRequestWizard] = useState(false);
  const [wizardSubmission, setWizardSubmission] = useState<IntakeSubmission | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Appointment booking modal state
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingSubmission, setBookingSubmission] = useState<IntakeSubmission | null>(null);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");

  // Address edit state
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressEdits, setAddressEdits] = useState({
    cats_address: "",
    cats_city: "",
    cats_zip: "",
  });
  const [resolvedQueuePlace, setResolvedQueuePlace] = useState<ResolvedPlace | null>(null);

  // Edit history state
  const [editHistory, setEditHistory] = useState<Array<{
    edit_id: string;
    field_name: string;
    old_value: unknown;
    new_value: unknown;
    edited_at: string;
    edited_by: string;
    edit_reason: string | null;
  }>>([]);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Editable sections state
  const [editingCats, setEditingCats] = useState(false);
  const [catsEdits, setCatsEdits] = useState({
    cat_count_estimate: "",
    ownership_status: "",
    fixed_status: "",
    has_kittens: false,
    has_medical_concerns: false,
  });
  const [editingSituation, setEditingSituation] = useState(false);
  const [situationEdit, setSituationEdit] = useState("");
  const [savingSection, setSavingSection] = useState(false);

  // Contact info editing state
  const [editingContact, setEditingContact] = useState(false);
  const [contactEdits, setContactEdits] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<string>("");

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = (currentSubs: IntakeSubmission[]) => {
    if (selectedIds.size === currentSubs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentSubs.map((s) => s.submission_id)));
    }
  };

  const handleBulkStatusUpdate = async () => {
    if (selectedIds.size === 0 || !bulkStatusTarget) return;
    if (!confirm(`Update ${selectedIds.size} submissions to "${bulkStatusTarget}"?`)) return;

    setBulkUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        fetch(`/api/intake/queue/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submission_status: bulkStatusTarget }),
        })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setBulkStatusTarget("");
      await fetchSubmissions();
    } catch (err) {
      alert("Error updating submissions");
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Archive ${selectedIds.size} submissions?`)) return;

    setBulkUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        fetch(`/api/intake/queue/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submission_status: "archived" }),
        })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      await fetchSubmissions();
    } catch (err) {
      alert("Error archiving submissions");
    } finally {
      setBulkUpdating(false);
    }
  };

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();

      // Tab-based filtering using mode parameter
      // "attention" = actionable items (new + legacy pending/contacted)
      // "recent" = all recent including booked
      // "legacy" = all legacy data for reference
      params.set("mode", activeTab);

      if (categoryFilter) params.set("category", categoryFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const response = await fetch(`/api/intake/queue?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setSubmissions(data.submissions || []);
      }
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, categoryFilter, searchQuery]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Handle opening a specific submission from URL parameter
  useEffect(() => {
    if (openSubmissionId && !initialOpenHandled && !loading) {
      // Try to find in current list first
      const found = submissions.find(s => s.submission_id === openSubmissionId);
      if (found) {
        openDetail(found);
        setInitialOpenHandled(true);
        // Clear the URL parameter
        router.replace("/intake/queue", { scroll: false });
      } else if (submissions.length > 0) {
        // Submission not in current list - fetch directly
        fetch(`/api/intake/queue/${openSubmissionId}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.submission) {
              openDetail(data.submission);
            }
          })
          .catch(err => console.error("Failed to fetch submission:", err))
          .finally(() => {
            setInitialOpenHandled(true);
            router.replace("/intake/queue", { scroll: false });
          });
      }
    }
  }, [openSubmissionId, initialOpenHandled, loading, submissions, router]);

  // Fetch staff list on mount
  useEffect(() => {
    fetch("/api/staff")
      .then((res) => res.json())
      .then((data) => setStaffList(data.staff || []))
      .catch((err) => console.error("Failed to fetch staff:", err));
  }, []);

  // Reset editing states when submission changes
  useEffect(() => {
    setEditingAddress(false);
    setResolvedQueuePlace(null);
    setShowInlineContactForm(null);
  }, [selectedSubmission?.submission_id]);

  // Fetch communication logs when detail modal opens
  useEffect(() => {
    if (selectedSubmission?.submission_id) {
      fetchCommunicationLogs(selectedSubmission.submission_id);
    } else {
      setCommunicationLogs([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubmission?.submission_id]);

  // Fetch communication logs for a submission
  const fetchCommunicationLogs = async (submissionId: string) => {
    setLoadingLogs(true);
    try {
      const response = await fetch(`/api/intake/${submissionId}/communications`);
      if (response.ok) {
        const data = await response.json();
        setCommunicationLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to fetch communication logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Open contact modal for a submission
  const openContactModal = (sub: IntakeSubmission) => {
    setContactModalSubmission(sub);
    setContactForm({
      contact_method: "phone",
      contact_result: "answered",
      notes: "",
      contacted_by: "",
      is_journal_only: false,
    });
    setShowContactModal(true);
    fetchCommunicationLogs(sub.submission_id);
  };

  // Submit new communication log
  const handleSubmitContactLog = async () => {
    if (!contactModalSubmission) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/intake/${contactModalSubmission.submission_id}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });

      if (response.ok) {
        // Refresh logs and submissions
        fetchCommunicationLogs(contactModalSubmission.submission_id);
        fetchSubmissions();
        // Reset form but keep modal open to show updated logs
        setContactForm({
          ...contactForm,
          notes: "",
          is_journal_only: false,
        });
      }
    } catch (err) {
      console.error("Failed to submit contact log:", err);
    } finally {
      setSaving(false);
    }
  };

  const closeContactModal = () => {
    setShowContactModal(false);
    setContactModalSubmission(null);
    setCommunicationLogs([]);
  };

  // Submit inline contact/journal entry (for detail modal)
  const handleInlineContactSubmit = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/intake/${selectedSubmission.submission_id}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });

      if (response.ok) {
        // Refresh logs
        fetchCommunicationLogs(selectedSubmission.submission_id);
        fetchSubmissions();
        // Reset form and close inline form
        setContactForm({
          ...contactForm,
          notes: "",
          is_journal_only: false,
        });
        setShowInlineContactForm(null);
        setToastMessage("Entry added successfully");
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (err) {
      console.error("Failed to submit contact log:", err);
    } finally {
      setSaving(false);
    }
  };

  const fetchEditHistory = async (submissionId: string) => {
    setLoadingHistory(true);
    try {
      const response = await fetch(`/api/intake/queue/${submissionId}/history`);
      if (response.ok) {
        const data = await response.json();
        setEditHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch edit history:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleQuickStatus = async (submissionId: string, field: string, value: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: submissionId,
          [field]: value || null,
        }),
      });

      if (response.ok) {
        fetchSubmissions();
      }
    } catch (err) {
      console.error("Failed to update:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkContacted = (sub: IntakeSubmission) => {
    handleQuickStatus(sub.submission_id, "legacy_status", "Contacted");
  };

  const handleMarkBooked = (sub: IntakeSubmission) => {
    // Show booking modal instead of immediately setting status
    setBookingSubmission(sub);
    setBookingDate("");
    setBookingNotes("");
    setShowBookingModal(true);
  };

  const handleConfirmBooking = async () => {
    if (!bookingSubmission) return;
    const wasAlreadyScheduled = bookingSubmission.submission_status === "scheduled";
    setSaving(true);
    try {
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: bookingSubmission.submission_id,
          // Use unified status
          submission_status: "scheduled",
          appointment_date: bookingDate || null,
          // Also update legacy fields for backward compatibility
          legacy_submission_status: "Booked",
          legacy_appointment_date: bookingDate || null,
          legacy_notes: bookingNotes
            ? (bookingSubmission.legacy_notes ? bookingSubmission.legacy_notes + "\n" + bookingNotes : bookingNotes)
            : bookingSubmission.legacy_notes,
        }),
      });

      if (response.ok) {
        const submitterName = normalizeName(bookingSubmission.submitter_name);
        setShowBookingModal(false);
        setBookingSubmission(null);
        fetchSubmissions();

        // Update selected submission if viewing it
        if (selectedSubmission?.submission_id === bookingSubmission.submission_id) {
          setSelectedSubmission({
            ...selectedSubmission,
            submission_status: "scheduled",
            appointment_date: bookingDate || null,
            legacy_submission_status: "Booked",
            legacy_appointment_date: bookingDate || null,
          });
        }

        // Show toast notification
        if (wasAlreadyScheduled) {
          setToastMessage(`Updated appointment for ${submitterName}`);
        } else {
          setToastMessage(`Scheduled ${submitterName}. Find in "Scheduled" tab.`);
        }
        // Auto-clear toast after 5 seconds
        setTimeout(() => setToastMessage(null), 5000);
      }
    } catch (err) {
      console.error("Failed to schedule:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleChangeAppointment = (sub: IntakeSubmission) => {
    // Open booking modal with existing date pre-filled
    setBookingSubmission(sub);
    setBookingDate(sub.appointment_date || sub.legacy_appointment_date || "");
    setBookingNotes("");
    setShowBookingModal(true);
  };

  const closeBookingModal = () => {
    setShowBookingModal(false);
    setBookingSubmission(null);
    setBookingDate("");
    setBookingNotes("");
  };

  const handleMarkNoResponse = (sub: IntakeSubmission) => {
    handleQuickStatus(sub.submission_id, "legacy_status", "Call/Email/No response");
  };

  const openDetail = (sub: IntakeSubmission) => {
    setSelectedSubmission(sub);
    setStatusEdits({
      // Unified status fields
      submission_status: sub.submission_status || "new",
      appointment_date: sub.appointment_date || "",
      priority_override: sub.priority_override || "",
      // Legacy fields
      legacy_status: sub.legacy_status || "",
      legacy_submission_status: sub.legacy_submission_status || "",
      legacy_appointment_date: sub.legacy_appointment_date || "",
      legacy_notes: sub.legacy_notes || "",
    });
    setEditingStatus(false);
    // Reset edit history when opening a new submission
    setShowEditHistory(false);
    setEditHistory([]);
    // Reset section edit states
    setEditingCats(false);
    setEditingSituation(false);
    setEditingContact(false);
  };

  const handleSaveStatus = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    try {
      // Use the [id] PATCH endpoint for unified status
      const response = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Unified status fields
          submission_status: statusEdits.submission_status || null,
          appointment_date: statusEdits.appointment_date || null,
          priority_override: statusEdits.priority_override || null,
          // Legacy fields (keep for backward compatibility)
          legacy_status: statusEdits.legacy_status || null,
          legacy_submission_status: statusEdits.legacy_submission_status || null,
          legacy_appointment_date: statusEdits.legacy_appointment_date || null,
          legacy_notes: statusEdits.legacy_notes || null,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setEditingStatus(false);
        setSelectedSubmission({
          ...selectedSubmission,
          ...data.submission,
        });
        fetchSubmissions();
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  // Handler for removing urgent flag with reason
  const handleUrgentDowngrade = async () => {
    if (!selectedSubmission || !urgentDowngradeReason) return;
    setSavingUrgentDowngrade(true);

    const reasonInfo = URGENT_DOWNGRADE_REASONS.find(r => r.value === urgentDowngradeReason);
    const noteText = `Urgent flag removed: ${reasonInfo?.label} - ${reasonInfo?.description}`;

    try {
      const response = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_emergency: false,
          review_notes: selectedSubmission.review_notes
            ? `${selectedSubmission.review_notes}\n\n[${new Date().toLocaleDateString()}] ${noteText}`
            : `[${new Date().toLocaleDateString()}] ${noteText}`,
        }),
      });

      if (response.ok) {
        setShowUrgentDowngrade(false);
        setUrgentDowngradeReason("");
        setSelectedSubmission({
          ...selectedSubmission,
          is_emergency: false,
        });
        fetchSubmissions();
      }
    } catch (err) {
      console.error("Failed to remove urgent flag:", err);
    } finally {
      setSavingUrgentDowngrade(false);
    }
  };

  const handleSaveAddress = async () => {
    if (!selectedSubmission) return;
    if (!addressEdits.cats_address.trim()) {
      alert("Street address is required");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cats_address: addressEdits.cats_address.trim(),
          cats_city: addressEdits.cats_city.trim() || null,
          cats_zip: addressEdits.cats_zip.trim() || null,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setEditingAddress(false);
        // Update local state with refreshed submission data
        if (data.submission) {
          setSelectedSubmission(data.submission);
        }
        // Show success message
        if (data.address_relinked) {
          setToastMessage("Address updated and re-linked to place");
        } else {
          setToastMessage("Address updated");
        }
        setTimeout(() => setToastMessage(null), 5000);
        fetchSubmissions();
      } else {
        const err = await response.json();
        alert(err.error || "Failed to update address");
      }
    } catch (err) {
      console.error("Failed to save address:", err);
      alert("Failed to save address");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (submissionId: string) => {
    try {
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: submissionId,
          submission_status: "archived",
          status: "archived", // Keep legacy field updated too
        }),
      });

      if (response.ok) {
        fetchSubmissions();
        setSelectedSubmission(null);
      }
    } catch (err) {
      console.error("Failed to archive:", err);
    }
  };

  const handleOpenRequestWizard = (submission: IntakeSubmission) => {
    setWizardSubmission(submission);
    setShowRequestWizard(true);
    // Close the detail modal if open
    setSelectedSubmission(null);
  };

  const handleRequestWizardComplete = (requestId: string) => {
    setShowRequestWizard(false);
    setWizardSubmission(null);
    fetchSubmissions();
    // Optionally navigate to the new request
    window.location.href = `/requests/${requestId}`;
  };

  const handleRequestWizardCancel = () => {
    setShowRequestWizard(false);
    setWizardSubmission(null);
  };

  // Stats for current view using unified status
  const stats = {
    total: submissions.length,
    new: submissions.filter(s => s.submission_status === "new").length,
    inProgress: submissions.filter(s => s.submission_status === "in_progress").length,
    scheduled: submissions.filter(s => s.submission_status === "scheduled").length,
    complete: submissions.filter(s => s.submission_status === "complete").length,
    highPriority: submissions.filter(s => s.triage_category === "high_priority_tnr").length,
    thirdParty: submissions.filter(s => s.is_third_party_report).length,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Intake Queue</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a
            href="/intake?test=true"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              background: "#0dcaf0",
              color: "#000",
              textDecoration: "none",
              borderRadius: "4px",
              fontSize: "0.85rem",
            }}
            title="Create test submission for demo purposes"
          >
            Demo Test
          </a>
          <a
            href="/intake"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            + New Intake
          </a>
          <a
            href="/intake/print"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            Print Form
          </a>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: "1.5rem",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#198754",
            color: "#fff",
            padding: "0.75rem 1.5rem",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              padding: "0",
              fontSize: "1.2rem",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0", borderBottom: "2px solid var(--border)", marginBottom: "1rem" }}>
        {[
          { id: "attention" as TabType, label: "Needs Attention", count: null },
          { id: "scheduled" as TabType, label: "Scheduled", count: null },
          { id: "recent" as TabType, label: "Recent", count: null },
          { id: "complete" as TabType, label: "Complete", count: null },
          { id: "all" as TabType, label: "All", count: null },
          { id: "legacy" as TabType, label: "Legacy", count: null },
          { id: "test" as TabType, label: "Test", count: null },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "0.75rem 1.5rem",
              border: "none",
              background: activeTab === tab.id ? "var(--foreground)" : "transparent",
              color: activeTab === tab.id ? "var(--background)" : "var(--foreground)",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: activeTab === tab.id ? 600 : 400,
              borderRadius: "6px 6px 0 0",
              marginBottom: "-2px",
              borderBottom: activeTab === tab.id ? "2px solid var(--foreground)" : "2px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search and Filter */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        {/* Search Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", searchInput);
          }}
          style={{ display: "flex", gap: "0.5rem", flex: 1, minWidth: "200px", maxWidth: "400px" }}
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, email, phone, address..."
            style={{ flex: 1, padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border)" }}
          />
          <button
            type="submit"
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Search
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setFilter("q", "");
              }}
              style={{
                padding: "0.5rem 0.75rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </form>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ padding: "0.5rem", minWidth: "180px" }}
        >
          <option value="">All Categories</option>
          <option value="high_priority_tnr">High Priority FFR</option>
          <option value="standard_tnr">Standard FFR</option>
          <option value="wellness_only">Wellness Only</option>
          <option value="owned_cat_low">Owned Cat (Low)</option>
          <option value="out_of_county">Out of County</option>
          <option value="needs_review">Needs Review</option>
        </select>

        {/* Sort controls */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "date" | "category" | "type")}
          style={{ padding: "0.5rem", minWidth: "130px" }}
        >
          <option value="date">Sort by Date</option>
          <option value="category">Sort by Category</option>
          <option value="type">Sort by Type</option>
        </select>

        {/* Group by */}
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as "" | "category" | "type" | "status")}
          style={{ padding: "0.5rem", minWidth: "120px" }}
        >
          <option value="">No grouping</option>
          <option value="category">Group by Category</option>
          <option value="type">Group by Type</option>
          <option value="status">Group by Status</option>
        </select>

        <button
          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          style={{ padding: "0.5rem", minWidth: "40px" }}
          title={sortOrder === "asc" ? "Oldest first" : "Newest first"}
        >
          {sortOrder === "asc" ? "↑" : "↓"}
        </button>

        <button onClick={fetchSubmissions} style={{ padding: "0.5rem 1rem" }}>
          Refresh
        </button>

        <span style={{ color: "var(--muted)", fontSize: "0.875rem", marginLeft: "auto" }}>
          {submissions.length} submissions
        </span>
      </div>

      {/* Quick stats for current tab */}
      {stats.total > 0 && (
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          {stats.new > 0 && (
            <span style={{ padding: "0.25rem 0.75rem", background: "#0d6efd", color: "#fff", borderRadius: "12px", fontSize: "0.8rem" }}>
              {stats.new} New
            </span>
          )}
          {stats.inProgress > 0 && (
            <span style={{ padding: "0.25rem 0.75rem", background: "#fd7e14", color: "#000", borderRadius: "12px", fontSize: "0.8rem" }}>
              {stats.inProgress} In Progress
            </span>
          )}
          {stats.scheduled > 0 && (
            <span style={{ padding: "0.25rem 0.75rem", background: "#198754", color: "#fff", borderRadius: "12px", fontSize: "0.8rem" }}>
              {stats.scheduled} Scheduled
            </span>
          )}
          {activeTab !== "attention" && stats.complete > 0 && (
            <span style={{ padding: "0.25rem 0.75rem", background: "#20c997", color: "#000", borderRadius: "12px", fontSize: "0.8rem" }}>
              {stats.complete} Complete
            </span>
          )}
          {stats.highPriority > 0 && (
            <span style={{ padding: "0.25rem 0.75rem", background: "#dc3545", color: "#fff", borderRadius: "12px", fontSize: "0.8rem" }}>
              {stats.highPriority} High Priority
            </span>
          )}
          {stats.thirdParty > 0 && (
            <span style={{ padding: "0.25rem 0.75rem", background: "#ffc107", color: "#000", borderRadius: "12px", fontSize: "0.8rem" }}>
              {stats.thirdParty} Third-Party
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : submissions.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          {activeTab === "attention" ? (
            <>
              <p style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>All caught up!</p>
              <p>No new submissions need attention right now.</p>
            </>
          ) : (
            <p>No submissions found</p>
          )}
        </div>
      ) : (() => {
        // Sort submissions
        const sortedSubmissions = [...submissions].sort((a, b) => {
          let comparison = 0;
          if (sortBy === "date") {
            comparison = new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
          } else if (sortBy === "category") {
            comparison = (a.triage_category || "zzz").localeCompare(b.triage_category || "zzz");
          } else if (sortBy === "type") {
            comparison = (a.is_legacy ? 1 : 0) - (b.is_legacy ? 1 : 0);
          }
          return sortOrder === "asc" ? comparison : -comparison;
        });

        // Group submissions if groupBy is set
        const groupedSubmissions = groupBy
          ? sortedSubmissions.reduce((acc, sub) => {
              let key = "";
              if (groupBy === "category") {
                key = sub.triage_category?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Uncategorized";
              } else if (groupBy === "type") {
                key = sub.is_legacy ? "Legacy (Airtable)" : "Native (Atlas)";
              } else if (groupBy === "status") {
                key = (sub.submission_status || "unknown").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              }
              if (!acc[key]) acc[key] = [];
              acc[key].push(sub);
              return acc;
            }, {} as Record<string, IntakeSubmission[]>)
          : { "": sortedSubmissions };

        const groupOrder = groupBy === "type"
          ? ["Native (Atlas)", "Legacy (Airtable)"]
          : groupBy === "category"
          ? ["High Priority Tnr", "Standard Tnr", "Wellness Only", "Owned Cat Low", "Out Of County", "Needs Review", "Uncategorized"]
          : ["New", "Reviewed", "Converted", "Rejected"];

        const sortedGroups = Object.entries(groupedSubmissions).sort(([a], [b]) => {
          const aIdx = groupOrder.indexOf(a);
          const bIdx = groupOrder.indexOf(b);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });

        return (
        <div>
          {/* Bulk Action Bar */}
          {selectedIds.size > 0 && (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "#dbeafe",
                borderRadius: "8px",
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <span style={{ fontWeight: 500, color: "#1e40af" }}>
                {selectedIds.size} submission{selectedIds.size !== 1 ? "s" : ""} selected
              </span>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={bulkStatusTarget}
                  onChange={(e) => setBulkStatusTarget(e.target.value)}
                  style={{ minWidth: "140px", padding: "0.4rem 0.5rem", fontSize: "0.875rem" }}
                >
                  <option value="">Change status to...</option>
                  <option value="new">New</option>
                  <option value="in_progress">In Progress</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="complete">Complete</option>
                </select>
                <button
                  onClick={handleBulkStatusUpdate}
                  disabled={!bulkStatusTarget || bulkUpdating}
                  style={{
                    padding: "0.4rem 0.75rem",
                    border: "none",
                    borderRadius: "6px",
                    background: bulkStatusTarget ? "#2563eb" : "#94a3b8",
                    color: "white",
                    cursor: bulkStatusTarget && !bulkUpdating ? "pointer" : "not-allowed",
                    fontSize: "0.875rem",
                  }}
                >
                  {bulkUpdating ? "Updating..." : "Apply"}
                </button>
                <button
                  onClick={handleBulkArchive}
                  disabled={bulkUpdating}
                  style={{
                    padding: "0.4rem 0.75rem",
                    border: "1px solid #dc2626",
                    borderRadius: "6px",
                    background: "transparent",
                    color: "#dc2626",
                    cursor: bulkUpdating ? "not-allowed" : "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Archive
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  style={{
                    padding: "0.4rem 0.75rem",
                    border: "1px solid #64748b",
                    borderRadius: "6px",
                    background: "transparent",
                    color: "#64748b",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

        <div className="table-container">
          {sortedGroups.map(([groupName, groupSubs]) => (
            <div key={groupName || "all"} style={{ marginBottom: groupBy ? "2rem" : 0 }}>
              {groupBy && (
                <h3 style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  marginBottom: "0.75rem",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem"
                }}>
                  {groupName}
                  <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "var(--muted)" }}>
                    ({groupSubs.length})
                  </span>
                </h3>
              )}
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === sortedSubmissions.length && sortedSubmissions.length > 0}
                    onChange={() => toggleSelectAll(sortedSubmissions)}
                  />
                </th>
                <th style={{ width: "60px" }}>Type</th>
                <th style={{ width: "180px" }}>Submitter</th>
                <th style={{ width: "200px" }}>Location</th>
                <th style={{ width: "80px" }}>Cats</th>
                <th style={{ width: "120px" }}>Status</th>
                <th style={{ width: "80px" }}>Submitted</th>
                <th style={{ width: "200px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupSubs.map((sub) => (
                <tr
                  key={sub.submission_id}
                  style={{
                    background: selectedIds.has(sub.submission_id)
                      ? "#dbeafe"
                      : sub.is_emergency
                      ? "rgba(220, 53, 69, 0.1)"
                      : sub.submission_status === "scheduled"
                      ? "rgba(25, 135, 84, 0.05)"
                      : sub.submission_status === "complete"
                      ? "rgba(32, 201, 151, 0.05)"
                      : undefined,
                  }}
                >
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(sub.submission_id)}
                      onChange={() => toggleSelect(sub.submission_id)}
                    />
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: sub.is_legacy ? "#6c757d" : "#198754",
                        color: "#fff",
                        fontSize: "0.65rem",
                      }}
                    >
                      {sub.is_legacy ? "Legacy" : "Native"}
                    </span>
                  </td>
                  <td>
                    <div
                      style={{ fontWeight: 500, cursor: "pointer" }}
                      onClick={() => openDetail(sub)}
                    >
                      {normalizeName(sub.submitter_name)}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.email}</div>
                    {sub.phone && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                        {formatPhone(sub.phone)}
                        {!isValidPhone(sub.phone) && (
                          <span
                            style={{ fontSize: "0.6rem", background: "#ffc107", color: "#000", padding: "1px 4px", borderRadius: "3px", cursor: "help" }}
                            title={extractPhone(sub.phone) ? `Likely: ${formatPhone(extractPhone(sub.phone))}` : "Invalid phone format"}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                    )}
                    {sub.is_third_party_report && (
                      <span style={{ fontSize: "0.65rem", background: "#ffc107", color: "#000", padding: "1px 4px", borderRadius: "3px" }}>
                        3RD PARTY
                      </span>
                    )}
                    {sub.is_test && (
                      <span style={{ fontSize: "0.65rem", background: "#dc3545", color: "#fff", padding: "1px 4px", borderRadius: "3px", marginLeft: "4px" }}>
                        TEST
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ cursor: "pointer" }} onClick={() => openDetail(sub)}>
                      {/* Show geocoded address if available, otherwise original */}
                      {sub.geo_formatted_address || sub.cats_address}
                    </div>
                    {sub.geo_formatted_address && sub.geo_formatted_address !== sub.cats_address && (
                      <div style={{ fontSize: "0.65rem", color: "var(--muted)", fontStyle: "italic" }}>
                        (original: {sub.cats_address})
                      </div>
                    )}
                    {!sub.geo_formatted_address && sub.cats_city && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.cats_city}</div>
                    )}
                    {!sub.geo_formatted_address && sub.geo_confidence === null && (
                      <span style={{ fontSize: "0.6rem", background: "#ffc107", color: "#000", padding: "1px 4px", borderRadius: "2px" }}>
                        needs geocoding
                      </span>
                    )}
                  </td>
                  <td>
                    <div>{sub.cat_count_estimate ?? "?"}</div>
                    {sub.has_kittens && <span style={{ fontSize: "0.7rem", color: "#fd7e14" }}>+kittens</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {/* Unified status badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <SubmissionStatusBadge status={sub.submission_status} />
                        {sub.overdue && (
                          <span style={{ fontSize: "0.6rem", background: "#ffc107", color: "#000", padding: "1px 4px", borderRadius: "3px" }} title="No activity for 48+ hours">
                            STALE
                          </span>
                        )}
                      </div>
                      {/* Triage category if available */}
                      {sub.triage_category && (
                        <span
                          className="badge"
                          style={{
                            background: sub.triage_category === "high_priority_tnr" ? "#dc3545" :
                                       sub.triage_category === "standard_tnr" ? "#0d6efd" :
                                       "#6c757d",
                            color: "#fff",
                            fontSize: "0.6rem",
                          }}
                        >
                          {sub.triage_category.replace(/_/g, " ")}
                        </span>
                      )}
                      {/* Appointment date if scheduled */}
                      {sub.appointment_date && (
                        <span style={{ fontSize: "0.7rem", color: "#198754" }}>
                          {formatDate(sub.appointment_date)}
                        </span>
                      )}
                      {sub.is_emergency && (
                        <span style={{ color: "#dc3545", fontSize: "0.7rem", fontWeight: "bold" }}>URGENT</span>
                      )}
                      {sub.is_test && (
                        <span style={{
                          background: "#0dcaf0",
                          color: "#000",
                          fontSize: "0.65rem",
                          fontWeight: "bold",
                          padding: "1px 4px",
                          borderRadius: "3px"
                        }}>TEST</span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                    {formatDate(sub.submitted_at)}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                      {/* Log Contact button - always visible */}
                      <button
                        onClick={() => openContactModal(sub)}
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.7rem",
                          background: "#6f42c1",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                        title={sub.contact_attempt_count ? `${sub.contact_attempt_count} contact attempts` : "Log a contact attempt"}
                      >
                        Log {sub.contact_attempt_count ? `(${sub.contact_attempt_count})` : ""}
                      </button>
                      {/* Status-based actions */}
                      {sub.submission_status === "new" && (
                        <button
                          onClick={() => handleQuickStatus(sub.submission_id, "submission_status", "in_progress")}
                          disabled={saving}
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.7rem",
                            background: "#fd7e14",
                            color: "#000",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Working
                        </button>
                      )}
                      {(sub.submission_status === "new" || sub.submission_status === "in_progress") && (
                        <button
                          onClick={() => handleMarkBooked(sub)}
                          disabled={saving}
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.7rem",
                            background: "#198754",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Schedule
                        </button>
                      )}
                      {sub.submission_status === "scheduled" && (
                        <>
                          <button
                            onClick={() => handleChangeAppointment(sub)}
                            disabled={saving}
                            style={{
                              padding: "0.25rem 0.5rem",
                              fontSize: "0.7rem",
                              background: "#0d6efd",
                              color: "#fff",
                              border: "none",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                            title={sub.appointment_date ? `Appt: ${formatDate(sub.appointment_date)}` : "No date set"}
                          >
                            Edit Date
                          </button>
                          <button
                            onClick={() => handleQuickStatus(sub.submission_id, "submission_status", "complete")}
                            disabled={saving}
                            style={{
                              padding: "0.25rem 0.5rem",
                              fontSize: "0.7rem",
                              background: "#20c997",
                              color: "#000",
                              border: "none",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            Done
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => openDetail(sub)}
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.7rem",
                          background: "transparent",
                          border: "1px solid var(--border)",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          ))}
        </div>
        </div>
        );
      })()}

      {/* Detail Modal */}
      {selectedSubmission && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setSelectedSubmission(null)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "700px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with Contact Editing */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
              <div style={{ flex: 1 }}>
                {editingContact ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>First Name</label>
                        <input
                          type="text"
                          value={contactEdits.first_name}
                          onChange={(e) => setContactEdits({ ...contactEdits, first_name: e.target.value })}
                          style={{ width: "100%", padding: "0.375rem", fontSize: "0.9rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>Last Name</label>
                        <input
                          type="text"
                          value={contactEdits.last_name}
                          onChange={(e) => setContactEdits({ ...contactEdits, last_name: e.target.value })}
                          style={{ width: "100%", padding: "0.375rem", fontSize: "0.9rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                        />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>Email</label>
                        <input
                          type="email"
                          value={contactEdits.email}
                          onChange={(e) => setContactEdits({ ...contactEdits, email: e.target.value })}
                          style={{ width: "100%", padding: "0.375rem", fontSize: "0.9rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>
                          Phone
                          {contactEdits.phone && !isValidPhone(contactEdits.phone) && (
                            <span style={{ color: "#dc3545", marginLeft: "4px" }}>⚠ Invalid</span>
                          )}
                        </label>
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                          <input
                            type="tel"
                            value={contactEdits.phone}
                            onChange={(e) => setContactEdits({ ...contactEdits, phone: e.target.value })}
                            style={{
                              flex: 1,
                              minWidth: "140px",
                              padding: "0.375rem",
                              fontSize: "0.9rem",
                              borderRadius: "4px",
                              border: `1px solid ${contactEdits.phone && !isValidPhone(contactEdits.phone) ? "#dc3545" : "var(--border)"}`,
                            }}
                          />
                          {contactEdits.phone && !isValidPhone(contactEdits.phone) && (() => {
                            const phones = extractPhones(contactEdits.phone);
                            if (phones.length === 0) return null;
                            if (phones.length === 1) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setContactEdits({ ...contactEdits, phone: phones[0] })}
                                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                                  title={`Fix to: ${formatPhone(phones[0])}`}
                                >
                                  Fix
                                </button>
                              );
                            }
                            // Multiple phones found - show options
                            return phones.map((p, i) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setContactEdits({ ...contactEdits, phone: p })}
                                style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem", background: i === 0 ? "#198754" : "#0d6efd", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                                title={`Use: ${formatPhone(p)}`}
                              >
                                {i === 0 ? "Primary" : `Alt ${i}`}: {formatPhone(p)}
                              </button>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem" }}>
                      <button
                        onClick={async () => {
                          setSavingSection(true);
                          try {
                            const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                first_name: contactEdits.first_name || null,
                                last_name: contactEdits.last_name || null,
                                email: contactEdits.email || null,
                                phone: contactEdits.phone || null,
                              }),
                            });
                            if (res.ok) {
                              const data = await res.json();
                              // Update local state with new name constructed from first/last
                              const newName = `${contactEdits.first_name || ""} ${contactEdits.last_name || ""}`.trim();
                              setSelectedSubmission({
                                ...selectedSubmission,
                                ...data.submission,
                                submitter_name: newName || selectedSubmission.submitter_name,
                                email: contactEdits.email || selectedSubmission.email,
                                phone: contactEdits.phone || selectedSubmission.phone,
                              });
                              setEditingContact(false);
                              fetchSubmissions();
                            }
                          } catch (err) {
                            console.error("Failed to save contact:", err);
                          } finally {
                            setSavingSection(false);
                          }
                        }}
                        disabled={savingSection}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                      >
                        {savingSection ? "..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingContact(false)}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <h2 style={{ margin: 0 }}>{normalizeName(selectedSubmission.submitter_name)}</h2>
                      <button
                        onClick={() => {
                          // Parse submitter_name into first/last name
                          const nameParts = (selectedSubmission.submitter_name || "").trim().split(" ");
                          const firstName = nameParts[0] || "";
                          const lastName = nameParts.slice(1).join(" ") || "";
                          setContactEdits({
                            first_name: selectedSubmission.first_name || firstName,
                            last_name: selectedSubmission.last_name || lastName,
                            email: selectedSubmission.email || "",
                            phone: selectedSubmission.phone || "",
                          });
                          setEditingContact(true);
                        }}
                        style={{ padding: "0.125rem 0.375rem", fontSize: "0.7rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", color: "var(--muted)" }}
                        title="Edit contact info"
                      >
                        Edit
                      </button>
                    </div>
                    <p style={{ color: "var(--muted)", margin: "0.25rem 0", fontSize: "0.9rem" }}>
                      {selectedSubmission.email}
                      {selectedSubmission.phone && (
                        <>
                          {` | ${formatPhone(selectedSubmission.phone)}`}
                          {!isValidPhone(selectedSubmission.phone) && (
                            <span
                              style={{ fontSize: "0.7rem", background: "#ffc107", color: "#000", padding: "1px 4px", borderRadius: "3px", marginLeft: "4px", cursor: "help" }}
                              title={extractPhone(selectedSubmission.phone) ? `Click Edit to fix. Likely: ${formatPhone(extractPhone(selectedSubmission.phone))}` : "Invalid phone - click Edit to correct"}
                            >
                              ⚠ Invalid
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  </>
                )}
                <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.8rem" }}>
                  Submitted {formatDate(selectedSubmission.submitted_at)}
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {selectedSubmission.is_test && (
                  <span style={{ background: "#dc3545", color: "#fff", padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: "bold" }}>
                    TEST
                  </span>
                )}
                {selectedSubmission.is_legacy && (
                  <span style={{ background: "#6c757d", color: "#fff", padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem" }}>
                    Legacy
                  </span>
                )}
                <SubmissionStatusBadge status={selectedSubmission.submission_status} />
              </div>
            </div>

            {selectedSubmission.is_emergency ? (
              <div style={{ background: "rgba(220, 53, 69, 0.15)", padding: "0.75rem", borderRadius: "8px", marginBottom: "1rem", border: "1px solid rgba(220, 53, 69, 0.3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ color: "#dc3545", fontWeight: "bold" }}>MARKED AS URGENT</span>
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#856404" }}>
                      True emergencies (injury, illness) should be referred to a pet hospital. We are a spay/neuter clinic, not an emergency vet.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowUrgentDowngrade(true)}
                    style={{
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.8rem",
                      background: "#fff",
                      border: "1px solid #dc3545",
                      color: "#dc3545",
                      borderRadius: "4px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Remove Urgent Flag
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ is_emergency: true }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setSelectedSubmission({ ...selectedSubmission, ...data.submission, is_emergency: true });
                      setSubmissions(submissions.map(s =>
                        s.submission_id === selectedSubmission.submission_id
                          ? { ...s, is_emergency: true }
                          : s
                      ));
                    }
                  } catch (err) {
                    console.error("Failed to mark as urgent:", err);
                  }
                }}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.8rem",
                  background: "transparent",
                  border: "1px dashed #dc3545",
                  color: "#dc3545",
                  borderRadius: "4px",
                  cursor: "pointer",
                  marginBottom: "1rem",
                }}
              >
                + Mark as Urgent
              </button>
            )}

            {/* Urgent downgrade reason picker */}
            {showUrgentDowngrade && (
              <div style={{
                background: "#fff",
                border: "1px solid #dee2e6",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>Why is this not urgent?</h4>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Select a reason to help track common misunderstandings and improve our intake form.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
                  {URGENT_DOWNGRADE_REASONS.map((reason) => (
                    <label
                      key={reason.value}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        padding: "0.5rem",
                        background: urgentDowngradeReason === reason.value ? "rgba(25, 135, 84, 0.1)" : "var(--bg-muted, #f8f9fa)",
                        borderRadius: "4px",
                        cursor: "pointer",
                        border: urgentDowngradeReason === reason.value ? "1px solid #198754" : "1px solid transparent",
                      }}
                    >
                      <input
                        type="radio"
                        name="urgentReason"
                        value={reason.value}
                        checked={urgentDowngradeReason === reason.value}
                        onChange={(e) => setUrgentDowngradeReason(e.target.value)}
                        style={{ marginTop: "0.2rem" }}
                      />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: "0.85rem" }}>{reason.label}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{reason.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => {
                      setShowUrgentDowngrade(false);
                      setUrgentDowngradeReason("");
                    }}
                    style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUrgentDowngrade}
                    disabled={!urgentDowngradeReason || savingUrgentDowngrade}
                    style={{
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.85rem",
                      background: urgentDowngradeReason ? "#198754" : "#6c757d",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: urgentDowngradeReason ? "pointer" : "not-allowed",
                    }}
                  >
                    {savingUrgentDowngrade ? "Saving..." : "Remove Urgent Flag"}
                  </button>
                </div>
              </div>
            )}

            {/* Status Section - Unified workflow */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Status & Priority</h3>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                {/* Status dropdown - always visible, saves on change */}
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Status</label>
                  <select
                    value={statusEdits.submission_status || selectedSubmission.submission_status || "new"}
                    onChange={async (e) => {
                      const newStatus = e.target.value;
                      setStatusEdits({ ...statusEdits, submission_status: newStatus });
                      // Auto-save on change
                      try {
                        const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ submission_status: newStatus }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setSelectedSubmission({ ...selectedSubmission, ...data.submission, submission_status: newStatus });
                          fetchSubmissions();
                        }
                      } catch (err) {
                        console.error("Failed to update status:", err);
                      }
                    }}
                    style={{ width: "100%", padding: "0.5rem", fontWeight: 500 }}
                  >
                    {UNIFIED_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                {/* Priority dropdown */}
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Priority {selectedSubmission.triage_score && !statusEdits.priority_override && (
                      <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                        (Score: {selectedSubmission.triage_score})
                      </span>
                    )}
                  </label>
                  <select
                    value={statusEdits.priority_override || selectedSubmission.priority_override || ""}
                    onChange={async (e) => {
                      const newPriority = e.target.value;
                      setStatusEdits({ ...statusEdits, priority_override: newPriority });
                      // Auto-save on change
                      try {
                        const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ priority_override: newPriority || null }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setSelectedSubmission({ ...selectedSubmission, ...data.submission, priority_override: newPriority || null });
                          fetchSubmissions();
                        }
                      } catch (err) {
                        console.error("Failed to update priority:", err);
                      }
                    }}
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {/* Appointment date - shown when status is scheduled */}
                {(statusEdits.submission_status === "scheduled" || selectedSubmission.submission_status === "scheduled") && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Appointment Date</label>
                    <input
                      type="date"
                      value={statusEdits.appointment_date || selectedSubmission.appointment_date || ""}
                      onChange={async (e) => {
                        const newDate = e.target.value;
                        setStatusEdits({ ...statusEdits, appointment_date: newDate });
                        // Auto-save on change
                        try {
                          const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ appointment_date: newDate || null }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setSelectedSubmission({ ...selectedSubmission, ...data.submission, appointment_date: newDate || null });
                            fetchSubmissions();
                          }
                        } catch (err) {
                          console.error("Failed to update appointment:", err);
                        }
                      }}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                )}
              </div>

              {/* Legacy status section - collapsible for backward compatibility */}
              {selectedSubmission.is_legacy && (
                <details style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                    Legacy Status Fields
                  </summary>
                  <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "rgba(0,0,0,0.03)", borderRadius: "4px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div><strong>Contact:</strong> {selectedSubmission.legacy_status || "(none)"}</div>
                      <div><strong>Status:</strong> {selectedSubmission.legacy_submission_status || "(none)"}</div>
                      {selectedSubmission.legacy_appointment_date && (
                        <div><strong>Appt:</strong> {formatDate(selectedSubmission.legacy_appointment_date)}</div>
                      )}
                    </div>
                  </div>
                </details>
              )}
            </div>

            {/* Location */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Location</h3>
                {!editingAddress ? (
                  <button
                    onClick={() => {
                      setAddressEdits({
                        cats_address: selectedSubmission.cats_address || "",
                        cats_city: selectedSubmission.cats_city || "",
                        cats_zip: "",
                      });
                      setEditingAddress(true);
                    }}
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.75rem",
                      background: "transparent",
                      border: "1px solid var(--muted)",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Edit Address
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => setEditingAddress(false)}
                      style={{
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.75rem",
                        background: "transparent",
                        border: "1px solid var(--muted)",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveAddress}
                      disabled={saving}
                      style={{
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.75rem",
                        background: "#198754",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </div>

              {!editingAddress ? (
                <>
                  <p style={{ margin: 0 }}>{selectedSubmission.cats_address}</p>
                  {selectedSubmission.cats_city && <p style={{ margin: 0, color: "var(--muted)" }}>{selectedSubmission.cats_city}</p>}
                  {selectedSubmission.geo_formatted_address && selectedSubmission.geo_formatted_address !== selectedSubmission.cats_address && (
                    <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                      Geocoded: {selectedSubmission.geo_formatted_address}
                    </p>
                  )}
                  {!selectedSubmission.geo_formatted_address && selectedSubmission.geo_confidence === null && (
                    <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "#fd7e14" }}>
                      ⚠ Address needs geocoding - consider correcting if vague
                    </p>
                  )}
                </>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--muted)" }}>
                      Street Address * (start typing for suggestions)
                    </label>
                    <PlaceResolver
                      value={resolvedQueuePlace}
                      onChange={(place) => {
                        setResolvedQueuePlace(place);
                        if (place) {
                          setAddressEdits({
                            cats_address: place.formatted_address || place.display_name || "",
                            cats_city: place.locality || "",
                            cats_zip: "",
                          });
                        }
                      }}
                      placeholder="Start typing address..."
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--muted)" }}>
                        City
                      </label>
                      <input
                        type="text"
                        value={addressEdits.cats_city}
                        onChange={(e) => setAddressEdits({ ...addressEdits, cats_city: e.target.value })}
                        placeholder="Santa Rosa"
                        style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--muted)" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--muted)" }}>
                        ZIP
                      </label>
                      <input
                        type="text"
                        value={addressEdits.cats_zip}
                        onChange={(e) => setAddressEdits({ ...addressEdits, cats_zip: e.target.value })}
                        placeholder="95401"
                        style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--muted)" }}
                      />
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                    Select from suggestions or type manually. Address will be linked to the correct place.
                  </p>
                </div>
              )}
            </div>

            {/* Cats */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Cats</h3>
                {!editingCats ? (
                  <button
                    onClick={() => {
                      setCatsEdits({
                        cat_count_estimate: selectedSubmission.cat_count_estimate?.toString() || "",
                        ownership_status: selectedSubmission.ownership_status || "",
                        fixed_status: selectedSubmission.fixed_status || "",
                        has_kittens: selectedSubmission.has_kittens || false,
                        has_medical_concerns: selectedSubmission.has_medical_concerns || false,
                      });
                      setEditingCats(true);
                    }}
                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                  >
                    Edit
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <button
                      onClick={async () => {
                        setSavingSection(true);
                        try {
                          const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              cat_count_estimate: catsEdits.cat_count_estimate ? parseInt(catsEdits.cat_count_estimate) : null,
                              ownership_status: catsEdits.ownership_status || null,
                              fixed_status: catsEdits.fixed_status || null,
                              has_kittens: catsEdits.has_kittens,
                              has_medical_concerns: catsEdits.has_medical_concerns,
                            }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setSelectedSubmission({ ...selectedSubmission, ...data.submission });
                            setEditingCats(false);
                            fetchSubmissions();
                          }
                        } catch (err) {
                          console.error("Failed to save:", err);
                        } finally {
                          setSavingSection(false);
                        }
                      }}
                      disabled={savingSection}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                    >
                      {savingSection ? "..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingCats(false)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              {editingCats ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Count</label>
                    <input
                      type="number"
                      value={catsEdits.cat_count_estimate}
                      onChange={(e) => setCatsEdits({ ...catsEdits, cat_count_estimate: e.target.value })}
                      style={{ width: "100%", padding: "0.375rem", fontSize: "0.85rem" }}
                      min="1"
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Type</label>
                    <select
                      value={catsEdits.ownership_status}
                      onChange={(e) => setCatsEdits({ ...catsEdits, ownership_status: e.target.value })}
                      style={{ width: "100%", padding: "0.375rem", fontSize: "0.85rem" }}
                    >
                      <option value="">Select...</option>
                      <option value="unknown_stray">Stray cat</option>
                      <option value="community_colony">Community/Colony</option>
                      <option value="newcomer">Newcomer</option>
                      <option value="neighbors_cat">Neighbor's cat</option>
                      <option value="my_cat">My own pet</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Fixed Status</label>
                    <select
                      value={catsEdits.fixed_status}
                      onChange={(e) => setCatsEdits({ ...catsEdits, fixed_status: e.target.value })}
                      style={{ width: "100%", padding: "0.375rem", fontSize: "0.85rem" }}
                    >
                      <option value="">Select...</option>
                      <option value="none_fixed">None fixed</option>
                      <option value="some_fixed">Some fixed</option>
                      <option value="all_fixed">All fixed</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={catsEdits.has_kittens}
                        onChange={(e) => setCatsEdits({ ...catsEdits, has_kittens: e.target.checked })}
                      />
                      Kittens present
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={catsEdits.has_medical_concerns}
                        onChange={(e) => setCatsEdits({ ...catsEdits, has_medical_concerns: e.target.checked })}
                      />
                      Medical concerns
                    </label>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div><strong>Count:</strong> {selectedSubmission.cat_count_estimate ?? "Unknown"}</div>
                  {selectedSubmission.ownership_status && <div><strong>Type:</strong> {selectedSubmission.ownership_status.replace(/_/g, " ")}</div>}
                  {selectedSubmission.fixed_status && <div><strong>Fixed:</strong> {selectedSubmission.fixed_status.replace(/_/g, " ")}</div>}
                  {selectedSubmission.has_kittens && <div style={{ color: "#fd7e14" }}><strong>Kittens present</strong></div>}
                  {selectedSubmission.has_medical_concerns && <div style={{ color: "#dc3545" }}><strong>Medical concerns</strong></div>}
                </div>
              )}
            </div>

            {/* Situation */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Situation</h3>
                {!editingSituation ? (
                  <button
                    onClick={() => {
                      setSituationEdit(selectedSubmission.situation_description || "");
                      setEditingSituation(true);
                    }}
                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                  >
                    Edit
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <button
                      onClick={async () => {
                        setSavingSection(true);
                        try {
                          const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ situation_description: situationEdit }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setSelectedSubmission({ ...selectedSubmission, ...data.submission });
                            setEditingSituation(false);
                            fetchSubmissions();
                          }
                        } catch (err) {
                          console.error("Failed to save:", err);
                        } finally {
                          setSavingSection(false);
                        }
                      }}
                      disabled={savingSection}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                    >
                      {savingSection ? "..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingSituation(false)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              {editingSituation ? (
                <textarea
                  value={situationEdit}
                  onChange={(e) => setSituationEdit(e.target.value)}
                  rows={8}
                  style={{ width: "100%", padding: "0.5rem", resize: "vertical", fontSize: "0.9rem", fontFamily: "inherit" }}
                  placeholder="Describe the situation..."
                />
              ) : selectedSubmission.situation_description ? (
                <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>{selectedSubmission.situation_description}</p>
              ) : (
                <p style={{ margin: 0, color: "var(--muted)", fontStyle: "italic" }}>No situation description provided.</p>
              )}
            </div>

            {/* Third Party */}
            {selectedSubmission.is_third_party_report && (
              <div style={{ background: "rgba(255, 193, 7, 0.15)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem", border: "1px solid rgba(255, 193, 7, 0.5)" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Third-Party Report</h3>
                <p style={{ margin: 0 }}>Reported by: {selectedSubmission.third_party_relationship?.replace(/_/g, " ")}</p>
                {selectedSubmission.property_owner_name && (
                  <p style={{ margin: "0.25rem 0 0" }}>Property owner: {selectedSubmission.property_owner_name}</p>
                )}
                {selectedSubmission.property_owner_phone && (
                  <p style={{ margin: "0.25rem 0 0" }}>Owner phone: {formatPhone(selectedSubmission.property_owner_phone)}</p>
                )}
              </div>
            )}

            {/* Triage */}
            {selectedSubmission.triage_reasons && selectedSubmission.triage_reasons.length > 0 && (
              <div style={{ background: "rgba(13, 110, 253, 0.1)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>
                  Triage: {selectedSubmission.triage_category?.replace(/_/g, " ")} (Score: {selectedSubmission.triage_score})
                </h3>
                <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem" }}>
                  {selectedSubmission.triage_reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Legacy Review Notes - only shown if record has existing notes */}
            {selectedSubmission.legacy_notes && (
              <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem", color: "var(--muted)" }}>
                  Legacy Notes
                </h3>
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Historical notes from before the Communication Log. New notes should be added using &quot;+ Note&quot; below.
                </p>
                <div style={{
                  padding: "0.75rem",
                  background: "var(--background)",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  whiteSpace: "pre-wrap",
                  fontSize: "0.9rem"
                }}>
                  {selectedSubmission.legacy_notes}
                </div>
              </div>
            )}

            {/* Edit History - collapsible section to see and undo changes */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showEditHistory ? "0.75rem" : 0 }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Edit History</h3>
                <button
                  onClick={() => {
                    if (!showEditHistory) {
                      fetchEditHistory(selectedSubmission.submission_id);
                    }
                    setShowEditHistory(!showEditHistory);
                  }}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.8rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  {showEditHistory ? "Hide" : "Show"} History
                </button>
              </div>
              {showEditHistory && (
                <div>
                  {loadingHistory ? (
                    <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>Loading...</p>
                  ) : editHistory.length === 0 ? (
                    <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic" }}>
                      No edit history recorded yet.
                    </p>
                  ) : (
                    <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                      {editHistory.map((edit) => (
                        <div
                          key={edit.edit_id}
                          style={{
                            padding: "0.5rem",
                            borderBottom: "1px solid var(--border)",
                            fontSize: "0.8rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                            <strong style={{ textTransform: "capitalize" }}>
                              {edit.field_name.replace(/_/g, " ")}
                            </strong>
                            <span style={{ color: "var(--muted)" }}>
                              {new Date(edit.edited_at).toLocaleDateString()} {new Date(edit.edited_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", color: "var(--muted)" }}>
                            <span style={{ textDecoration: "line-through", color: "#dc3545" }}>
                              {edit.old_value === null ? "(empty)" : String(edit.old_value)}
                            </span>
                            <span>→</span>
                            <span style={{ color: "#198754" }}>
                              {edit.new_value === null ? "(empty)" : String(edit.new_value)}
                            </span>
                          </div>
                          <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--muted)" }}>
                            by {edit.edited_by}{edit.edit_reason && ` • ${edit.edit_reason}`}
                          </div>
                          {/* Undo button for recent changes */}
                          {new Date(edit.edited_at).getTime() > Date.now() - 24 * 60 * 60 * 1000 && (
                            <button
                              onClick={async () => {
                                if (!confirm(`Revert ${edit.field_name.replace(/_/g, " ")} back to "${edit.old_value}"?`)) return;
                                try {
                                  const res = await fetch(`/api/intake/queue/${selectedSubmission.submission_id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      [edit.field_name]: edit.old_value,
                                      edit_reason: "undo_change",
                                    }),
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    setSelectedSubmission({ ...selectedSubmission, ...data.submission });
                                    fetchEditHistory(selectedSubmission.submission_id);
                                    fetchSubmissions();
                                  }
                                } catch (err) {
                                  console.error("Failed to undo:", err);
                                }
                              }}
                              style={{
                                marginTop: "0.25rem",
                                padding: "0.15rem 0.4rem",
                                fontSize: "0.7rem",
                                background: "#fff",
                                border: "1px solid #fd7e14",
                                color: "#fd7e14",
                                borderRadius: "3px",
                                cursor: "pointer",
                              }}
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick Actions - for tracking outreach */}
            <div style={{
              background: "var(--card-bg, rgba(0,0,0,0.05))",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1rem"
            }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>Quick Actions</h3>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {selectedSubmission.submission_status === "new" && (
                  <button
                    onClick={() => {
                      handleQuickStatus(selectedSubmission.submission_id, "submission_status", "in_progress");
                      setSelectedSubmission({ ...selectedSubmission, submission_status: "in_progress" });
                    }}
                    style={{ padding: "0.5rem 1rem", background: "#fd7e14", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer" }}
                  >
                    Mark In Progress
                  </button>
                )}

                {selectedSubmission.submission_status !== "scheduled" && selectedSubmission.submission_status !== "complete" ? (
                  <button
                    onClick={() => {
                      setSelectedSubmission(null);
                      handleMarkBooked(selectedSubmission);
                    }}
                    style={{ padding: "0.5rem 1rem", background: "#198754", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                  >
                    Schedule Appointment
                  </button>
                ) : selectedSubmission.submission_status === "scheduled" ? (
                  <button
                    onClick={() => {
                      setSelectedSubmission(null);
                      handleChangeAppointment(selectedSubmission);
                    }}
                    style={{ padding: "0.5rem 1rem", background: "#0d6efd", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                  >
                    Change Appointment {selectedSubmission.appointment_date && `(${formatDate(selectedSubmission.appointment_date)})`}
                  </button>
                ) : null}
              </div>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                These actions update tracking status. Changes save automatically.
              </p>
            </div>

            {/* Inline Communication Log */}
            <div style={{
              background: "var(--card-bg, rgba(0,0,0,0.03))",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1rem"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  Communication Log
                  {communicationLogs.length > 0 && (
                    <span style={{
                      background: "var(--muted-bg, #e0e0e0)",
                      padding: "0.125rem 0.4rem",
                      borderRadius: "10px",
                      fontSize: "0.75rem",
                      color: "var(--muted)"
                    }}>
                      {communicationLogs.length}
                    </span>
                  )}
                </h3>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    onClick={() => {
                      setShowInlineContactForm("note");
                      setContactForm({ ...contactForm, is_journal_only: true, notes: "" });
                    }}
                    style={{
                      padding: "0.35rem 0.75rem",
                      background: showInlineContactForm === "note" ? "#0d6efd" : "transparent",
                      color: showInlineContactForm === "note" ? "#fff" : "#0d6efd",
                      border: "1px solid #0d6efd",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontWeight: 500
                    }}
                  >
                    + Note
                  </button>
                  <button
                    onClick={() => {
                      setShowInlineContactForm("call");
                      setContactForm({ ...contactForm, is_journal_only: false, notes: "", contact_method: "phone", contact_result: "answered" });
                    }}
                    style={{
                      padding: "0.35rem 0.75rem",
                      background: showInlineContactForm === "call" ? "#6f42c1" : "transparent",
                      color: showInlineContactForm === "call" ? "#fff" : "#6f42c1",
                      border: "1px solid #6f42c1",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontWeight: 500
                    }}
                  >
                    + Call
                  </button>
                </div>
              </div>

              {/* Inline Add Form */}
              {showInlineContactForm && (
                <div style={{
                  background: "var(--background)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  marginBottom: "0.75rem"
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: showInlineContactForm === "call" ? "1fr 1fr" : "1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    {/* Contact method & result - only for calls */}
                    {showInlineContactForm === "call" && (
                      <>
                        <div>
                          <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>Method</label>
                          <select
                            value={contactForm.contact_method}
                            onChange={(e) => setContactForm({ ...contactForm, contact_method: e.target.value })}
                            style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                          >
                            {CONTACT_METHODS.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>Result</label>
                          <select
                            value={contactForm.contact_result}
                            onChange={(e) => setContactForm({ ...contactForm, contact_result: e.target.value })}
                            style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                          >
                            {CONTACT_RESULTS.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>Staff</label>
                      <select
                        value={contactForm.contacted_by}
                        onChange={(e) => setContactForm({ ...contactForm, contacted_by: e.target.value })}
                        style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                      >
                        <option value="">Select staff...</option>
                        {staffList.map((s) => (
                          <option key={s.staff_id} value={s.display_name}>
                            {s.display_name} ({s.role})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>
                        {showInlineContactForm === "note" ? "Note" : "Notes"}
                      </label>
                      <textarea
                        value={contactForm.notes}
                        onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                        rows={2}
                        placeholder={showInlineContactForm === "note" ? "Internal note..." : "Notes about the conversation..."}
                        style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem", resize: "vertical" }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={handleInlineContactSubmit}
                      disabled={saving || !contactForm.notes.trim() || !contactForm.contacted_by}
                      style={{
                        padding: "0.4rem 0.75rem",
                        background: showInlineContactForm === "note" ? "#0d6efd" : "#6f42c1",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: saving || !contactForm.notes.trim() || !contactForm.contacted_by ? "not-allowed" : "pointer",
                        opacity: saving || !contactForm.notes.trim() || !contactForm.contacted_by ? 0.6 : 1,
                        fontSize: "0.85rem",
                        fontWeight: 500
                      }}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setShowInlineContactForm(null)}
                      style={{
                        padding: "0.4rem 0.75rem",
                        background: "transparent",
                        color: "var(--muted)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.85rem"
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Communication Log Entries */}
              {loadingLogs ? (
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>Loading...</p>
              ) : communicationLogs.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0, fontStyle: "italic" }}>
                  No communication logged yet. Use the buttons above to add notes or log calls.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "200px", overflowY: "auto" }}>
                  {communicationLogs.map((log) => {
                    const isNote = log.entry_kind === "note" || !log.contact_method;
                    const displayName = log.created_by_staff_name || log.contacted_by;
                    const initials = displayName
                      ? displayName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
                      : "??";

                    return (
                      <div
                        key={log.log_id}
                        style={{
                          padding: "0.5rem 0.65rem",
                          background: "var(--background)",
                          borderRadius: "4px",
                          borderLeft: `3px solid ${isNote ? "#0d6efd" : "#6f42c1"}`,
                          fontSize: "0.85rem"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                          {/* Initials badge */}
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "22px",
                            height: "22px",
                            borderRadius: "50%",
                            background: isNote ? "#0d6efd" : "#6f42c1",
                            color: "#fff",
                            fontSize: "0.6rem",
                            fontWeight: "bold"
                          }}>{initials}</span>

                          {/* Entry type badge */}
                          <span style={{
                            padding: "0.1rem 0.35rem",
                            borderRadius: "3px",
                            fontSize: "0.65rem",
                            fontWeight: 500,
                            background: isNote ? "#0d6efd" : "#6f42c1",
                            color: "#fff"
                          }}>
                            {isNote ? "Note" : "Contact"}
                          </span>

                          {/* Contact details for calls */}
                          {!isNote && log.contact_method && (
                            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                              {CONTACT_METHODS.find(m => m.value === log.contact_method)?.label || log.contact_method}
                              {log.contact_result && (
                                <> → {CONTACT_RESULTS.find(r => r.value === log.contact_result)?.label || log.contact_result}</>
                              )}
                            </span>
                          )}

                          {/* Date */}
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)", marginLeft: "auto" }}>
                            {formatDate(log.contacted_at)}
                          </span>
                        </div>

                        {/* Notes */}
                        {log.notes && (
                          <p style={{ margin: 0, color: "var(--foreground)", lineHeight: 1.4 }}>
                            {log.notes}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Convert to Request - for ALL not-yet-converted submissions */}
            {selectedSubmission.native_status !== "request_created" && !selectedSubmission.created_request_id && (
              <div style={{
                background: "rgba(102, 16, 242, 0.1)",
                border: "1px solid rgba(102, 16, 242, 0.3)",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem"
              }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem", color: "#6610f2" }}>
                  Create Trapping Request
                </h3>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: "var(--muted)" }}>
                  Convert this submission into a formal FFR request. This creates a new request record
                  that can be assigned to trappers and tracked through completion.
                </p>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic" }}>
                  Most submissions are handled directly (booked for clinic) without becoming requests.
                  Only create a request if this needs trapper coordination.
                </p>
                <button
                  onClick={() => handleOpenRequestWizard(selectedSubmission)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#6610f2",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 500
                  }}
                >
                  Create Request →
                </button>
              </div>
            )}

            {/* Already converted indicator */}
            {selectedSubmission.native_status === "request_created" && selectedSubmission.created_request_id && (
              <div style={{
                background: "rgba(25, 135, 84, 0.1)",
                border: "1px solid rgba(25, 135, 84, 0.3)",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem"
              }}>
                <p style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ color: "#198754", fontSize: "1.25rem" }}>✓</span>
                  <span>
                    Request created.{" "}
                    <a
                      href={`/requests/${selectedSubmission.created_request_id}`}
                      style={{ color: "#198754", fontWeight: 500 }}
                    >
                      View Request →
                    </a>
                  </span>
                </p>
              </div>
            )}

            {/* Footer Actions */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <button
                onClick={() => {
                  if (confirm(`Archive "${normalizeName(selectedSubmission.submitter_name)}"?\n\nThis will remove it from all views.`)) {
                    handleArchive(selectedSubmission.submission_id);
                  }
                }}
                style={{ padding: "0.5rem 1rem", background: "#6c757d", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Archive
              </button>

              <a
                href={`/intake/print/${selectedSubmission.submission_id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: "0.5rem 1rem", background: "#0d6efd", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", textDecoration: "none", display: "inline-block" }}
              >
                Print / PDF
              </a>

              {/* Mark Complete - requires confirmation */}
              {selectedSubmission.submission_status !== "complete" && (
                <button
                  onClick={async () => {
                    if (confirm(`Mark "${normalizeName(selectedSubmission.submitter_name)}" as Complete?\n\nThis will remove it from the active queue.`)) {
                      await handleQuickStatus(selectedSubmission.submission_id, "submission_status", "complete");
                      setSelectedSubmission({ ...selectedSubmission, submission_status: "complete" });
                      setToastMessage(`${normalizeName(selectedSubmission.submitter_name)} marked as Complete`);
                      setTimeout(() => setToastMessage(null), 5000);
                    }
                  }}
                  style={{ padding: "0.5rem 1rem", background: "#20c997", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  Mark Complete
                </button>
              )}

              {/* Reset status - useful for accidentally marked submissions */}
              {(selectedSubmission.submission_status === "scheduled" || selectedSubmission.submission_status === "complete") && (
                <button
                  onClick={async () => {
                    if (confirm("Reset this submission back to New? It will appear in Needs Attention tab again.")) {
                      await handleQuickStatus(selectedSubmission.submission_id, "submission_status", "new");
                      setSelectedSubmission({ ...selectedSubmission, submission_status: "new" });
                      setToastMessage(`${normalizeName(selectedSubmission.submitter_name)} moved back to New`);
                      setTimeout(() => setToastMessage(null), 5000);
                    }
                  }}
                  style={{ padding: "0.5rem 1rem", background: "#ffc107", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  Reset to New
                </button>
              )}

              <button
                onClick={() => setSelectedSubmission(null)}
                style={{ padding: "0.5rem 1rem", marginLeft: "auto", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact Log Modal */}
      {showContactModal && contactModalSubmission && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
          }}
          onClick={closeContactModal}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>Log Contact / Journal</h2>
              <p style={{ color: "var(--muted)", margin: "0.25rem 0", fontSize: "0.9rem" }}>
                {normalizeName(contactModalSubmission.submitter_name)} - {contactModalSubmission.email}
                {contactModalSubmission.phone && ` | ${formatPhone(contactModalSubmission.phone)}`}
              </p>
              <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.8rem" }}>
                {contactModalSubmission.geo_formatted_address || contactModalSubmission.cats_address}
              </p>
            </div>

            {/* Contact Form */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
                {contactForm.is_journal_only ? "New Journal Entry" : "New Contact Log"}
              </h3>

              {/* Journal Only Toggle */}
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={contactForm.is_journal_only}
                    onChange={(e) => setContactForm({ ...contactForm, is_journal_only: e.target.checked })}
                    style={{ width: "1rem", height: "1rem" }}
                  />
                  <span style={{ fontSize: "0.9rem" }}>Just log a journal entry (internal note only)</span>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                {/* Contact Method & Result - only show if not journal only */}
                {!contactForm.is_journal_only && (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Contact Method
                      </label>
                      <select
                        value={contactForm.contact_method}
                        onChange={(e) => setContactForm({ ...contactForm, contact_method: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem" }}
                      >
                        {CONTACT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Result
                      </label>
                      <select
                        value={contactForm.contact_result}
                        onChange={(e) => setContactForm({ ...contactForm, contact_result: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem" }}
                      >
                        {CONTACT_RESULTS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div style={{ gridColumn: contactForm.is_journal_only ? "1 / -1" : undefined }}>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                    {contactForm.is_journal_only ? "Staff" : "Who Contacted"}
                  </label>
                  <select
                    value={contactForm.contacted_by}
                    onChange={(e) => setContactForm({ ...contactForm, contacted_by: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    <option value="">Select staff...</option>
                    {staffList.map((s) => (
                      <option key={s.staff_id} value={s.display_name}>
                        {s.display_name} ({s.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                    {contactForm.is_journal_only ? "Journal Entry" : "Notes"}
                  </label>
                  <textarea
                    value={contactForm.notes}
                    onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                    rows={3}
                    placeholder={contactForm.is_journal_only ? "Internal notes..." : "Brief notes about the conversation or attempt..."}
                    style={{ width: "100%", padding: "0.5rem", resize: "vertical" }}
                  />
                </div>
              </div>

              <div style={{ marginTop: "0.75rem" }}>
                <button
                  onClick={handleSubmitContactLog}
                  disabled={saving}
                  style={{
                    padding: "0.5rem 1rem",
                    background: contactForm.is_journal_only ? "#0d6efd" : "#6f42c1",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  {saving ? "Saving..." : contactForm.is_journal_only ? "Save Journal Entry" : "Save Contact Log"}
                </button>
              </div>
            </div>

            {/* Communication History */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
                Contact History
                {contactModalSubmission.contact_attempt_count ? ` (${contactModalSubmission.contact_attempt_count} attempts)` : ""}
              </h3>

              {loadingLogs ? (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Loading...</p>
              ) : communicationLogs.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
                  No journal entries logged yet.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {communicationLogs.map((log) => {
                    const isNote = log.entry_kind === "note" || !log.contact_method;
                    const displayName = log.created_by_staff_name || log.contacted_by;

                    return (
                      <div
                        key={log.log_id}
                        style={{
                          padding: "0.5rem 0.75rem",
                          background: "var(--background)",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          borderLeft: `3px solid ${isNote ? "#0d6efd" : "#6f42c1"}`,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            {/* Entry type badge */}
                            <span style={{
                              padding: "0.125rem 0.4rem",
                              borderRadius: "3px",
                              fontSize: "0.7rem",
                              fontWeight: 500,
                              background: isNote ? "#0d6efd" : "#6f42c1",
                              color: "#fff",
                            }}>
                              {isNote ? "Note" : "Contact"}
                            </span>

                            {/* Contact method and result (only for contact attempts) */}
                            {!isNote && (
                              <>
                                <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>
                                  {CONTACT_METHODS.find(m => m.value === log.contact_method)?.label || log.contact_method}
                                </span>
                                <span style={{ color: "var(--muted)" }}>→</span>
                                <span style={{
                                  padding: "0.125rem 0.5rem",
                                  borderRadius: "4px",
                                  fontSize: "0.75rem",
                                  background: log.contact_result === "answered" || log.contact_result === "scheduled"
                                    ? "rgba(25, 135, 84, 0.15)"
                                    : log.contact_result === "no_answer"
                                    ? "rgba(108, 117, 125, 0.15)"
                                    : "rgba(13, 110, 253, 0.15)",
                                  color: log.contact_result === "answered" || log.contact_result === "scheduled"
                                    ? "#198754"
                                    : log.contact_result === "no_answer"
                                    ? "#6c757d"
                                    : "#0d6efd",
                                }}>
                                  {CONTACT_RESULTS.find(r => r.value === log.contact_result)?.label || log.contact_result}
                                </span>
                              </>
                            )}

                            {/* Staff name */}
                            {displayName && (
                              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                                by {displayName}{log.created_by_staff_role ? ` (${log.created_by_staff_role})` : ""}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                            {new Date(log.contacted_at).toLocaleString()}
                          </span>
                        </div>
                        {log.notes && (
                          <div style={{ fontSize: "0.85rem", marginTop: "0.35rem", whiteSpace: "pre-wrap" }}>
                            {log.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Close button */}
            <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={closeContactModal}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Request Wizard */}
      {showRequestWizard && wizardSubmission && (
        <CreateRequestWizard
          submission={wizardSubmission}
          onComplete={handleRequestWizardComplete}
          onCancel={handleRequestWizardCancel}
        />
      )}

      {/* Booking Modal */}
      {showBookingModal && bookingSubmission && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1002,
          }}
          onClick={closeBookingModal}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "450px",
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 0.5rem" }}>
              {bookingSubmission.legacy_submission_status === "Booked" ? "Change Appointment" : "Book Appointment"}
            </h2>
            <p style={{ color: "var(--muted)", margin: "0 0 1rem", fontSize: "0.9rem" }}>
              {normalizeName(bookingSubmission.submitter_name)} - {bookingSubmission.geo_formatted_address || bookingSubmission.cats_address}
            </p>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Appointment Date
              </label>
              <input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
              />
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                Optional - leave blank if date TBD
              </p>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Notes (optional)
              </label>
              <textarea
                value={bookingNotes}
                onChange={(e) => setBookingNotes(e.target.value)}
                placeholder="e.g., Booked for morning drop-off, 3 cats confirmed..."
                rows={2}
                style={{ width: "100%", padding: "0.5rem", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={closeBookingModal}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBooking}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                {saving ? "Saving..." : bookingSubmission.legacy_submission_status === "Booked" ? "Update Booking" : "Confirm Booking"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IntakeQueuePage() {
  return (
    <Suspense fallback={<div className="loading">Loading queue...</div>}>
      <IntakeQueueContent />
    </Suspense>
  );
}
