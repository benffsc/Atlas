"use client";

import { useState, useCallback, ReactNode } from "react";
import { usePersonDetail } from "@/hooks/usePersonDetail";
import { detectRoles, getRoleConfig } from "@/lib/person-roles/configs";
import type { RoleType, SectionDefinition } from "@/lib/person-roles/types";
import { TwoColumnLayout, Section, StatsSidebar, StatRow } from "@/components/layouts";
import { TabBar, TabPanel } from "@/components/ui";
import { TrapperBadge, VolunteerBadge, VerificationBadge, LastVerified } from "@/components/badges";
import { QuickActions, usePersonQuickActionState, EditHistory } from "@/components/common";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { SendEmailModal } from "@/components/modals";
import { BackButton } from "@/components/common";
import { EntityHeader } from "./EntityHeader";
import { SectionRenderer } from "./SectionRenderer";
import { formatDateLocal } from "@/lib/formatters";
import { ContactInfoCard } from "./ContactInfoCard";
import { PlaceResolver } from "@/components/forms";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { postApi } from "@/lib/api-client";
import { isValidPhone, extractPhones, formatPhone } from "@/lib/formatters";

// Import section adapters
import { QuickNotesAdapter } from "./sections/QuickNotesAdapter";
import { ClinicNotesSectionAdapter } from "./sections/ClinicNotesSectionAdapter";
import { LinkedCatsSectionAdapter } from "./sections/LinkedCatsSectionAdapter";
import { LinkedPlacesSectionAdapter } from "./sections/LinkedPlacesSectionAdapter";
import { VerificationSectionAdapter } from "./sections/VerificationSectionAdapter";
import { PhotosSectionAdapter } from "./sections/PhotosSectionAdapter";
import { VolunteerProfileAdapter } from "./sections/VolunteerProfileAdapter";
import { ClinicHistorySectionAdapter } from "./sections/ClinicHistorySectionAdapter";
import { LocationContextAdapter } from "./sections/LocationContextAdapter";
import { RelatedPeopleAdapter } from "./sections/RelatedPeopleAdapter";
import { JournalSectionAdapter } from "./sections/JournalSectionAdapter";
import { RequestsSectionAdapter } from "./sections/RequestsSectionAdapter";
import { SubmissionsSectionAdapter } from "./sections/SubmissionsSectionAdapter";
import { AliasesSectionAdapter } from "./sections/AliasesSectionAdapter";
import { DataSourcesSectionAdapter } from "./sections/DataSourcesSectionAdapter";
import { TrapperStatsCardAdapter } from "./sections/TrapperStatsCardAdapter";
import { TrapperJournalAdapter } from "./sections/TrapperJournalAdapter";
import { FosterOverviewAdapter } from "./sections/FosterOverviewAdapter";
import { FosterCatsAdapter } from "./sections/FosterCatsAdapter";
import { FosterAgreementsAdapter } from "./sections/FosterAgreementsAdapter";

// Import trapper sections
import { PerformanceBannerSection } from "@/components/sections/PerformanceBannerSection";
import { ContractProfileSection } from "@/components/sections/ContractProfileSection";
import { ContractHistorySection } from "@/components/sections/ContractHistorySection";
import { ServiceAreasSection } from "@/components/sections/ServiceAreasSection";
import { ManualCatchesSection } from "@/components/sections/ManualCatchesSection";
import { AssignmentHistorySection } from "@/components/sections/AssignmentHistorySection";
import { ChangeHistorySection } from "@/components/sections/ChangeHistorySection";

/**
 * Section component lookup — maps section IDs to their components.
 */
const SECTION_COMPONENTS: Record<string, React.ComponentType<import("@/lib/person-roles/types").SectionProps>> = {
  // Base sections
  "quick-notes": QuickNotesAdapter,
  "clinic-notes": ClinicNotesSectionAdapter,
  "linked-cats": LinkedCatsSectionAdapter,
  "linked-places": LinkedPlacesSectionAdapter,
  "verification": VerificationSectionAdapter,
  "photos": PhotosSectionAdapter,
  "volunteer-profile": VolunteerProfileAdapter,
  "clinic-history": ClinicHistorySectionAdapter,
  "location-context": LocationContextAdapter,
  "related-people": RelatedPeopleAdapter,
  "journal": JournalSectionAdapter,
  "requests": RequestsSectionAdapter,
  "submissions": SubmissionsSectionAdapter,
  "aliases": AliasesSectionAdapter,
  "data-sources": DataSourcesSectionAdapter,
  // Trapper sections
  "performance-banner": PerformanceBannerSection,
  "contract-profile": ContractProfileSection,
  "contract-history": ContractHistorySection,
  "trapper-stats-card": TrapperStatsCardAdapter,
  "service-areas": ServiceAreasSection,
  "manual-catches": ManualCatchesSection,
  "assignment-history": AssignmentHistorySection,
  "trapper-journal": TrapperJournalAdapter,
  "change-history": ChangeHistorySection,
  // Foster sections
  "foster-overview": FosterOverviewAdapter,
  "foster-cats": FosterCatsAdapter,
  "foster-agreements": FosterAgreementsAdapter,
};

