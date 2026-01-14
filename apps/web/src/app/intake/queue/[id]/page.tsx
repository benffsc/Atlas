"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  source: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  cats_zip: string | null;
  county: string | null;
  ownership_status: string;
  cat_count_estimate: number | null;
  fixed_status: string;
  awareness_duration: string | null;
  has_kittens: boolean | null;
  kitten_count: number | null;
  kitten_age_estimate: string | null;
  kitten_mixed_ages_description: string | null;
  kitten_behavior: string | null;
  kitten_contained: string | null;
  mom_present: string | null;
  mom_fixed: string | null;
  can_bring_in: string | null;
  kitten_notes: string | null;
  has_medical_concerns: boolean | null;
  is_emergency: boolean;
  cats_being_fed: boolean | null;
  has_property_access: boolean | null;
  is_property_owner: boolean | null;
  situation_description: string | null;
  referral_source: string | null;
  how_long_feeding: string | null;
  triage_category: string | null;
  triage_score: number | null;
  triage_reasons: string[] | null;
  status: string;
  final_category: string | null;
  created_request_id: string | null;
  priority_override: string | null;
  kitten_outcome: string | null;
  foster_readiness: string | null;
  kitten_urgency_factors: string[] | null;
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
  intake_source: string | null;
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_confidence: string | null;
  updated_at: string | null;
}

interface MatchedPerson {
  person_id: string;
  display_name: string;
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

// Legacy submission status options
const LEGACY_SUBMISSION_STATUSES = [
  "",
  "Pending Review",
  "Booked",
  "Declined",
  "Complete",
];

// Legacy status options
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
      <span className="badge" style={{ background: "#6c757d", color: "#fff" }}>
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
      <span className="badge" style={{ background: style.bg, color: style.color }}>
        {category.replace(/_/g, " ")}
      </span>
      {score !== null && (
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          Score: {score}
        </span>
      )}
    </div>
  );
}

function GeoConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;

  const colors: Record<string, { bg: string; color: string; label: string }> = {
    exact: { bg: "#198754", color: "#fff", label: "Exact" },
    approximate: { bg: "#ffc107", color: "#000", label: "Approx" },
    city: { bg: "#fd7e14", color: "#000", label: "City only" },
    failed: { bg: "#dc3545", color: "#fff", label: "Failed" },
    skip: { bg: "#6c757d", color: "#fff", label: "Skipped" },
  };
  const style = colors[confidence] || { bg: "#6c757d", color: "#fff", label: confidence };

  return (
    <span className="badge" style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}>
      {style.label}
    </span>
  );
}

