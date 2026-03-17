"use client";

import { useState, useEffect } from "react";
import { formatPhone } from "@/lib/formatters";
import { postApi, ApiError } from "@/lib/api-client";
import { URGENCY_REASON_OPTIONS } from "@/lib/intake-options";

interface IntakeSubmission {
  submission_id: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  cat_count_estimate: number | null;
  ownership_status: string;
  has_kittens: boolean | null;
  kitten_count: number | null;
  is_emergency: boolean;
  situation_description: string | null;
  is_third_party_report: boolean | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  has_property_access: boolean | null;
  geo_formatted_address: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  is_legacy: boolean;
  legacy_notes: string | null;
  // MIG_2531/2532: Additional intake fields
  county: string | null;
  peak_count: number | null;
  awareness_duration: string | null;
  has_medical_concerns: boolean | null;
  medical_description: string | null;
  feeding_location: string | null;
  feeding_time: string | null;
  dogs_on_site: boolean | null;
  trap_savvy: boolean | null;
  previous_tnr: boolean | null;
  third_party_relationship: string | null;
  kitten_age_estimate: string | null;
  kitten_behavior: string | null;
}

interface CreateRequestWizardProps {
  submission: IntakeSubmission;
  onComplete: (requestId: string) => void;
  onCancel: () => void;
}

// Priority options
const PRIORITIES = [
  { value: "urgent", label: "Urgent", description: "Medical emergency, eviction, or immediate danger" },
  { value: "high", label: "High", description: "Kittens, pregnant cats, or time-sensitive situation" },
  { value: "normal", label: "Normal", description: "Standard TNR request" },
  { value: "low", label: "Low", description: "Long-standing colony, no urgency" },
];

// Permission status options
const PERMISSION_STATUSES = [
  { value: "yes", label: "Yes - Permission Granted", description: "Requester has authority to allow trapping" },
  { value: "pending", label: "Pending - Need to Contact Owner", description: "Need to get property owner permission" },
  { value: "no", label: "No - Not Yet Obtained", description: "Permission has not been granted" },
  { value: "unknown", label: "Unknown", description: "Permission status unclear" },
];

// URGENCY_REASON_OPTIONS imported from @/lib/intake-options