function resolveComponents(sections: SectionDefinition[]): SectionDefinition[] {
  return sections.map(s => ({
    ...s,
    component: SECTION_COMPONENTS[s.id] || s.component,
  }));
}

// Source labels for record info
const SOURCE_LABELS: Record<string, string> = {
  clinichq: "ClinicHQ",
  petlink: "PetLink",
  legacy_import: "Legacy Import",
  volunteerhub: "VolunteerHub",
  airtable: "Airtable",
  web_intake: "Web Intake",
  atlas_ui: "Atlas",
  shelterluv: "ShelterLuv",
};

interface PersonDetailShellProps {
  /** Person UUID */
  id: string;
  /** Pre-select an initial role (affects which tab is shown first and which data is fetched) */
  initialRole?: RoleType;
  /** Back button destination */
  backHref?: string;
}

/**
 * Unified detail page shell for person/trapper detail pages.
 *
 * Uses usePersonDetail for data, getRoleConfig for layout config,
 * and SectionRenderer for content. Both /people/[id] and /trappers/[id]
 * render this component with different initialRole props.
 */
export function PersonDetailShell({
  id,
  initialRole,
  backHref = "/people",
}: PersonDetailShellProps) {
  const data = usePersonDetail(id, { initialRole });
  const preview = useEntityPreviewModal();

  // Determine active tab - trapper tab first if accessed via /trappers
  const roles = detectRoles(data);
  const config = getRoleConfig(roles);
  const resolvedSections = resolveComponents(config.sections);

  const defaultTab = initialRole === "trapper" && config.tabs.some(t => t.id === "trapper")
    ? "trapper"
    : initialRole === "foster" && config.tabs.some(t => t.id === "foster")
    ? "foster"
    : "main";
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Modals
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Edit identifiers modal state
  const [editingIdentifiers, setEditingIdentifiers] = useState(false);
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [savingIdentifiers, setSavingIdentifiers] = useState(false);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [pendingPlace, setPendingPlace] = useState<ResolvedPlace | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);

  const handleDataChange = useCallback((what?: "person" | "journal" | "trapper" | "foster" | "all") => {
    if (what === "person") data.refetchPerson();
    else if (what === "journal") data.refetchJournal();
    else if (what === "trapper") data.refetchTrapperData();
    else if (what === "foster") data.refetchFosterData();
    else data.refetchAll();
  }, [data]);

  // Edit identifiers handlers
  const startEditingIdentifiers = () => {
    if (data.person) {
      const phoneId = data.person.identifiers?.find(i => i.id_type === "phone");
      const emailId = data.person.identifiers?.find(i => i.id_type === "email" && (i.confidence ?? 1) >= 0.5);
      setEditPhone(phoneId?.id_value || "");
      setEditEmail(emailId?.id_value || "");
      setIdentifierError(null);
      setEditingIdentifiers(true);
    }
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
      await data.refetchPerson();
      setEditingIdentifiers(false);
    } catch (err) {
      setIdentifierError(err instanceof Error ? err.message : "Network error while saving");
    } finally {
      setSavingIdentifiers(false);
    }
  };

  const confirmAddressChange = async () => {
    if (!pendingPlace) return;
    setSavingAddress(true);
    try {
      await postApi(`/api/people/${id}/address`, { place_id: pendingPlace.place_id }, { method: "PATCH" });
      await data.refetchPerson();
      setPendingPlace(null);
    } catch (err) {
      console.error("Failed to save address:", err);
    } finally {
      setSavingAddress(false);
    }
  };

  // Loading / Error states
  if (data.loading) {
    return <div className="loading">Loading person details...</div>;
  }

  if (data.error) {
    return (
      <div>
        <BackButton fallbackHref={backHref} />
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{data.error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>Person ID: <code>{id}</code></p>
          {initialRole === "trapper" && (
            <a href={`/people/${id}`} style={{ marginTop: "1rem" }}>View as person record instead</a>
          )}
        </div>
      </div>
    );
  }

  if (!data.person) {
    return <div className="empty">Person not found</div>;
  }

  const person = data.person;

  // Build badges
  const badgeElements: ReactNode[] = [];
  if (data.trapperInfo) {
    badgeElements.push(<TrapperBadge key="trapper" trapperType={data.trapperInfo.trapper_type} />);
  }
  if (data.volunteerRoles?.roles) {
    data.volunteerRoles.roles
      .filter(r => r.role_status === "active" && r.role !== "trapper" && r.role !== "volunteer")
      .forEach(r => {
        badgeElements.push(
          <VolunteerBadge
            key={r.role}
            role={r.role as "foster" | "caretaker" | "staff"}
            groupNames={data.volunteerRoles!.volunteer_groups.active.map(g => g.name)}
            size="md"
          />
        );
      });
  }

  // Build action buttons
  const actionButtons = (
    <>
      {data.primaryEmail && !person.do_not_contact && (
        <button
          onClick={() => setShowEmailModal(true)}
          style={{
            padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent",
            color: "inherit", border: "1px solid var(--border)", borderRadius: "6px",
            display: "inline-flex", alignItems: "center", gap: "0.375rem", cursor: "pointer",
          }}
        >
          <span>&#x2709;&#xFE0F;</span> Email
        </button>
      )}
      <a
        href={`/people/${person.person_id}/print`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent",
          color: "inherit", border: "1px solid var(--border)", borderRadius: "6px",
          textDecoration: "none", display: "inline-flex", alignItems: "center",
        }}
      >
        Print
      </a>
      <button
        onClick={() => setShowHistory(!showHistory)}
        style={{
          padding: "0.25rem 0.75rem", fontSize: "0.875rem",
          background: showHistory ? "var(--primary)" : "transparent",
          color: showHistory ? "white" : "inherit",
          border: showHistory ? "none" : "1px solid var(--border)",
          borderRadius: "6px",
        }}
      >
        History
      </button>
      {initialRole === "trapper" && (
        <>
          <a href={`/people/${id}`} style={{ fontSize: "0.8rem", color: "var(--muted)" }}>View person record</a>
          <a href={`/map?layers=trapper_territories&trapper=${id}`} style={{ fontSize: "0.8rem", color: "var(--muted)" }}>View on Map</a>
        </>
      )}
      {initialRole === "foster" && (
        <a href={`/people/${id}`} style={{ fontSize: "0.8rem", color: "var(--muted)" }}>View person record</a>
      )}
    </>
  );

  // Header
  const headerContent = (
    <EntityHeader
      personId={person.person_id}
      displayName={person.display_name}
      backHref={backHref}
      email={data.primaryEmail}
      phone={data.primaryPhone}
      badges={<>{badgeElements}</>}
      availabilityStatus={data.trapperStats?.availability_status}
      aliases={person.aliases?.map(a => a.name_raw)}
      doNotContact={person.do_not_contact}
      doNotContactReason={person.do_not_contact_reason}
      entityType={person.entity_type}
      allowNameEdit={initialRole !== "trapper"}
      actions={actionButtons}
      onDataChange={() => data.refetchPerson()}
    />
  );

  // Sidebar
  const sidebarContent = (
    <div className="space-y-4">
      <StatsSidebar
        stats={config.stats
          .filter(s => !s.showWhen || s.showWhen(data))
          .map(s => ({
            label: s.label,
            value: s.value(data),
            icon: s.icon,
            href: typeof s.href === "function" ? s.href(data) : s.href,
          }))
        }
        sections={[
          {
            title: "Quick Actions",
            content: (
              <QuickActions
                entityType="person"
                entityId={person.person_id}
                state={usePersonQuickActionState({
                  email: data.primaryEmail,
                  phone: data.primaryPhone,
                  is_trapper: data.isTrapper,
                  cat_count: person.cat_count,
                  request_count: data.requests.length,
                })}
                onActionComplete={() => data.refetchPerson()}
              />
            ),
          },
          {
            title: "Contact",
            content: (
              <div style={{ fontSize: "0.875rem" }}>
                <div style={{ marginBottom: "0.5rem" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.125rem" }}>Address</div>
                  {person.primary_address ? (
                    person.primary_place_id ? (
                      <a href={`/places/${person.primary_place_id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{person.primary_address}</a>
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
                <div style={{ marginBottom: "0.5rem" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.125rem" }}>Phone</div>
                  {data.primaryPhone ? <span>{formatPhone(data.primaryPhone)}</span> : <span className="text-muted">Not available</span>}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.125rem" }}>Email</div>
                  {data.primaryEmail ? <span style={{ wordBreak: "break-all" }}>{data.primaryEmail}</span> : <span className="text-muted">Not available</span>}
                </div>
                <button
                  onClick={startEditingIdentifiers}
                  style={{
                    marginTop: "0.5rem", padding: "0.25rem 0.5rem", fontSize: "0.75rem",
                    background: "transparent", border: "1px solid var(--border)", borderRadius: "4px",
                    cursor: "pointer", width: "100%",
                  }}
                >
                  Edit Contact Info
                </button>
              </div>
            ),
          },
          {
            title: "Verification",
            content: (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <VerificationBadge
                  table="people"
                  recordId={person.person_id}
                  verifiedAt={person.verified_at}
                  verifiedBy={person.verified_by_name}
                  onVerify={() => data.refetchPerson()}
                />
                {person.verified_at && (
                  <LastVerified verifiedAt={person.verified_at} verifiedBy={person.verified_by_name} />
                )}
              </div>
            ),
          },
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
                <StatRow label="Source" value={SOURCE_LABELS[person.data_source || ""] || person.data_source || "Unknown"} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );

  // Tab definitions with counts
  const tabDefs = config.tabs.map(t => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    count: t.count ? t.count(data) : undefined,
  }));

  // Get sections for active tab
  const sectionsForTab = resolvedSections.filter(s => s.tab === activeTab);

  // Main content
  const mainContent = (
    <>
      {/* Tabs */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ padding: "0 1rem" }}>
          <TabBar tabs={tabDefs} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>

      {/* Section content for active tab */}
      <SectionRenderer
        sections={sectionsForTab}
        personId={id}
        data={data}
        onDataChange={handleDataChange}
      />
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
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{
            background: "var(--card-bg, #fff)", borderRadius: "12px", padding: "1.5rem",
            width: "500px", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto",
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
                    <span style={{ color: "#dc3545", marginLeft: "4px", fontWeight: 400 }}>&#x26A0; Invalid</span>
                  )}
                </label>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  <input
                    type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    style={{ flex: 1, minWidth: "140px", border: editPhone && !isValidPhone(editPhone) ? "1px solid #dc3545" : undefined, padding: "0.5rem" }}
                  />
                  {editPhone && !isValidPhone(editPhone) && (() => {
                    const phones = extractPhones(editPhone);
                    if (phones.length === 0) return null;
                    if (phones.length === 1) {
                      return (
                        <button type="button" onClick={() => setEditPhone(phones[0])} style={{
                          padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "#198754", color: "#fff",
                          border: "none", borderRadius: "4px", cursor: "pointer",
                        }} title={`Fix to: ${formatPhone(phones[0])}`}>Fix</button>
                      );
                    }
                    return phones.map((p, i) => (
                      <button key={p} type="button" onClick={() => setEditPhone(p)} style={{
                        padding: "0.25rem 0.5rem", fontSize: "0.7rem", background: i === 0 ? "#198754" : "#0d6efd",
                        color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer",
                      }} title={`Use: ${formatPhone(p)}`}>
                        {i === 0 ? "Primary" : `Alt ${i}`}: {formatPhone(p)}
                      </button>
                    ));
                  })()}
                </div>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Email</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@example.com" style={{ width: "100%", padding: "0.5rem" }} />
              </div>
            </div>

            {/* Address edit */}
            <div style={{ marginBottom: "1rem" }}>
              <label className="text-sm" style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Primary Address</label>
              <PlaceResolver value={pendingPlace} onChange={setPendingPlace} placeholder="Search for an address..." disabled={savingAddress} />
              {pendingPlace && (
                <div style={{ marginTop: "0.75rem", padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--card-bg, #fff)" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-muted)" }}>Confirm Address Change</div>
                  {person.primary_address && (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <span className="text-sm text-muted">Current: </span>
                      <span className="text-sm" style={{ textDecoration: "line-through", opacity: 0.6 }}>{person.primary_address}</span>
                    </div>
                  )}
                  <div style={{ marginBottom: "0.75rem" }}>
                    <span className="text-sm text-muted">New: </span>
                    <span className="text-sm" style={{ fontWeight: 500 }}>{pendingPlace.formatted_address || pendingPlace.display_name}</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button onClick={confirmAddressChange} disabled={savingAddress} style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}>
                      {savingAddress ? "Saving..." : "Confirm"}
                    </button>
                    <button onClick={() => setPendingPlace(null)} disabled={savingAddress} style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem", background: "transparent", border: "1px solid var(--border)" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>Contact info changes are tracked for audit purposes.</p>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={handleSaveIdentifiers} disabled={savingIdentifiers}>{savingIdentifiers ? "Saving..." : "Save Changes"}</button>
              <button onClick={() => { setEditingIdentifiers(false); setIdentifierError(null); }} disabled={savingIdentifiers} style={{ background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit History Panel */}
      {showHistory && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "400px",
          background: "var(--card-bg)", borderLeft: "1px solid var(--border)",
          padding: "1.5rem", overflowY: "auto", zIndex: 100, boxShadow: "-4px 0 10px rgba(0,0,0,0.2)",
        }}>
          <EditHistory entityType="person" entityId={id} limit={50} onClose={() => setShowHistory(false)} />
        </div>
      )}

      {/* Email Modal */}
      <SendEmailModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        defaultTo={data.primaryEmail ?? ""}
        defaultToName={person.display_name}
        personId={person.person_id}
        placeholders={{ first_name: person.display_name?.split(" ")[0] || "" }}
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
