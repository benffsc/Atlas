"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import AddressAutocomplete from "@/components/AddressAutocomplete";

interface Cat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
  source_system: string;
  data_source: string; // clinichq, petlink, or legacy_import
}

interface Place {
  place_id: string;
  place_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  role: string;
  confidence: number;
}

interface PersonRelationship {
  person_id: string;
  person_name: string;
  relationship_type: string;
  relationship_label: string;
  confidence: number;
}

interface PlaceDetails {
  place_id: string;
  formatted_address: string;
  name: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

interface PersonIdentifier {
  id_type: string;
  id_value: string;
  source_system: string | null;
  source_table: string | null;
}

interface PersonDetail {
  person_id: string;
  display_name: string;
  merged_into_person_id: string | null;
  created_at: string;
  updated_at: string;
  cats: Cat[] | null;
  places: Place[] | null;
  person_relationships: PersonRelationship[] | null;
  cat_count: number;
  place_count: number;
  primary_address_id: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  data_source: string | null;
  identifiers: PersonIdentifier[] | null;
  entity_type: string | null;
}

interface JournalEntry {
  id: string;
  body: string;
  title: string | null;
  entry_kind: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  occurred_at: string | null;
  is_archived: boolean;
  is_pinned: boolean;
  edit_count: number;
  tags: string[];
  primary_cat_id: string | null;
  cat_name?: string | null;
  primary_place_id: string | null;
  place_name?: string | null;
}

interface RelatedRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  created_at: string;
  place_name: string | null;
}

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

// Source badge for cats - ClinicHQ patients vs PetLink-only
function SourceBadge({ dataSource }: { dataSource: string }) {
  if (dataSource === "clinichq") {
    return (
      <span
        className="badge"
        style={{ background: "#198754", color: "#fff", fontSize: "0.65rem" }}
        title="Actual ClinicHQ patient - has been to clinic"
      >
        ClinicHQ
      </span>
    );
  }
  if (dataSource === "petlink") {
    return (
      <span
        className="badge"
        style={{ background: "#6c757d", color: "#fff", fontSize: "0.65rem" }}
        title="PetLink microchip registration only - no clinic history"
      >
        PetLink
      </span>
    );
  }
  // legacy_import
  return (
    <span
      className="badge"
      style={{ background: "#ffc107", color: "#000", fontSize: "0.65rem" }}
      title="Imported from legacy system"
    >
      Legacy
    </span>
  );
}

// Entity type badge (site vs person)
function EntityTypeBadge({ entityType }: { entityType: string | null }) {
  if (!entityType || entityType === "person") return null;

  const typeLabels: Record<string, { label: string; bg: string; color: string; title: string }> = {
    site: {
      label: "Site",
      bg: "#dc3545",
      color: "#fff",
      title: "This is a site/location, not a person"
    },
    business: {
      label: "Business",
      bg: "#fd7e14",
      color: "#000",
      title: "This is a business account, not a person"
    },
    unknown: {
      label: "Needs Review",
      bg: "#ffc107",
      color: "#000",
      title: "This record needs review - may be a site or duplicate"
    },
  };

  const info = typeLabels[entityType] || {
    label: entityType,
    bg: "#6c757d",
    color: "#fff",
    title: `Entity type: ${entityType}`
  };

  return (
    <span
      className="badge"
      style={{ background: info.bg, color: info.color, fontSize: "0.75rem" }}
      title={info.title}
    >
      {info.label}
    </span>
  );
}

// Data source badge for person header
function DataSourceBadge({ dataSource }: { dataSource: string | null }) {
  if (!dataSource) return null;

  const sourceLabels: Record<string, { label: string; bg: string; color: string; title: string }> = {
    clinichq: {
      label: "ClinicHQ",
      bg: "#198754",
      color: "#fff",
      title: "Person record from ClinicHQ clinic software"
    },
    petlink: {
      label: "PetLink",
      bg: "#0d6efd",
      color: "#fff",
      title: "Person from PetLink microchip registration"
    },
    legacy_import: {
      label: "Legacy",
      bg: "#ffc107",
      color: "#000",
      title: "Imported from legacy system (Airtable, VolunteerHub, etc.)"
    },
    volunteerhub: {
      label: "VolunteerHub",
      bg: "#6f42c1",
      color: "#fff",
      title: "Person from volunteer management system"
    },
  };

  const info = sourceLabels[dataSource] || {
    label: dataSource,
    bg: "#6c757d",
    color: "#fff",
    title: `Data source: ${dataSource}`
  };

  return (
    <span
      className="badge"
      style={{ background: info.bg, color: info.color, fontSize: "0.75rem" }}
      title={info.title}
    >
      {info.label}
    </span>
  );
}

