"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import JournalSection, { JournalEntry } from "@/components/JournalSection";
import { BackButton } from "@/components/BackButton";
import { EditHistory } from "@/components/EditHistory";
import { TrapperBadge } from "@/components/TrapperBadge";
import { TrapperStatsCard } from "@/components/TrapperStatsCard";
import { SubmissionsSection } from "@/components/SubmissionsSection";
import { EntityLink } from "@/components/EntityLink";
import { VerificationBadge, LastVerified } from "@/components/VerificationBadge";
import { PersonPlaceGoogleContext } from "@/components/GoogleMapContextCard";
import { QuickActions, usePersonQuickActionState } from "@/components/QuickActions";
import { formatDateLocal } from "@/lib/formatters";
import { SendEmailModal } from "@/components/SendEmailModal";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { ProfileLayout } from "@/components/ProfileLayout";

interface Cat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
  source_system: string;
  data_source: string; // clinichq, petlink, or legacy_import
  microchip: string | null;
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

interface AssociatedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  source_type: "relationship" | "request" | "intake";
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
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  associated_places: AssociatedPlace[] | null;
}

interface RelatedRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  created_at: string;
  place_name: string | null;
}

interface TrapperInfo {
  trapper_type: string;
  is_ffsc_trapper: boolean;
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

export default function PersonDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [requests, setRequests] = useState<RelatedRequest[]>([]);
  const [trapperInfo, setTrapperInfo] = useState<TrapperInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode states
  const [editingContact, setEditingContact] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [pendingAddress, setPendingAddress] = useState<PlaceDetails | null>(null);

  // Phone/Email edit state
  const [editingIdentifiers, setEditingIdentifiers] = useState(false);
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [savingIdentifiers, setSavingIdentifiers] = useState(false);
  const [identifierError, setIdentifierError] = useState<string | null>(null);

