"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import JournalSection, { JournalEntry } from "@/components/JournalSection";

interface Owner {
  person_id: string;
  display_name: string;
  role: string;
}

interface Place {
  place_id: string;
  label: string;
  place_kind: string | null;
  role: string;
}

interface Identifier {
  type: string;
  value: string;
  source: string | null;
}

interface ClinicVisit {
  visit_date: string;
  appt_number: string;
  client_name: string;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
}

interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  altered_by_clinic: boolean | null; // TRUE if we performed the spay/neuter
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  data_source: string | null; // clinichq, petlink, or legacy_import
  ownership_type: string | null; // Community Cat (Feral), Owned, etc.
  quality_tier: string | null;
  quality_reason: string | null;
  notes: string | null;
  identifiers: Identifier[];
  owners: Owner[];
  places: Place[];
  clinic_history: ClinicVisit[];
  created_at: string;
  updated_at: string;
}

interface Appointment {
  appointment_id: string;
  scheduled_at: string;
  scheduled_date: string;
  status: string;
  appointment_type: string;
  provider_name: string | null;
  person_name: string | null;
  person_id: string | null;
  place_name: string | null;
  source_system: string;
}

// Data source badge - ClinicHQ patients vs PetLink-only
function DataSourceBadge({ dataSource }: { dataSource: string | null }) {
  if (dataSource === "clinichq") {
    return (
      <span
        className="badge"
        style={{ background: "#198754", color: "#fff", fontSize: "0.5em" }}
        title="This cat has been to the clinic - verified ClinicHQ patient"
      >
        ClinicHQ Patient
      </span>
    );
  }
  if (dataSource === "petlink") {
    return (
      <span
        className="badge"
        style={{ background: "#6c757d", color: "#fff", fontSize: "0.5em" }}
        title="PetLink microchip registration only - no clinic history"
      >
        PetLink Only
      </span>
    );
  }
  if (dataSource === "legacy_import") {
    return (
      <span
        className="badge"
        style={{ background: "#ffc107", color: "#000", fontSize: "0.5em" }}
        title="Imported from legacy system"
      >
        Legacy Import
      </span>
    );
  }
  return null;
}

