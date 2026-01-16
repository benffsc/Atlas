"use client";

import { useState, useEffect, use } from "react";

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
  // Additional fields for display
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

function Bubble({ filled }: { filled: boolean }) {
  return (
    <span style={{
      display: "inline-block",
      width: "12px",
      height: "12px",
      border: "2px solid #000",
      borderRadius: "50%",
      background: filled ? "#000" : "#fff",
      marginRight: "2px",
    }} />
  );
}

function Checkbox({ filled }: { filled: boolean }) {
  return (
    <span style={{
      display: "inline-block",
      width: "12px",
      height: "12px",
      border: "2px solid #000",
      borderRadius: "2px",
      background: filled ? "#000" : "#fff",
      marginRight: "2px",
    }} />
  );
}

export default function PrintSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [submission, setSubmission] = useState<IntakeSubmission | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
  if (error || !submission) return <div style={{ padding: "2rem", color: "#dc3545" }}>Error: {error || "Not found"}</div>;

  const fullName = `${submission.first_name} ${submission.last_name}`;

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

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        @media print {
          @page { size: letter; margin: 0.4in 0.5in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-controls { display: none !important; }
          .print-page { padding: 0 !important; box-shadow: none !important; margin: 0 !important; page-break-after: always; }
          .print-page:last-child { page-break-after: auto; }
        }
        body { margin: 0; padding: 0; }
        .print-wrapper { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.25; }
        .print-page { width: 8.5in; min-height: 11in; padding: 0.4in 0.5in; box-sizing: border-box; background: #fff; color: #000; }
        .print-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 6px; }
        .print-header h1 { font-size: 15pt; margin: 0; }
        .section { margin-bottom: 6px; }
        .section-title { font-size: 10pt; font-weight: bold; background: #e0e0e0; padding: 2px 6px; margin-bottom: 3px; border-left: 3px solid #333; }
        .field-row { display: flex; gap: 6px; margin-bottom: 2px; }
        .field { flex: 1; }
        .field label { font-size: 9pt; font-weight: bold; }
        .field-value { border-bottom: 1px solid #999; min-height: 18px; padding: 2px 4px; }
        .checkbox-item { display: inline-flex; align-items: center; gap: 2px; font-size: 10pt; margin-right: 8px; }
        .question-row { display: flex; align-items: center; font-size: 10pt; padding: 1px 0; flex-wrap: wrap; gap: 4px; }
        .qlabel { min-width: 110px; font-weight: bold; }
        .filled-text { font-weight: bold; text-decoration: underline; }
        .staff-section { background: #f0f0f0; border: 1px solid #999; padding: 6px; margin-top: 6px; }
        .staff-section .section-title { background: #d0d0d0; margin: -6px -6px 6px -6px; padding: 3px 8px; border-left: 3px solid #666; }
        @media screen {
          body { background: #e5e5e5 !important; }
          .print-wrapper { padding: 20px; }
          .print-page { box-shadow: 0 4px 20px rgba(0,0,0,0.15); margin: 0 auto 30px auto; }
          .print-controls { position: fixed; top: 20px; right: 20px; background: #fff; border: 1px solid #ccc; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 1000; }
          .print-controls button { display: block; width: 100%; padding: 10px 16px; margin-bottom: 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
          .print-controls .print-btn { background: #0d6efd; color: #fff; }
          .print-controls .back-btn { background: #f0f0f0; color: #333; }
        }
      `}</style>

      {/* Controls */}
      <div className="print-controls">
        <button className="print-btn" onClick={() => window.print()}>Print / Save as PDF</button>
        <a href={`/intake/queue/${id}`} className="back-btn" style={{ textDecoration: "none", textAlign: "center" }}>← Back to Submission</a>
      </div>

      {/* PAGE 1 */}
      <div className="print-page">
        <div className="print-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <img src="/logo.png" alt="FF" style={{ height: "36px", width: "auto" }} />
            <h1>Forgotten Felines Request Form</h1>
          </div>
          <div style={{ textAlign: "right", fontSize: "8pt" }}>
            <strong>Forgotten Felines of Sonoma County</strong><br />
            (707) 576-7999 | info@forgottenfelines.com
          </div>
        </div>

        <div style={{ fontSize: "9pt", color: "#666", marginBottom: "4px" }}>
          Submitted: {new Date(submission.submitted_at).toLocaleString()} | ID: {submission.submission_id.slice(0, 8)}
        </div>

        {/* Third Party */}
        {submission.is_third_party_report && (
          <div style={{ border: "2px solid #ffc107", background: "#fffbeb", padding: "3px 6px", marginBottom: "6px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "2px" }}>
              <Checkbox filled={true} /> Reporting on behalf of someone else
            </div>
            <div className="field-row">
              <div className="field"><label>Relationship:</label> <span className="filled-text">{submission.third_party_relationship || "—"}</span></div>
              <div className="field"><label>Owner Name:</label> <span className="filled-text">{submission.property_owner_name || "—"}</span></div>
              <div className="field"><label>Owner Contact:</label> <span className="filled-text">{submission.property_owner_phone || "—"}</span></div>
            </div>
          </div>
        )}

        {/* Section 1 */}
        <div className="section">
          <div className="section-title">1. YOUR CONTACT INFO</div>
          <div className="field-row">
            <div className="field"><label>First Name:</label> <span className="filled-text">{submission.first_name}</span></div>
            <div className="field"><label>Last Name:</label> <span className="filled-text">{submission.last_name}</span></div>
            <div className="field"><label>Phone:</label> <span className="filled-text">{submission.phone || "—"}</span></div>
            <div className="field" style={{ flex: 2 }}><label>Email:</label> <span className="filled-text">{submission.email}</span></div>
          </div>
        </div>

        {/* Section 2 */}
        <div className="section">
          <div className="section-title">2. CAT LOCATION</div>
          <div className="field-row">
            <div className="field" style={{ flex: 3 }}><label>Address:</label> <span className="filled-text">{submission.cats_address}</span></div>
            <div className="field"><label>City:</label> <span className="filled-text">{submission.cats_city || "—"}</span></div>
            <div className="field" style={{ flex: 0.5 }}><label>ZIP:</label> <span className="filled-text">{submission.cats_zip || "—"}</span></div>
          </div>
          {submission.geo_formatted_address && submission.geo_formatted_address !== submission.cats_address && (
            <div style={{ fontSize: "8pt", color: "#666", marginTop: "2px" }}>
              Verified: <span style={{ fontStyle: "italic" }}>{submission.geo_formatted_address}</span>
            </div>
          )}
          <div className="question-row">
            <span className="qlabel">County:</span>
            <span className="checkbox-item"><Bubble filled={submission.county === "sonoma"} /> Sonoma</span>
            <span className="checkbox-item"><Bubble filled={submission.county === "marin"} /> Marin</span>
            <span className="checkbox-item"><Bubble filled={submission.county === "napa"} /> Napa</span>
            <span className="checkbox-item"><Bubble filled={!["sonoma", "marin", "napa"].includes(submission.county || "")} /> Other</span>
          </div>
        </div>

        {/* Section 3 */}
        <div className="section">
          <div className="section-title">3. ABOUT THE CATS</div>
          <div className="question-row">
            <span className="qlabel">Ownership?</span>
            <span className="checkbox-item"><Bubble filled={submission.ownership_status === "unknown_stray"} /> Stray</span>
            <span className="checkbox-item"><Bubble filled={submission.ownership_status === "community_colony"} /> Community</span>
            <span className="checkbox-item"><Bubble filled={submission.ownership_status === "my_cat"} /> My cat</span>
            <span className="checkbox-item"><Bubble filled={submission.ownership_status === "neighbors_cat"} /> Neighbor's</span>
            <span className="checkbox-item"><Bubble filled={submission.ownership_status === "unsure"} /> Unsure</span>
          </div>
          <div className="question-row">
            <span className="qlabel">How many?</span>
            <span className="filled-text" style={{ marginRight: "1rem" }}>{submission.cat_count_estimate || "—"}</span>
            <span className="qlabel" style={{ minWidth: "100px" }}>Fixed (ear-tip)?</span>
            <span className="checkbox-item"><Bubble filled={submission.fixed_status === "none_fixed"} /> None</span>
            <span className="checkbox-item"><Bubble filled={submission.fixed_status === "some_fixed"} /> Some</span>
            <span className="checkbox-item"><Bubble filled={submission.fixed_status === "most_fixed"} /> Most/All</span>
            <span className="checkbox-item"><Bubble filled={submission.fixed_status === "unknown"} /> Unknown</span>
          </div>
          <div className="question-row">
            <span className="qlabel">How long aware?</span>
            <span className="checkbox-item"><Bubble filled={submission.awareness_duration === "under_1_week"} /> &lt;1 week</span>
            <span className="checkbox-item"><Bubble filled={submission.awareness_duration === "under_1_month"} /> &lt;1 month</span>
            <span className="checkbox-item"><Bubble filled={submission.awareness_duration === "1_to_6_months"} /> 1-6 mo</span>
            <span className="checkbox-item"><Bubble filled={submission.awareness_duration === "6_to_12_months"} /> 6-12 mo</span>
            <span className="checkbox-item"><Bubble filled={submission.awareness_duration === "over_1_year"} /> 1+ year</span>
          </div>
          <div className="question-row">
            <span className="qlabel">Kittens present?</span>
            <span className="checkbox-item"><Bubble filled={submission.has_kittens === true} /> Yes</span>
            <span className="checkbox-item"><Bubble filled={submission.has_kittens === false} /> No</span>
            {submission.has_kittens && <span style={{ marginLeft: "0.5rem" }}>Count: <span className="filled-text">{submission.kitten_count || "—"}</span></span>}
          </div>
        </div>

        {/* Emergency */}
        {submission.is_emergency && (
          <div style={{ border: "2px solid #dc3545", background: "#fff5f5", padding: "3px 8px", marginBottom: "6px" }}>
            <Checkbox filled={true} />
            <span style={{ fontWeight: "bold", color: "#dc3545", marginLeft: "4px" }}>THIS IS AN EMERGENCY</span>
          </div>
        )}

        {/* Section 4 */}
        <div className="section">
          <div className="section-title">4. SITUATION</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
            <div className="question-row">
              <span className="qlabel">Medical concerns?</span>
              <span className="checkbox-item"><Bubble filled={submission.has_medical_concerns === true} /> Yes</span>
              <span className="checkbox-item"><Bubble filled={submission.has_medical_concerns === false} /> No</span>
              <span className="checkbox-item"><Bubble filled={submission.has_medical_concerns === null} /> Unsure</span>
            </div>
            <div className="question-row">
              <span className="qlabel">Cats being fed?</span>
              <span className="checkbox-item"><Bubble filled={submission.cats_being_fed === true} /> Yes</span>
              <span className="checkbox-item"><Bubble filled={submission.cats_being_fed === false} /> No</span>
              <span className="checkbox-item"><Bubble filled={submission.cats_being_fed === null} /> Unsure</span>
            </div>
            <div className="question-row">
              <span className="qlabel">Property access?</span>
              <span className="checkbox-item"><Bubble filled={submission.has_property_access === true} /> Yes</span>
              <span className="checkbox-item"><Bubble filled={submission.has_property_access === false} /> No</span>
              <span className="checkbox-item"><Bubble filled={submission.has_property_access === null} /> Check</span>
            </div>
            <div className="question-row">
              <span className="qlabel">Property owner?</span>
              <span className="checkbox-item"><Bubble filled={submission.is_property_owner === true} /> Yes</span>
              <span className="checkbox-item"><Bubble filled={submission.is_property_owner === false} /> No</span>
            </div>
          </div>
          <div className="question-row" style={{ marginTop: "2px" }}>
            <span className="qlabel">Referral:</span>
            <span className="filled-text">{formatValue(submission.referral_source) || "—"}</span>
          </div>
        </div>

        {/* Section 5 */}
        <div className="section">
          <div className="section-title">5. DESCRIBE THE SITUATION</div>
          <p style={{ fontSize: "8pt", color: "#666", margin: "1px 0 3px 0" }}>
            Cat descriptions, medical concerns, feeding schedule, best contact times, access notes
          </p>
          <div style={{ border: "1px solid #666", padding: "6px", minHeight: "1.5in", whiteSpace: "pre-wrap" }}>
            {submission.situation_description || "—"}
          </div>
        </div>

        {/* Section 6: Additional Questions (feeding + custom fields) */}
        {(submission.feeds_cat !== null || submission.feeding_frequency || filledCustomFields.length > 0) && (
          <div className="section">
            <div className="section-title">6. ADDITIONAL QUESTIONS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
              {submission.feeds_cat !== null && (
                <div className="question-row">
                  <span className="qlabel">Feeds the cat?</span>
                  <span className="checkbox-item"><Bubble filled={submission.feeds_cat === true} /> Yes</span>
                  <span className="checkbox-item"><Bubble filled={submission.feeds_cat === false} /> No</span>
                </div>
              )}
              {submission.feeding_frequency && (
                <div className="question-row">
                  <span className="qlabel">Feeding freq:</span>
                  <span className="filled-text">{formatValue(submission.feeding_frequency)}</span>
                </div>
              )}
              {submission.feeding_duration && (
                <div className="question-row">
                  <span className="qlabel">How long:</span>
                  <span className="filled-text">{formatValue(submission.feeding_duration)}</span>
                </div>
              )}
              {submission.cat_comes_inside && (
                <div className="question-row">
                  <span className="qlabel">Comes inside?</span>
                  <span className="filled-text">{formatValue(submission.cat_comes_inside)}</span>
                </div>
              )}
              {/* Custom fields from admin configuration */}
              {filledCustomFields.map((field, i) => (
                <div className="question-row" key={i}>
                  <span className="qlabel">{field.label}:</span>
                  <span className="filled-text">{field.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Staff Section */}
        <div className="staff-section">
          <div className="section-title">FOR OFFICE USE ONLY</div>
          <div className="field-row">
            <div className="field">
              <span className="qlabel">Source:</span>
              <span className="checkbox-item"><Bubble filled={submission.source === "phone"} /> Phone</span>
              <span className="checkbox-item"><Bubble filled={submission.source === "paper"} /> Paper</span>
              <span className="checkbox-item"><Bubble filled={submission.source === "in_person"} /> Walk-in</span>
              <span className="checkbox-item"><Bubble filled={submission.source === "web"} /> Web</span>
            </div>
            <div className="field">
              <span className="qlabel">Priority:</span>
              <span className="checkbox-item"><Bubble filled={submission.priority_override === "high"} /> High</span>
              <span className="checkbox-item"><Bubble filled={submission.priority_override === "normal" || !submission.priority_override} /> Normal</span>
              <span className="checkbox-item"><Bubble filled={submission.priority_override === "low"} /> Low</span>
            </div>
          </div>
          <div className="question-row">
            <span className="qlabel">Triage:</span>
            <span className="filled-text">{formatValue(submission.triage_category) || "Pending"}</span>
            {submission.triage_score !== null && <span style={{ marginLeft: "0.5rem", color: "#666" }}>(Score: {submission.triage_score})</span>}
          </div>
          {submission.reviewed_by && (
            <div className="question-row">
              <span className="qlabel">Reviewed by:</span>
              <span className="filled-text">{submission.reviewed_by}</span>
            </div>
          )}
        </div>
      </div>

      {/* PAGE 2: Kitten Details (if applicable) */}
      {submission.has_kittens && (
        <div className="print-page">
          <div className="print-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <img src="/logo.png" alt="FF" style={{ height: "32px", width: "auto" }} />
              <div>
                <h1 style={{ fontSize: "14pt" }}>Kitten Details</h1>
                <div style={{ fontSize: "8pt", color: "#666" }}>Complete if kittens are present</div>
              </div>
            </div>
            <div style={{ fontSize: "10pt" }}>
              <strong>Requester:</strong> {fullName}
            </div>
          </div>

          <div className="section">
            <div className="section-title">6. KITTEN INFORMATION</div>

            <div className="question-row" style={{ marginBottom: "6px" }}>
              <span className="qlabel">How many?</span>
              <span className="filled-text">{submission.kitten_count || "—"}</span>
            </div>

            <div className="question-row" style={{ marginBottom: "6px" }}>
              <span className="qlabel">Age range:</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_age_estimate === "under_4_weeks"} /> Under 4 wks</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_age_estimate === "4_to_8_weeks"} /> 4-8 wks</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_age_estimate === "8_to_12_weeks"} /> 8-12 wks</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_age_estimate === "12_to_16_weeks"} /> 12-16 wks</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_age_estimate === "over_16_weeks"} /> 4+ mo</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_age_estimate === "mixed"} /> Mixed</span>
            </div>

            {submission.kitten_mixed_ages_description && (
              <div style={{ marginBottom: "6px" }}>
                <label style={{ fontWeight: "bold", fontSize: "9pt" }}>Mixed ages description:</label>
                <span className="filled-text" style={{ marginLeft: "0.5rem" }}>{submission.kitten_mixed_ages_description}</span>
              </div>
            )}

            <div className="question-row" style={{ marginBottom: "6px" }}>
              <span className="qlabel">Behavior:</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_behavior === "friendly"} /> Friendly</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_behavior === "shy_handleable"} /> Shy but handleable</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_behavior === "shy_young"} /> Shy/hissy (young)</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_behavior === "unhandleable_older"} /> Unhandleable (older)</span>
              <span className="checkbox-item"><Bubble filled={submission.kitten_behavior === "unknown"} /> Unknown</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginBottom: "6px" }}>
              <div className="question-row">
                <span className="qlabel">Kittens contained?</span>
                <span className="checkbox-item"><Bubble filled={submission.kitten_contained === "yes"} /> Yes</span>
                <span className="checkbox-item"><Bubble filled={submission.kitten_contained === "some"} /> Some</span>
                <span className="checkbox-item"><Bubble filled={submission.kitten_contained === "no"} /> No</span>
              </div>
              <div className="question-row">
                <span className="qlabel">Mom present?</span>
                <span className="checkbox-item"><Bubble filled={submission.mom_present === "yes"} /> Yes</span>
                <span className="checkbox-item"><Bubble filled={submission.mom_present === "no"} /> No</span>
                <span className="checkbox-item"><Bubble filled={submission.mom_present === "unsure"} /> Unsure</span>
              </div>
              <div className="question-row">
                <span className="qlabel">Mom fixed?</span>
                <span className="checkbox-item"><Bubble filled={submission.mom_fixed === "yes"} /> Yes</span>
                <span className="checkbox-item"><Bubble filled={submission.mom_fixed === "no"} /> No</span>
                <span className="checkbox-item"><Bubble filled={submission.mom_fixed === "unsure"} /> Unsure</span>
              </div>
              <div className="question-row">
                <span className="qlabel">Can bring in?</span>
                <span className="checkbox-item"><Bubble filled={submission.can_bring_in === "yes"} /> Yes</span>
                <span className="checkbox-item"><Bubble filled={submission.can_bring_in === "need_help"} /> Need help</span>
                <span className="checkbox-item"><Bubble filled={submission.can_bring_in === "no"} /> No</span>
              </div>
            </div>

            <div>
              <label style={{ fontWeight: "bold", fontSize: "9pt" }}>Kitten details:</label>
              <div style={{ border: "1px solid #666", padding: "6px", minHeight: "0.6in", whiteSpace: "pre-wrap" }}>
                {submission.kitten_notes || "—"}
              </div>
            </div>
          </div>

          {/* Foster Info */}
          <div style={{ border: "1px solid #666", padding: "8px", marginBottom: "8px", fontSize: "9pt" }}>
            <strong>About our foster program:</strong>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: "18px" }}>
              <li><strong>Age matters:</strong> Under 12 weeks is ideal. 12-16 weeks needs intensive socialization.</li>
              <li><strong>Behavior matters:</strong> Friendly/handleable kittens are prioritized.</li>
              <li><strong>Mom helps:</strong> Spayed mom with kittens increases foster likelihood.</li>
              <li><strong>Foster space is limited</strong> and not guaranteed until day of assessment.</li>
            </ul>
          </div>

          {/* Staff Kitten Assessment */}
          <div className="staff-section">
            <div className="section-title">FOR OFFICE USE ONLY — KITTEN ASSESSMENT</div>

            <div className="field-row" style={{ marginBottom: "6px" }}>
              <div className="field">
                <span className="qlabel">Kitten outcome:</span>
                <span className="checkbox-item"><Bubble filled={submission.kitten_outcome === "foster_intake"} /> Foster</span>
                <span className="checkbox-item"><Bubble filled={submission.kitten_outcome === "tnr_candidate"} /> FFR</span>
                <span className="checkbox-item"><Bubble filled={submission.kitten_outcome === "pending_space"} /> Pending</span>
                <span className="checkbox-item"><Bubble filled={submission.kitten_outcome === "declined"} /> Declined</span>
              </div>
              <div className="field">
                <span className="qlabel">Foster readiness:</span>
                <span className="checkbox-item"><Bubble filled={submission.foster_readiness === "high"} /> High</span>
                <span className="checkbox-item"><Bubble filled={submission.foster_readiness === "medium"} /> Medium</span>
                <span className="checkbox-item"><Bubble filled={submission.foster_readiness === "low"} /> Low</span>
              </div>
            </div>

            <div className="question-row" style={{ marginBottom: "6px" }}>
              <span className="qlabel">Urgency factors:</span>
              <span className="checkbox-item"><Checkbox filled={submission.kitten_urgency_factors?.includes("bottle_babies") || false} /> Bottle babies</span>
              <span className="checkbox-item"><Checkbox filled={submission.kitten_urgency_factors?.includes("medical_needs") || false} /> Medical needs</span>
              <span className="checkbox-item"><Checkbox filled={submission.kitten_urgency_factors?.includes("unsafe_location") || false} /> Unsafe location</span>
              <span className="checkbox-item"><Checkbox filled={submission.kitten_urgency_factors?.includes("mom_unfixed") || false} /> Mom unfixed</span>
            </div>

            <div>
              <label style={{ fontWeight: "bold", fontSize: "9pt" }}>Staff notes:</label>
              <div style={{ border: "1px solid #666", padding: "6px", minHeight: "0.8in", background: "#fff", whiteSpace: "pre-wrap" }}>
                {submission.review_notes || "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
