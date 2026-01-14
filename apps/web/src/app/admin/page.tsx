"use client";

import { useState, useEffect } from "react";

interface QueueStats {
  total: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  by_geo_confidence: Record<string, number>;
}

// Intake form structure for documentation
const intakeFormStructure = {
  name: "Intake Form",
  path: "/intake",
  steps: [
    {
      name: "Contact",
      fields: [
        { name: "is_third_party_report", type: "checkbox", required: false, description: "Reporting on behalf of someone else (volunteer, neighbor, etc.)" },
        { name: "third_party_relationship", type: "select", required: false, options: ["volunteer", "neighbor", "family_member", "concerned_citizen", "rescue_worker", "other"] },
        { name: "property_owner_name", type: "text", required: false, description: "Name of property owner if known" },
        { name: "property_owner_phone", type: "tel", required: false },
        { name: "property_owner_email", type: "email", required: false },
        { name: "first_name", type: "text", required: true },
        { name: "last_name", type: "text", required: true },
        { name: "email", type: "email", required: true },
        { name: "phone", type: "tel", required: false },
        { name: "requester_address", type: "text", required: false },
        { name: "requester_city", type: "text", required: false },
        { name: "requester_zip", type: "text", required: false },
      ],
    },
    {
      name: "Location",
      fields: [
        { name: "cats_address", type: "text", required: true },
        { name: "cats_city", type: "text", required: false },
        { name: "cats_zip", type: "text", required: false },
        { name: "county", type: "select", required: false, options: ["Sonoma", "Marin", "Napa", "Mendocino", "Lake", "other"] },
        { name: "same_as_requester", type: "checkbox", required: false },
      ],
    },
    {
      name: "Cats",
      fields: [
        { name: "ownership_status", type: "radio", required: true, options: ["unknown_stray", "community_colony", "my_cat", "neighbors_cat", "unsure"] },
        { name: "cat_count_estimate", type: "number", required: false },
        { name: "cat_count_text", type: "text", required: false },
        { name: "fixed_status", type: "radio", required: true, options: ["none_fixed", "some_fixed", "most_fixed", "all_fixed", "unknown"] },
        { name: "has_kittens", type: "radio", required: false, options: ["yes", "no", "unsure"] },
        { name: "kitten_count", type: "number", required: false },
        { name: "kitten_age_estimate", type: "select", required: false, options: ["newborn", "eyes_open", "weaned", "unknown"] },
        { name: "awareness_duration", type: "select", required: false },
      ],
    },
    {
      name: "Situation",
      fields: [
        { name: "is_emergency", type: "checkbox", required: false },
        { name: "has_medical_concerns", type: "radio", required: false },
        { name: "medical_description", type: "textarea", required: false },
        { name: "cats_being_fed", type: "radio", required: false },
        { name: "feeder_info", type: "text", required: false },
        { name: "has_property_access", type: "radio", required: false },
        { name: "is_property_owner", type: "radio", required: false },
        { name: "situation_description", type: "textarea", required: false },
        { name: "referral_source", type: "select", required: false },
      ],
    },
    {
      name: "Review",
      fields: [],
    },
  ],
};

