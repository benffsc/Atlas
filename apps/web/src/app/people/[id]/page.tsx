"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { PlaceResolver } from "@/components/forms";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { JournalSection, ClinicHistorySection, ClinicNotesSection, LinkedCatsSection, LinkedPlacesSection } from "@/components/sections";
import type { JournalEntry } from "@/components/sections";
import { QuickNotes, BackButton, EditHistory, EntityLink, QuickActions, usePersonQuickActionState, SubmissionsSection } from "@/components/common";
import { TrapperBadge, VolunteerBadge, VerificationBadge, LastVerified, StatusBadge, PriorityBadge } from "@/components/badges";
import { TrapperStatsCard, PersonPlaceGoogleContext } from "@/components/cards";
import { SendEmailModal } from "@/components/modals";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { MediaGallery } from "@/components/media";
import { TwoColumnLayout, Section, StatsSidebar, StatRow } from "@/components/layouts";
import { TabBar, TabPanel } from "@/components/ui";
import { VerificationPanel } from "@/components/verification";
import { validatePersonName } from "@/lib/validation";
import { formatDateLocal, formatPhone, isValidPhone, extractPhones } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";

interface Cat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
  source_system: string;
  data_source: string;
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

interface PersonIdentifier {
  id_type: string;
  id_value: string;
  source_system: string | null;
  source_table: string | null;
  confidence?: number;
}

interface AssociatedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  source_type: "relationship" | "request" | "intake";
}

interface PersonAlias {
  alias_id: string;
  name_raw: string;
  source_system: string | null;
  source_table: string | null;
  created_at: string;
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
  source_created_at: string | null;
  primary_address_id: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  data_source: string | null;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  data_quality: string | null;
  primary_place_id: string | null;
  identifiers: PersonIdentifier[] | null;
  entity_type: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  associated_places: AssociatedPlace[] | null;
  aliases: PersonAlias[] | null;
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

interface VolunteerRolesData {
  roles: Array<{
    role: string;
    trapper_type: string | null;
    role_status: string;
    source_system: string | null;
    started_at: string | null;
    ended_at: string | null;
    notes: string | null;
  }>;
  volunteer_groups: {
    active: Array<{ name: string; joined_at: string | null }>;
    history: Array<{ name: string; joined_at: string | null; left_at: string | null }>;
  };
  volunteer_profile: {
    hours_logged: number | null;
    event_count: number | null;
    last_activity: string | null;
    last_login: string | null;
    joined: string | null;
    is_active: boolean | null;
    notes: string | null;
    motivation: string | null;
    experience: string | null;
    skills: Record<string, string> | null;
    availability: string | null;
    languages: string | null;
    pronouns: string | null;
    occupation: string | null;
    how_heard: string | null;
    emergency_contact: string | null;
    can_drive: boolean | null;
  } | null;
  operational_summary: {
    trapper_stats: { total_caught: number; active_assignments: number; last_catch: string | null } | null;
    foster_stats: { cats_fostered: number; current_fosters: number };
    places_linked: number;
  };
}

// Human-readable source name mapping
const SOURCE_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  clinichq: { label: "ClinicHQ", bg: "#198754", color: "#fff" },
  petlink: { label: "PetLink", bg: "#0d6efd", color: "#fff" },
  legacy_import: { label: "Legacy Import", bg: "#ffc107", color: "#000" },
  volunteerhub: { label: "VolunteerHub", bg: "#6f42c1", color: "#fff" },
  airtable: { label: "Airtable", bg: "#ff6f00", color: "#fff" },
  web_intake: { label: "Web Intake", bg: "#3b82f6", color: "#fff" },
  atlas_ui: { label: "Atlas", bg: "#374151", color: "#fff" },
  shelterluv: { label: "ShelterLuv", bg: "#e91e63", color: "#fff" },
};

function getSourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  return SOURCE_LABELS[source]?.label || source;
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

// TabNav replaced with shared TabBar component from @/components/ui

