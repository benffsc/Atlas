"use client";

import { useState, useEffect, use } from "react";
import { formatPhone } from "@/lib/formatters";
import {
  URGENT_SITUATION_EXAMPLES,
  getOwnershipLabel as getOwnershipLabelFromLib,
  getFixedStatusLabel as getFixedLabelFromLib,
} from "@/lib/intake-options";

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  source: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_third_party_report: boolean;
  third_party_relationship: string | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
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
  is_emergency: boolean;
  has_medical_concerns: boolean | null;
  cats_being_fed: boolean | null;
  has_property_access: boolean | null;
  is_property_owner: boolean | null;
  referral_source: string | null;
  situation_description: string | null;
  triage_category: string | null;
  triage_score: number | null;
  priority_override: string | null;
  kitten_outcome: string | null;
  foster_readiness: string | null;
  kitten_urgency_factors: string[] | null;
  review_notes: string | null;
  reviewed_by: string | null;
  custom_fields: Record<string, string | boolean | number> | null;
  // Legacy fields
  is_legacy: boolean;
  legacy_status: string | null;
  legacy_submission_status: string | null;
  legacy_appointment_date: string | null;
  legacy_notes: string | null;
  submission_status: string | null;
  appointment_date: string | null;
  // Additional fields
  feeds_cat: boolean | null;
  feeding_frequency: string | null;
  feeding_duration: string | null;
  cat_comes_inside: string | null;
  geo_formatted_address: string | null;
}

interface CustomFieldDef {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
}

function formatValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return dateStr;
  }
}

function getOwnershipLabel(status: string): string {
  return getOwnershipLabelFromLib(status) || formatValue(status);
}

function getFixedLabel(status: string): string {
  return getFixedLabelFromLib(status) || formatValue(status);
}

function getPriorityColor(priority: string | null, triage: string | null): string {
  if (priority === "high") return "#e74c3c";
  if (triage === "high_priority" || triage === "ffr_high") return "#e67e22";
  return "#27ae60";
}

