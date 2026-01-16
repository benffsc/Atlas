"use client";

import { useState, useEffect } from "react";

interface Submission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cat_count_estimate: number | null;
  cat_count_text: string | null;
  situation_description: string | null;
  // Unified status (primary)
  submission_status: string | null;
  appointment_date: string | null;
  // Native status (for reference)
  status: string;
  triage_category: string | null;
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  created_request_id: string | null;
  place_id?: string | null;
  matched_person_id?: string | null;
  matched_person_name?: string | null;
}

interface SubmissionsSectionProps {
  entityType: "person" | "place";
  entityId: string;
}

function SourceBadge({ isLegacy }: { isLegacy: boolean }) {
  if (isLegacy) {
    return (
      <span
        className="badge"
        style={{
          background: "#ffc107",
          color: "#000",
          fontSize: "0.65rem",
        }}
        title="Imported from Airtable appointment requests"
      >
        Legacy
      </span>
    );
  }
  return (
    <span
      className="badge"
      style={{
        background: "#198754",
        color: "#fff",
        fontSize: "0.65rem",
      }}
      title="New web intake submission"
    >
      Web Intake
    </span>
  );
}

// Unified status badge for the new submission_status field
function StatusBadge({ submissionStatus }: { submissionStatus: string | null }) {
  const colors: Record<string, { bg: string; color: string; label: string }> = {
    "new": { bg: "#0d6efd", color: "#fff", label: "New" },
    "in_progress": { bg: "#fd7e14", color: "#000", label: "In Progress" },
    "scheduled": { bg: "#198754", color: "#fff", label: "Scheduled" },
    "complete": { bg: "#20c997", color: "#000", label: "Complete" },
    "archived": { bg: "#adb5bd", color: "#000", label: "Archived" },
  };

  const status = submissionStatus || "new";
  const style = colors[status] || colors["new"];

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.65rem" }}
    >
      {style.label}
    </span>
  );
}

function TriageBadge({ category }: { category: string | null }) {
  if (!category) return null;

  const colors: Record<string, { bg: string; color: string }> = {
    urgent: { bg: "#dc3545", color: "#fff" },
    high_priority: { bg: "#fd7e14", color: "#000" },
    standard: { bg: "#0d6efd", color: "#fff" },
    low_priority: { bg: "#6c757d", color: "#fff" },
    redirect: { bg: "#6f42c1", color: "#fff" },
    client_education: { bg: "#20c997", color: "#000" },
  };

  const style = colors[category] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.65rem" }}
      title={`Triage category: ${category}`}
    >
      {category.replace(/_/g, " ")}
    </span>
  );
}

export function SubmissionsSection({ entityType, entityId }: SubmissionsSectionProps) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLegacy, setShowLegacy] = useState(true);
  const [showNew, setShowNew] = useState(true);

  useEffect(() => {
    const fetchSubmissions = async () => {
      try {
        const endpoint = entityType === "person"
          ? `/api/people/${entityId}/submissions`
          : `/api/places/${entityId}/submissions`;

        const response = await fetch(endpoint);
        if (!response.ok) {
          throw new Error("Failed to fetch submissions");
        }
        const data = await response.json();
        setSubmissions(data.submissions || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchSubmissions();
  }, [entityType, entityId]);

  if (loading) {
    return <p className="text-muted">Loading submissions...</p>;
  }

  if (error) {
    return <p style={{ color: "#dc3545" }}>Error: {error}</p>;
  }

  const legacyCount = submissions.filter(s => s.is_legacy).length;
  const newCount = submissions.filter(s => !s.is_legacy).length;

  const filteredSubmissions = submissions.filter(s => {
    if (s.is_legacy && !showLegacy) return false;
    if (!s.is_legacy && !showNew) return false;
    return true;
  });

  if (submissions.length === 0) {
    return <p className="text-muted">No submissions linked to this {entityType}.</p>;
  }

  return (
    <div>
      {/* Filter toggles */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showLegacy}
            onChange={(e) => setShowLegacy(e.target.checked)}
          />
          <SourceBadge isLegacy={true} />
          <span className="text-sm">({legacyCount})</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showNew}
            onChange={(e) => setShowNew(e.target.checked)}
          />
          <SourceBadge isLegacy={false} />
          <span className="text-sm">({newCount})</span>
        </label>
      </div>

      {/* Submissions list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {filteredSubmissions.map((submission) => (
          <div
            key={submission.submission_id}
            style={{
              padding: "1rem",
              background: "var(--card-bg, #f8f9fa)",
              borderRadius: "8px",
              border: `1px solid ${submission.is_legacy ? "#ffc107" : "#198754"}`,
              borderLeftWidth: "3px",
            }}
          >
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <SourceBadge isLegacy={submission.is_legacy} />
              <StatusBadge submissionStatus={submission.submission_status} />
              <TriageBadge category={submission.triage_category} />
              <span className="text-muted text-sm" style={{ marginLeft: "auto" }}>
                {new Date(submission.submitted_at).toLocaleDateString()}
              </span>
            </div>

            {/* Main content */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.875rem" }}>
              <div>
                <span className="text-muted">Submitted by: </span>
                {entityType === "place" && submission.matched_person_id ? (
                  <a href={`/people/${submission.matched_person_id}`}>
                    {submission.matched_person_name || submission.submitter_name}
                  </a>
                ) : (
                  <span>{submission.submitter_name}</span>
                )}
              </div>
              <div>
                <span className="text-muted">Cats at: </span>
                {entityType === "person" && submission.place_id ? (
                  <a href={`/places/${submission.place_id}`}>{submission.cats_address}</a>
                ) : (
                  <span>{submission.cats_address}</span>
                )}
              </div>
              {submission.cat_count_estimate && (
                <div>
                  <span className="text-muted">Cat count: </span>
                  <span>{submission.cat_count_estimate}</span>
                  {submission.cat_count_text && (
                    <span className="text-muted"> ({submission.cat_count_text})</span>
                  )}
                </div>
              )}
              {(submission.appointment_date || submission.legacy_appointment_date) && (
                <div>
                  <span className="text-muted">Appt date: </span>
                  <span>{new Date(submission.appointment_date || submission.legacy_appointment_date!).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* Description */}
            {submission.situation_description && (
              <div style={{ marginTop: "0.75rem", fontSize: "0.875rem" }}>
                <span className="text-muted">Situation: </span>
                <span style={{
                  display: "block",
                  marginTop: "0.25rem",
                  padding: "0.5rem",
                  background: "var(--background, #fff)",
                  borderRadius: "4px",
                  whiteSpace: "pre-wrap",
                }}>
                  {submission.situation_description.length > 300
                    ? submission.situation_description.slice(0, 300) + "..."
                    : submission.situation_description}
                </span>
              </div>
            )}

            {/* Request link */}
            {submission.created_request_id && (
              <div style={{ marginTop: "0.75rem" }}>
                <a
                  href={`/requests/${submission.created_request_id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    fontSize: "0.875rem",
                    color: "#0d6efd",
                  }}
                >
                  View linked request →
                </a>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredSubmissions.length === 0 && submissions.length > 0 && (
        <p className="text-muted">No submissions match the current filters.</p>
      )}
    </div>
  );
}
