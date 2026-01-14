"use client";

import { useState, useEffect } from "react";

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
  // Third-party report fields
  is_third_party_report: boolean | null;
  third_party_relationship: string | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  property_owner_email: string | null;
  // Legacy fields
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  legacy_notes: string | null;
  legacy_source_id: string | null;
  review_notes: string | null;
  matched_person_id: string | null;
  // Source tracking
  intake_source: string | null;
  // Geocoding
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_confidence: string | null;
}

// Legacy submission status options (from Jami's workflow)
const LEGACY_SUBMISSION_STATUSES = [
  "",
  "Pending Review",
  "Booked",
  "Declined",
  "Complete",
];

// Legacy status options (from Jami's workflow)
const LEGACY_STATUSES = [
  "",
  "An appointment has been booked",
  "Contacted",
  "Contacted multiple times",
  "Call/Email/No response",
  "Out of County - no appts avail",
  "Sent to Diane/Out of County",
];

function TriageBadge({ category, score }: { category: string | null; score: number | null }) {
  if (!category) {
    return (
      <span
        className="badge"
        style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}
      >
        Legacy
      </span>
    );
  }

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
      <span
        className="badge"
        style={{ background: style.bg, color: style.color }}
      >
        {category.replace(/_/g, " ")}
      </span>
      {score !== null && (
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          Score: {score}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    new: { bg: "#0d6efd", color: "#fff" },
    triaged: { bg: "#6610f2", color: "#fff" },
    reviewed: { bg: "#198754", color: "#fff" },
    request_created: { bg: "#20c997", color: "#000" },
    redirected: { bg: "#fd7e14", color: "#000" },
    client_handled: { bg: "#17a2b8", color: "#fff" },  // Client will handle themselves
    archived: { bg: "#6c757d", color: "#fff" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}
    >
      {status}
    </span>
  );
}

function LegacyStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const colors: Record<string, { bg: string; color: string }> = {
    "Pending Review": { bg: "#ffc107", color: "#fff" },
    "Booked": { bg: "#198754", color: "#fff" },
    "Declined": { bg: "#dc3545", color: "#fff" },
    "Complete": { bg: "#20c997", color: "#fff" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}
    >
      {status}
    </span>
  );
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;

  const labels: Record<string, string> = {
    web: "Web",
    phone: "Phone",
    in_person: "In Person",
    paper: "Paper",
    legacy_airtable: "Legacy",
    legacy_website: "Old Web",
  };

  const colors: Record<string, { bg: string; color: string }> = {
    web: { bg: "#0d6efd", color: "#fff" },
    phone: { bg: "#6f42c1", color: "#fff" },
    in_person: { bg: "#20c997", color: "#fff" },
    paper: { bg: "#fd7e14", color: "#fff" },
    legacy_airtable: { bg: "#6c757d", color: "#fff" },
    legacy_website: { bg: "#6c757d", color: "#fff" },
  };

  const style = colors[source] || { bg: "#6c757d", color: "#fff" };
  const label = labels[source] || source;

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.6rem" }}
      title={`Source: ${source}`}
    >
      {label}
    </span>
  );
}

function ThirdPartyBadge({ isThirdParty, relationship }: { isThirdParty: boolean | null; relationship: string | null }) {
  if (!isThirdParty) return null;

  const relationshipLabel = relationship ? relationship.replace(/_/g, " ") : "third party";

  return (
    <span
      className="badge"
      style={{
        background: "#ffc107",
        color: "#000",
        fontSize: "0.65rem",
        fontWeight: "bold",
        border: "1px solid #e0a800",
      }}
      title={`Third-party report from: ${relationshipLabel}. Need to contact property owner.`}
    >
      3RD PARTY
    </span>
  );
}

