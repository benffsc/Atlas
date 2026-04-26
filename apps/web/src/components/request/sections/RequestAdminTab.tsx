"use client";

import { NearbyEntities } from "@/components/common";
import { ColonyEstimates } from "@/components/charts";
import { COLORS } from "@/lib/design-tokens";
import type { RequestDetail } from "@/app/requests/[id]/types";

interface RequestAdminTabProps {
  request: RequestDetail;
  mapUrl: string | null;
  onUpgradeLegacy: () => void;
  onCreateColony: () => void;
}

export function RequestAdminTab({ request, mapUrl, onUpgradeLegacy, onCreateColony }: RequestAdminTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Colony Stats */}
      <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
        <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem", fontWeight: 700, color: COLORS.successDark }}>Colony Summary</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.75rem" }}>
          <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.successDark }}>{request.colony_size_estimate ?? "?"}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Estimated</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.success }}>{request.colony_verified_altered ?? 0}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Altered</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.warning }}>{request.colony_work_remaining ?? "?"}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Remaining</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: COLORS.primary }}>
              {request.colony_alteration_rate != null ? `${Math.round(request.colony_alteration_rate)}%` : "—"}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase" }}>Coverage</div>
          </div>
        </div>
        {request.place_id && (
          <div style={{ marginTop: "0.75rem" }}>
            <ColonyEstimates placeId={request.place_id} />
          </div>
        )}
      </div>

      {/* Map Preview */}
      {mapUrl && (
        <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", fontWeight: 700 }}>Location</h4>
          <img src={mapUrl} alt="Map" style={{ width: "100%", height: "150px", objectFit: "cover", borderRadius: "6px" }} />
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
            <a href={`https://www.google.com/maps/search/?api=1&query=${request.place_coordinates?.lat},${request.place_coordinates?.lng}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ flex: 1, fontSize: "0.75rem" }}>Google Maps</a>
            <a href={`/map?lat=${request.place_coordinates?.lat}&lng=${request.place_coordinates?.lng}&zoom=17`} className="btn btn-sm btn-secondary" style={{ flex: 1, fontSize: "0.75rem" }}>Beacon Map</a>
          </div>
        </div>
      )}

      {/* Nearby Entities */}
      {request.place_coordinates && (
        <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 1rem 0", fontSize: "0.95rem", fontWeight: 600, color: "var(--text-secondary)" }}>Nearby Entities</h4>
          <NearbyEntities requestId={request.request_id} />
        </div>
      )}

      {/* Intake Source */}
      {request.intake_submission_id && (
        <details style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px", fontSize: "0.8rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            Intake Source
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", color: "var(--muted)", marginTop: "0.5rem" }}>
            {request.intake_call_type && (
              <div><strong>Call Type:</strong> {request.intake_call_type}</div>
            )}
            {request.intake_triage_category && (
              <div><strong>Triage:</strong> {request.intake_triage_category}
                {request.intake_triage_score != null && ` (score: ${request.intake_triage_score})`}
              </div>
            )}
            {request.intake_custom_fields && Object.keys(request.intake_custom_fields).length > 0 && (
              <div>
                <strong>Custom Fields:</strong>
                {Object.entries(request.intake_custom_fields).map(([key, val]) => (
                  <div key={key} style={{ paddingLeft: "0.75rem", fontSize: "0.75rem" }}>
                    {key.replace(/_/g, " ")}: {String(val)}
                  </div>
                ))}
              </div>
            )}
            {request.intake_submitted_at && (
              <div><strong>Submitted:</strong> {new Date(request.intake_submitted_at).toLocaleString()}</div>
            )}
            <div style={{ marginTop: "0.25rem" }}>
              <a href={`/admin/intake?selected=${request.intake_submission_id}`} style={{ fontSize: "0.75rem" }}>
                View Full Intake Submission
              </a>
            </div>
          </div>
        </details>
      )}

      {/* Quick Actions */}
      <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
        <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem", fontWeight: 700 }}>Quick Actions</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <a href={`/requests/${request.request_id}/trapper-sheet`} target="_blank" rel="noopener noreferrer" className="btn" style={{ width: "100%", fontSize: "0.85rem", background: "#166534" }}>Print Trapper Sheet</a>
          <a href={`/requests/${request.request_id}/print`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ width: "100%", fontSize: "0.85rem" }}>Print Summary</a>
          {request.place_id && <button onClick={onCreateColony} className="btn btn-secondary" style={{ width: "100%", fontSize: "0.85rem" }}>Create Colony</button>}
        </div>
      </div>

      {/* Legacy Upgrade */}
      {request.source_system?.startsWith("airtable") && (
        <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px" }}>
          <button onClick={onUpgradeLegacy} className="btn btn-secondary" style={{ width: "100%", fontSize: "0.85rem" }}>
            Upgrade Legacy Data
          </button>
        </div>
      )}

      {/* Metadata */}
      <div style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px", fontSize: "0.8rem", color: "var(--muted)" }}>
        <div style={{ marginBottom: "0.5rem" }}><strong>Created:</strong> {new Date(request.created_at).toLocaleString()}</div>
        <div style={{ marginBottom: "0.5rem" }}><strong>Updated:</strong> {new Date(request.updated_at).toLocaleString()}</div>
        {request.source_system && <div style={{ marginBottom: "0.5rem" }}><strong>Source:</strong> {request.source_system}</div>}
        <div><strong>ID:</strong> {request.request_id.slice(0, 8)}...</div>
      </div>
    </div>
  );
}
