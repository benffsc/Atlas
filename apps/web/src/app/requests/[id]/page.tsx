"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

interface RequestDetail {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  assigned_to: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_kind: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates: { lat: number; lng: number } | null;
  requester_person_id: string | null;
  requester_name: string | null;
  cats: { cat_id: string; cat_name: string; relationship: string }[] | null;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "triaged", label: "Triaged" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "on_hold", label: "On Hold" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    new: { bg: "#0d6efd", color: "#fff" },
    triaged: { bg: "#6610f2", color: "#fff" },
    scheduled: { bg: "#198754", color: "#fff" },
    in_progress: { bg: "#fd7e14", color: "#000" },
    completed: { bg: "#20c997", color: "#000" },
    cancelled: { bg: "#6c757d", color: "#fff" },
    on_hold: { bg: "#ffc107", color: "#000" },
  };
  const style = colors[status] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: "0.9rem", padding: "0.5rem 1rem" }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    urgent: { bg: "#dc3545", color: "#fff" },
    high: { bg: "#fd7e14", color: "#000" },
    normal: { bg: "#6c757d", color: "#fff" },
    low: { bg: "#adb5bd", color: "#000" },
  };
  const style = colors[priority] || { bg: "#6c757d", color: "#fff" };

  return (
    <span className="badge" style={{ background: style.bg, color: style.color }}>
      {priority}
    </span>
  );
}

function LegacyBadge() {
  return (
    <span
      className="badge"
      style={{
        background: "#e9ecef",
        color: "#495057",
        fontSize: "0.75rem",
        padding: "0.25rem 0.5rem",
        border: "1px solid #ced4da",
      }}
      title="This request was imported from Airtable"
    >
      Legacy (Airtable)
    </span>
  );
}