export default function CreateRequestWizard({
  submission,
  onComplete,
  onCancel,
}: CreateRequestWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    priority: submission.is_emergency ? "urgent" : "normal",
    permission_status: submission.has_property_access ? "yes" : (submission.is_third_party_report ? "pending" : "unknown"),
    property_owner_name: submission.property_owner_name || "",
    property_owner_phone: submission.property_owner_phone || "",
    authorization_pending: submission.is_third_party_report || false,
    access_notes: "",
    traps_overnight_safe: true,
    best_contact_times: "",
    urgency_reasons: [] as string[],
    urgency_notes: "",
    trapper_notes: "",
    summary: "",
  });

  // Auto-generate summary
  useEffect(() => {
    const parts: string[] = [];
    if (submission.cat_count_estimate) {
      parts.push(`${submission.cat_count_estimate} cat${submission.cat_count_estimate > 1 ? "s" : ""}`);
    }
    if (submission.has_kittens) {
      parts.push("with kittens");
    }
    if (submission.ownership_status) {
      parts.push(`(${submission.ownership_status.replace(/_/g, " ")})`);
    }
    parts.push(`at ${submission.geo_formatted_address || submission.cats_address}`);

    setFormData(prev => ({
      ...prev,
      summary: parts.join(" "),
    }));
  }, [submission]);

  const handleToggleUrgency = (reason: string) => {
    setFormData(prev => ({
      ...prev,
      urgency_reasons: prev.urgency_reasons.includes(reason)
        ? prev.urgency_reasons.filter(r => r !== reason)
        : [...prev.urgency_reasons, reason],
    }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      const data = await postApi<{ request_id: string }>("/api/intake/convert", {
        submission_id: submission.submission_id,
        ...formData,
        converted_by: "web_user",
        // Pass through MIG_2531/2532 fields from intake
        county: submission.county,
        peak_count: submission.peak_count,
        awareness_duration: submission.awareness_duration,
        has_medical_concerns: submission.has_medical_concerns,
        medical_description: submission.medical_description,
        feeding_location: submission.feeding_location,
        feeding_time: submission.feeding_time,
        dogs_on_site: submission.dogs_on_site,
        trap_savvy: submission.trap_savvy,
        previous_tnr: submission.previous_tnr,
        is_third_party_report: submission.is_third_party_report,
        third_party_relationship: submission.third_party_relationship,
        kitten_age_estimate: submission.kitten_age_estimate,
        kitten_behavior: submission.kitten_behavior,
      });

      onComplete(data.request_id);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to create request");
      } else {
        setError("Network error - please try again");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          maxWidth: "600px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.5rem",
            borderBottom: "1px solid var(--border)",
            background: "linear-gradient(135deg, #6610f2 0%, #7c3aed 100%)",
            color: "#fff",
            borderRadius: "12px 12px 0 0",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Create Trapping Request</h2>
          <p style={{ margin: "0.5rem 0 0", opacity: 0.9, fontSize: "0.9rem" }}>
            Step {step} of 3: {step === 1 ? "Priority & Permission" : step === 2 ? "Access & Urgency" : "Review & Create"}
          </p>
        </div>

        {/* Progress bar */}
        <div style={{ height: "4px", background: "var(--border)" }}>
          <div
            style={{
              height: "100%",
              width: `${(step / 3) * 100}%`,
              background: "#6610f2",
              transition: "width 0.3s ease",
            }}
          />
        </div>

        {/* Content */}
        <div style={{ padding: "1.5rem" }}>
          {/* Captured Intake Data (always visible) */}
          <div
            style={{
              background: "linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1.5rem",
              fontSize: "0.85rem",
              border: "1px solid rgba(16, 185, 129, 0.3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <span style={{ fontWeight: 600, color: "#10b981", fontSize: "0.8rem", textTransform: "uppercase" }}>
                From Intake Submission
              </span>
              <span style={{ fontSize: "0.75rem", color: "#6b7280", background: "var(--bg-secondary)", padding: "2px 8px", borderRadius: "10px" }}>
                Pre-filled
              </span>
            </div>

            {/* Contact & Location */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{submission.submitter_name}</div>
                <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                  {submission.phone ? formatPhone(submission.phone) : submission.email}
                </div>
                {submission.is_third_party_report && (
                  <span style={{ fontSize: "0.7rem", background: "#fef3c7", color: "#92400e", padding: "1px 6px", borderRadius: "4px" }}>
                    Third-party: {submission.third_party_relationship || "unknown"}
                  </span>
                )}
              </div>
              <div>
                <div style={{ fontWeight: 500 }}>{submission.geo_formatted_address || submission.cats_address}</div>
                {submission.county && <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{submission.county} County</div>}
              </div>
            </div>

            {/* Colony Data (Beacon fields) */}
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <span style={{ fontWeight: 500 }}>Cats:</span>
                <span>{submission.cat_count_estimate || "?"}</span>
                {submission.peak_count && <span style={{ color: "#6b7280" }}>(peak: {submission.peak_count})</span>}
              </div>
              {submission.has_kittens && (
                <span style={{ background: "#fed7aa", color: "#9a3412", padding: "1px 6px", borderRadius: "4px", fontWeight: 500 }}>
                  +{submission.kitten_count || "?"} kittens {submission.kitten_age_estimate && `(${submission.kitten_age_estimate})`}
                </span>
              )}
              {submission.awareness_duration && (
                <div style={{ color: "#6b7280" }}>Known: {submission.awareness_duration.replace(/_/g, " ")}</div>
              )}
            </div>

            {/* Trapping Logistics */}
            {(submission.dogs_on_site || submission.trap_savvy || submission.previous_tnr || submission.feeding_location) && (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                {submission.dogs_on_site && (
                  <span style={{ fontSize: "0.75rem", background: "#fecaca", color: "#991b1b", padding: "1px 6px", borderRadius: "4px" }}>
                    Dogs on site
                  </span>
                )}
                {submission.trap_savvy && (
                  <span style={{ fontSize: "0.75rem", background: "#e0e7ff", color: "#3730a3", padding: "1px 6px", borderRadius: "4px" }}>
                    Trap savvy
                  </span>
                )}
                {submission.previous_tnr && (
                  <span style={{ fontSize: "0.75rem", background: "#d1fae5", color: "#065f46", padding: "1px 6px", borderRadius: "4px" }}>
                    Previous TNR
                  </span>
                )}
                {submission.feeding_location && (
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    Fed at: {submission.feeding_location} {submission.feeding_time && `@ ${submission.feeding_time}`}
                  </span>
                )}
              </div>
            )}

            {/* Medical Concerns */}
            {(submission.is_emergency || submission.has_medical_concerns) && (
              <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "4px" }}>
                {submission.is_emergency && (
                  <span style={{ color: "#dc2626", fontWeight: 600 }}>EMERGENCY </span>
                )}
                {submission.has_medical_concerns && (
                  <span style={{ color: "#dc2626" }}>Medical concerns{submission.medical_description && `: ${submission.medical_description}`}</span>
                )}
              </div>
            )}

            {/* Situation Description */}
            {submission.situation_description && (
              <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "rgba(0,0,0,0.05)", borderRadius: "4px", fontStyle: "italic", color: "#4b5563" }}>
                "{submission.situation_description.substring(0, 200)}{submission.situation_description.length > 200 ? "..." : ""}"
              </div>
            )}
          </div>

          {error && (
            <div
              style={{
                background: "rgba(220, 53, 69, 0.1)",
                border: "1px solid rgba(220, 53, 69, 0.3)",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem",
                color: "#dc3545",
              }}
            >
              {error}
            </div>
          )}

          {/* Step 1: Priority & Permission */}
          {step === 1 && (
            <div>
              <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Priority</h3>
              <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1.5rem" }}>
                {PRIORITIES.map((p) => (
                  <label
                    key={p.value}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      border: `2px solid ${formData.priority === p.value ? "#6610f2" : "var(--border)"}`,
                      borderRadius: "8px",
                      cursor: "pointer",
                      background: formData.priority === p.value ? "rgba(102, 16, 242, 0.05)" : "transparent",
                    }}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={p.value}
                      checked={formData.priority === p.value}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                      style={{ marginTop: "0.2rem" }}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{p.description}</div>
                    </div>
                  </label>
                ))}
              </div>

              <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Property Permission</h3>
              <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
                {PERMISSION_STATUSES.map((p) => (
                  <label
                    key={p.value}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      border: `2px solid ${formData.permission_status === p.value ? "#6610f2" : "var(--border)"}`,
                      borderRadius: "8px",
                      cursor: "pointer",
                      background: formData.permission_status === p.value ? "rgba(102, 16, 242, 0.05)" : "transparent",
                    }}
                  >
                    <input
                      type="radio"
                      name="permission"
                      value={p.value}
                      checked={formData.permission_status === p.value}
                      onChange={(e) => setFormData({ ...formData, permission_status: e.target.value })}
                      style={{ marginTop: "0.2rem" }}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{p.description}</div>
                    </div>
                  </label>
                ))}
              </div>

              {(formData.permission_status === "pending" || formData.permission_status === "no") && (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "rgba(255, 193, 7, 0.1)", borderRadius: "8px" }}>
                  <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>Property Owner Info</h4>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <input
                      type="text"
                      placeholder="Owner Name"
                      value={formData.property_owner_name}
                      onChange={(e) => setFormData({ ...formData, property_owner_name: e.target.value })}
                      style={{ padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)" }}
                    />
                    <input
                      type="tel"
                      placeholder="Owner Phone"
                      value={formData.property_owner_phone}
                      onChange={(e) => setFormData({ ...formData, property_owner_phone: e.target.value })}
                      style={{ padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)" }}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
                      <input
                        type="checkbox"
                        checked={formData.authorization_pending}
                        onChange={(e) => setFormData({ ...formData, authorization_pending: e.target.checked })}
                      />
                      Mark as pending authorization (needs follow-up)
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Access & Urgency */}
          {step === 2 && (
            <div>
              <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Access Details</h3>
              <div style={{ display: "grid", gap: "1rem", marginBottom: "1.5rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
                    Access Notes (gate codes, parking, landmarks)
                  </label>
                  <textarea
                    value={formData.access_notes}
                    onChange={(e) => setFormData({ ...formData, access_notes: e.target.value })}
                    placeholder="Gate code: 1234, park on street, cats usually behind garage..."
                    rows={3}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", resize: "vertical" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
                    Best Times to Contact / Trap
                  </label>
                  <input
                    type="text"
                    value={formData.best_contact_times}
                    onChange={(e) => setFormData({ ...formData, best_contact_times: e.target.value })}
                    placeholder="e.g., Evenings after 5pm, weekends only"
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)" }}
                  />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
                  <input
                    type="checkbox"
                    checked={formData.traps_overnight_safe}
                    onChange={(e) => setFormData({ ...formData, traps_overnight_safe: e.target.checked })}
                  />
                  Safe to leave traps overnight
                </label>
              </div>

              <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Urgency Factors</h3>
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                Select any that apply (affects prioritization)
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
                {URGENCY_REASON_OPTIONS.map((r) => (
                  <label
                    key={r.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 0.75rem",
                      border: `1px solid ${formData.urgency_reasons.includes(r.value) ? "#6610f2" : "var(--border)"}`,
                      borderRadius: "6px",
                      cursor: "pointer",
                      background: formData.urgency_reasons.includes(r.value) ? "rgba(102, 16, 242, 0.05)" : "transparent",
                      fontSize: "0.85rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={formData.urgency_reasons.includes(r.value)}
                      onChange={() => handleToggleUrgency(r.value)}
                    />
                    {r.label}
                  </label>
                ))}
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
                  Urgency Notes
                </label>
                <textarea
                  value={formData.urgency_notes}
                  onChange={(e) => setFormData({ ...formData, urgency_notes: e.target.value })}
                  placeholder="Any deadlines or special circumstances..."
                  rows={2}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", resize: "vertical" }}
                />
              </div>
            </div>
          )}

          {/* Step 3: Review & Create */}
          {step === 3 && (
            <div>
              <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Request Summary</h3>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
                  Request Title
                </label>
                <input
                  type="text"
                  value={formData.summary}
                  onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)" }}
                />
              </div>

              <div style={{ marginTop: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
                  Trapper Notes (for assigned trappers)
                </label>
                <textarea
                  value={formData.trapper_notes}
                  onChange={(e) => setFormData({ ...formData, trapper_notes: e.target.value })}
                  placeholder="Notes for trappers: what to expect, cat descriptions, etc..."
                  rows={3}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", resize: "vertical" }}
                />
              </div>

              {/* Summary */}
              <div
                style={{
                  marginTop: "1.5rem",
                  padding: "1rem",
                  background: "rgba(102, 16, 242, 0.05)",
                  borderRadius: "8px",
                  border: "1px solid rgba(102, 16, 242, 0.2)",
                }}
              >
                <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>Request Details</h4>
                <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.9rem" }}>
                  <div>
                    <strong>Priority:</strong> {PRIORITIES.find(p => p.value === formData.priority)?.label}
                  </div>
                  <div>
                    <strong>Permission:</strong> {PERMISSION_STATUSES.find(p => p.value === formData.permission_status)?.label}
                  </div>
                  {formData.urgency_reasons.length > 0 && (
                    <div>
                      <strong>Urgency:</strong> {formData.urgency_reasons.map(r => URGENCY_REASON_OPTIONS.find(u => u.value === r)?.label).join(", ")}
                    </div>
                  )}
                  {formData.access_notes && (
                    <div>
                      <strong>Access:</strong> {formData.access_notes.substring(0, 50)}...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={step > 1 ? () => setStep(step - 1) : onCancel}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            {step > 1 ? "← Back" : "Cancel"}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              style={{
                padding: "0.5rem 1.5rem",
                background: "#6610f2",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{
                padding: "0.5rem 1.5rem",
                background: saving ? "#6c757d" : "#198754",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: saving ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
            >
              {saving ? "Creating..." : "Create Request"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
