"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

interface Cat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
}

interface Person {
  person_id: string;
  person_name: string;
  role: string;
  confidence: number;
}

interface PlaceRelationship {
  place_id: string;
  place_name: string;
  relationship_type: string;
  relationship_label: string;
}

interface PlaceDetail {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: Cat[] | null;
  people: Person[] | null;
  place_relationships: PlaceRelationship[] | null;
  cat_count: number;
  person_count: number;
}

interface JournalEntry {
  entry_id: string;
  content: string;
  entry_type: string;
  created_by: string;
  created_at: string;
  observed_at: string | null;
  source_system: string | null;
  cat_id: string | null;
  cat_name?: string | null;
  person_id: string | null;
  person_name?: string | null;
}

interface RelatedRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  created_at: string;
  requester_name: string | null;
}

// Status badge component for requests
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
    <span className="badge" style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}>
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
    <span className="badge" style={{ background: style.bg, color: style.color, fontSize: "0.7rem" }}>
      {priority}
    </span>
  );
}

// Section component for read-only display with edit toggle
function Section({
  title,
  children,
  onEdit,
  editMode = false,
}: {
  title: string;
  children: React.ReactNode;
  onEdit?: () => void;
  editMode?: boolean;
}) {
  return (
    <div className="detail-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>{title}</h2>
        {onEdit && !editMode && (
          <button
            onClick={onEdit}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
          >
            Edit
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// Clickable link pill for related entities
function EntityLink({
  href,
  label,
  badge,
  badgeColor,
}: {
  href: string;
  label: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        background: "#f8f9fa",
        borderRadius: "8px",
        textDecoration: "none",
        color: "#212529",
        border: "1px solid #dee2e6",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = "#e9ecef";
        e.currentTarget.style.borderColor = "#adb5bd";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "#f8f9fa";
        e.currentTarget.style.borderColor = "#dee2e6";
      }}
    >
      <span>{label}</span>
      {badge && (
        <span
          className="badge"
          style={{ background: badgeColor || "#6c757d", color: "#fff", fontSize: "0.7rem" }}
        >
          {badge}
        </span>
      )}
    </a>
  );
}

export default function PlaceDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [requests, setRequests] = useState<RelatedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modes
  const [editingDetails, setEditingDetails] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPlaceKind, setEditPlaceKind] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // New journal entry
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Place kind options
  const PLACE_KINDS = [
    { value: "unknown", label: "Unknown" },
    { value: "residential_house", label: "Residential House" },
    { value: "apartment_unit", label: "Apartment Unit" },
    { value: "apartment_building", label: "Apartment Building" },
    { value: "business", label: "Business" },
    { value: "clinic", label: "Clinic" },
    { value: "neighborhood", label: "Neighborhood" },
    { value: "outdoor_site", label: "Outdoor Site" },
  ];

  const fetchPlace = useCallback(async () => {
    try {
      const response = await fetch(`/api/places/${id}`);
      if (response.status === 404) {
        setError("Place not found");
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch place details");
      }
      const result: PlaceDetail = await response.json();
      setPlace(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const response = await fetch(`/api/journal?place_id=${id}&limit=50`);
      if (response.ok) {
        const data = await response.json();
        setJournal(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch journal:", err);
    }
  }, [id]);

  const fetchRequests = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests?place_id=${id}&limit=10`);
      if (response.ok) {
        const data = await response.json();
        setRequests(data.requests || []);
      }
    } catch (err) {
      console.error("Failed to fetch requests:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchPlace(), fetchJournal(), fetchRequests()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchPlace, fetchJournal, fetchRequests]);

  const startEditing = () => {
    if (place) {
      setEditDisplayName(place.display_name);
      setEditPlaceKind(place.place_kind || "unknown");
      setSaveError(null);
      setEditingDetails(true);
    }
  };

  const cancelEditing = () => {
    setEditingDetails(false);
    setSaveError(null);
  };

  const handleSaveDetails = async () => {
    if (!place) return;

    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(`/api/places/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editDisplayName,
          place_kind: editPlaceKind,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setSaveError(result.error || "Failed to save changes");
        return;
      }

      // Refresh place data
      await fetchPlace();
      setEditingDetails(false);
    } catch (err) {
      setSaveError("Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    setAddingNote(true);
    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newNote,
          place_id: id,
          entry_type: "note",
          created_by: "app_user", // TODO: Replace with actual user
        }),
      });

      if (response.ok) {
        setNewNote("");
        await fetchJournal();
      }
    } catch (err) {
      console.error("Failed to add note:", err);
    } finally {
      setAddingNote(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading place details...</div>;
  }

  if (error) {
    return (
      <div>
        <a href="/places">&larr; Back to places</a>
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Place ID: <code>{id}</code>
          </p>
        </div>
      </div>
    );
  }

  if (!place) {
    return <div className="empty">Place not found</div>;
  }

  const placeKindColors: Record<string, string> = {
    residential_house: "#198754",
    apartment_unit: "#0d6efd",
    apartment_building: "#6610f2",
    business: "#fd7e14",
    clinic: "#dc3545",
    outdoor_site: "#20c997",
    neighborhood: "#6c757d",
  };

  return (
    <div>
      <a href="/places">&larr; Back to places</a>

      {/* Header */}
      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {place.display_name}
          {place.place_kind && (
            <span
              className="badge"
              style={{
                fontSize: "0.5em",
                background: placeKindColors[place.place_kind] || "#6c757d",
              }}
            >
              {place.place_kind.replace(/_/g, " ")}
            </span>
          )}
        </h1>
        {place.formatted_address && place.formatted_address !== place.display_name && (
          <p className="text-muted">{place.formatted_address}</p>
        )}
        <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
          ID: {place.place_id}
        </p>
      </div>

      {/* Location Details */}
      <Section
        title="Location Details"
        onEdit={startEditing}
        editMode={editingDetails}
      >
        {editingDetails ? (
          <div>
            {/* Warning for geocoded addresses */}
            {place.is_address_backed && (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  background: "#fff3cd",
                  border: "1px solid #ffc107",
                  borderRadius: "6px",
                  marginBottom: "1rem",
                  color: "#856404",
                }}
              >
                <strong>Note:</strong> This place has a verified Google address. You can change
                the display name (label) and type, but the underlying address data will remain
                linked to its geocoded location.
              </div>
            )}

            {/* Edit Form */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Display Name */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Display Name / Label
                </label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="e.g., Old Stony Point, OSP, Mrs. Johnson's House"
                  style={{ width: "100%", maxWidth: "400px" }}
                />
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  A friendly name for this place. The full address will still be shown.
                </p>
              </div>

              {/* Place Kind */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Place Type
                </label>
                <select
                  value={editPlaceKind}
                  onChange={(e) => setEditPlaceKind(e.target.value)}
                  style={{ minWidth: "200px" }}
                >
                  {PLACE_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  Helps categorize locations for filtering and reporting.
                </p>
              </div>

              {/* Address (read-only info) */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Address
                </label>
                <p className="text-muted" style={{ margin: 0 }}>
                  {place.formatted_address || "No address set"}
                </p>
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  Address changes require creating a new place. Contact support if needed.
                </p>
              </div>

              {/* Error Message */}
              {saveError && (
                <div style={{ color: "#dc3545" }}>{saveError}</div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button onClick={handleSaveDetails} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  style={{ background: "transparent", border: "1px solid var(--border)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Address</span>
              <span className="detail-value">{place.formatted_address || "Not set"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">City</span>
              <span className="detail-value">{place.locality || "Unknown"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Postal Code</span>
              <span className="detail-value">{place.postal_code || "Unknown"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">State</span>
              <span className="detail-value">{place.state_province || "Unknown"}</span>
            </div>
            {place.coordinates && (
              <div className="detail-item">
                <span className="detail-label">Coordinates</span>
                <span className="detail-value" style={{ fontFamily: "monospace" }}>
                  {place.coordinates.lat.toFixed(6)}, {place.coordinates.lng.toFixed(6)}
                </span>
              </div>
            )}
            <div className="detail-item">
              <span className="detail-label">Geocoded</span>
              <span className="detail-value">
                {place.is_address_backed ? (
                  <span style={{ color: "#198754" }}>Yes</span>
                ) : (
                  <span style={{ color: "#ffc107" }}>Approximate</span>
                )}
              </span>
            </div>
          </div>
        )}
      </Section>

      {/* Activity Summary */}
      <Section title="Activity">
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Cats</span>
            <span className="detail-value">{place.cat_count}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">People</span>
            <span className="detail-value">{place.person_count}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Cat Activity</span>
            <span className="detail-value">
              {place.has_cat_activity ? (
                <span style={{ color: "#198754" }}>Active</span>
              ) : (
                <span className="text-muted">None</span>
              )}
            </span>
          </div>
        </div>
      </Section>

      {/* Cats - Clickable Links */}
      <Section title="Cats">
        {place.cats && place.cats.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {place.cats.map((cat) => (
              <EntityLink
                key={cat.cat_id}
                href={`/cats/${cat.cat_id}`}
                label={cat.cat_name}
                badge={cat.relationship_type}
                badgeColor={cat.relationship_type === "residence" ? "#198754" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No cats linked to this place.</p>
        )}
      </Section>

      {/* People - Clickable Links */}
      <Section title="People">
        {place.people && place.people.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {place.people.map((person) => (
              <EntityLink
                key={person.person_id}
                href={`/people/${person.person_id}`}
                label={person.person_name}
                badge={person.role}
                badgeColor={person.role === "requester" ? "#0d6efd" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No people linked to this place.</p>
        )}
      </Section>

      {/* Related Places */}
      {place.place_relationships && place.place_relationships.length > 0 && (
        <Section title="Related Places">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {place.place_relationships.map((rel) => (
              <EntityLink
                key={rel.place_id}
                href={`/places/${rel.place_id}`}
                label={rel.place_name}
                badge={rel.relationship_label}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Related Requests */}
      <Section title="Related Requests">
        {requests.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {requests.map((req) => (
              <a
                key={req.request_id}
                href={`/requests/${req.request_id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  background: "#f8f9fa",
                  borderRadius: "8px",
                  textDecoration: "none",
                  color: "inherit",
                  border: "1px solid #dee2e6",
                }}
              >
                <StatusBadge status={req.status} />
                <PriorityBadge priority={req.priority} />
                <span style={{ flex: 1, fontWeight: 500 }}>
                  {req.summary || "No summary"}
                </span>
                <span className="text-muted text-sm">
                  {new Date(req.created_at).toLocaleDateString()}
                </span>
              </a>
            ))}
            {requests.length >= 10 && (
              <a href={`/requests?place_id=${place.place_id}`} className="text-sm" style={{ marginTop: "0.5rem" }}>
                View all requests for this place...
              </a>
            )}
          </div>
        ) : (
          <div>
            <p className="text-muted">No requests for this place yet.</p>
            <a
              href={`/requests/new?place_id=${place.place_id}`}
              style={{
                display: "inline-block",
                marginTop: "0.5rem",
                padding: "0.5rem 1rem",
                background: "var(--foreground)",
                color: "var(--background)",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              + Create Request
            </a>
          </div>
        )}
      </Section>

      {/* Journal / Notes */}
      <Section title="Journal">
        {/* Add new note */}
        <div style={{ marginBottom: "1rem" }}>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note about this place..."
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
          <button
            onClick={handleAddNote}
            disabled={addingNote || !newNote.trim()}
            style={{ marginTop: "0.5rem" }}
          >
            {addingNote ? "Adding..." : "Add Note"}
          </button>
        </div>

        {/* Existing entries */}
        {journal.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {journal.map((entry) => (
              <div
                key={entry.entry_id}
                style={{
                  padding: "1rem",
                  background: entry.entry_type === "legacy_note" ? "#fff8e1" : "#f8f9fa",
                  borderRadius: "8px",
                  borderLeft: `4px solid ${
                    entry.entry_type === "legacy_note"
                      ? "#ffc107"
                      : entry.entry_type === "site_visit"
                      ? "#198754"
                      : "#0d6efd"
                  }`,
                }}
              >
                <div style={{ marginBottom: "0.5rem" }}>
                  <span
                    className="badge"
                    style={{
                      marginRight: "0.5rem",
                      background:
                        entry.entry_type === "legacy_note"
                          ? "#ffc107"
                          : entry.entry_type === "site_visit"
                          ? "#198754"
                          : "#0d6efd",
                      color: entry.entry_type === "legacy_note" ? "#000" : "#fff",
                      fontSize: "0.7rem",
                    }}
                  >
                    {entry.entry_type}
                  </span>
                  <span className="text-muted text-sm">
                    {entry.created_by} &middot;{" "}
                    {new Date(entry.observed_at || entry.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{entry.content}</p>
                {/* Show linked entities */}
                {(entry.cat_id || entry.person_id) && (
                  <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                    {entry.cat_id && (
                      <a href={`/cats/${entry.cat_id}`} className="text-sm">
                        Cat: {entry.cat_name || entry.cat_id}
                      </a>
                    )}
                    {entry.person_id && (
                      <a href={`/people/${entry.person_id}`} className="text-sm">
                        Person: {entry.person_name || entry.person_id}
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">No journal entries yet.</p>
        )}
      </Section>

      {/* Metadata */}
      <Section title="Metadata">
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Created</span>
            <span className="detail-value">
              {new Date(place.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Updated</span>
            <span className="detail-value">
              {new Date(place.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}
