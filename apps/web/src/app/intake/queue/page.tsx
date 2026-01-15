"use client";

import { useState, useEffect, useCallback } from "react";

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  ownership_status: string;
  cat_count_estimate: number | null;
  fixed_status: string;
  has_kittens: boolean | null;
  has_medical_concerns: boolean | null;
  is_emergency: boolean;
  situation_description: string | null;
  triage_category: string | null;
  triage_score: number | null;
  triage_reasons: string[] | null;
  status: string;
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
}

interface CommunicationLog {
  log_id: string;
  submission_id: string;
  contact_method: string;
  contact_result: string;
  notes: string | null;
  contacted_at: string;
  contacted_by: string | null;
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

// Submission status options (workflow state)
const SUBMISSION_STATUSES = [
  { value: "", label: "(none)" },
  { value: "Pending Review", label: "Pending Review" },
  { value: "Booked", label: "Booked" },
  { value: "Declined", label: "Declined" },
  { value: "Complete", label: "Complete" },
];

type TabType = "attention" | "recent" | "all" | "legacy";

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

function LegacyStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const colors: Record<string, { bg: string; color: string }> = {
    "Pending Review": { bg: "#ffc107", color: "#000" },
    "Booked": { bg: "#198754", color: "#fff" },
    "Declined": { bg: "#dc3545", color: "#fff" },
    "Complete": { bg: "#20c997", color: "#000" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span className="badge" style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}>
      {status}
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

export default function IntakeQueuePage() {
  const [submissions, setSubmissions] = useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("attention");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState<IntakeSubmission | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusEdits, setStatusEdits] = useState({
    legacy_status: "",
    legacy_submission_status: "",
    legacy_appointment_date: "",
    legacy_notes: "",
  });

  // Communication log state
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactModalSubmission, setContactModalSubmission] = useState<IntakeSubmission | null>(null);
  const [communicationLogs, setCommunicationLogs] = useState<CommunicationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [contactForm, setContactForm] = useState({
    contact_method: "phone",
    contact_result: "answered",
    notes: "",
    contacted_by: "",
  });