function formatAge(age: unknown): string {
  if (!age) return "";

  // Handle PostgreSQL interval objects or strings
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

// Normalize capitalization (JOHN SMITH -> John Smith)
function normalizeName(name: string | null): string {
  if (!name) return "";
  // If all caps or all lowercase, title case it
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
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [sourceFilter, setSourceFilter] = useState(""); // 'legacy', 'new', or ''
  const [selectedSubmission, setSelectedSubmission] = useState<IntakeSubmission | null>(null);
  const [editingLegacy, setEditingLegacy] = useState(false);
  const [legacyEdits, setLegacyEdits] = useState({
    legacy_status: "",
    legacy_submission_status: "",
    legacy_appointment_date: "",
    legacy_notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSubmissions();
  }, [categoryFilter, statusFilter, sourceFilter]);

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status_filter", statusFilter);
      if (sourceFilter) params.set("source", sourceFilter);

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
  };

  const handleConvertToRequest = async (submissionId: string) => {
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

  const handleUpdateStatus = async (submissionId: string, newStatus: string) => {
    try {
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: submissionId, status: newStatus }),
      });

      if (response.ok) {
        fetchSubmissions();
        setSelectedSubmission(null);
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const handleStartEditLegacy = () => {
    if (!selectedSubmission) return;
    setLegacyEdits({
      legacy_status: selectedSubmission.legacy_status || "",
      legacy_submission_status: selectedSubmission.legacy_submission_status || "",
      legacy_appointment_date: selectedSubmission.legacy_appointment_date || "",
      legacy_notes: selectedSubmission.legacy_notes || "",
    });
    setEditingLegacy(true);
  };

  const handleSaveLegacy = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    try {
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: selectedSubmission.submission_id,
          legacy_status: legacyEdits.legacy_status || null,
          legacy_submission_status: legacyEdits.legacy_submission_status || null,
          legacy_appointment_date: legacyEdits.legacy_appointment_date || null,
          legacy_notes: legacyEdits.legacy_notes || null,
        }),
      });

      if (response.ok) {
        setEditingLegacy(false);
        // Update local state
        setSelectedSubmission({
          ...selectedSubmission,
          legacy_status: legacyEdits.legacy_status || null,
          legacy_submission_status: legacyEdits.legacy_submission_status || null,
          legacy_appointment_date: legacyEdits.legacy_appointment_date || null,
          legacy_notes: legacyEdits.legacy_notes || null,
        });
        fetchSubmissions();
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  // Filter submissions client-side for source filters
  const filteredSubmissions = submissions.filter(s => {
    if (!sourceFilter) return true;
    // Intake source filters
    if (["web", "phone", "in_person", "paper", "legacy_airtable", "legacy_website"].includes(sourceFilter)) {
      return s.intake_source === sourceFilter;
    }
    // Legacy workflow filters
    if (sourceFilter === "legacy_booked") return s.is_legacy && s.legacy_submission_status === "Booked";
    if (sourceFilter === "legacy_pending") return s.is_legacy && (s.legacy_submission_status === "Pending Review" || !s.legacy_submission_status);
    return true;
  });

  // Stats
  const legacyCount = submissions.filter(s => s.is_legacy).length;
  const newCount = submissions.filter(s => !s.is_legacy).length;
  const bookedCount = submissions.filter(s => s.is_legacy && s.legacy_submission_status === "Booked").length;
  const pendingReviewCount = submissions.filter(s => s.is_legacy && (s.legacy_submission_status === "Pending Review" || !s.legacy_submission_status)).length;
  const thirdPartyCount = filteredSubmissions.filter(s => s.is_third_party_report).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1>Intake Triage Queue</h1>
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
            }}
          >
            New Intake Form
          </a>
          <a
            href="/intake/print"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              background: "var(--primary)",
              color: "#fff",
              borderRadius: "6px",
              textDecoration: "none",
              opacity: 0.8,
            }}
          >
            Print Intake Form
          </a>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ minWidth: "150px" }}
        >
          <option value="active">Active (New + Triaged)</option>
          <option value="">All Statuses</option>
          <option value="new">New Only</option>
          <option value="triaged">Triaged Only</option>
          <option value="reviewed">Reviewed</option>
          <option value="request_created">Converted to Request</option>
          <option value="client_handled">Client Handled</option>
          <option value="archived">Archived</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ minWidth: "180px" }}
        >
          <option value="">All Categories</option>
          <option value="high_priority_tnr">High Priority TNR</option>
          <option value="standard_tnr">Standard TNR</option>
          <option value="wellness_only">Wellness Only</option>
          <option value="owned_cat_low">Owned Cat (Low)</option>
          <option value="out_of_county">Out of County</option>
          <option value="needs_review">Needs Review</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          style={{ minWidth: "160px" }}
        >
          <option value="">All Sources</option>
          <option value="web">Web Form</option>
          <option value="phone">Phone</option>
          <option value="in_person">In Person</option>
          <option value="paper">Paper Form</option>
          <option value="legacy_airtable">Legacy (Airtable)</option>
          <option value="legacy_booked">Legacy: Booked</option>
          <option value="legacy_pending">Legacy: Pending Review</option>
        </select>

        <button onClick={fetchSubmissions} style={{ padding: "0.5rem 1rem" }}>
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {[
          { label: "High Priority", count: filteredSubmissions.filter(s => s.triage_category === "high_priority_tnr").length, color: "#dc3545" },
          { label: "Standard TNR", count: filteredSubmissions.filter(s => s.triage_category === "standard_tnr").length, color: "#0d6efd" },
          { label: "Third-Party", count: thirdPartyCount, color: "#ffc107" },
          { label: "Overdue (48h+)", count: filteredSubmissions.filter(s => s.overdue).length, color: "#fd7e14" },
          { label: "Booked", count: bookedCount, color: "#198754" },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "50%",
                background: stat.color,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: "bold",
              }}
            >
              {stat.count}
            </span>
            <span style={{ fontSize: "0.875rem" }}>{stat.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading submissions...</div>
      ) : filteredSubmissions.length === 0 ? (
        <div className="empty">
          <p>No submissions in queue</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Triage</th>
                <th>Status</th>
                <th>Submitter</th>
                <th>Location</th>
                <th>Cats</th>
                <th>Age</th>
                <th style={{ width: "30px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredSubmissions.map((sub) => (
                <tr
                  key={sub.submission_id}
                  onClick={() => window.location.href = `/intake/queue/${sub.submission_id}`}
                  style={{
                    background: sub.is_emergency ? "rgba(220, 53, 69, 0.15)" : sub.overdue ? "rgba(255, 193, 7, 0.15)" : sub.is_legacy ? "rgba(108, 117, 125, 0.1)" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <td>
                    <TriageBadge category={sub.triage_category} score={sub.triage_score} />
                    {sub.is_legacy && sub.legacy_submission_status && (
                      <div style={{ marginTop: "0.25rem" }}>
                        <LegacyStatusBadge status={sub.legacy_submission_status} />
                      </div>
                    )}
                    {sub.is_emergency && (
                      <span style={{ display: "block", color: "#dc3545", fontSize: "0.75rem", fontWeight: "bold", marginTop: "0.25rem" }}>
                        EMERGENCY
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <div style={{ display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }}>
                        <StatusBadge status={sub.status} />
                        <SourceBadge source={sub.intake_source} />
                        <ThirdPartyBadge isThirdParty={sub.is_third_party_report} relationship={sub.third_party_relationship} />
                      </div>
                      {sub.is_legacy && sub.legacy_appointment_date && (
                        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                          Appt: {formatDate(sub.legacy_appointment_date)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{normalizeName(sub.submitter_name)}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{sub.email}</div>
                    {sub.phone && <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{sub.phone}</div>}
                  </td>
                  <td>
                    <div>{sub.cats_address}</div>
                    {sub.cats_city && <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{sub.cats_city}</div>}
                  </td>
                  <td>
                    <div>{sub.cat_count_estimate ?? "?"} cats</div>
                    {sub.fixed_status && (
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                        {sub.fixed_status.replace(/_/g, " ")}
                      </div>
                    )}
                    {sub.has_kittens && (
                      <span style={{ color: "#fd7e14", fontSize: "0.75rem" }}>+kittens</span>
                    )}
                  </td>
                  <td>
                    <span style={{ color: sub.overdue ? "#dc3545" : undefined, fontWeight: sub.overdue ? "bold" : undefined }}>
                      {formatAge(sub.age)}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", color: "var(--text-muted)" }}>
                    →
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
          onClick={() => {
            setSelectedSubmission(null);
            setEditingLegacy(false);
          }}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  {selectedSubmission.submitter_name}
                  {selectedSubmission.is_legacy && (
                    <span style={{ fontSize: "0.75rem", background: "#6c757d", color: "#fff", padding: "0.25rem 0.5rem", borderRadius: "4px", marginLeft: "0.5rem" }}>
                      Legacy
                    </span>
                  )}
                </h2>
                <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{selectedSubmission.email}</p>
                {selectedSubmission.phone && <p style={{ color: "var(--muted)", margin: 0 }}>{selectedSubmission.phone}</p>}
              </div>
              <TriageBadge category={selectedSubmission.triage_category} score={selectedSubmission.triage_score} />
            </div>

            {selectedSubmission.is_emergency && (
              <div style={{ background: "rgba(220, 53, 69, 0.2)", border: "1px solid rgba(220, 53, 69, 0.5)", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem", color: "#ff6b6b" }}>
                <strong>EMERGENCY REQUEST</strong>
              </div>
            )}

            {/* Legacy Fields Section */}
            {selectedSubmission.is_legacy && (
              <div style={{ background: "rgba(255, 193, 7, 0.15)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem", border: "1px solid rgba(255, 193, 7, 0.5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>Legacy Workflow</h3>
                  {!editingLegacy ? (
                    <button
                      onClick={handleStartEditLegacy}
                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}
                    >
                      Edit
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        onClick={handleSaveLegacy}
                        disabled={saving}
                        style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px" }}
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingLegacy(false)}
                        style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {editingLegacy ? (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Submission Status</label>
                      <select
                        value={legacyEdits.legacy_submission_status}
                        onChange={(e) => setLegacyEdits({ ...legacyEdits, legacy_submission_status: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem" }}
                      >
                        {LEGACY_SUBMISSION_STATUSES.map((s) => (
                          <option key={s} value={s}>{s || "(none)"}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Status</label>
                      <select
                        value={legacyEdits.legacy_status}
                        onChange={(e) => setLegacyEdits({ ...legacyEdits, legacy_status: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem" }}
                      >
                        {LEGACY_STATUSES.map((s) => (
                          <option key={s} value={s}>{s || "(none)"}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Appointment Date</label>
                      <input
                        type="date"
                        value={legacyEdits.legacy_appointment_date}
                        onChange={(e) => setLegacyEdits({ ...legacyEdits, legacy_appointment_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Notes</label>
                      <textarea
                        value={legacyEdits.legacy_notes}
                        onChange={(e) => setLegacyEdits({ ...legacyEdits, legacy_notes: e.target.value })}
                        rows={3}
                        style={{ width: "100%", padding: "0.5rem", resize: "vertical" }}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.9rem" }}>
                    <div>
                      <strong>Submission Status:</strong>{" "}
                      {selectedSubmission.legacy_submission_status ? (
                        <LegacyStatusBadge status={selectedSubmission.legacy_submission_status} />
                      ) : (
                        <span style={{ color: "var(--muted)" }}>(none)</span>
                      )}
                    </div>
                    <div>
                      <strong>Status:</strong>{" "}
                      <span style={{ color: selectedSubmission.legacy_status ? "#000" : "#666" }}>
                        {selectedSubmission.legacy_status || "(none)"}
                      </span>
                    </div>
                    <div>
                      <strong>Appointment Date:</strong>{" "}
                      <span style={{ color: selectedSubmission.legacy_appointment_date ? "#000" : "#666" }}>
                        {selectedSubmission.legacy_appointment_date ? formatDate(selectedSubmission.legacy_appointment_date) : "(none)"}
                      </span>
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <strong>Notes:</strong>{" "}
                      <span style={{ color: selectedSubmission.legacy_notes ? "#000" : "#666" }}>
                        {selectedSubmission.legacy_notes || "(none)"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ background: "var(--card-bg, rgba(108, 117, 125, 0.1))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Location</h3>
              <p style={{ margin: 0 }}>{selectedSubmission.cats_address}</p>
              {selectedSubmission.cats_city && <p style={{ margin: 0, color: "var(--muted)" }}>{selectedSubmission.cats_city}</p>}
            </div>

            <div style={{ background: "var(--card-bg, rgba(108, 117, 125, 0.1))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Cats</h3>
              <p style={{ margin: "0.25rem 0" }}><strong>Count:</strong> {selectedSubmission.cat_count_estimate ?? "Unknown"}</p>
              {selectedSubmission.ownership_status && (
                <p style={{ margin: "0.25rem 0" }}><strong>Type:</strong> {selectedSubmission.ownership_status.replace(/_/g, " ")}</p>
              )}
              {selectedSubmission.fixed_status && (
                <p style={{ margin: "0.25rem 0" }}><strong>Fixed:</strong> {selectedSubmission.fixed_status.replace(/_/g, " ")}</p>
              )}
              {selectedSubmission.has_kittens && <p style={{ margin: "0.25rem 0", color: "#fd7e14" }}><strong>Kittens present</strong></p>}
              {selectedSubmission.has_medical_concerns && <p style={{ margin: "0.25rem 0", color: "#dc3545" }}><strong>Medical concerns noted</strong></p>}
            </div>

            {selectedSubmission.situation_description && (
              <div style={{ background: "var(--card-bg, rgba(108, 117, 125, 0.1))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Situation</h3>
                <p style={{ margin: 0 }}>{selectedSubmission.situation_description}</p>
              </div>
            )}

            {selectedSubmission.triage_reasons && selectedSubmission.triage_reasons.length > 0 && (
              <div style={{ background: "rgba(13, 110, 253, 0.15)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Triage Reasons</h3>
                <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                  {selectedSubmission.triage_reasons.map((reason, i) => (
                    <li key={i} style={{ marginBottom: "0.25rem" }}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {selectedSubmission.status !== "request_created" && (
                <button
                  onClick={() => handleConvertToRequest(selectedSubmission.submission_id)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#198754",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Create Request
                </button>
              )}

              {selectedSubmission.status !== "reviewed" && selectedSubmission.status !== "request_created" && (
                <button
                  onClick={() => handleUpdateStatus(selectedSubmission.submission_id, "reviewed")}
                  style={{ padding: "0.5rem 1rem" }}
                >
                  Mark Reviewed
                </button>
              )}

              {selectedSubmission.triage_category === "owned_cat_low" && (
                <button
                  onClick={() => handleUpdateStatus(selectedSubmission.submission_id, "redirected")}
                  style={{ padding: "0.5rem 1rem", background: "#fd7e14", color: "#000", border: "none", borderRadius: "6px" }}
                >
                  Redirect (Send Resources)
                </button>
              )}

              <button
                onClick={() => handleUpdateStatus(selectedSubmission.submission_id, "client_handled")}
                style={{ padding: "0.5rem 1rem", background: "#17a2b8", color: "#fff", border: "none", borderRadius: "6px" }}
                title="Client will handle it themselves (e.g., book their own cat at the clinic)"
              >
                Client Handled
              </button>

              <button
                onClick={() => handleUpdateStatus(selectedSubmission.submission_id, "archived")}
                style={{ padding: "0.5rem 1rem", background: "#6c757d", color: "#fff", border: "none", borderRadius: "6px" }}
              >
                Archive
              </button>

              <button
                onClick={() => {
                  setSelectedSubmission(null);
                  setEditingLegacy(false);
                }}
                style={{ padding: "0.5rem 1rem", marginLeft: "auto" }}
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