export default function SubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [submission, setSubmission] = useState<IntakeSubmission | null>(null);
  const [matchedPerson, setMatchedPerson] = useState<MatchedPerson | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [legacyStatus, setLegacyStatus] = useState("");
  const [legacySubmissionStatus, setLegacySubmissionStatus] = useState("");
  const [legacyAppointmentDate, setLegacyAppointmentDate] = useState("");
  const [legacyNotes, setLegacyNotes] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  useEffect(() => {
    fetch(`/api/intake/queue/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setSubmission(data.submission);
        setMatchedPerson(data.matchedPerson);
        // Initialize editable fields
        setLegacyStatus(data.submission.legacy_status || "");
        setLegacySubmissionStatus(data.submission.legacy_submission_status || "");
        setLegacyAppointmentDate(data.submission.legacy_appointment_date?.split("T")[0] || "");
        setLegacyNotes(data.submission.legacy_notes || "");
        setReviewNotes(data.submission.review_notes || "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!submission) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/intake/queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legacy_status: legacyStatus || null,
          legacy_submission_status: legacySubmissionStatus || null,
          legacy_appointment_date: legacyAppointmentDate || null,
          legacy_notes: legacyNotes || null,
          review_notes: reviewNotes || null,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      const data = await res.json();
      setSubmission(data.submission);
      alert("Saved successfully!");
    } catch (err) {
      alert("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <a href="/intake/queue" style={{ color: "var(--muted)" }}>← Back to Queue</a>
        <div style={{ marginTop: "2rem" }}>Loading...</div>
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div>
        <a href="/intake/queue" style={{ color: "var(--muted)" }}>← Back to Queue</a>
        <div style={{ marginTop: "2rem", color: "#dc3545" }}>
          Error: {error || "Submission not found"}
        </div>
      </div>
    );
  }

  const fullName = `${normalizeName(submission.first_name)} ${normalizeName(submission.last_name)}`;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1.5rem" }}>
        <div>
          <a href="/intake/queue" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>← Back to Queue</a>
          <h1 style={{ margin: "0.5rem 0 0 0" }}>
            {fullName}
            {submission.is_legacy && (
              <span style={{ fontSize: "0.75rem", background: "#6c757d", color: "#fff", padding: "0.25rem 0.5rem", borderRadius: "4px", marginLeft: "0.75rem", verticalAlign: "middle" }}>
                Legacy
              </span>
            )}
          </h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>
            Submitted {new Date(submission.submitted_at).toLocaleDateString()} at {new Date(submission.submitted_at).toLocaleTimeString()}
          </p>
        </div>
        <TriageBadge category={submission.triage_category} score={submission.triage_score} />
      </div>

      {submission.is_emergency && (
        <div style={{ background: "rgba(220, 53, 69, 0.2)", border: "1px solid rgba(220, 53, 69, 0.5)", borderRadius: "8px", padding: "1rem", marginBottom: "1.5rem", color: "#ff6b6b" }}>
          <strong>EMERGENCY REQUEST</strong>
          {submission.situation_description && (
            <p style={{ margin: "0.5rem 0 0 0", color: "var(--foreground)" }}>{submission.situation_description}</p>
          )}
        </div>
      )}

      {/* Third-Party Report Banner */}
      {submission.is_third_party_report && (
        <div style={{
          background: "var(--warning-bg)",
          border: "2px solid #ffc107",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1.5rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <span style={{
              background: "#ffc107",
              color: "#000",
              padding: "0.25rem 0.75rem",
              borderRadius: "4px",
              fontWeight: "bold",
              fontSize: "0.85rem",
            }}>
              THIRD-PARTY REPORT
            </span>
            {submission.third_party_relationship && (
              <span style={{ color: "var(--warning-text)", fontSize: "0.9rem" }}>
                from {submission.third_party_relationship.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <p style={{ margin: "0 0 0.75rem 0", color: "var(--warning-text)" }}>
            This submission was made by someone else on behalf of the property. Staff needs to contact the property owner for permission before scheduling services.
          </p>
          {(submission.property_owner_name || submission.property_owner_phone || submission.property_owner_email) && (
            <div style={{ background: "var(--card-bg)", padding: "0.75rem", borderRadius: "6px", border: "1px solid #e0a800" }}>
              <strong style={{ fontSize: "0.85rem", display: "block", marginBottom: "0.5rem" }}>Property Owner Contact:</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem" }}>
                {submission.property_owner_name && (
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Name:</span>
                    <div style={{ fontWeight: 500 }}>{submission.property_owner_name}</div>
                  </div>
                )}
                {submission.property_owner_phone && (
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Phone:</span>
                    <div style={{ fontWeight: 500 }}>{submission.property_owner_phone}</div>
                  </div>
                )}
                {submission.property_owner_email && (
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Email:</span>
                    <div style={{ fontWeight: 500 }}>{submission.property_owner_email}</div>
                  </div>
                )}
              </div>
            </div>
          )}
          {!submission.property_owner_name && !submission.property_owner_phone && !submission.property_owner_email && (
            <p style={{ margin: 0, color: "#dc3545", fontWeight: 500 }}>
              No property owner contact provided - will need to investigate.
            </p>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Left Column: Contact & Location */}
        <div>
          {/* Contact Info */}
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h3 style={{ margin: "0 0 1rem 0" }}>Contact Information</h3>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Name</label>
                <div style={{ fontWeight: 500 }}>{fullName}</div>
                {(submission.first_name !== normalizeName(submission.first_name) ||
                  submission.last_name !== normalizeName(submission.last_name)) && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    Original: {submission.first_name} {submission.last_name}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Email</label>
                <div>{submission.email}</div>
              </div>
              {submission.phone && (
                <div>
                  <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Phone</label>
                  <div>{submission.phone}</div>
                </div>
              )}
              {matchedPerson && (
                <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "rgba(25, 135, 84, 0.15)", borderRadius: "6px" }}>
                  <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Linked to Person</label>
                  <div>
                    <a href={`/people/${matchedPerson.person_id}`} style={{ fontWeight: 500 }}>
                      {matchedPerson.display_name}
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Location Info */}
          <div className="card">
            <h3 style={{ margin: "0 0 1rem 0" }}>Location</h3>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Address (Original)</label>
                <div>{submission.cats_address}</div>
                {submission.cats_city && <div style={{ color: "var(--muted)" }}>{submission.cats_city}</div>}
              </div>
              {submission.geo_formatted_address && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Geocoded Address</label>
                    <GeoConfidenceBadge confidence={submission.geo_confidence} />
                  </div>
                  <div style={{ color: "#198754" }}>{submission.geo_formatted_address}</div>
                </div>
              )}
              {submission.geo_latitude && submission.geo_longitude && (
                <div>
                  <a
                    href={`https://www.google.com/maps?q=${submission.geo_latitude},${submission.geo_longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "0.85rem" }}
                  >
                    View on Google Maps →
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Cats & Details */}
        <div>
          {/* Cat Info */}
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h3 style={{ margin: "0 0 1rem 0" }}>Cat Information</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Estimated Count</label>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{submission.cat_count_estimate ?? "?"}</div>
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Fixed Status</label>
                <div>{submission.fixed_status?.replace(/_/g, " ") || "Unknown"}</div>
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Has Kittens</label>
                <div>{submission.has_kittens ? "Yes" : submission.has_kittens === false ? "No" : "Unknown"}</div>
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Medical Concerns</label>
                <div>{submission.has_medical_concerns ? "Yes" : submission.has_medical_concerns === false ? "No" : "Unknown"}</div>
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Ownership</label>
                <div>{submission.ownership_status?.replace(/_/g, " ") || "Unknown"}</div>
              </div>
              {submission.how_long_feeding && (
                <div>
                  <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Feeding Duration</label>
                  <div>{submission.how_long_feeding}</div>
                </div>
              )}
            </div>
          </div>

          {/* Situation Description */}
          {submission.situation_description && !submission.is_emergency && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Situation</h3>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{submission.situation_description}</p>
            </div>
          )}

          {/* Triage Reasons */}
          {submission.triage_reasons && Array.isArray(submission.triage_reasons) && submission.triage_reasons.length > 0 && (
            <div className="card">
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Triage Reasons</h3>
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {submission.triage_reasons.map((reason, i) => (
                  <li key={i} style={{ fontSize: "0.9rem" }}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Kitten Details Section */}
      {submission.has_kittens && (
        <div className="card" style={{ marginTop: "1.5rem", background: "rgba(33, 150, 243, 0.1)", border: "1px solid #2196f3" }}>
          <h3 style={{ margin: "0 0 1rem 0", color: "#1565c0" }}>Kitten Details</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Count</label>
              <div style={{ fontWeight: "bold" }}>{submission.kitten_count || "?"}</div>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Age Range</label>
              <div>{submission.kitten_age_estimate?.replace(/_/g, " ") || "Unknown"}</div>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Behavior</label>
              <div>{submission.kitten_behavior?.replace(/_/g, " ") || "Unknown"}</div>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Contained?</label>
              <div>{submission.kitten_contained?.replace(/_/g, " ") || "Unknown"}</div>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Mom Present?</label>
              <div>{submission.mom_present || "Unknown"}</div>
            </div>
            {submission.mom_present === "yes" && (
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Mom Fixed?</label>
                <div>{submission.mom_fixed || "Unknown"}</div>
              </div>
            )}
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Can Bring In?</label>
              <div>{submission.can_bring_in?.replace(/_/g, " ") || "Unknown"}</div>
            </div>
          </div>
          {submission.kitten_mixed_ages_description && (
            <div style={{ marginTop: "1rem" }}>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Mixed Ages Description</label>
              <div>{submission.kitten_mixed_ages_description}</div>
            </div>
          )}
          {submission.kitten_notes && (
            <div style={{ marginTop: "1rem" }}>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Kitten Notes</label>
              <div style={{ whiteSpace: "pre-wrap" }}>{submission.kitten_notes}</div>
            </div>
          )}
          {/* Staff Kitten Assessment (display only) */}
          {(submission.kitten_outcome || submission.foster_readiness) && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(33, 150, 243, 0.3)" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#1565c0" }}>Staff Assessment</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem", marginTop: "0.5rem" }}>
                {submission.kitten_outcome && (
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Outcome</label>
                    <div>{submission.kitten_outcome.replace(/_/g, " ")}</div>
                  </div>
                )}
                {submission.foster_readiness && (
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Foster Readiness</label>
                    <div>{submission.foster_readiness}</div>
                  </div>
                )}
                {submission.kitten_urgency_factors && submission.kitten_urgency_factors.length > 0 && (
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Urgency Factors</label>
                    <div>{submission.kitten_urgency_factors.map(f => f.replace(/_/g, " ")).join(", ")}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workflow Section - Full Width */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ margin: "0 0 1rem 0" }}>
          {submission.is_legacy ? "Legacy Workflow" : "Workflow"}
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          {submission.is_legacy && (
            <>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>
                  Status
                </label>
                <select
                  value={legacyStatus}
                  onChange={(e) => setLegacyStatus(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  {LEGACY_STATUSES.map((s) => (
                    <option key={s} value={s}>{s || "(none)"}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>
                  Submission Status
                </label>
                <select
                  value={legacySubmissionStatus}
                  onChange={(e) => setLegacySubmissionStatus(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  {LEGACY_SUBMISSION_STATUSES.map((s) => (
                    <option key={s} value={s}>{s || "(none)"}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>
                  Appointment Date
                </label>
                <input
                  type="date"
                  value={legacyAppointmentDate}
                  onChange={(e) => setLegacyAppointmentDate(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            </>
          )}
        </div>

        {submission.is_legacy && (
          <div style={{ marginTop: "1rem" }}>
            <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>
              Legacy Notes (Jami's working notes)
            </label>
            <textarea
              value={legacyNotes}
              onChange={(e) => setLegacyNotes(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", minHeight: "80px", fontFamily: "inherit" }}
            />
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>
            Review Notes (Atlas internal notes)
          </label>
          <textarea
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", minHeight: "80px", fontFamily: "inherit" }}
            placeholder="Add notes about this submission..."
          />
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "6px",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {submission.created_request_id ? (
            <a
              href={`/requests/${submission.created_request_id}`}
              style={{
                padding: "0.5rem 1rem",
                background: "#198754",
                color: "#fff",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              View Request →
            </a>
          ) : (
            <a
              href={`/requests/new?from_intake=${submission.submission_id}`}
              style={{
                padding: "0.5rem 1rem",
                background: "#0d6efd",
                color: "#fff",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Create Request →
            </a>
          )}
        </div>
      </div>

      {/* Metadata Footer */}
      <div style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>
        <div>Submission ID: {submission.submission_id}</div>
        {submission.legacy_source_id && <div>Legacy Source ID: {submission.legacy_source_id}</div>}
        {submission.intake_source && <div>Source: {submission.intake_source}</div>}
        {submission.updated_at && <div>Last Updated: {new Date(submission.updated_at).toLocaleString()}</div>}
      </div>
    </div>
  );
}