  // Staff list for dropdown
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

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
  }, [activeTab, categoryFilter]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Fetch staff list on mount
  useEffect(() => {
    fetch("/api/staff")
      .then((res) => res.json())
      .then((data) => setStaffList(data.staff || []))
      .catch((err) => console.error("Failed to fetch staff:", err));
  }, []);

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
    handleQuickStatus(sub.submission_id, "legacy_submission_status", "Booked");
  };

  const handleMarkNoResponse = (sub: IntakeSubmission) => {
    handleQuickStatus(sub.submission_id, "legacy_status", "Call/Email/No response");
  };

  const openDetail = (sub: IntakeSubmission) => {
    setSelectedSubmission(sub);
    setStatusEdits({
      legacy_status: sub.legacy_status || "",
      legacy_submission_status: sub.legacy_submission_status || "",
      legacy_appointment_date: sub.legacy_appointment_date || "",
      legacy_notes: sub.legacy_notes || "",
    });
    setEditingStatus(false);
  };

  const handleSaveStatus = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    try {
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: selectedSubmission.submission_id,
          legacy_status: statusEdits.legacy_status || null,
          legacy_submission_status: statusEdits.legacy_submission_status || null,
          legacy_appointment_date: statusEdits.legacy_appointment_date || null,
          legacy_notes: statusEdits.legacy_notes || null,
        }),
      });

      if (response.ok) {
        setEditingStatus(false);
        setSelectedSubmission({
          ...selectedSubmission,
          ...statusEdits,
        });
        fetchSubmissions();
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (submissionId: string) => {
    try {
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: submissionId, status: "archived" }),
      });

      if (response.ok) {
        fetchSubmissions();
        setSelectedSubmission(null);
      }
    } catch (err) {
      console.error("Failed to archive:", err);
    }
  };

  const handleCreateRequest = async (submissionId: string) => {
    try {
      const response = await fetch("/api/intake/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: submissionId }),
      });

      if (response.ok) {
        fetchSubmissions();
        setSelectedSubmission(null);
      }
    } catch (err) {
      console.error("Failed to convert:", err);
    }
  };

  // Stats for current view
  const stats = {
    total: submissions.length,
    needsAttention: submissions.filter(s => !s.legacy_submission_status || s.legacy_submission_status === "Pending Review").length,
    contacted: submissions.filter(s => s.legacy_status?.includes("Contacted")).length,
    noResponse: submissions.filter(s => s.legacy_status === "Call/Email/No response").length,
    booked: submissions.filter(s => s.legacy_submission_status === "Booked").length,
    highPriority: submissions.filter(s => s.triage_category === "high_priority_tnr").length,
    thirdParty: submissions.filter(s => s.is_third_party_report).length,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Intake Queue</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
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

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0", borderBottom: "2px solid var(--border)", marginBottom: "1rem" }}>
        {[
          { id: "attention" as TabType, label: "Needs Attention", count: null },
          { id: "recent" as TabType, label: "Recent", count: null },
          { id: "all" as TabType, label: "All Submissions", count: null },
          { id: "legacy" as TabType, label: "Legacy", count: null },
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

      {/* Category filter (optional) */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ padding: "0.5rem", minWidth: "180px" }}
        >
          <option value="">All Categories</option>
          <option value="high_priority_tnr">High Priority TNR</option>
          <option value="standard_tnr">Standard TNR</option>
          <option value="wellness_only">Wellness Only</option>
          <option value="owned_cat_low">Owned Cat (Low)</option>
          <option value="out_of_county">Out of County</option>
          <option value="needs_review">Needs Review</option>
        </select>

        <button onClick={fetchSubmissions} style={{ padding: "0.5rem 1rem" }}>
          Refresh
        </button>

        <span style={{ color: "var(--muted)", fontSize: "0.875rem", marginLeft: "auto" }}>
          {submissions.length} submissions
        </span>
      </div>

      {/* Quick stats for current tab */}
      {activeTab === "attention" && stats.total > 0 && (
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
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

      {activeTab === "legacy" && stats.total > 0 && (
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <span style={{ padding: "0.25rem 0.75rem", background: "#ffc107", color: "#000", borderRadius: "12px", fontSize: "0.8rem" }}>
            {stats.needsAttention} Pending
          </span>
          <span style={{ padding: "0.25rem 0.75rem", background: "#17a2b8", color: "#fff", borderRadius: "12px", fontSize: "0.8rem" }}>
            {stats.contacted} Contacted
          </span>
          <span style={{ padding: "0.25rem 0.75rem", background: "#6c757d", color: "#fff", borderRadius: "12px", fontSize: "0.8rem" }}>
            {stats.noResponse} No Response
          </span>
          <span style={{ padding: "0.25rem 0.75rem", background: "#198754", color: "#fff", borderRadius: "12px", fontSize: "0.8rem" }}>
            {stats.booked} Booked
          </span>
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
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: "180px" }}>Submitter</th>
                <th style={{ width: "200px" }}>Location</th>
                <th style={{ width: "80px" }}>Cats</th>
                <th style={{ width: "120px" }}>Status</th>
                <th style={{ width: "80px" }}>Submitted</th>
                <th style={{ width: "200px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => (
                <tr
                  key={sub.submission_id}
                  style={{
                    background: sub.is_emergency
                      ? "rgba(220, 53, 69, 0.1)"
                      : sub.legacy_submission_status === "Booked"
                      ? "rgba(25, 135, 84, 0.05)"
                      : sub.legacy_status === "Call/Email/No response"
                      ? "rgba(108, 117, 125, 0.1)"
                      : undefined,
                  }}
                >
                  <td>
                    <div
                      style={{ fontWeight: 500, cursor: "pointer" }}
                      onClick={() => openDetail(sub)}
                    >
                      {normalizeName(sub.submitter_name)}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.email}</div>
                    {sub.phone && <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.phone}</div>}
                    {sub.is_third_party_report && (
                      <span style={{ fontSize: "0.65rem", background: "#ffc107", color: "#000", padding: "1px 4px", borderRadius: "3px" }}>
                        3RD PARTY
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
                      {sub.is_legacy ? (
                        <>
                          <LegacyStatusBadge status={sub.legacy_submission_status} />
                          <ContactStatusBadge status={sub.legacy_status} />
                        </>
                      ) : (
                        <TriageBadge category={sub.triage_category} score={sub.triage_score} isLegacy={false} />
                      )}
                      {sub.is_emergency && (
                        <span style={{ color: "#dc3545", fontSize: "0.7rem", fontWeight: "bold" }}>EMERGENCY</span>
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
                        Log Contact {sub.contact_attempt_count ? `(${sub.contact_attempt_count})` : ""}
                      </button>
                      {/* Quick action buttons based on current status */}
                      {(!sub.legacy_status || sub.legacy_status === "") && (
                        <button
                          onClick={() => handleMarkContacted(sub)}
                          disabled={saving}
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.7rem",
                            background: "#17a2b8",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Contacted
                        </button>
                      )}
                      {sub.legacy_status === "Contacted" && (
                        <button
                          onClick={() => handleMarkNoResponse(sub)}
                          disabled={saving}
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.7rem",
                            background: "#6c757d",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          No Response
                        </button>
                      )}
                      {sub.legacy_submission_status !== "Booked" && (
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
                          Booked
                        </button>
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
      )}

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
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ margin: 0 }}>{normalizeName(selectedSubmission.submitter_name)}</h2>
                <p style={{ color: "var(--muted)", margin: "0.25rem 0", fontSize: "0.9rem" }}>
                  {selectedSubmission.email}
                  {selectedSubmission.phone && ` | ${selectedSubmission.phone}`}
                </p>
                <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.8rem" }}>
                  Submitted {formatDate(selectedSubmission.submitted_at)}
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {selectedSubmission.is_legacy && (
                  <span style={{ background: "#6c757d", color: "#fff", padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem" }}>
                    Legacy
                  </span>
                )}
                <LegacyStatusBadge status={selectedSubmission.legacy_submission_status} />
              </div>
            </div>

            {selectedSubmission.is_emergency && (
              <div style={{ background: "rgba(220, 53, 69, 0.2)", padding: "0.75rem", borderRadius: "8px", marginBottom: "1rem", color: "#dc3545", fontWeight: "bold" }}>
                EMERGENCY REQUEST
              </div>
            )}

            {/* Status Section */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Status & Tracking</h3>
                {!editingStatus ? (
                  <button onClick={() => setEditingStatus(true)} style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}>
                    Edit
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={handleSaveStatus}
                      disabled={saving}
                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px" }}
                    >
                      {saving ? "..." : "Save"}
                    </button>
                    <button onClick={() => setEditingStatus(false)} style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {editingStatus ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Contact Status</label>
                    <select
                      value={statusEdits.legacy_status}
                      onChange={(e) => setStatusEdits({ ...statusEdits, legacy_status: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem" }}
                    >
                      {CONTACT_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Submission Status</label>
                    <select
                      value={statusEdits.legacy_submission_status}
                      onChange={(e) => setStatusEdits({ ...statusEdits, legacy_submission_status: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem" }}
                    >
                      {SUBMISSION_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Appointment Date</label>
                    <input
                      type="date"
                      value={statusEdits.legacy_appointment_date}
                      onChange={(e) => setStatusEdits({ ...statusEdits, legacy_appointment_date: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem" }}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Notes</label>
                    <textarea
                      value={statusEdits.legacy_notes}
                      onChange={(e) => setStatusEdits({ ...statusEdits, legacy_notes: e.target.value })}
                      rows={2}
                      style={{ width: "100%", padding: "0.5rem", resize: "vertical" }}
                      placeholder="Working notes..."
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.9rem" }}>
                  <div>
                    <strong>Contact:</strong>{" "}
                    <span style={{ color: selectedSubmission.legacy_status ? "inherit" : "var(--muted)" }}>
                      {selectedSubmission.legacy_status || "(not contacted)"}
                    </span>
                  </div>
                  <div>
                    <strong>Status:</strong>{" "}
                    <LegacyStatusBadge status={selectedSubmission.legacy_submission_status} />
                    {!selectedSubmission.legacy_submission_status && <span style={{ color: "var(--muted)" }}>(pending)</span>}
                  </div>
                  {selectedSubmission.legacy_appointment_date && (
                    <div>
                      <strong>Appt Date:</strong> {formatDate(selectedSubmission.legacy_appointment_date)}
                    </div>
                  )}
                  {selectedSubmission.legacy_notes && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <strong>Notes:</strong> {selectedSubmission.legacy_notes}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Location */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Location</h3>
              <p style={{ margin: 0 }}>{selectedSubmission.cats_address}</p>
              {selectedSubmission.cats_city && <p style={{ margin: 0, color: "var(--muted)" }}>{selectedSubmission.cats_city}</p>}
              {selectedSubmission.geo_formatted_address && selectedSubmission.geo_formatted_address !== selectedSubmission.cats_address && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Geocoded: {selectedSubmission.geo_formatted_address}
                </p>
              )}
            </div>

            {/* Cats */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Cats</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div><strong>Count:</strong> {selectedSubmission.cat_count_estimate ?? "Unknown"}</div>
                {selectedSubmission.ownership_status && <div><strong>Type:</strong> {selectedSubmission.ownership_status.replace(/_/g, " ")}</div>}
                {selectedSubmission.fixed_status && <div><strong>Fixed:</strong> {selectedSubmission.fixed_status.replace(/_/g, " ")}</div>}
                {selectedSubmission.has_kittens && <div style={{ color: "#fd7e14" }}><strong>Kittens present</strong></div>}
                {selectedSubmission.has_medical_concerns && <div style={{ color: "#dc3545" }}><strong>Medical concerns</strong></div>}
              </div>
            </div>

            {/* Situation */}
            {selectedSubmission.situation_description && (
              <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Situation</h3>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{selectedSubmission.situation_description}</p>
              </div>
            )}

            {/* Third Party */}
            {selectedSubmission.is_third_party_report && (
              <div style={{ background: "rgba(255, 193, 7, 0.15)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem", border: "1px solid rgba(255, 193, 7, 0.5)" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Third-Party Report</h3>
                <p style={{ margin: 0 }}>Reported by: {selectedSubmission.third_party_relationship?.replace(/_/g, " ")}</p>
                {selectedSubmission.property_owner_name && (
                  <p style={{ margin: "0.25rem 0 0" }}>Property owner: {selectedSubmission.property_owner_name}</p>
                )}
                {selectedSubmission.property_owner_phone && (
                  <p style={{ margin: "0.25rem 0 0" }}>Owner phone: {selectedSubmission.property_owner_phone}</p>
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

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              {/* Log Contact button */}
              <button
                onClick={() => {
                  setSelectedSubmission(null);
                  openContactModal(selectedSubmission);
                }}
                style={{ padding: "0.5rem 1rem", background: "#6f42c1", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Log Contact {selectedSubmission.contact_attempt_count ? `(${selectedSubmission.contact_attempt_count})` : ""}
              </button>

              {/* Quick status buttons */}
              {(!selectedSubmission.legacy_status || selectedSubmission.legacy_status === "") && (
                <button
                  onClick={() => {
                    handleQuickStatus(selectedSubmission.submission_id, "legacy_status", "Contacted");
                    setSelectedSubmission({ ...selectedSubmission, legacy_status: "Contacted" });
                  }}
                  style={{ padding: "0.5rem 1rem", background: "#17a2b8", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  Mark Contacted
                </button>
              )}

              {selectedSubmission.legacy_submission_status !== "Booked" && (
                <button
                  onClick={() => {
                    handleQuickStatus(selectedSubmission.submission_id, "legacy_submission_status", "Booked");
                    setSelectedSubmission({ ...selectedSubmission, legacy_submission_status: "Booked" });
                  }}
                  style={{ padding: "0.5rem 1rem", background: "#198754", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  Mark Booked
                </button>
              )}

              {selectedSubmission.status !== "request_created" && !selectedSubmission.is_legacy && (
                <button
                  onClick={() => handleCreateRequest(selectedSubmission.submission_id)}
                  style={{ padding: "0.5rem 1rem", background: "#6610f2", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  Create Request
                </button>
              )}

              <button
                onClick={() => handleArchive(selectedSubmission.submission_id)}
                style={{ padding: "0.5rem 1rem", background: "#6c757d", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Archive
              </button>

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
              <h2 style={{ margin: 0 }}>Log Contact Attempt</h2>
              <p style={{ color: "var(--muted)", margin: "0.25rem 0", fontSize: "0.9rem" }}>
                {normalizeName(contactModalSubmission.submitter_name)} - {contactModalSubmission.email}
                {contactModalSubmission.phone && ` | ${contactModalSubmission.phone}`}
              </p>
              <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.8rem" }}>
                {contactModalSubmission.geo_formatted_address || contactModalSubmission.cats_address}
              </p>
            </div>

            {/* Contact Form */}
            <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>New Contact Log</h3>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
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

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Who Contacted
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
                    Notes
                  </label>
                  <textarea
                    value={contactForm.notes}
                    onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                    rows={3}
                    placeholder="Brief notes about the conversation or attempt..."
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
                    background: "#6f42c1",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  {saving ? "Saving..." : "Save Contact Log"}
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
                  No contact attempts logged yet.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {communicationLogs.map((log) => (
                    <div
                      key={log.log_id}
                      style={{
                        padding: "0.5rem 0.75rem",
                        background: "var(--background)",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ fontWeight: 500 }}>
                            {CONTACT_METHODS.find(m => m.value === log.contact_method)?.label || log.contact_method}
                          </span>
                          <span style={{ color: "var(--muted)", margin: "0 0.5rem" }}>→</span>
                          <span style={{
                            padding: "0.125rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
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
                        </div>
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                          {new Date(log.contacted_at).toLocaleString()}
                        </span>
                      </div>
                      {log.contacted_by && (
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                          By: {log.contacted_by}
                        </div>
                      )}
                      {log.notes && (
                        <div style={{ fontSize: "0.85rem", marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>
                          {log.notes}
                        </div>
                      )}
                    </div>
                  ))}
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
    </div>
  );
}