export default function PersonDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [requests, setRequests] = useState<RelatedRequest[]>([]);
  const [trapperInfo, setTrapperInfo] = useState<TrapperInfo | null>(null);
  const [volunteerRoles, setVolunteerRoles] = useState<VolunteerRolesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("details");
  const preview = useEntityPreviewModal();

  // Edit mode states
  const [editingContact, setEditingContact] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [pendingPlace, setPendingPlace] = useState<ResolvedPlace | null>(null);

  // Phone/Email edit state
  const [editingIdentifiers, setEditingIdentifiers] = useState(false);
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [savingIdentifiers, setSavingIdentifiers] = useState(false);
  const [identifierError, setIdentifierError] = useState<string | null>(null);

  // Name edit state
  const [editingName, setEditingName] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameWarning, setNameWarning] = useState<string | null>(null);

  // Alias management state
  const [addingAlias, setAddingAlias] = useState(false);
  const [newAliasName, setNewAliasName] = useState("");
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [savingAlias, setSavingAlias] = useState(false);

  // Edit history panel
  const [showHistory, setShowHistory] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const fetchPerson = useCallback(async () => {
    try {
      const data = await fetchApi<PersonDetail>(`/api/people/${id}`);
      setPerson(data);
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("not found")) {
        setError("Person not found");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(`/api/journal?person_id=${id}&limit=50&include_related=true`);
      setJournal(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch journal:", err);
    }
  }, [id]);

  const fetchRequests = useCallback(async () => {
    try {
      const data = await fetchApi<{ requests: RelatedRequest[] }>(`/api/requests?person_id=${id}&limit=10`);
      setRequests(data.requests || []);
    } catch (err) {
      console.error("Failed to fetch requests:", err);
    }
  }, [id]);

  const fetchTrapperInfo = useCallback(async () => {
    try {
      const data = await fetchApi<{ trapper_type: string; is_ffsc_trapper: boolean }>(`/api/people/${id}/trapper-stats`);
      setTrapperInfo({
        trapper_type: data.trapper_type,
        is_ffsc_trapper: data.is_ffsc_trapper,
      });
    } catch {
      setTrapperInfo(null);
    }
  }, [id]);

  const fetchVolunteerRoles = useCallback(async () => {
    try {
      const data = await fetchApi<VolunteerRolesData>(`/api/people/${id}/roles`);
      if (data.roles && data.roles.length > 0) {
        setVolunteerRoles(data);
      } else {
        setVolunteerRoles(null);
      }
    } catch {
      setVolunteerRoles(null);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchPerson(), fetchJournal(), fetchRequests(), fetchTrapperInfo(), fetchVolunteerRoles()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchPerson, fetchJournal, fetchRequests, fetchTrapperInfo, fetchVolunteerRoles]);

  const handlePlaceResolved = (place: ResolvedPlace | null) => {
    setPendingPlace(place);
  };

  const confirmAddressChange = async () => {
    if (!pendingPlace) return;
    setSavingAddress(true);
    try {
      await postApi(`/api/people/${id}/address`, {
        place_id: pendingPlace.place_id,
      }, { method: "PATCH" });
      await fetchPerson();
      setEditingContact(false);
      setPendingPlace(null);
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
      await postApi(`/api/people/${id}/address`, {}, { method: "DELETE" });
      await fetchPerson();
    } catch (err) {
      console.error("Failed to remove address:", err);
    } finally {
      setSavingAddress(false);
    }
  };

  const startEditingIdentifiers = () => {
    if (person) {
      const phoneId = person.identifiers?.find(i => i.id_type === "phone");
      const emailId = person.identifiers?.find(i => i.id_type === "email" && (i.confidence ?? 1) >= 0.5);
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
      await postApi(`/api/people/${id}/identifiers`, {
        phone: editPhone || null,
        email: editEmail || null,
        change_reason: "contact_update",
      }, { method: "PATCH" });

      await fetchPerson();
      setEditingIdentifiers(false);
    } catch (err) {
      setIdentifierError(err instanceof Error ? err.message : "Network error while saving");
    } finally {
      setSavingIdentifiers(false);
    }
  };

  const startEditingName = () => {
    if (person) {
      const name = person.display_name || "";
      const spaceIdx = name.indexOf(" ");
      setEditFirstName(spaceIdx > 0 ? name.substring(0, spaceIdx) : name);
      setEditLastName(spaceIdx > 0 ? name.substring(spaceIdx + 1) : "");
      setNameError(null);
      setNameWarning(null);
      setEditingName(true);
    }
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameError(null);
    setNameWarning(null);
  };

  const handleSaveName = async () => {
    const combinedName = `${editFirstName.trim()} ${editLastName.trim()}`.trim();
    const validation = validatePersonName(combinedName);
    if (!validation.valid) {
      setNameError(validation.error || "Invalid name");
      setNameWarning(null);
      return;
    }

    if (combinedName === person?.display_name) {
      setEditingName(false);
      return;
    }

    setSavingName(true);
    setNameError(null);
    setNameWarning(null);

    try {
      await postApi(`/api/people/${id}`, {
        display_name: combinedName,
        change_reason: "name_correction",
      }, { method: "PATCH" });

      setNameWarning(`Previous name "${person?.display_name}" preserved as alias. Staff can still search by the old name.`);
      await fetchPerson();
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Network error while saving");
    } finally {
      setSavingName(false);
    }
  };

  const handleAddAlias = async () => {
    const name = newAliasName.trim();
    if (!name) return;

    setSavingAlias(true);
    setAliasError(null);

    try {
      await postApi(`/api/people/${id}/aliases`, { name });

      setNewAliasName("");
      setAddingAlias(false);
      await fetchPerson();
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSavingAlias(false);
    }
  };

  const handleDeleteAlias = async (aliasId: string) => {
    try {
      await postApi(`/api/people/${id}/aliases`, { alias_id: aliasId }, { method: "DELETE" });
      await fetchPerson();
    } catch {
      /* optional: alias delete failed, alias remains visible until page refresh */
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

  // Get primary email and phone
  const primaryEmail = person.identifiers?.find(i => i.id_type === "email" && (i.confidence ?? 1) >= 0.5)?.id_value;
  const primaryPhone = person.identifiers?.find(i => i.id_type === "phone")?.id_value;

  // Build header content
  const headerContent = (
    <div>
      <BackButton fallbackHref="/people" />

      <div style={{ marginTop: "1rem" }}>
        {/* Name row with edit */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          {editingName ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  placeholder="First name"
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    padding: "0.25rem 0.5rem",
                    width: "160px",
                  }}
                  autoFocus
                />
                <input
                  type="text"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  placeholder="Last name"
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    padding: "0.25rem 0.5rem",
                    width: "200px",
                  }}
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
              {nameError && (
                <div style={{ color: "#dc3545", fontSize: "0.8rem" }}>{nameError}</div>
              )}
            </div>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{person.display_name}</h1>
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
              {trapperInfo && <TrapperBadge trapperType={trapperInfo.trapper_type} />}
              {volunteerRoles?.roles
                .filter(r => r.role_status === "active" && r.role !== "trapper" && r.role !== "volunteer")
                .map(r => (
                  <VolunteerBadge
                    key={r.role}
                    role={r.role as "foster" | "caretaker" | "staff"}
                    groupNames={volunteerRoles.volunteer_groups.active.map(g => g.name)}
                    size="md"
                  />
                ))
              }
              <EntityTypeBadge entityType={person.entity_type} />
              <DataSourceBadge dataSource={person.data_source} />
            </>
          )}
        </div>

        {/* Aliases */}
        {person.aliases && person.aliases.length > 0 && !editingName && (
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
            Also known as: {person.aliases.map(a => a.name_raw).join(", ")}
          </div>
        )}

        {/* Do Not Contact Warning */}
        {person.do_not_contact && (
          <div style={{
            background: "#dc3545",
            color: "#fff",
            padding: "0.625rem 1rem",
            borderRadius: "6px",
            marginBottom: "0.75rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontWeight: 600,
            fontSize: "0.875rem",
          }}>
            <span style={{ fontSize: "1.1rem" }}>⛔</span>
            <span>DO NOT CONTACT</span>
            {person.do_not_contact_reason && (
              <span style={{ fontWeight: 400, opacity: 0.9 }}>
                — {person.do_not_contact_reason}
              </span>
            )}
          </div>
        )}

        {/* Warnings */}
        {nameWarning && (
          <div style={{ fontSize: "0.8rem", color: "#198754", marginBottom: "0.25rem" }}>
            {nameWarning}
          </div>
        )}
        {person.entity_type === "site" && (
          <p className="text-muted text-sm" style={{ color: "#dc3545", marginBottom: "0.25rem" }}>
            This is a site/location account from ClinicHQ, not a person.
          </p>
        )}
        {person.entity_type === "unknown" && (
          <p className="text-muted text-sm" style={{ color: "#ffc107", marginBottom: "0.25rem" }}>
            This record needs review - may be a site, business, or duplicate entry.
          </p>
        )}

        {/* ID */}
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>ID: {person.person_id}</p>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {primaryEmail && !person.do_not_contact && (
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
              borderRadius: "6px",
            }}
          >
            History
          </button>
        </div>
      </div>
    </div>
  );

  // Build sidebar content
  const sidebarContent = (
    <div className="space-y-4">
      <StatsSidebar
        stats={[
          { label: "Cats", value: person.cat_count, icon: "🐱" },
          { label: "Places", value: person.place_count, icon: "📍" },
          { label: "Requests", value: requests.length, icon: "📋", href: `/requests?person_id=${person.person_id}` },
          ...(volunteerRoles?.volunteer_profile?.hours_logged != null ? [{
            label: "Hours Logged",
            value: volunteerRoles.volunteer_profile.hours_logged,
            icon: "⏱️"
          }] : []),
        ]}
        sections={[
          // Quick Actions
          {
            title: "Quick Actions",
            content: (
              <QuickActions
                entityType="person"
                entityId={person.person_id}
                state={usePersonQuickActionState({
                  email: primaryEmail,
                  phone: primaryPhone,
                  is_trapper: !!trapperInfo,
                  cat_count: person.cat_count,
                  request_count: requests?.length || 0,
                })}
                onActionComplete={fetchPerson}
              />
            ),
          },
          // Contact info
          {
            title: "Contact",
            content: (
              <div style={{ fontSize: "0.875rem" }}>
                {/* Address */}
                <div style={{ marginBottom: "0.5rem" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.125rem" }}>Address</div>
                  {person.primary_address ? (
                    person.primary_place_id ? (
                      <a href={`/places/${person.primary_place_id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>
                        {person.primary_address}
                      </a>
                    ) : (
                      <span>{person.primary_address}</span>
                    )
                  ) : person.associated_places && person.associated_places.length > 0 ? (
                    <a href={`/places/${person.associated_places[0].place_id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>
                      {person.associated_places[0].formatted_address || person.associated_places[0].display_name || "Unknown"}
                      <span className="text-muted" style={{ fontSize: "0.75rem", marginLeft: "0.25rem" }}>(inferred)</span>
                    </a>
                  ) : (
                    <span className="text-muted">No address set</span>
                  )}
                </div>

                {/* Phone */}
                <div style={{ marginBottom: "0.5rem" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.125rem" }}>Phone</div>
                  {primaryPhone ? (
                    <span>{formatPhone(primaryPhone)}</span>
                  ) : (
                    <span className="text-muted">Not available</span>
                  )}
                </div>

                {/* Email */}
                <div style={{ marginBottom: "0.5rem" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.125rem" }}>Email</div>
                  {primaryEmail ? (
                    <span style={{ wordBreak: "break-all" }}>{primaryEmail}</span>
                  ) : (
                    <span className="text-muted">Not available</span>
                  )}
                </div>

                <button
                  onClick={startEditingIdentifiers}
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  Edit Contact Info
                </button>
              </div>
            ),
          },
          // Verification
          {
            title: "Verification",
            content: (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
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
              </div>
            ),
          },
          // Record info
          {
            title: "Record Info",
            content: (
              <div style={{ fontSize: "0.875rem" }}>
                <StatRow label="First Seen" value={formatDateLocal(
                  person.source_created_at && person.created_at
                    ? (person.source_created_at < person.created_at ? person.source_created_at : person.created_at)
                    : person.source_created_at || person.created_at
                )} />
                <StatRow label="Created" value={formatDateLocal(person.created_at)} />
                <StatRow label="Updated" value={formatDateLocal(person.updated_at)} />
                <StatRow label="Source" value={getSourceLabel(person.data_source)} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );

  // Transform cats for LinkedCatsSection
  const catsForSection = person.cats?.map(c => ({
    cat_id: c.cat_id,
    cat_name: c.cat_name,
    relationship_type: c.relationship_type,
    microchip: c.microchip,
    altered_status: null,
    linked_at: person.created_at,
  })) || [];

  // Transform places for LinkedPlacesSection
  const placesForSection = (person.associated_places || person.places || []).map(p => {
    if ('source_type' in p) {
      const ap = p as AssociatedPlace;
      return {
        place_id: ap.place_id,
        display_name: ap.display_name,
        formatted_address: ap.formatted_address,
        place_kind: ap.place_kind,
        relationship_type: ap.source_type,
        is_primary: person.primary_address_id ? ap.formatted_address === person.primary_address : false,
      };
    } else {
      const pl = p as Place;
      return {
        place_id: pl.place_id,
        display_name: pl.place_name,
        formatted_address: pl.formatted_address,
        place_kind: pl.place_kind,
        relationship_type: pl.role,
        is_primary: false,
      };
    }
  });

  // Build main content
  const mainContent = (
    <>
      {/* Staff Quick Notes */}
      <div style={{ marginBottom: "1.5rem" }}>
        <QuickNotes
          entityType="person"
          entityId={person.person_id}
          entries={journal}
          onNoteAdded={fetchJournal}
        />
      </div>

      {/* ClinicHQ Notes (elevated for quick access) */}
      <ClinicNotesSection personId={id} />

      {/* Trapper Stats (if trapper) */}
      {trapperInfo && (
        <Section title="Trapper Statistics" className="mb-4">
          <TrapperStatsCard personId={id} compact />
        </Section>
      )}

      {/* Volunteer Profile (if volunteer) */}
      {volunteerRoles && (volunteerRoles.volunteer_profile || volunteerRoles.volunteer_groups.active.length > 0) && (
        <Section title="Volunteer Profile" className="mb-4">
          {/* Role badges */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            {volunteerRoles.roles
              .filter(r => r.role_status === "active")
              .map(r => {
                if (r.role === "trapper") return null;
                if (r.role === "volunteer") return (
                  <VolunteerBadge key={r.role} role="volunteer" size="md"
                    groupNames={volunteerRoles.volunteer_groups.active.map(g => g.name)} />
                );
                return (
                  <VolunteerBadge key={r.role} role={r.role as "foster" | "caretaker" | "staff"} size="md"
                    groupNames={volunteerRoles.volunteer_groups.active.map(g => g.name)} />
                );
              })
            }
            {volunteerRoles.volunteer_profile?.is_active === false && (
              <span style={{ fontSize: "0.75rem", color: "#dc2626", fontWeight: 500 }}>Inactive</span>
            )}
          </div>

          {/* Active Groups */}
          {volunteerRoles.volunteer_groups.active.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Active Groups</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {volunteerRoles.volunteer_groups.active.map(g => (
                  <span key={g.name} style={{
                    display: "inline-block", padding: "0.2rem 0.5rem", fontSize: "0.75rem",
                    background: "var(--bg-secondary)", borderRadius: "9999px", color: "var(--text-primary)"
                  }}>
                    {g.name}
                    {g.joined_at && <span style={{ color: "var(--text-muted)", marginLeft: "0.25rem" }}>
                      ({new Date(g.joined_at).toLocaleDateString()})
                    </span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Activity stats */}
          {volunteerRoles.volunteer_profile && (
            <div className="detail-grid" style={{ marginBottom: "1rem" }}>
              {volunteerRoles.volunteer_profile.event_count != null && (
                <div className="detail-item">
                  <span className="detail-label">Events</span>
                  <span className="detail-value">{volunteerRoles.volunteer_profile.event_count}</span>
                </div>
              )}
              {volunteerRoles.volunteer_profile.joined && (
                <div className="detail-item">
                  <span className="detail-label">Member Since</span>
                  <span className="detail-value">{formatDateLocal(volunteerRoles.volunteer_profile.joined)}</span>
                </div>
              )}
              {volunteerRoles.volunteer_profile.last_activity && (
                <div className="detail-item">
                  <span className="detail-label">Last Activity</span>
                  <span className="detail-value">{formatDateLocal(volunteerRoles.volunteer_profile.last_activity)}</span>
                </div>
              )}
            </div>
          )}

          {/* Skills/Interests */}
          {volunteerRoles.volunteer_profile?.skills && Object.keys(volunteerRoles.volunteer_profile.skills).length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Skills &amp; Interests</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {Object.entries(volunteerRoles.volunteer_profile.skills)
                  .filter(([, v]) => v && v !== "false" && v !== "No")
                  .map(([key, value]) => (
                    <span key={key} style={{
                      display: "inline-block", padding: "0.2rem 0.5rem", fontSize: "0.7rem",
                      background: "#f0fdf4", color: "#166534", borderRadius: "9999px", border: "1px solid #bbf7d0",
                    }} title={String(value)}>
                      {key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  ))
                }
              </div>
            </div>
          )}

          {/* Notes */}
          {volunteerRoles.volunteer_profile?.notes && (
            <div style={{ padding: "0.75rem", background: "var(--bg-secondary)", borderRadius: "6px", fontSize: "0.85rem" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Volunteer Notes</div>
              {volunteerRoles.volunteer_profile.notes}
            </div>
          )}
        </Section>
      )}

      {/* Cats */}
      <Section
        title={`Cats${person.cat_count > 0 ? ` (${person.cat_count})` : ""}`}
        className="mb-4"
      >
        {catsForSection.length > 0 ? (
          <>
            <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
              <span style={{ color: "#198754", fontWeight: 500 }}>ClinicHQ</span> = actual clinic patient,{" "}
              <span style={{ color: "var(--muted)" }}>PetLink</span> = microchip only
            </p>
            <LinkedCatsSection cats={catsForSection} context="person" emptyMessage="No cats linked" onEntityClick={(t, id) => preview.open(t as "cat", id)} compact />
          </>
        ) : (
          <p className="text-muted">No cats linked to this person.</p>
        )}
      </Section>

      {/* Places */}
      <Section
        title={`Places${person.place_count > 0 ? ` (${person.place_count})` : ""}`}
        className="mb-4"
      >
        <LinkedPlacesSection
          places={placesForSection}
          context="person"
          emptyMessage="No places linked"
          showCount={false}
          title=""
          onEntityClick={(t, id) => preview.open(t as "place", id)}
          compact
        />
      </Section>

      {/* Verification Panel */}
      <Section title="Verification Status" className="mb-4" defaultCollapsed>
        <VerificationPanel
          personId={id}
          personName={person.display_name}
        />
      </Section>

      {/* Photos */}
      <Section title="Photos" className="mb-4" defaultCollapsed>
        <MediaGallery
          entityType="person"
          entityId={id}
          allowUpload={true}
          includeRelated={true}
          defaultMediaType="site_photo"
        />
      </Section>

      {/* Bottom Tabs */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <div style={{ padding: "0 1rem" }}>
          <TabBar
            tabs={[
              { id: "details", label: "Details", icon: "📋" },
              { id: "history", label: "History", icon: "📜", count: requests.length },
              { id: "admin", label: "Admin", icon: "⚙️" },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>

        <div style={{ padding: "1rem" }}>
          <TabPanel tabId="details" activeTab={activeTab}>
              {/* Clinic History */}
              <ClinicHistorySection personId={id} onCatPreview={(catId) => preview.open("cat", catId)} />

              {/* Location Context */}
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
                        onClick={preview.handleClick("person", rel.person_id)}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Journal & Communications */}
              <Section title="Journal & Communications">
                <JournalSection
                  entries={journal}
                  entityType="person"
                  entityId={id}
                  onEntryAdded={fetchJournal}
                />
              </Section>
          </TabPanel>

          <TabPanel tabId="history" activeTab={activeTab}>
              {/* Related Requests */}
              <Section title="Requests">
                {requests.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {requests.map((req) => (
                      <a
                        key={req.request_id}
                        href={`/requests/${req.request_id}`}
                        onClick={preview.handleClick("request", req.request_id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.75rem 1rem",
                          background: "var(--card-bg)",
                          borderRadius: "8px",
                          textDecoration: "none",
                          color: "inherit",
                          border: "1px solid var(--border)",
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
          </TabPanel>

          <TabPanel tabId="admin" activeTab={activeTab}>
              {/* Previous Names / Aliases */}
              <Section title="Previous Names">
                {person.aliases && person.aliases.length > 0 ? (
                  <table style={{ width: "100%", fontSize: "0.875rem" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "0.5rem 0" }}>Name</th>
                        <th style={{ padding: "0.5rem 0" }}>Source</th>
                        <th style={{ padding: "0.5rem 0" }}>Date</th>
                        <th style={{ padding: "0.5rem 0", width: "60px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {person.aliases.map((alias) => {
                        const sourceLabel = alias.source_table === "name_change" ? "Name Change" :
                          alias.source_table === "manual_alias" ? "Manual" :
                          alias.source_system || "System";
                        return (
                          <tr key={alias.alias_id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "0.5rem 0" }}>{alias.name_raw}</td>
                            <td style={{ padding: "0.5rem 0" }}>
                              <span className="badge" style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}>
                                {sourceLabel}
                              </span>
                            </td>
                            <td style={{ padding: "0.5rem 0" }} className="text-muted">
                              {formatDateLocal(alias.created_at)}
                            </td>
                            <td style={{ padding: "0.5rem 0" }}>
                              <button
                                onClick={() => handleDeleteAlias(alias.alias_id)}
                                style={{
                                  padding: "0.125rem 0.375rem",
                                  fontSize: "0.7rem",
                                  background: "transparent",
                                  border: "1px solid var(--border)",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  color: "#dc3545",
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-muted text-sm">No previous names recorded.</p>
                )}
                <div style={{ marginTop: "0.75rem" }}>
                  {addingAlias ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <input
                        type="text"
                        value={newAliasName}
                        onChange={(e) => setNewAliasName(e.target.value)}
                        placeholder="Enter previous name"
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.875rem", width: "200px" }}
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && handleAddAlias()}
                      />
                      <button
                        onClick={handleAddAlias}
                        disabled={savingAlias || !newAliasName.trim()}
                        style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}
                      >
                        {savingAlias ? "Saving..." : "Add"}
                      </button>
                      <button
                        onClick={() => { setAddingAlias(false); setAliasError(null); setNewAliasName(""); }}
                        style={{
                          padding: "0.25rem 0.75rem",
                          fontSize: "0.8rem",
                          background: "transparent",
                          border: "1px solid var(--border)",
                        }}
                      >
                        Cancel
                      </button>
                      {aliasError && (
                        <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{aliasError}</span>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingAlias(true)}
                      style={{
                        padding: "0.25rem 0.75rem",
                        fontSize: "0.8rem",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      + Add Previous Name
                    </button>
                  )}
                </div>
              </Section>

              {/* Data Sources */}
              {person.identifiers && person.identifiers.length > 0 && (
                <Section title="Data Sources">
                  <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
                    This person record was seeded from these sources:
                  </p>
                  <table style={{ width: "100%", fontSize: "0.875rem" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "0.5rem 0" }}>Type</th>
                        <th style={{ padding: "0.5rem 0" }}>Value</th>
                        <th style={{ padding: "0.5rem 0" }}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {person.identifiers.map((pid, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "0.5rem 0" }}>
                            <span className="badge" style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}>
                              {pid.id_type}
                            </span>
                          </td>
                          <td style={{ padding: "0.5rem 0" }}>{pid.id_type === "phone" ? formatPhone(pid.id_value) : pid.id_value}</td>
                          <td style={{ padding: "0.5rem 0" }} className="text-muted">
                            {pid.source_system ? `${pid.source_system}${pid.source_table ? `.${pid.source_table}` : ""}` : "Unknown"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}
          </TabPanel>
        </div>
      </div>
    </>
  );

  return (
    <>
      <TwoColumnLayout
        header={headerContent}
        main={mainContent}
        sidebar={sidebarContent}
        sidebarWidth="35%"
      />

      {/* Edit Identifiers Modal */}
      {editingIdentifiers && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "var(--card-bg, #fff)",
            borderRadius: "12px",
            padding: "1.5rem",
            width: "500px",
            maxWidth: "90vw",
            maxHeight: "90vh",
            overflow: "auto",
          }}>
            <h3 style={{ margin: "0 0 1rem 0" }}>Edit Contact Information</h3>

            {identifierError && (
              <div style={{ color: "#dc3545", marginBottom: "0.75rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", fontSize: "0.875rem" }}>
                {identifierError}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                  Phone
                  {editPhone && !isValidPhone(editPhone) && (
                    <span style={{ color: "#dc3545", marginLeft: "4px", fontWeight: 400 }}>⚠ Invalid</span>
                  )}
                </label>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    style={{
                      flex: 1,
                      minWidth: "140px",
                      border: editPhone && !isValidPhone(editPhone) ? "1px solid #dc3545" : undefined,
                      padding: "0.5rem",
                    }}
                  />
                  {editPhone && !isValidPhone(editPhone) && (() => {
                    const phones = extractPhones(editPhone);
                    if (phones.length === 0) return null;
                    if (phones.length === 1) {
                      return (
                        <button
                          type="button"
                          onClick={() => setEditPhone(phones[0])}
                          style={{
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.75rem",
                            background: "#198754",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                          title={`Fix to: ${formatPhone(phones[0])}`}
                        >
                          Fix
                        </button>
                      );
                    }
                    return phones.map((p, i) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setEditPhone(p)}
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.7rem",
                          background: i === 0 ? "#198754" : "#0d6efd",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                        title={`Use: ${formatPhone(p)}`}
                      >
                        {i === 0 ? "Primary" : `Alt ${i}`}: {formatPhone(p)}
                      </button>
                    ));
                  })()}
                </div>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="email@example.com"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            </div>

            {/* Address edit */}
            <div style={{ marginBottom: "1rem" }}>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Primary Address
              </label>
              <PlaceResolver
                value={pendingPlace}
                onChange={handlePlaceResolved}
                placeholder="Search for an address..."
                disabled={savingAddress}
              />
              {pendingPlace && (
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
                      {pendingPlace.formatted_address || pendingPlace.display_name}
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
                      onClick={() => setPendingPlace(null)}
                      disabled={savingAddress}
                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent", border: "1px solid var(--border)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
          </div>
        </div>
      )}

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
        defaultTo={primaryEmail ?? ""}
        defaultToName={person.display_name}
        personId={person.person_id}
        placeholders={{
          first_name: person.display_name?.split(" ")[0] || "",
        }}
      />

      {/* Entity Preview Modal */}
      <EntityPreviewModal
        isOpen={preview.isOpen}
        onClose={preview.close}
        entityType={preview.entityType}
        entityId={preview.entityId}
      />
    </>
  );
}