export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    status: "",
    priority: "",
    summary: "",
    notes: "",
    estimated_cat_count: "" as number | "",
    has_kittens: false,
    cats_are_friendly: null as boolean | null,
    assigned_to: "",
    scheduled_date: "",
    scheduled_time_range: "",
    resolution_notes: "",
    cats_trapped: "" as number | "",
    cats_returned: "" as number | "",
  });

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const response = await fetch(`/api/requests/${requestId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError("Request not found");
          } else {
            setError("Failed to load request");
          }
          return;
        }
        const data = await response.json();
        setRequest(data);
        // Initialize edit form
        setEditForm({
          status: data.status,
          priority: data.priority,
          summary: data.summary || "",
          notes: data.notes || "",
          estimated_cat_count: data.estimated_cat_count ?? "",
          has_kittens: data.has_kittens,
          cats_are_friendly: data.cats_are_friendly,
          assigned_to: data.assigned_to || "",
          scheduled_date: data.scheduled_date || "",
          scheduled_time_range: data.scheduled_time_range || "",
          resolution_notes: data.resolution_notes || "",
          cats_trapped: data.cats_trapped ?? "",
          cats_returned: data.cats_returned ?? "",
        });
      } catch (err) {
        setError("Failed to load request");
      } finally {
        setLoading(false);
      }
    };

    fetchRequest();
  }, [requestId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editForm.status,
          priority: editForm.priority,
          summary: editForm.summary || null,
          notes: editForm.notes || null,
          estimated_cat_count: editForm.estimated_cat_count || null,
          has_kittens: editForm.has_kittens,
          cats_are_friendly: editForm.cats_are_friendly,
          assigned_to: editForm.assigned_to || null,
          scheduled_date: editForm.scheduled_date || null,
          scheduled_time_range: editForm.scheduled_time_range || null,
          resolution_notes: editForm.resolution_notes || null,
          cats_trapped: editForm.cats_trapped || null,
          cats_returned: editForm.cats_returned || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to save changes");
        return;
      }

      // Reload the request data
      const refreshResponse = await fetch(`/api/requests/${requestId}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setRequest(data);
      }

      setEditing(false);
    } catch (err) {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (request) {
      setEditForm({
        status: request.status,
        priority: request.priority,
        summary: request.summary || "",
        notes: request.notes || "",
        estimated_cat_count: request.estimated_cat_count ?? "",
        has_kittens: request.has_kittens,
        cats_are_friendly: request.cats_are_friendly,
        assigned_to: request.assigned_to || "",
        scheduled_date: request.scheduled_date || "",
        scheduled_time_range: request.scheduled_time_range || "",
        resolution_notes: request.resolution_notes || "",
        cats_trapped: request.cats_trapped ?? "",
        cats_returned: request.cats_returned ?? "",
      });
    }
    setEditing(false);
  };

  if (loading) {
    return (
      <div>
        <a href="/requests">&larr; Back to requests</a>
        <div className="loading" style={{ marginTop: "2rem" }}>Loading request...</div>
      </div>
    );
  }

  if (error && !request) {
    return (
      <div>
        <a href="/requests">&larr; Back to requests</a>
        <div className="empty" style={{ marginTop: "2rem" }}>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!request) return null;

  const isResolved = request.status === "completed" || request.status === "cancelled";

  return (
    <div>
      <a href="/requests">&larr; Back to requests</a>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ margin: 0 }}>
              {request.summary || request.place_name || "TNR Request"}
            </h1>
            {request.source_system === "airtable" && <LegacyBadge />}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <StatusBadge status={request.status} />
            <PriorityBadge priority={request.priority} />
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{ padding: "0.5rem 1rem" }}>
            Edit
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: "#dc3545", marginBottom: "1rem", padding: "0.75rem", background: "#f8d7da", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      {editing ? (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Edit Request</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Status
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  style={{ width: "100%" }}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Priority
                </label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                  style={{ width: "100%" }}
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Summary
              </label>
              <input
                type="text"
                value={editForm.summary}
                onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Estimated Cats
                </label>
                <input
                  type="number"
                  min="0"
                  value={editForm.estimated_cat_count}
                  onChange={(e) => setEditForm({ ...editForm, estimated_cat_count: e.target.value ? parseInt(e.target.value) : "" })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ flex: "1 1 150px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Assigned To
                </label>
                <input
                  type="text"
                  value={editForm.assigned_to}
                  onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editForm.has_kittens}
                  onChange={(e) => setEditForm({ ...editForm, has_kittens: e.target.checked })}
                />
                Has kittens
              </label>

              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <span>Cats friendly?</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === true}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: true })}
                  />
                  Yes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === false}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: false })}
                  />
                  No
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="friendly"
                    checked={editForm.cats_are_friendly === null}
                    onChange={() => setEditForm({ ...editForm, cats_are_friendly: null })}
                  />
                  Unknown
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Scheduled Date
                </label>
                <input
                  type="date"
                  value={editForm.scheduled_date}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_date: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Time Range
                </label>
                <input
                  type="text"
                  value={editForm.scheduled_time_range}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_time_range: e.target.value })}
                  placeholder="e.g., morning, 9am-12pm"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Notes
              </label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={4}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            {(editForm.status === "completed" || editForm.status === "cancelled") && (
              <>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Resolution Notes
                  </label>
                  <textarea
                    value={editForm.resolution_notes}
                    onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })}
                    rows={3}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Cats Trapped
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.cats_trapped}
                      onChange={(e) => setEditForm({ ...editForm, cats_trapped: e.target.value ? parseInt(e.target.value) : "" })}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div style={{ flex: "1 1 150px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Cats Returned
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.cats_returned}
                      onChange={(e) => setEditForm({ ...editForm, cats_returned: e.target.value ? parseInt(e.target.value) : "" })}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "inherit" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
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
                {request.place_kind && (
                  <span className="badge" style={{ marginTop: "0.5rem", display: "inline-block" }}>
                    {request.place_kind}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted">No location linked</p>
            )}
          </div>

          {/* Requester Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Requester</h2>
            {request.requester_person_id ? (
              <a href={`/people/${request.requester_person_id}`} style={{ fontWeight: 500 }}>
                {request.requester_name}
              </a>
            ) : (
              <p className="text-muted">No requester linked</p>
            )}
          </div>

          {/* Details Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Details</h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <div className="text-muted text-sm">Estimated Cats</div>
                <div style={{ fontWeight: 500 }}>
                  {request.estimated_cat_count ?? "Unknown"}
                  {request.has_kittens && (
                    <span style={{ marginLeft: "0.5rem", color: "#fd7e14" }}>+kittens</span>
                  )}
                </div>
              </div>

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

          {/* Resolution Card (if resolved) */}
          {isResolved && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Resolution</h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
                <div>
                  <div className="text-muted text-sm">Resolved</div>
                  <div style={{ fontWeight: 500 }}>
                    {request.resolved_at ? new Date(request.resolved_at).toLocaleDateString() : "—"}
                  </div>
                </div>

                <div>
                  <div className="text-muted text-sm">Cats Trapped</div>
                  <div style={{ fontWeight: 500 }}>{request.cats_trapped ?? "—"}</div>
                </div>

                <div>
                  <div className="text-muted text-sm">Cats Returned</div>
                  <div style={{ fontWeight: 500 }}>{request.cats_returned ?? "—"}</div>
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

          {/* Legacy Internal Notes Card (for Airtable imports) */}
          {request.legacy_notes && (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem", background: "var(--card-bg, #1a1a1a)", border: "1px solid var(--border)" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>📋</span>
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
                overflowY: "auto"
              }}>
                {request.legacy_notes}
              </div>
              <p className="text-muted text-sm" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
                These notes were imported from Airtable and are read-only. Future notes will use the new journal system.
              </p>
            </div>
          )}

          {/* Linked Cats Card */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Linked Cats</h2>
            {request.cats && request.cats.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {request.cats.map((cat) => (
                  <a
                    key={cat.cat_id}
                    href={`/cats/${cat.cat_id}`}
                    style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}
                  >
                    {cat.cat_name || "Unnamed cat"}
                    <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                      ({cat.relationship})
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-muted">No cats linked to this request yet</p>
            )}
          </div>

          {/* Metadata Card */}
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
            </div>
            <div style={{ marginTop: "1rem" }}>
              <div className="text-muted text-sm">Request ID</div>
              <code style={{ fontSize: "0.8rem" }}>{request.request_id}</code>
            </div>
            {request.source_system === "airtable" && request.source_record_id && (
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
      )}
    </div>
  );
}
