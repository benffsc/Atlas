"use client";

interface LegacyTabProps {
  request: {
    created_at: string;
    source_system: string | null;
    source_record_id: string | null;
    data_source: string;
    legacy_notes: string | null;
    place_name: string | null;
    place_address: string | null;
    place_city: string | null;
    requester_name: string | null;
    summary: string | null;
    estimated_cat_count: number | null;
    has_kittens: boolean;
    notes: string | null;
  };
  onShowUpgradeWizard: () => void;
  onSwitchToDetails: () => void;
}

export function LegacyTab({ request, onShowUpgradeWizard, onSwitchToDetails }: LegacyTabProps) {
  return (
    <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
      <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Legacy Airtable Data</h2>

      {/* Info banner */}
      <div style={{
        background: "#f8f9fa",
        border: "1px solid #e9ecef",
        borderRadius: "8px",
        padding: "1rem",
        marginBottom: "1rem",
        fontSize: "0.9rem",
      }}>
        This data was imported from Airtable on {new Date(request.created_at).toLocaleDateString()}.
        Some fields may have been migrated to new Atlas fields.
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        {/* Source Info */}
        <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "0.5rem" }}>
          <strong>Source System:</strong>
          <span>{request.source_system || "N/A"}</span>
          <strong>Airtable ID:</strong>
          <span>
            {request.source_record_id ? (
              <a
                href={`https://airtable.com/appl6zLrRFDvsz0dh/tblc1bva7jFzg8DVF/${request.source_record_id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {request.source_record_id}
              </a>
            ) : (
              "N/A"
            )}
          </span>
          <strong>Data Source:</strong>
          <span>{request.data_source || "N/A"}</span>
          <strong>Created:</strong>
          <span>{new Date(request.created_at).toLocaleString()}</span>
        </div>

        {/* Legacy Notes */}
        {request.legacy_notes && (
          <div>
            <strong style={{ display: "block", marginBottom: "0.5rem" }}>Internal Notes (from Airtable):</strong>
            <pre style={{
              background: "#2d3748",
              color: "#e2e8f0",
              padding: "1rem",
              borderRadius: "8px",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              margin: 0,
              maxHeight: "400px",
              overflow: "auto",
            }}>
              {request.legacy_notes}
            </pre>
          </div>
        )}

        {/* Location Info */}
        <div>
          <strong style={{ display: "block", marginBottom: "0.5rem" }}>Location Info:</strong>
          <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
            <p style={{ margin: "0 0 0.25rem 0" }}><strong>Place:</strong> {request.place_name || "N/A"}</p>
            <p style={{ margin: "0 0 0.25rem 0" }}><strong>Address:</strong> {request.place_address || "N/A"}</p>
            <p style={{ margin: "0 0 0.25rem 0" }}><strong>City:</strong> {request.place_city || "N/A"}</p>
            <p style={{ margin: 0 }}><strong>Requester:</strong> {request.requester_name || "N/A"}</p>
          </div>
        </div>

        {/* Original Request Details */}
        <div>
          <strong style={{ display: "block", marginBottom: "0.5rem" }}>Original Request Details:</strong>
          <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "6px" }}>
            <p style={{ margin: "0 0 0.25rem 0" }}><strong>Request Title:</strong> {request.summary || "N/A"}</p>
            <p style={{ margin: "0 0 0.25rem 0" }}><strong>Cats Needing TNR:</strong> {request.estimated_cat_count ?? "N/A"}</p>
            <p style={{ margin: "0 0 0.25rem 0" }}><strong>Has Kittens:</strong> {request.has_kittens ? "Yes" : "No"}</p>
            <p style={{ margin: 0 }}><strong>Original Notes:</strong> {request.notes || "N/A"}</p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.5rem" }}>
        <button
          onClick={onShowUpgradeWizard}
          style={{
            padding: "0.5rem 1rem",
            background: "#0d6efd",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
          }}
        >
          Upgrade to Full Request
        </button>
        <button
          onClick={onSwitchToDetails}
          style={{ padding: "0.5rem 1rem" }}
        >
          Back to Details
        </button>
      </div>
    </div>
  );
}
