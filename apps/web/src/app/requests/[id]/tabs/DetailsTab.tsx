"use client";

import { AlterationStatsCard } from "@/components/AlterationStatsCard";
import type { RequestDetail } from "../types";

interface KittenForm {
  kitten_count: number | "";
  kitten_age_weeks: number | "";
  kitten_assessment_status: string;
  kitten_assessment_outcome: string;
  kitten_foster_readiness: string;
  kitten_urgency_factors: string[];
  kitten_assessment_notes: string;
  not_assessing_reason: string;
}

interface DetailsTabProps {
  request: RequestDetail;
  requestId: string;
  // Kitten assessment
  editingKittens: boolean;
  savingKittens: boolean;
  kittenForm: KittenForm;
  onStartEditKittens: () => void;
  onSaveKittens: () => void;
  onCancelKittens: () => void;
  onKittenFormChange: (form: KittenForm) => void;
  onToggleUrgencyFactor: (factor: string) => void;
  // Upgrade wizard
  onShowUpgradeWizard: () => void;
}

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

export function DetailsTab({
  request,
  requestId,
  editingKittens,
  savingKittens,
  kittenForm,
  onStartEditKittens,
  onSaveKittens,
  onCancelKittens,
  onKittenFormChange,
  onToggleUrgencyFactor,
  onShowUpgradeWizard,
}: DetailsTabProps) {
  const isResolved = request.status === "completed" || request.status === "cancelled";

  const hasLogisticsData =
    (request.permission_status && request.permission_status !== "unknown") ||
    request.access_notes ||
    request.traps_overnight_safe !== null ||
    request.access_without_contact !== null ||
    request.best_times_seen ||
    request.property_owner_contact;

  const hasColonyData =
    request.property_type ||
    request.colony_duration ||
    request.location_description ||
    request.eartip_count !== null ||
    request.count_confidence ||
    request.is_being_fed !== null;

  const hasUrgencyData =
    (request.urgency_reasons && request.urgency_reasons.length > 0) ||
    request.urgency_deadline ||
    request.urgency_notes;

  return (
    <>
      {/* 1. Details Card */}
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

      {/* 2. Kitten Assessment Card (only if has_kittens) */}
      {request.has_kittens && (
        <div className="card" style={{
          padding: "1.5rem",
          marginBottom: "1.5rem",
          background: "rgba(33, 150, 243, 0.1)",
          border: "1px solid #2196f3",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.25rem", margin: 0, color: "#1565c0" }}>
              Kitten Assessment
            </h2>
            {!editingKittens && (
              <button
                onClick={onStartEditKittens}
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
                    onChange={(e) => onKittenFormChange({ ...kittenForm, kitten_count: e.target.value ? parseInt(e.target.value) : "" })}
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
                    onChange={(e) => onKittenFormChange({ ...kittenForm, kitten_age_weeks: e.target.value ? parseInt(e.target.value) : "" })}
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
                  onChange={(e) => onKittenFormChange({ ...kittenForm, kitten_assessment_status: e.target.value })}
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
                    onChange={(e) => onKittenFormChange({ ...kittenForm, not_assessing_reason: e.target.value })}
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
                  onChange={(e) => onKittenFormChange({ ...kittenForm, kitten_assessment_outcome: e.target.value })}
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
                  onChange={(e) => onKittenFormChange({ ...kittenForm, kitten_foster_readiness: e.target.value })}
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
                        onChange={() => onToggleUrgencyFactor(opt.value)}
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
                  onChange={(e) => onKittenFormChange({ ...kittenForm, kitten_assessment_notes: e.target.value })}
                  rows={3}
                  style={{ width: "100%", resize: "vertical" }}
                  placeholder="Notes about the kittens, socialization level, health observations, etc."
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                <button onClick={onSaveKittens} disabled={savingKittens}>
                  {savingKittens ? "Saving..." : "Save Assessment"}
                </button>
                <button
                  type="button"
                  onClick={onCancelKittens}
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
                        fontSize: "0.85rem",
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
                      : "\u2014"}
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
                            : "#dc3545",
                      }}>
                        {request.kitten_foster_readiness}
                      </span>
                    ) : "\u2014"}
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
                          fontSize: "0.85rem",
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
                  border: "1px dashed #ffc107",
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

      {/* 3. Resolution Card (only if completed or cancelled) */}
      {isResolved && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Resolution</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
            <div>
              <div className="text-muted text-sm">Resolved</div>
              <div style={{ fontWeight: 500 }}>
                {request.resolved_at ? new Date(request.resolved_at).toLocaleDateString() : "\u2014"}
              </div>
            </div>

            <div>
              <div className="text-muted text-sm">Cats Trapped</div>
              <div style={{ fontWeight: 500 }}>{request.cats_trapped ?? "\u2014"}</div>
            </div>

            <div>
              <div className="text-muted text-sm">Cats Returned</div>
              <div style={{ fontWeight: 500 }}>{request.cats_returned ?? "\u2014"}</div>
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

      {/* 4. Legacy Internal Notes Card (only if legacy_notes exists) */}
      {request.legacy_notes && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem", background: "var(--card-bg, #1a1a1a)", border: "1px solid var(--border)" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
            overflowY: "auto",
          }}>
            {request.legacy_notes}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            These notes were imported from Airtable and are read-only. Future notes will use the new journal system.
          </p>
        </div>
      )}

      {/* 5. Trapping Logistics Card (only if any logistics fields exist) */}
      {hasLogisticsData && (
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

      {/* 6. Colony Information Card (only if any colony info fields exist) */}
      {hasColonyData && (
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

      {/* 7. Urgency Information Card (only if urgency data exists) */}
      {hasUrgencyData && (
        <div className="card" style={{
          padding: "1.5rem",
          marginBottom: "1.5rem",
          background: "rgba(220, 53, 69, 0.1)",
          border: "1px solid #dc3545",
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
                      fontSize: "0.85rem",
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

      {/* 8. Computed Scores (if readiness_score or urgency_score not null) */}
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
                  color: request.readiness_score >= 70 ? "#198754" : request.readiness_score >= 40 ? "#ffc107" : "#dc3545",
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
                  color: request.urgency_score >= 70 ? "#dc3545" : request.urgency_score >= 40 ? "#ffc107" : "#198754",
                }}>
                  {request.urgency_score}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 9. AlterationStatsCard */}
      <AlterationStatsCard
        requestId={requestId}
        onUpgradeClick={onShowUpgradeWizard}
      />

      {/* 10. Metadata Card */}
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
  );
}