// Ownership type badge - Unowned (community cats) vs Owned vs Foster
function OwnershipTypeBadge({ ownershipType }: { ownershipType: string | null }) {
  if (!ownershipType) return null;

  const lowerType = ownershipType.toLowerCase();

  // Community Cat (Feral) and Community Cat (Friendly) both → Unowned
  if (lowerType.includes("community") || lowerType.includes("feral") || lowerType.includes("stray")) {
    return (
      <span
        className="badge"
        style={{ background: "#dc3545", color: "#fff", fontSize: "0.5em" }}
        title={`Unowned (${ownershipType})`}
      >
        Unowned
      </span>
    );
  }
  if (lowerType === "owned") {
    return (
      <span
        className="badge"
        style={{ background: "#0d6efd", color: "#fff", fontSize: "0.5em" }}
        title="Owned cat - has an owner"
      >
        Owned
      </span>
    );
  }
  if (lowerType === "foster") {
    return (
      <span
        className="badge"
        style={{ background: "#6f42c1", color: "#fff", fontSize: "0.5em" }}
        title="Foster cat - in foster care"
      >
        Foster
      </span>
    );
  }
  // Unknown type - show as-is
  return (
    <span
      className="badge"
      style={{ background: "#6c757d", color: "#fff", fontSize: "0.5em" }}
      title={ownershipType}
    >
      {ownershipType}
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
        background: "var(--card-bg, #f8f9fa)",
        borderRadius: "8px",
        textDecoration: "none",
        color: "var(--foreground, #212529)",
        border: "1px solid var(--border, #dee2e6)",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "#adb5bd";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--border, #dee2e6)";
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

export default function CatDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [cat, setCat] = useState<CatDetail | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modes per section
  const [editingBasic, setEditingBasic] = useState(false);

  const fetchCat = useCallback(async () => {
    try {
      const response = await fetch(`/api/cats/${id}`);
      if (response.status === 404) {
        setError("Cat not found");
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch cat details");
      }
      const result: CatDetail = await response.json();
      setCat(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [id]);

  const fetchAppointments = useCallback(async () => {
    try {
      const response = await fetch(`/api/appointments?cat_id=${id}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || []);
      }
    } catch (err) {
      console.error("Failed to fetch appointments:", err);
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const response = await fetch(`/api/journal?cat_id=${id}&limit=50`);
      if (response.ok) {
        const data = await response.json();
        setJournal(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch journal:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchCat(), fetchAppointments(), fetchJournal()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchCat, fetchAppointments, fetchJournal]);

  if (loading) {
    return <div className="loading">Loading cat details...</div>;
  }

  if (error) {
    return (
      <div>
        <a href="/cats">&larr; Back to cats</a>
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Cat ID: <code>{id}</code>
          </p>
        </div>
      </div>
    );
  }

  if (!cat) {
    return <div className="empty">Cat not found</div>;
  }

  const tierColors: Record<string, string> = {
    A: "#198754",
    B: "#ffc107",
    C: "#fd7e14",
    D: "#dc3545",
  };

  return (
    <div>
      <a href="/cats">&larr; Back to cats</a>

      {/* Header */}
      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          {cat.display_name}
          <DataSourceBadge dataSource={cat.data_source} />
          <OwnershipTypeBadge ownershipType={cat.ownership_type} />
          {cat.quality_tier && (
            <span
              className="badge"
              style={{
                fontSize: "0.5em",
                background: tierColors[cat.quality_tier] || "#6c757d",
                color: cat.quality_tier === "B" ? "#000" : "#fff",
              }}
              title={cat.quality_reason || undefined}
            >
              {cat.quality_tier === "A"
                ? "Verified (Microchip)"
                : cat.quality_tier === "B"
                ? "Clinic ID"
                : cat.quality_tier === "C"
                ? "Other ID"
                : "Name Only"}
            </span>
          )}
        </h1>
        <p className="text-muted text-sm">ID: {cat.cat_id}</p>
      </div>

      {/* Basic Information */}
      <Section
        title="Basic Information"
        onEdit={() => setEditingBasic(true)}
        editMode={editingBasic}
      >
        {editingBasic ? (
          <div>
            <p className="text-muted text-sm">
              Editing not yet implemented. <button onClick={() => setEditingBasic(false)}>Cancel</button>
            </p>
          </div>
        ) : (
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Sex</span>
              <span className="detail-value">{cat.sex || "Unknown"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Altered Status</span>
              <span className="detail-value">
                {cat.altered_status || "Unknown"}
                {cat.altered_status === "Yes" && (
                  <span
                    className="badge"
                    style={{
                      marginLeft: "0.5rem",
                      background: cat.altered_by_clinic ? "#198754" : "#6c757d",
                      color: "#fff",
                      fontSize: "0.7rem",
                    }}
                    title={cat.altered_by_clinic
                      ? "We performed this spay/neuter (billed service item)"
                      : "Already altered or done elsewhere"}
                  >
                    {cat.altered_by_clinic ? "By Clinic" : "Prior/Other"}
                  </span>
                )}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Breed</span>
              <span className="detail-value">{cat.breed || "Unknown"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Color</span>
              <span className="detail-value">{cat.color || "Unknown"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Coat Pattern</span>
              <span className="detail-value">{cat.coat_pattern || "Unknown"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Microchip</span>
              <span className="detail-value" style={{ fontFamily: "monospace" }}>
                {cat.microchip || "None"}
              </span>
            </div>
          </div>
        )}
      </Section>

      {/* Identifiers */}
      {cat.identifiers && cat.identifiers.length > 0 && (
        <Section title="Identifiers">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {cat.identifiers.map((ident, idx) => (
              <div
                key={idx}
                className="identifier-badge"
              >
                <strong>{ident.type}:</strong>{" "}
                <code>{ident.value}</code>
                {ident.source && (
                  <span className="text-muted" style={{ marginLeft: "0.5rem" }}>
                    ({ident.source})
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Owners - Clickable Links */}
      <Section title="People">
        {cat.owners && cat.owners.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {cat.owners.map((owner) => (
              <EntityLink
                key={owner.person_id}
                href={`/people/${owner.person_id}`}
                label={owner.display_name}
                badge={owner.role}
                badgeColor={owner.role === "owner" ? "#0d6efd" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No people linked to this cat.</p>
        )}
      </Section>

      {/* Places - Clickable Links */}
      <Section title="Places">
        {cat.places && cat.places.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {cat.places.map((place) => (
              <EntityLink
                key={place.place_id}
                href={`/places/${place.place_id}`}
                label={place.label}
                badge={place.place_kind || place.role}
                badgeColor={place.role === "residence" ? "#198754" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No places linked to this cat.</p>
        )}
      </Section>

      {/* Clinic History - Who brought this cat to clinic */}
      {cat.clinic_history && cat.clinic_history.length > 0 && (
        <Section title="Clinic History">
          <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
            Who brought this cat to clinic (from ClinicHQ records)
          </p>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Address</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {cat.clinic_history.map((visit, idx) => (
                  <tr key={idx}>
                    <td>{new Date(visit.visit_date).toLocaleDateString()}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{visit.client_name}</div>
                      {visit.client_email && (
                        <div className="text-muted text-sm">{visit.client_email}</div>
                      )}
                      {visit.client_phone && (
                        <div className="text-muted text-sm">{visit.client_phone}</div>
                      )}
                    </td>
                    <td>
                      {visit.client_address || <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {visit.ownership_type && (
                        <span
                          className="badge"
                          style={{
                            background: visit.ownership_type.includes("Feral") ? "#6c757d" : "#0d6efd",
                            color: "#fff",
                            fontSize: "0.7rem",
                          }}
                        >
                          {visit.ownership_type}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Appointments */}
      <Section title="Appointments">
        {appointments.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Provider</th>
                  <th>Client</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appt) => (
                  <tr key={appt.appointment_id}>
                    <td>{new Date(appt.scheduled_date).toLocaleDateString()}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background:
                            appt.status === "completed"
                              ? "#198754"
                              : appt.status === "scheduled"
                              ? "#0d6efd"
                              : appt.status === "cancelled"
                              ? "#dc3545"
                              : "#6c757d",
                        }}
                      >
                        {appt.status}
                      </span>
                    </td>
                    <td>{appt.appointment_type !== "unknown" ? appt.appointment_type : "—"}</td>
                    <td>{appt.provider_name || "—"}</td>
                    <td>
                      {appt.person_id ? (
                        <a href={`/people/${appt.person_id}`}>{appt.person_name}</a>
                      ) : (
                        appt.person_name || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">No appointments found for this cat.</p>
        )}
      </Section>

      {/* Journal / Notes */}
      <Section title="Journal">
        <JournalSection
          entries={journal}
          entityType="cat"
          entityId={id}
          onEntryAdded={fetchJournal}
        />
      </Section>

      {/* Metadata */}
      <Section title="Metadata">
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Data Source</span>
            <span className="detail-value">
              {cat.data_source === "clinichq" ? "ClinicHQ" :
               cat.data_source === "petlink" ? "PetLink (microchip only)" :
               cat.data_source === "legacy_import" ? "Legacy Import" :
               cat.data_source || "Unknown"}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Created</span>
            <span className="detail-value">
              {new Date(cat.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Updated</span>
            <span className="detail-value">
              {new Date(cat.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}