  // Name edit state
  const [editingName, setEditingName] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Edit history panel
  const [showHistory, setShowHistory] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);

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

  const fetchTrapperInfo = useCallback(async () => {
    try {
      const response = await fetch(`/api/people/${id}/trapper-stats`);
      if (response.ok) {
        const data = await response.json();
        setTrapperInfo({
          trapper_type: data.trapper_type,
          is_ffsc_trapper: data.is_ffsc_trapper,
        });
      } else {
        setTrapperInfo(null);
      }
    } catch (err) {
      // Not a trapper, or error - just ignore
      setTrapperInfo(null);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchPerson(), fetchJournal(), fetchRequests(), fetchTrapperInfo()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchPerson, fetchJournal, fetchRequests, fetchTrapperInfo]);

  const handlePlaceSelect = (place: PlaceDetails) => {
    setPendingAddress(place);
  };

  const confirmAddressChange = async () => {
    if (!pendingAddress) return;
    setSavingAddress(true);
    try {
      const response = await fetch(`/api/people/${id}/address`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_place_id: pendingAddress.place_id,
          formatted_address: pendingAddress.formatted_address,
          lat: pendingAddress.geometry.location.lat,
          lng: pendingAddress.geometry.location.lng,
          address_components: pendingAddress.address_components,
        }),
      });

      if (response.ok) {
        await fetchPerson();
        setEditingContact(false);
        setAddressInput("");
        setPendingAddress(null);
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

  const startEditingIdentifiers = () => {
    if (person) {
      // Get current phone/email from identifiers
      const phoneId = person.identifiers?.find(i => i.id_type === "phone");
      const emailId = person.identifiers?.find(i => i.id_type === "email");
      setEditPhone(phoneId?.id_value || "");
      setEditEmail(emailId?.id_value || "");
      setIdentifierError(null);
      setEditingIdentifiers(true);
    }
  };

  const cancelEditingIdentifiers = () => {
    setEditingIdentifiers(false);
    setIdentifierError(null);
  };

  const handleSaveIdentifiers = async () => {
    setSavingIdentifiers(true);
    setIdentifierError(null);

    try {
      const response = await fetch(`/api/people/${id}/identifiers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: editPhone || null,
          email: editEmail || null,
          change_reason: "contact_update",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setIdentifierError(result.error || "Failed to save changes");
        return;
      }

      // Refresh person data
      await fetchPerson();
      setEditingIdentifiers(false);
    } catch (err) {
      setIdentifierError("Network error while saving");
    } finally {
      setSavingIdentifiers(false);
    }
  };

  const startEditingName = () => {
    if (person) {
      setEditDisplayName(person.display_name || "");
      setNameError(null);
      setEditingName(true);
    }
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameError(null);
  };

  const handleSaveName = async () => {
    if (!editDisplayName.trim()) {
      setNameError("Name cannot be empty");
      return;
    }

    setSavingName(true);
    setNameError(null);

    try {
      const response = await fetch(`/api/people/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editDisplayName.trim(),
          change_reason: "name_correction",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setNameError(result.error || "Failed to save name");
        return;
      }

      // Refresh person data
      await fetchPerson();
      setEditingName(false);
    } catch (err) {
      setNameError("Network error while saving");
    } finally {
      setSavingName(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading person details...</div>;
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/people" />
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

  const profileHeader = (
    <div>
      <BackButton fallbackHref="/people" />

      {/* Header */}
      <div className="detail-header" style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          {editingName ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
              <input
                type="text"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder="Enter name"
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  padding: "0.25rem 0.5rem",
                  width: "300px",
                }}
                autoFocus
              />
              <button
                onClick={handleSaveName}
                disabled={savingName}
                style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
              >
                {savingName ? "Saving..." : "Save"}
              </button>
              <button
                onClick={cancelEditingName}
                disabled={savingName}
                style={{
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.875rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h1 style={{ margin: 0 }}>{person.display_name}</h1>
              <button
                onClick={startEditingName}
                style={{
                  padding: "0.125rem 0.5rem",
                  fontSize: "0.75rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
                title="Edit name"
              >
                Edit
              </button>
            </>
          )}
          {!editingName && (
            <>
              {trapperInfo && <TrapperBadge trapperType={trapperInfo.trapper_type} />}
              <EntityTypeBadge entityType={person.entity_type} />
              <DataSourceBadge dataSource={person.data_source} />
            </>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            {person.identifiers?.some(i => i.id_type === "email") && (
              <button
                onClick={() => setShowEmailModal(true)}
                style={{
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.875rem",
                  background: "transparent",
                  color: "inherit",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  cursor: "pointer",
                }}
              >
                <span>✉️</span>
                Email
              </button>
            )}
            <a
              href={`/people/${person.person_id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.875rem",
                background: "transparent",
                color: "inherit",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Print
            </a>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.875rem",
                background: showHistory ? "var(--primary)" : "transparent",
                color: showHistory ? "white" : "inherit",
                border: showHistory ? "none" : "1px solid var(--border)",
              }}
            >
              History
            </button>
          </div>
        </div>
        {nameError && (
          <div style={{ color: "#dc3545", marginTop: "0.5rem", fontSize: "0.875rem" }}>
            {nameError}
          </div>
        )}
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
    </div>
  );

  const overviewTab = (
    <>
      {/* Quick Actions */}
      <div className="card" style={{ padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
        <QuickActions
          entityType="person"
          entityId={person.person_id}
          state={usePersonQuickActionState({
            email: person.identifiers?.find((i) => i.id_type === "email")?.id_value,
            phone: person.identifiers?.find((i) => i.id_type === "phone")?.id_value,
            is_trapper: !!trapperInfo,
            cat_count: person.cat_count,
            request_count: requests?.length || 0,
          })}
          onActionComplete={fetchPerson}
        />
      </div>

      {/* Trapper Stats (if person is a trapper) */}
      {trapperInfo && (
        <Section title="Trapper Statistics">
          <TrapperStatsCard personId={id} compact />
        </Section>
      )}

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
              {formatDateLocal(person.created_at)}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Updated</span>
            <span className="detail-value">
              {formatDateLocal(person.updated_at)}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Verification</span>
            <span className="detail-value" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <VerificationBadge
                table="people"
                recordId={person.person_id}
                verifiedAt={person.verified_at}
                verifiedBy={person.verified_by_name}
                onVerify={() => fetchPerson()}
              />
              {person.verified_at && (
                <LastVerified verifiedAt={person.verified_at} verifiedBy={person.verified_by_name} />
              )}
            </span>
          </div>
        </div>
      </Section>

      {/* Contact Info - with edit button */}
      <Section
        title="Contact Information"
        onEdit={startEditingIdentifiers}
        editMode={editingIdentifiers}
      >
        {editingIdentifiers ? (
          <div>
            {identifierError && (
              <div style={{ color: "#dc3545", marginBottom: "0.75rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", fontSize: "0.875rem" }}>
                {identifierError}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Phone</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="email@example.com"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
              Contact info changes are tracked for audit purposes.
            </p>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={handleSaveIdentifiers} disabled={savingIdentifiers}>
                {savingIdentifiers ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={cancelEditingIdentifiers}
                disabled={savingIdentifiers}
                style={{ background: "transparent", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>

            {/* Address section */}
            <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Primary Address
              </label>
              <AddressAutocomplete
                value={addressInput}
                onChange={setAddressInput}
                onPlaceSelect={handlePlaceSelect}
                placeholder="Search for an address..."
                disabled={savingAddress || !!pendingAddress}
              />
              {pendingAddress && (
                <div style={{
                  marginTop: "0.75rem",
                  padding: "0.75rem",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-muted)" }}>
                    Confirm Address Change
                  </div>
                  {person.primary_address && (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <span className="text-sm text-muted">Current: </span>
                      <span className="text-sm" style={{ textDecoration: "line-through", opacity: 0.6 }}>
                        {person.primary_address}
                      </span>
                    </div>
                  )}
                  <div style={{ marginBottom: "0.75rem" }}>
                    <span className="text-sm text-muted">New: </span>
                    <span className="text-sm" style={{ fontWeight: 500 }}>
                      {pendingAddress.formatted_address}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={confirmAddressChange}
                      disabled={savingAddress}
                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
                    >
                      {savingAddress ? "Saving..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => { setPendingAddress(null); setAddressInput(""); }}
                      disabled={savingAddress}
                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent", border: "1px solid var(--border)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {savingAddress && !pendingAddress && (
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>Saving...</p>
              )}
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
                {person.identifiers.filter(i => i.id_type === "phone").map((pid, idx) => (
                  <div className="detail-item" key={`phone-${idx}`}>
                    <span className="detail-label">
                      Phone
                      {pid.source_system && (
                        <span className="text-muted" style={{ fontSize: "0.7rem", marginLeft: "0.25rem" }}>
                          ({pid.source_system})
                        </span>
                      )}
                    </span>
                    <span className="detail-value">{pid.id_value}</span>
                  </div>
                ))}
                {person.identifiers.filter(i => i.id_type === "email").map((eid, idx) => (
                  <div className="detail-item" key={`email-${idx}`}>
                    <span className="detail-label">
                      Email
                      {eid.source_system && (
                        <span className="text-muted" style={{ fontSize: "0.7rem", marginLeft: "0.25rem" }}>
                          ({eid.source_system})
                        </span>
                      )}
                    </span>
                    <span className="detail-value">{eid.id_value}</span>
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
    </>
  );

  const connectionsTab = (
    <>
      {/* Cats */}
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
                  sublabel={cat.microchip || undefined}
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

      {/* Associated Places */}
      <Section title="Associated Places">
        {(() => {
          const places = person.associated_places || person.places;
          if (!places || places.length === 0) {
            return <p className="text-muted">No places linked to this person.</p>;
          }

          const sourceLabels: Record<string, { label: string; color: string }> = {
            relationship: { label: "via relationship", color: "#6c757d" },
            request: { label: "via request", color: "#198754" },
            intake: { label: "via intake", color: "#3b82f6" },
          };

          // Use associated_places if available (has source_type), otherwise fall back to places
          if (person.associated_places && person.associated_places.length > 0) {
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                {person.associated_places.map((ap) => {
                  const src = sourceLabels[ap.source_type] || sourceLabels.relationship;
                  const isPrimary = person.primary_address_id &&
                    ap.formatted_address === person.primary_address;
                  return (
                    <EntityLink
                      key={`${ap.place_id}-${ap.source_type}`}
                      href={`/places/${ap.place_id}`}
                      label={ap.display_name || ap.formatted_address || "Unknown"}
                      sublabel={
                        (ap.locality ? `${ap.locality} — ` : "") + src.label +
                        (isPrimary ? " (Primary)" : "")
                      }
                      badge={ap.place_kind || undefined}
                      badgeColor={src.color}
                    />
                  );
                })}
              </div>
            );
          }

          // Fallback: legacy places array from v_person_detail
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {(person.places as Place[]).map((place) => (
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
          );
        })()}
      </Section>

      {/* Location Context from Google Maps */}
      <PersonPlaceGoogleContext personId={id} className="mt-4" />

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
    </>
  );

  const activityTab = (
    <>
      {/* Related Requests */}
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
                  {formatDateLocal(req.created_at)}
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

      {/* Website Submissions */}
      <Section title="Website Submissions">
        <SubmissionsSection entityType="person" entityId={id} />
      </Section>

      {/* Journal / Notes */}
      <Section title="Journal">
        <JournalSection
          entries={journal}
          entityType="person"
          entityId={id}
          onEntryAdded={fetchJournal}
        />
      </Section>
    </>
  );

  const dataTab = (
    <>
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
              {person.identifiers.map((pid, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "0.5rem 0" }}>
                    <span className="badge" style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}>
                      {pid.id_type}
                    </span>
                  </td>
                  <td style={{ padding: "0.5rem 0" }}>{pid.id_value}</td>
                  <td style={{ padding: "0.5rem 0" }} className="text-muted">
                    {pid.source_system ? `${pid.source_system}${pid.source_table ? `.${pid.source_table}` : ""}` : "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );

  const connectionCount = (person.cat_count || 0) + (person.place_count || 0);

  return (
    <ProfileLayout
      header={profileHeader}
      defaultTab="overview"
      tabs={[
        { id: "overview", label: "Overview", content: overviewTab },
        { id: "connections", label: "Connections", content: connectionsTab, badge: connectionCount || undefined },
        { id: "activity", label: "Activity", content: activityTab, badge: requests.length || undefined },
        { id: "data", label: "Data", content: dataTab, show: !!(person.identifiers && person.identifiers.length > 0) },
      ]}
    >
      {/* Edit History Panel */}
      {showHistory && (
        <div style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "400px",
          background: "var(--card-bg)",
          borderLeft: "1px solid var(--border)",
          padding: "1.5rem",
          overflowY: "auto",
          zIndex: 100,
          boxShadow: "-4px 0 10px rgba(0,0,0,0.2)"
        }}>
          <EditHistory
            entityType="person"
            entityId={id}
            limit={50}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}

      {/* Email Modal */}
      <SendEmailModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        defaultTo={person.identifiers?.find(i => i.id_type === "email")?.id_value || ""}
        defaultToName={person.display_name}
        personId={person.person_id}
        placeholders={{
          first_name: person.display_name?.split(" ")[0] || "",
        }}
      />
    </ProfileLayout>
  );
}