// Clickable link pill for related entities
function EntityLink({
  href,
  label,
  sublabel,
  badge,
  badgeColor,
  dataSource,
}: {
  href: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: string;
  dataSource?: string;
}) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        padding: "0.75rem 1rem",
        background: "var(--card-bg, #f8f9fa)",
        borderRadius: "8px",
        textDecoration: "none",
        color: "var(--foreground, #212529)",
        border: `1px solid ${dataSource === "clinichq" ? "#198754" : "var(--border, #dee2e6)"}`,
        borderLeftWidth: dataSource === "clinichq" ? "3px" : "1px",
        transition: "all 0.15s",
        minWidth: "150px",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "#adb5bd";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = dataSource === "clinichq" ? "#198754" : "var(--border, #dee2e6)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {dataSource && <SourceBadge dataSource={dataSource} />}
        {badge && (
          <span
            className="badge"
            style={{ background: badgeColor || "#6c757d", color: "#fff", fontSize: "0.7rem" }}
          >
            {badge}
          </span>
        )}
      </div>
      {sublabel && (
        <span className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
          {sublabel}
        </span>
      )}
    </a>
  );
}

export default function PersonDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [requests, setRequests] = useState<RelatedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode states
  const [editingContact, setEditingContact] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);

  // New journal entry
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchPerson = useCallback(async () => {
    try {
      const response = await fetch(`/api/people/${id}`);
      if (response.status === 404) {
        setError("Person not found");
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch person details");
      }
      const result: PersonDetail = await response.json();
      setPerson(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const response = await fetch(`/api/journal?person_id=${id}&limit=50`);
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
      const response = await fetch(`/api/requests?person_id=${id}&limit=10`);
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
      await Promise.all([fetchPerson(), fetchJournal(), fetchRequests()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchPerson, fetchJournal, fetchRequests]);

  const handlePlaceSelect = async (place: PlaceDetails) => {
    setSavingAddress(true);
    try {
      const response = await fetch(`/api/people/${id}/address`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_place_id: place.place_id,
          formatted_address: place.formatted_address,
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
          address_components: place.address_components,
        }),
      });

      if (response.ok) {
        await fetchPerson();
        setEditingContact(false);
        setAddressInput("");
      }
    } catch (err) {
      console.error("Failed to save address:", err);
    } finally {
      setSavingAddress(false);
    }
  };

  const handleRemoveAddress = async () => {
    if (!confirm("Remove the primary address from this person?")) return;

    setSavingAddress(true);
    try {
      const response = await fetch(`/api/people/${id}/address`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchPerson();
      }
    } catch (err) {
      console.error("Failed to remove address:", err);
    } finally {
      setSavingAddress(false);
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
          body: newNote,
          person_id: id,
          entry_kind: "note",
          // created_by defaults to "app_user" - TODO: auth context
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
    return <div className="loading">Loading person details...</div>;
  }

  if (error) {
    return (
      <div>
        <a href="/people">&larr; Back to people</a>
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Person ID: <code>{id}</code>
          </p>
        </div>
      </div>
    );
  }

  if (!person) {
    return <div className="empty">Person not found</div>;
  }

  return (
    <div>
      <a href="/people">&larr; Back to people</a>

      {/* Header */}
      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{person.display_name}</h1>
          <EntityTypeBadge entityType={person.entity_type} />
          <DataSourceBadge dataSource={person.data_source} />
        </div>
        <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>ID: {person.person_id}</p>
        {person.entity_type === "site" && (
          <p className="text-muted text-sm" style={{ marginTop: "0.25rem", color: "#dc3545" }}>
            This is a site/location account from ClinicHQ, not a person.
          </p>
        )}
        {person.entity_type === "unknown" && (
          <p className="text-muted text-sm" style={{ marginTop: "0.25rem", color: "#ffc107" }}>
            This record needs review - may be a site, business, or duplicate entry.
          </p>
        )}
      </div>

      {/* Summary Stats */}
      <Section title="Summary">
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Cats</span>
            <span className="detail-value">{person.cat_count}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Places</span>
            <span className="detail-value">{person.place_count}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Created</span>
            <span className="detail-value">
              {new Date(person.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Updated</span>
            <span className="detail-value">
              {new Date(person.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </Section>

      {/* Contact Info - with edit button */}
      <Section
        title="Contact Information"
        onEdit={() => setEditingContact(true)}
        editMode={editingContact}
      >
        {editingContact ? (
          <div>
            <div style={{ marginBottom: "1rem" }}>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Primary Address
              </label>
              <AddressAutocomplete
                value={addressInput}
                onChange={setAddressInput}
                onPlaceSelect={handlePlaceSelect}
                placeholder="Search for an address..."
                disabled={savingAddress}
              />
              {savingAddress && (
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>Saving...</p>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={() => { setEditingContact(false); setAddressInput(""); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="detail-grid">
            <div className="detail-item" style={{ gridColumn: "span 2" }}>
              <span className="detail-label">Address</span>
              {person.primary_address ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className="detail-value">{person.primary_address}</span>
                  <button
                    onClick={handleRemoveAddress}
                    style={{
                      padding: "0.125rem 0.375rem",
                      fontSize: "0.75rem",
                      background: "transparent",
                      border: "1px solid #dc3545",
                      color: "#dc3545",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                    title="Remove address"
                  >
                    &times;
                  </button>
                </div>
              ) : (
                <span className="detail-value text-muted">No address set</span>
              )}
            </div>
            {/* Show identifiers from data sources */}
            {person.identifiers && person.identifiers.length > 0 ? (
              <>
                {person.identifiers.filter(i => i.id_type === "phone").map((id, idx) => (
                  <div className="detail-item" key={`phone-${idx}`}>
                    <span className="detail-label">
                      Phone
                      {id.source_system && (
                        <span className="text-muted" style={{ fontSize: "0.7rem", marginLeft: "0.25rem" }}>
                          ({id.source_system})
                        </span>
                      )}
                    </span>
                    <span className="detail-value">{id.id_value}</span>
                  </div>
                ))}
                {person.identifiers.filter(i => i.id_type === "email").map((id, idx) => (
                  <div className="detail-item" key={`email-${idx}`}>
                    <span className="detail-label">
                      Email
                      {id.source_system && (
                        <span className="text-muted" style={{ fontSize: "0.7rem", marginLeft: "0.25rem" }}>
                          ({id.source_system})
                        </span>
                      )}
                    </span>
                    <span className="detail-value">{id.id_value}</span>
                  </div>
                ))}
                {person.identifiers.filter(i => !["phone", "email"].includes(i.id_type)).length === person.identifiers.length && (
                  <>
                    <div className="detail-item">
                      <span className="detail-label">Phone</span>
                      <span className="detail-value text-muted">Not available</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Email</span>
                      <span className="detail-value text-muted">Not available</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="detail-item">
                  <span className="detail-label">Phone</span>
                  <span className="detail-value text-muted">Not available</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Email</span>
                  <span className="detail-value text-muted">Not available</span>
                </div>
              </>
            )}
          </div>
        )}
      </Section>

      {/* Cats - Clickable Links */}
      <Section title="Cats">
        {person.cats && person.cats.length > 0 ? (
          <>
            <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
              <span style={{ color: "#198754", fontWeight: 500 }}>ClinicHQ</span> = actual clinic patient,{" "}
              <span style={{ color: "var(--muted)" }}>PetLink</span> = microchip only
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {person.cats.map((cat) => (
                <EntityLink
                  key={cat.cat_id}
                  href={`/cats/${cat.cat_id}`}
                  label={cat.cat_name}
                  dataSource={cat.data_source}
                  badge={cat.relationship_type}
                  badgeColor={cat.relationship_type === "owner" ? "#0d6efd" : "#6c757d"}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted">No cats linked to this person.</p>
        )}
      </Section>

      {/* Places - Clickable Links */}
      <Section title="Places">
        {person.places && person.places.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {person.places.map((place) => (
              <EntityLink
                key={place.place_id}
                href={`/places/${place.place_id}`}
                label={place.place_name}
                sublabel={place.formatted_address || undefined}
                badge={place.place_kind || place.role}
                badgeColor={place.role === "requester" ? "#198754" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No places linked to this person.</p>
        )}
      </Section>

      {/* Related People */}
      {person.person_relationships && person.person_relationships.length > 0 && (
        <Section title="Related People">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {person.person_relationships.map((rel) => (
              <EntityLink
                key={rel.person_id}
                href={`/people/${rel.person_id}`}
                label={rel.person_name}
                badge={rel.relationship_label}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Related Requests (as requester) */}
      <Section title="Requests">
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
                  {req.summary || req.place_name || "No summary"}
                </span>
                <span className="text-muted text-sm">
                  {new Date(req.created_at).toLocaleDateString()}
                </span>
              </a>
            ))}
            {requests.length >= 10 && (
              <a href={`/requests?person_id=${person.person_id}`} className="text-sm" style={{ marginTop: "0.5rem" }}>
                View all requests from this person...
              </a>
            )}
          </div>
        ) : (
          <p className="text-muted">No requests from this person.</p>
        )}
      </Section>

      {/* Journal / Notes */}
      <Section title="Journal">
        {/* Add new note */}
        <div style={{ marginBottom: "1rem" }}>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
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
                key={entry.id}
                style={{
                  padding: "1rem",
                  background: entry.is_pinned ? "#e3f2fd" : "#f8f9fa",
                  borderRadius: "8px",
                  borderLeft: `4px solid ${
                    entry.entry_kind === "contact"
                      ? "#17a2b8"
                      : entry.entry_kind === "medical"
                      ? "#dc3545"
                      : "#0d6efd"
                  }`,
                }}
              >
                <div style={{ marginBottom: "0.5rem" }}>
                  {entry.is_pinned && (
                    <span
                      className="badge"
                      style={{ marginRight: "0.5rem", background: "#6c757d", fontSize: "0.65rem" }}
                    >
                      pinned
                    </span>
                  )}
                  <span
                    className="badge"
                    style={{
                      marginRight: "0.5rem",
                      background:
                        entry.entry_kind === "contact"
                          ? "#17a2b8"
                          : entry.entry_kind === "medical"
                          ? "#dc3545"
                          : "#0d6efd",
                      color: "#fff",
                      fontSize: "0.7rem",
                    }}
                  >
                    {entry.entry_kind}
                  </span>
                  <span className="text-muted text-sm">
                    {entry.created_by || "unknown"} &middot;{" "}
                    {new Date(entry.occurred_at || entry.created_at).toLocaleDateString()}
                    {entry.edit_count > 0 && (
                      <span style={{ marginLeft: "0.5rem", fontStyle: "italic" }}>
                        (edited)
                      </span>
                    )}
                  </span>
                </div>
                {entry.title && (
                  <p style={{ margin: "0 0 0.5rem 0", fontWeight: "bold" }}>{entry.title}</p>
                )}
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{entry.body}</p>
                {/* Show linked entities */}
                {(entry.primary_cat_id || entry.primary_place_id) && (
                  <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                    {entry.primary_cat_id && (
                      <a href={`/cats/${entry.primary_cat_id}`} className="text-sm">
                        Cat: {entry.cat_name || entry.primary_cat_id}
                      </a>
                    )}
                    {entry.primary_place_id && (
                      <a href={`/places/${entry.primary_place_id}`} className="text-sm">
                        Place: {entry.place_name || entry.primary_place_id}
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

      {/* Data Sources - shows where this person's data came from */}
      {person.identifiers && person.identifiers.length > 0 && (
        <Section title="Data Sources">
          <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
            This person record was seeded from these sources:
          </p>
          <table style={{ width: "100%", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dee2e6" }}>
                <th style={{ padding: "0.5rem 0" }}>Type</th>
                <th style={{ padding: "0.5rem 0" }}>Value</th>
                <th style={{ padding: "0.5rem 0" }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {person.identifiers.map((id, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "0.5rem 0" }}>
                    <span className="badge" style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}>
                      {id.id_type}
                    </span>
                  </td>
                  <td style={{ padding: "0.5rem 0" }}>{id.id_value}</td>
                  <td style={{ padding: "0.5rem 0" }} className="text-muted">
                    {id.source_system ? `${id.source_system}${id.source_table ? `.${id.source_table}` : ""}` : "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