export default function AdminPage() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then(setStats)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1>Admin Dashboard</h1>
      <p className="text-muted">System administration and form previews</p>

      {/* Quick Links */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginTop: "1.5rem" }}>
        <a href="/intake?preview=true" className="card" style={{ textAlign: "center" }}>
          <h3>Intake Form</h3>
          <p className="text-muted text-sm">Preview form (no submission)</p>
        </a>
        <a href="/intake/print" className="card" style={{ textAlign: "center" }}>
          <h3>Print Intake Form</h3>
          <p className="text-muted text-sm">Printable PDF form</p>
        </a>
        <a href="/intake/queue" className="card" style={{ textAlign: "center" }}>
          <h3>Intake Queue</h3>
          <p className="text-muted text-sm">Review and triage submissions</p>
        </a>
        <a href="/requests" className="card" style={{ textAlign: "center" }}>
          <h3>Trapping Requests</h3>
          <p className="text-muted text-sm">Active trapping work</p>
        </a>
      </div>

      {/* Stats */}
      <div className="card" style={{ marginTop: "2rem" }}>
        <h2>Intake Queue Stats</h2>
        {loading ? (
          <p className="text-muted">Loading stats...</p>
        ) : stats ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
            <div>
              <h4 style={{ margin: "0 0 0.5rem 0" }}>Total Submissions</h4>
              <p style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>{stats.total}</p>
            </div>
            <div>
              <h4 style={{ margin: "0 0 0.5rem 0" }}>By Status</h4>
              {Object.entries(stats.by_status || {}).map(([status, count]) => (
                <div key={status} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                  <span>{status || "(none)"}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
            <div>
              <h4 style={{ margin: "0 0 0.5rem 0" }}>By Source</h4>
              {Object.entries(stats.by_source || {}).map(([source, count]) => (
                <div key={source} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                  <span>{source || "(none)"}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
            <div>
              <h4 style={{ margin: "0 0 0.5rem 0" }}>Geocoding Quality</h4>
              {Object.entries(stats.by_geo_confidence || {}).map(([conf, count]) => (
                <div key={conf} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                  <span>{conf || "(pending)"}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-muted">Could not load stats</p>
        )}
      </div>

      {/* Form Structure Documentation */}
      <div className="card" style={{ marginTop: "2rem" }}>
        <h2>Intake Form Structure</h2>
        <p className="text-muted" style={{ marginBottom: "1rem" }}>
          The intake form collects information in {intakeFormStructure.steps.length} steps.
          <a href={intakeFormStructure.path} style={{ marginLeft: "0.5rem" }}>Open Form →</a>
        </p>

        <div style={{ display: "grid", gap: "1rem" }}>
          {intakeFormStructure.steps.map((step, stepIndex) => (
            <div key={step.name} style={{ border: "1px solid var(--card-border)", borderRadius: "8px", padding: "1rem" }}>
              <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem" }}>
                Step {stepIndex + 1}: {step.name}
              </h3>
              {step.fields.length > 0 ? (
                <table style={{ width: "100%", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid var(--card-border)" }}>
                      <th style={{ padding: "0.25rem 0" }}>Field</th>
                      <th style={{ padding: "0.25rem 0" }}>Type</th>
                      <th style={{ padding: "0.25rem 0" }}>Required</th>
                      <th style={{ padding: "0.25rem 0" }}>Options</th>
                    </tr>
                  </thead>
                  <tbody>
                    {step.fields.map((field) => (
                      <tr key={field.name} style={{ borderBottom: "1px solid var(--card-border)" }}>
                        <td style={{ padding: "0.25rem 0", fontFamily: "monospace" }}>{field.name}</td>
                        <td style={{ padding: "0.25rem 0" }}>{field.type}</td>
                        <td style={{ padding: "0.25rem 0", color: field.required ? "#dc3545" : "var(--text-muted)" }}>
                          {field.required ? "Yes" : "No"}
                        </td>
                        <td style={{ padding: "0.25rem 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {field.options?.join(", ") || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted" style={{ margin: 0, fontSize: "0.85rem" }}>Review step - displays summary of all previous steps</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Database Tables */}
      <div className="card" style={{ marginTop: "2rem" }}>
        <h2>Data Pipeline</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ padding: "1rem", border: "1px solid var(--card-border)", borderRadius: "8px" }}>
            <h4 style={{ margin: "0 0 0.5rem 0" }}>Intake Queue</h4>
            <p className="text-sm text-muted" style={{ margin: 0 }}>
              web_intake_submissions receives all form data. Auto-triage scores submissions.
              Geocoding normalizes addresses.
            </p>
          </div>
          <div style={{ padding: "1rem", border: "1px solid var(--card-border)", borderRadius: "8px" }}>
            <h4 style={{ margin: "0 0 0.5rem 0" }}>People Matching</h4>
            <p className="text-sm text-muted" style={{ margin: 0 }}>
              Smart matching links submissions to existing People by email/phone.
              High-confidence matches auto-link.
            </p>
          </div>
          <div style={{ padding: "1rem", border: "1px solid var(--card-border)", borderRadius: "8px" }}>
            <h4 style={{ margin: "0 0 0.5rem 0" }}>Request Creation</h4>
            <p className="text-sm text-muted" style={{ margin: 0 }}>
              Staff reviews and creates Trapping Requests from validated submissions.
              Links to Places (SoT).
            </p>
          </div>
        </div>
      </div>

      {/* Scripts */}
      <div className="card" style={{ marginTop: "2rem" }}>
        <h2>Ingest Scripts</h2>
        <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
          Located in <code>scripts/ingest/</code>
        </p>
        <div style={{ display: "grid", gap: "0.5rem", fontFamily: "monospace", fontSize: "0.85rem" }}>
          <div style={{ padding: "0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
            <strong>geocode_intake_addresses.mjs</strong>
            <span className="text-muted"> - Normalize addresses via Google Geocoding API</span>
          </div>
          <div style={{ padding: "0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
            <strong>smart_match_intake.mjs</strong>
            <span className="text-muted"> - Link submissions to existing People</span>
          </div>
          <div style={{ padding: "0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
            <strong>normalize_intake_names.mjs</strong>
            <span className="text-muted"> - Fix ALL CAPS and lowercase names</span>
          </div>
          <div style={{ padding: "0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
            <strong>categorize_pending_reviews.mjs</strong>
            <span className="text-muted"> - Auto-categorize stale pending reviews</span>
          </div>
          <div style={{ padding: "0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
            <strong>legacy_intake_submissions.mjs</strong>
            <span className="text-muted"> - Import from Airtable CSV</span>
          </div>
        </div>
      </div>
    </div>
  );
}