export default function PrintSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [submission, setSubmission] = useState<IntakeSubmission | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideStaffNotes, setHideStaffNotes] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/intake/queue/${id}`).then(res => {
        if (!res.ok) throw new Error("Failed to fetch submission");
        return res.json();
      }),
      fetch("/api/intake/custom-fields").then(res => res.ok ? res.json() : { fields: [] })
    ])
      .then(([subData, fieldsData]) => {
        setSubmission(subData.submission);
        setCustomFieldDefs(fieldsData.fields || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>Loading...</div>;
  if (error || !submission) return <div style={{ padding: "2rem", color: "#dc3545", fontFamily: "Helvetica, Arial, sans-serif" }}>Error: {error || "Not found"}</div>;

  const fullName = `${submission.first_name} ${submission.last_name}`;
  const isLegacy = submission.is_legacy;

  // Helper to get custom field value with label
  const getCustomFieldDisplay = (key: string): { label: string; value: string } | null => {
    const fieldDef = customFieldDefs.find(f => f.field_key === key);
    const rawValue = submission.custom_fields?.[key];
    if (!fieldDef || rawValue === undefined || rawValue === null || rawValue === "") return null;

    let displayValue = String(rawValue);
    if (fieldDef.field_type === "select" && fieldDef.options) {
      const opt = fieldDef.options.find(o => o.value === rawValue);
      if (opt) displayValue = opt.label;
    } else if (fieldDef.field_type === "checkbox") {
      displayValue = rawValue ? "Yes" : "No";
    }

    return { label: fieldDef.field_label, value: displayValue };
  };

  // Get all filled custom fields
  const filledCustomFields = customFieldDefs
    .map(f => getCustomFieldDisplay(f.field_key))
    .filter((f): f is { label: string; value: string } => f !== null);

  // Get status for display
  const displayStatus = submission.submission_status || submission.legacy_submission_status || "New";
  const appointmentDate = submission.appointment_date || submission.legacy_appointment_date;

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');

        @media print {
          @page { size: letter; margin: 0.5in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-controls { display: none !important; }
          .print-page {
            padding: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
          }
          .print-page:last-child { page-break-after: auto; }
        }

        body { margin: 0; padding: 0; }

        .print-wrapper {
          font-family: Helvetica, Arial, sans-serif;
          font-size: 10pt;
          line-height: 1.35;
          color: #2c3e50;
        }

        .print-page {
          width: 8.5in;
          min-height: 10in;
          padding: 0.5in;
          box-sizing: border-box;
          background: #fff;
        }

        h1, h2, h3, .section-title {
          font-family: 'Raleway', Helvetica, sans-serif;
          font-weight: 700;
        }

        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 12px;
          margin-bottom: 16px;
          border-bottom: 3px solid #3498db;
        }

        .print-header h1 {
          font-size: 18pt;
          margin: 0;
          color: #2c3e50;
        }

        .print-header .subtitle {
          font-size: 10pt;
          color: #7f8c8d;
          margin-top: 2px;
        }

        .status-strip {
          display: flex;
          gap: 16px;
          background: #f8f9fa;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          align-items: center;
        }

        .status-badge {
          padding: 4px 12px;
          border-radius: 20px;
          font-weight: 600;
          font-size: 9pt;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .status-new { background: #3498db; color: white; }
        .status-in_progress { background: #f39c12; color: white; }
        .status-scheduled { background: #27ae60; color: white; }
        .status-complete { background: #95a5a6; color: white; }
        .status-archived { background: #7f8c8d; color: white; }

        .meta-item {
          font-size: 9pt;
          color: #7f8c8d;
        }

        .meta-item strong {
          color: #2c3e50;
        }

        .section {
          margin-bottom: 14px;
        }

        .section-title {
          font-size: 11pt;
          color: #3498db;
          border-bottom: 2px solid #ecf0f1;
          padding-bottom: 4px;
          margin-bottom: 10px;
        }

        .card {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 12px;
        }

        .card-highlight {
          border-left: 4px solid #3498db;
        }

        .card-warning {
          background: #fef9e7;
          border-left: 4px solid #f39c12;
        }

        .card-emergency {
          background: #fdedec;
          border-left: 4px solid #e74c3c;
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px 20px;
        }

        .info-grid-3 {
          grid-template-columns: repeat(3, 1fr);
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .info-label {
          font-size: 8pt;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .info-value {
          font-size: 10pt;
          color: #2c3e50;
          font-weight: 500;
        }

        .info-value.large {
          font-size: 12pt;
        }

        .tag {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 9pt;
          font-weight: 500;
        }

        .tag-blue { background: #e8f4fd; color: #2980b9; }
        .tag-green { background: #e8f8f5; color: #27ae60; }
        .tag-orange { background: #fef5e7; color: #e67e22; }
        .tag-purple { background: #f4ecf7; color: #8e44ad; }

        .description-box {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          padding: 10px 12px;
          min-height: 60px;
          white-space: pre-wrap;
          font-size: 10pt;
          line-height: 1.4;
        }

        .checklist {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 12px;
          padding-right: 4px;
        }

        .check-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 9pt;
        }

        .check-yes { color: #27ae60; }
        .check-no { color: #e74c3c; }
        .check-na { color: #7f8c8d; }

        .staff-section {
          background: #f0f3f4;
          border: 2px dashed #bdc3c7;
          border-radius: 8px;
          padding: 12px;
          margin-top: 12px;
        }

        .staff-section .section-title {
          color: #7f8c8d;
          border-bottom-color: #bdc3c7;
        }

        .notes-box {
          background: white;
          border: 1px solid #ddd;
          padding: 8px 10px;
          min-height: 50px;
          border-radius: 4px;
          font-size: 9pt;
        }

        .legacy-banner {
          background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
          color: white;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 9pt;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .footer {
          margin-top: auto;
          padding-top: 10px;
          border-top: 1px solid #ecf0f1;
          font-size: 8pt;
          color: #95a5a6;
          display: flex;
          justify-content: space-between;
        }

        @media screen {
          body { background: #ecf0f1 !important; }
          .print-wrapper { padding: 20px; }
          .print-page {
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin: 0 auto 30px auto;
            border-radius: 8px;
          }
          .print-controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 1000;
          }
          .print-controls button {
            display: block;
            width: 100%;
            padding: 12px 20px;
            margin-bottom: 10px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s;
          }
          .print-controls .print-btn {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: #fff;
          }
          .print-controls .print-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(52,152,219,0.4);
          }
          .print-controls .back-btn {
            background: #f0f0f0;
            color: #333;
          }
        }
      `}</style>

      {/* Controls */}
      <div className="print-controls">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", fontSize: "13px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={hideStaffNotes}
            onChange={(e) => setHideStaffNotes(e.target.checked)}
            style={{ width: "16px", height: "16px", accentColor: "#3498db" }}
          />
          Hide staff notes (public-safe)
        </label>
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
        <a href={`/intake/queue`} style={{ textDecoration: "none" }}>
          <button className="back-btn" style={{ width: "100%" }}>← Back to Queue</button>
        </a>
      </div>

      {/* PAGE 1 */}
      <div className="print-page" style={{ display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div className="print-header">
          <div>
            <h1>Help Request</h1>
            <div className="subtitle">
              {fullName} • Submitted {formatDate(submission.submitted_at)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Forgotten Felines" style={{ height: "50px", width: "auto" }} />
            <div style={{ textAlign: "right", fontSize: "9pt", color: "#7f8c8d" }}>
              (707) 576-7999<br />
              forgottenfelines.com
            </div>
          </div>
        </div>

        {/* Legacy Banner */}
        {isLegacy && (
          <div className="legacy-banner">
            <span>Legacy Request (imported from previous system)</span>
          </div>
        )}

        {/* Emergency Alert - Moved to top */}
        {submission.is_emergency && (
          <div className="card card-emergency" style={{ marginBottom: "14px" }}>
            <strong style={{ color: "#e74c3c" }}>URGENT SITUATION</strong>
            <div style={{ fontSize: "9pt", marginTop: "4px" }}>
              Urgent situations for us: {URGENT_SITUATION_EXAMPLES}
            </div>
          </div>
        )}

        {/* Status Strip */}
        <div className="status-strip">
          <span className={`status-badge status-${(displayStatus || "new").toLowerCase().replace(/\s+/g, "_")}`}>
            {formatValue(displayStatus)}
          </span>
          {appointmentDate && (
            <span className="meta-item">
              <strong>Appointment:</strong> {formatDate(appointmentDate)}
            </span>
          )}
          <span className="meta-item">
            <strong>ID:</strong> {submission.submission_id.slice(0, 8)}
          </span>
          {submission.triage_category && (
            <span className="tag tag-blue">{formatValue(submission.triage_category)}</span>
          )}
        </div>

        {/* Third Party Notice */}
        {submission.is_third_party_report && (
          <div className="card card-warning" style={{ marginBottom: "14px" }}>
            <strong>Third-Party Report</strong>
            <div style={{ fontSize: "9pt", marginTop: "4px" }}>
              {submission.third_party_relationship && <span>Relationship: {submission.third_party_relationship}</span>}
              {submission.property_owner_name && <span> • Property Owner: {submission.property_owner_name}</span>}
              {submission.property_owner_phone && <span> • Contact: {formatPhone(submission.property_owner_phone)}</span>}
            </div>
          </div>
        )}

        {/* Contact & Location - Combined Card */}
        <div className="card card-highlight">
          <div className="info-grid info-grid-3">
            <div className="info-item">
              <span className="info-label">Contact Name</span>
              <span className="info-value large">{fullName}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Phone</span>
              <span className="info-value">{submission.phone ? formatPhone(submission.phone) : "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Email</span>
              <span className="info-value" style={{ fontSize: "9pt" }}>{submission.email}</span>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #e0e0e0", marginTop: "10px", paddingTop: "10px" }}>
            <div className="info-grid info-grid-3">
              <div className="info-item" style={{ gridColumn: "span 2" }}>
                <span className="info-label">Cat Location</span>
                <span className="info-value">{submission.cats_address}</span>
                {submission.geo_formatted_address && submission.geo_formatted_address !== submission.cats_address && (
                  <span style={{ fontSize: "8pt", color: "#7f8c8d" }}>Verified: {submission.geo_formatted_address}</span>
                )}
              </div>
              <div className="info-item">
                <span className="info-label">City / County</span>
                <span className="info-value">{submission.cats_city || "—"} {submission.county ? `(${formatValue(submission.county)})` : ""}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Cat Information */}
        <div className="section">
          <div className="section-title">
            About the Cats
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Type of Cat</span>
              <span className="info-value">{getOwnershipLabel(submission.ownership_status)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Estimated Count</span>
              <span className="info-value large">{submission.cat_count_estimate || "Unknown"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Fixed Status</span>
              <span className="info-value">{getFixedLabel(submission.fixed_status)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">How Long Aware</span>
              <span className="info-value">{formatValue(submission.awareness_duration) || "—"}</span>
            </div>
            {submission.has_kittens && (
              <>
                <div className="info-item">
                  <span className="info-label">Kittens Present</span>
                  <span className="info-value">Yes{submission.kitten_count ? ` (${submission.kitten_count})` : ""}</span>
                </div>
                {submission.kitten_age_estimate && (
                  <div className="info-item">
                    <span className="info-label">Kitten Age</span>
                    <span className="info-value">{formatValue(submission.kitten_age_estimate)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Situation Checklist */}
        <div className="section">
          <div className="section-title">
            Situation Details
          </div>
          <div className="checklist" style={{ marginBottom: "10px" }}>
            <span className={`check-item ${submission.has_medical_concerns ? "check-yes" : submission.has_medical_concerns === false ? "check-no" : "check-na"}`}>
              {submission.has_medical_concerns ? "✓" : submission.has_medical_concerns === false ? "✗" : "?"} Medical concerns
            </span>
            <span className={`check-item ${submission.cats_being_fed ? "check-yes" : submission.cats_being_fed === false ? "check-no" : "check-na"}`}>
              {submission.cats_being_fed ? "✓" : submission.cats_being_fed === false ? "✗" : "?"} Cats being fed
            </span>
            <span className={`check-item ${submission.has_property_access ? "check-yes" : submission.has_property_access === false ? "check-no" : "check-na"}`}>
              {submission.has_property_access ? "✓" : submission.has_property_access === false ? "✗" : "?"} Property access
            </span>
            <span className={`check-item ${submission.is_property_owner ? "check-yes" : submission.is_property_owner === false ? "check-no" : "check-na"}`}>
              {submission.is_property_owner ? "✓" : submission.is_property_owner === false ? "✗" : "?"} Property owner
            </span>
            {submission.feeds_cat !== null && (
              <span className={`check-item ${submission.feeds_cat ? "check-yes" : "check-no"}`}>
                {submission.feeds_cat ? "✓" : "✗"} Feeds cat
              </span>
            )}
          </div>

          {/* Situation Description */}
          <div className="description-box">
            {submission.situation_description || "No additional details provided."}
          </div>
        </div>

        {/* Additional Info (feeding, custom fields) - Condensed */}
        {(submission.feeding_frequency || submission.referral_source || filledCustomFields.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
            {submission.feeding_frequency && (
              <span className="tag tag-green">Feeds {formatValue(submission.feeding_frequency).toLowerCase()}</span>
            )}
            {submission.referral_source && (
              <span className="tag tag-purple">Via {formatValue(submission.referral_source)}</span>
            )}
            {filledCustomFields.slice(0, 3).map((field, i) => (
              <span key={i} className="tag tag-blue">{field.label}: {field.value}</span>
            ))}
          </div>
        )}

        {/* Legacy Info Section - Hidden when hideStaffNotes is true */}
        {!hideStaffNotes && isLegacy && (submission.legacy_notes || submission.legacy_status) && (
          <div className="section">
            <div className="section-title">
              Legacy Information
            </div>
            <div className="info-grid">
              {submission.legacy_status && (
                <div className="info-item">
                  <span className="info-label">Previous Status</span>
                  <span className="info-value">{submission.legacy_status}</span>
                </div>
              )}
              {submission.legacy_appointment_date && (
                <div className="info-item">
                  <span className="info-label">Original Appointment</span>
                  <span className="info-value">{formatDate(submission.legacy_appointment_date)}</span>
                </div>
              )}
            </div>
            {submission.legacy_notes && (
              <div style={{ marginTop: "8px" }}>
                <span className="info-label">Previous Notes</span>
                <div className="notes-box" style={{ marginTop: "4px" }}>
                  {submission.legacy_notes}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Staff Section - Hidden when hideStaffNotes is true */}
        {!hideStaffNotes && (
          <div className="staff-section">
            <div className="section-title">
              Staff Notes
            </div>
            <div className="info-grid" style={{ marginBottom: "8px" }}>
              <div className="info-item">
                <span className="info-label">Priority</span>
                <span className="info-value" style={{ color: getPriorityColor(submission.priority_override, submission.triage_category) }}>
                  {formatValue(submission.priority_override) || "Normal"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Triage Score</span>
                <span className="info-value">{submission.triage_score ?? "—"}</span>
              </div>
            </div>
            <div className="notes-box" style={{ minHeight: "40px" }}>
              {submission.review_notes || ""}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="footer">
          <span>Forgotten Felines of Sonoma County • Helping community cats since 1990</span>
          <span>Printed {new Date().toLocaleDateString()}</span>
        </div>
      </div>

      {/* PAGE 2: Kitten Details (only if has kittens) */}
      {submission.has_kittens && (
        <div className="print-page" style={{ display: "flex", flexDirection: "column" }}>
          <div className="print-header">
            <div>
              <h1>Kitten Details</h1>
              <div className="subtitle">
                {fullName} • {submission.cats_address}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Forgotten Felines" style={{ height: "50px", width: "auto" }} />
              <div style={{ textAlign: "right", fontSize: "9pt", color: "#7f8c8d" }}>
                Kitten Program
              </div>
            </div>
          </div>

          <div className="card card-highlight">
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Number of Kittens</span>
                <span className="info-value large">{submission.kitten_count || "Unknown"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Age Estimate</span>
                <span className="info-value">{formatValue(submission.kitten_age_estimate) || "Unknown"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Behavior</span>
                <span className="info-value">{formatValue(submission.kitten_behavior) || "Unknown"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Contained?</span>
                <span className="info-value">{formatValue(submission.kitten_contained) || "Unknown"}</span>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">
              Mom Cat Status
            </div>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Mom Present?</span>
                <span className="info-value">{formatValue(submission.mom_present) || "Unknown"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Mom Fixed?</span>
                <span className="info-value">{formatValue(submission.mom_fixed) || "Unknown"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Can Bring In?</span>
                <span className="info-value">{formatValue(submission.can_bring_in) || "Unknown"}</span>
              </div>
            </div>
          </div>

          {submission.kitten_mixed_ages_description && (
            <div className="section">
              <div className="section-title">Age Details</div>
              <div className="description-box">
                {submission.kitten_mixed_ages_description}
              </div>
            </div>
          )}

          {submission.kitten_notes && (
            <div className="section">
              <div className="section-title">
                Additional Kitten Notes
              </div>
              <div className="description-box">
                {submission.kitten_notes}
              </div>
            </div>
          )}

          {/* Foster Program Info */}
          <div className="card" style={{ background: "#e8f6f3", borderLeft: "4px solid #1abc9c" }}>
            <strong style={{ color: "#16a085" }}>About Our Foster Program</strong>
            <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "9pt", lineHeight: "1.5" }}>
              <li><strong>Age matters:</strong> Under 12 weeks is ideal for socialization</li>
              <li><strong>Behavior matters:</strong> Friendly kittens are prioritized for foster</li>
              <li><strong>Mom helps:</strong> Spayed mom with kittens increases foster likelihood</li>
              <li>Older or feral kittens may be candidates for Feral Fix &amp; Return (FFR)</li>
            </ul>
          </div>

          {/* Staff Kitten Assessment - Hidden when hideStaffNotes is true */}
          {!hideStaffNotes && (
            <div className="staff-section">
              <div className="section-title">
                Kitten Assessment
              </div>
              <div className="info-grid" style={{ marginBottom: "10px" }}>
                <div className="info-item">
                  <span className="info-label">Outcome</span>
                  <span className="info-value">{formatValue(submission.kitten_outcome) || "—"}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Foster Readiness</span>
                  <span className="info-value">{formatValue(submission.foster_readiness) || "—"}</span>
                </div>
              </div>
              {submission.kitten_urgency_factors && submission.kitten_urgency_factors.length > 0 && (
                <div style={{ marginBottom: "10px" }}>
                  <span className="info-label">Urgency Factors</span>
                  <div style={{ marginTop: "4px" }}>
                    {submission.kitten_urgency_factors.map((f, i) => (
                      <span key={i} className="tag tag-orange" style={{ marginRight: "6px" }}>
                        {formatValue(f)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="notes-box" style={{ minHeight: "60px" }}>
                {/* Space for staff notes */}
              </div>
            </div>
          )}

          <div className="footer" style={{ marginTop: "auto" }}>
            <span>Forgotten Felines of Sonoma County • Kitten Program</span>
            <span>Page 2 of 2</span>
          </div>
        </div>
      )}
    </div>
  );
}
