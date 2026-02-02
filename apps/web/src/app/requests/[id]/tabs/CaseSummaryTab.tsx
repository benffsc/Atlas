"use client";

import { TrapperAssignments } from "@/components/TrapperAssignments";
import { ColonyEstimates } from "@/components/ColonyEstimates";
import { ClassificationSuggestionBanner } from "@/components/ClassificationSuggestionBanner";
import type { RequestDetail } from "../types";

interface CaseSummaryTabProps {
  request: RequestDetail;
  requestId: string;
  mapUrl: string | null;
  mapNearbyCount: number;
  onLogSiteVisit: () => void;
  onShowEmail: () => void;
  // Email batch editing
  editingEmailSummary: boolean;
  emailSummaryDraft: string;
  savingEmail: boolean;
  onToggleReadyToEmail: () => void;
  onStartEditEmailSummary: () => void;
  onSaveEmailSummary: () => void;
  onCancelEmailSummary: () => void;
  onEmailSummaryChange: (value: string) => void;
  onAssignmentChange?: () => void;
}

export function CaseSummaryTab({
  request,
  requestId,
  mapUrl,
  mapNearbyCount,
  onLogSiteVisit,
  onShowEmail,
  editingEmailSummary,
  emailSummaryDraft,
  savingEmail,
  onToggleReadyToEmail,
  onStartEditEmailSummary,
  onSaveEmailSummary,
  onCancelEmailSummary,
  onEmailSummaryChange,
  onAssignmentChange,
}: CaseSummaryTabProps) {
  return (
    <>
      {/* Location Card */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Location</h2>
        {request.place_id ? (
          <div>
            <a href={`/places/${request.place_id}`} style={{ fontWeight: 500, fontSize: "1.1rem" }}>
              {request.place_name}
            </a>
            {request.place_address && (
              <p className="text-muted" style={{ margin: "0.25rem 0 0" }}>
                {request.place_address}
              </p>
            )}
            {request.place_city && (
              <p className="text-muted text-sm" style={{ margin: "0.25rem 0 0" }}>
                {request.place_city}{request.place_postal_code ? `, ${request.place_postal_code}` : ""}
              </p>
            )}
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {request.place_kind && (
                <span className="badge">
                  {request.place_kind}
                </span>
              )}
              {request.place_service_zone && (
                <span className="badge" style={{ background: "#6f42c1", color: "#fff" }}>
                  Zone: {request.place_service_zone}
                </span>
              )}
            </div>
            {/* Safety concerns */}
            {(request.place_safety_concerns?.length || request.place_safety_notes) && (
              <div style={{
                marginTop: "1rem",
                padding: "0.75rem",
                background: "rgba(255, 193, 7, 0.15)",
                border: "1px solid #ffc107",
                borderRadius: "4px"
              }}>
                <div style={{ fontWeight: 500, color: "#856404", marginBottom: "0.5rem" }}>Safety Notes</div>
                {request.place_safety_concerns && request.place_safety_concerns.length > 0 && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: request.place_safety_notes ? "0.5rem" : 0 }}>
                    {request.place_safety_concerns.map((concern, idx) => (
                      <span key={idx} style={{
                        background: "#ffc107",
                        color: "#000",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "3px",
                        fontSize: "0.8rem"
                      }}>
                        {concern.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
                {request.place_safety_notes && (
                  <div style={{ fontSize: "0.9rem" }}>{request.place_safety_notes}</div>
                )}
              </div>
            )}

            {/* Map Preview */}
            {request.place_coordinates && (
              <div style={{ marginTop: "1rem" }}>
                {mapUrl ? (
                  <div style={{ position: "relative" }}>
                    <img
                      src={mapUrl}
                      alt="Location map"
                      style={{
                        width: "100%",
                        height: "200px",
                        objectFit: "cover",
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                      }}
                    />
                    {mapNearbyCount > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "8px",
                          left: "8px",
                          background: "rgba(0,0,0,0.7)",
                          color: "#fff",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                        }}
                      >
                        {mapNearbyCount} nearby request{mapNearbyCount > 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "200px",
                      background: "var(--card-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "8px",
                    }}
                  >
                    <div className="loading-spinner" />
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${request.place_coordinates.lat},${request.place_coordinates.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 1rem",
                      background: "#4285F4",
                      color: "#fff",
                      borderRadius: "6px",
                      textDecoration: "none",
                      fontSize: "0.9rem",
                    }}
                  >
                    View in Google Maps
                  </a>
                  <a
                    href={`/map?lat=${request.place_coordinates.lat}&lng=${request.place_coordinates.lng}&zoom=17`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 1rem",
                      background: "#6366f1",
                      color: "#fff",
                      borderRadius: "6px",
                      textDecoration: "none",
                      fontSize: "0.9rem",
                    }}
                  >
                    View on Atlas Map
                  </a>
                  <button
                    onClick={onLogSiteVisit}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 1rem",
                      background: "#28a745",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "0.9rem",
                      cursor: "pointer",
                    }}
                  >
                    Log Site Visit
                  </button>
                </div>
              </div>
            )}

            {/* Log Site Visit button (when no map) */}
            {!request.place_coordinates && (
              <button
                onClick={onLogSiteVisit}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginTop: "1rem",
                  padding: "0.5rem 1rem",
                  background: "#28a745",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
              >
                Log Site Visit
              </button>
            )}
          </div>
        ) : (
          <p className="text-muted">No location linked</p>
        )}
      </div>

      {/* Colony Estimates Card */}
      {request.place_id && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Colony Status</h2>

          {/* Reconciliation Notice when verified > reported (MIG_562) */}
          {request.colony_verified_exceeds_reported && (
            <div
              style={{
                padding: "0.75rem 1rem",
                marginBottom: "1rem",
                background: "var(--info-bg)",
                border: "1px solid var(--info-border)",
                borderRadius: "8px",
                fontSize: "0.875rem",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "var(--info-text)" }}>
                Data Reconciled
              </div>
              <div style={{ color: "var(--text-secondary)" }}>
                <strong>{request.colony_verified_altered}</strong> cats have been altered at clinic,
                which exceeds the originally reported estimate of <strong>{request.total_cats_reported}</strong>.
                {request.cat_count_semantic === "needs_tnr" && request.estimated_cat_count !== null && (
                  <>
                    {" "}Staff indicated <strong>{request.estimated_cat_count}</strong> cat{request.estimated_cat_count === 1 ? "" : "s"} still need{request.estimated_cat_count === 1 ? "s" : ""} TNR.
                  </>
                )}
                {request.colony_estimation_method === "Staff Override" && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", fontStyle: "italic" }}>
                    Colony size has been auto-reconciled based on verified data.
                    {request.colony_override_note && ` (${request.colony_override_note})`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Colony summary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <div className="text-muted text-sm">Size Estimate</div>
              <div style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                {request.colony_size_estimate ?? "Unknown"}
              </div>
            </div>
            <div>
              <div className="text-muted text-sm">Verified Altered</div>
              <div style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                {request.colony_verified_altered ?? 0}
              </div>
            </div>
            <div>
              <div className="text-muted text-sm">Work Remaining</div>
              <div style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                {request.colony_work_remaining ?? "Unknown"}
              </div>
            </div>
            <div>
              <div className="text-muted text-sm">Alteration Rate</div>
              <div style={{ fontWeight: 500, fontSize: "1.1rem" }}>
                {request.colony_alteration_rate != null
                  ? `${Math.round(request.colony_alteration_rate * 100)}%`
                  : "N/A"}
              </div>
            </div>
          </div>
          {request.colony_estimation_method && (
            <div style={{ marginBottom: "1rem" }}>
              <span className="badge">{request.colony_estimation_method}</span>
            </div>
          )}

          {/* Classification Suggestion Banner (MIG_622) */}
          {request.suggested_classification && (
            <ClassificationSuggestionBanner
              requestId={request.request_id}
              placeId={request.place_id}
              suggestion={{
                suggested_classification: request.suggested_classification,
                classification_confidence: request.classification_confidence,
                classification_signals: request.classification_signals,
                classification_disposition: request.classification_disposition,
                classification_reviewed_at: request.classification_reviewed_at,
                classification_reviewed_by: request.classification_reviewed_by,
              }}
              currentPlaceClassification={request.current_place_classification}
              onUpdate={() => {
                // Parent handles refetch via request state
                window.location.reload();
              }}
            />
          )}

          <ColonyEstimates placeId={request.place_id} />
        </div>
      )}

      {/* Requester Card */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Requester</h2>
          {request.requester_email && (
            <button
              onClick={onShowEmail}
              className="btn btn-secondary"
              style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
            >
              Email Requester
            </button>
          )}
        </div>
        {request.requester_person_id ? (
          <div>
            <a href={`/people/${request.requester_person_id}`} style={{ fontWeight: 500, fontSize: "1.1rem" }}>
              {request.requester_name}
            </a>
            {(request.requester_email || request.requester_phone) && (
              <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {request.requester_phone && (
                  <a href={`tel:${request.requester_phone}`} className="text-sm" style={{ color: "var(--foreground)" }}>
                    {request.requester_phone}
                  </a>
                )}
                {request.requester_email && (
                  <a href={`mailto:${request.requester_email}`} className="text-sm" style={{ color: "var(--foreground)" }}>
                    {request.requester_email}
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted">No requester linked</p>
        )}
      </div>

      {/* Assigned Trappers Card */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Assigned Trappers</h2>
        <TrapperAssignments requestId={requestId} onAssignmentChange={onAssignmentChange} />
      </div>

      {/* Ready to Email Card (MIG_605) */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Email Batch</h2>
          {request.email_batch_id && (
            <a
              href="/admin/email-batches"
              style={{
                fontSize: "0.85rem",
                color: "#6366f1",
              }}
            >
              View Batch
            </a>
          )}
        </div>

        {/* Ready to Email Toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={request.ready_to_email || false}
              onChange={onToggleReadyToEmail}
              disabled={savingEmail || !!request.email_batch_id}
              style={{ width: "18px", height: "18px" }}
            />
            <span style={{ fontWeight: 500 }}>Ready to Email</span>
          </label>
          {request.email_batch_id && (
            <span
              style={{
                padding: "0.25rem 0.5rem",
                background: "#dbeafe",
                color: "#1e40af",
                fontSize: "0.75rem",
                borderRadius: "4px",
              }}
            >
              Added to batch
            </span>
          )}
          {savingEmail && <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Saving...</span>}
        </div>

        {/* Email Summary */}
        {(request.ready_to_email || request.email_summary) && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span className="text-muted text-sm">Summary for Trapper Email</span>
              {!editingEmailSummary && (
                <button
                  onClick={onStartEditEmailSummary}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Edit
                </button>
              )}
            </div>

            {editingEmailSummary ? (
              <div>
                <textarea
                  value={emailSummaryDraft}
                  onChange={(e) => onEmailSummaryChange(e.target.value)}
                  rows={4}
                  placeholder="Brief summary of this assignment for the trapper (appears in batch emails)..."
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    resize: "vertical",
                    fontSize: "0.9rem",
                  }}
                />
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    onClick={onSaveEmailSummary}
                    disabled={savingEmail}
                    style={{
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.85rem",
                      background: "#3b82f6",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: savingEmail ? "not-allowed" : "pointer",
                    }}
                  >
                    {savingEmail ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={onCancelEmailSummary}
                    style={{
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.85rem",
                      background: "transparent",
                      color: "inherit",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "0.75rem",
                  background: "var(--surface)",
                  borderRadius: "6px",
                  fontSize: "0.9rem",
                  whiteSpace: "pre-wrap",
                  minHeight: "60px",
                  color: request.email_summary ? "inherit" : "var(--muted)",
                }}
              >
                {request.email_summary || "No summary written yet. Click Edit to add one."}
              </div>
            )}
          </div>
        )}

        {!request.ready_to_email && !request.email_summary && (
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", margin: 0 }}>
            Check &quot;Ready to Email&quot; to include this request in a trapper batch email.
          </p>
        )}
      </div>
    </>
  );
}
