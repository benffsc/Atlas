"use client";

import { useState } from "react";
import { usePlaceDetail } from "@/hooks/usePlaceDetail";
import { JournalSection, ObservationsSection, PlaceLinksSection, DiseaseStatusSection, ClinicHistorySection, ClinicNotesSection, LinkedPeopleSection, LinkedCatsSection } from "@/components/sections";
import { BackButton, EditHistory, SubmissionsSection } from "@/components/common";
import { AddressAutocomplete, PlaceContextEditor } from "@/components/forms";
import { PlaceAlterationHistory, CatPresenceReconciliation } from "@/components/admin";
import { ColonyEstimates, PopulationTrendChart, PopulationTimeline, TemporalTrendChart, PopulationEstimateCard } from "@/components/charts";
import { PlaceReadinessCard } from "@/components/place/PlaceReadinessCard";
import { HistoricalContextCard, SiteStatsCard } from "@/components/cards";
import { VerificationBadge, LastVerified, StatusBadge, PriorityBadge } from "@/components/badges";
import { CreateColonyModal } from "@/components/modals";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { MediaGallery } from "@/components/media";
import { Section } from "@/components/layouts";
import { TabBar, TabPanel } from "@/components/ui";
import { AssociatedPeopleCard } from "@/components/verification";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { useNavigationContext } from "@/hooks/useNavigationContext";
import { formatDateLocal, formatPhone, formatRelativeTime } from "@/lib/formatters";
import { fetchApi, postApi, ApiError } from "@/lib/api-client";
import { formatPlaceKind } from "@/lib/display-labels";
import { useToast } from "@/components/feedback/Toast";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { PlaceKindBadge, ContextBadge, PLACE_KINDS } from "./helpers";

interface PlaceDetailShellProps {
  id: string;
}

export function PlaceDetailShell({ id }: PlaceDetailShellProps) {
  const { addToast } = useToast();
  const data = usePlaceDetail(id);
  const preview = useEntityPreviewModal();
  const navContext = useNavigationContext(data.place?.display_name);

  const [activeTab, setActiveTab] = useState("overview");

  // Edit modes
  const [editingDetails, setEditingDetails] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPlaceKind, setEditPlaceKind] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Address correction mode
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeNotes, setChangeNotes] = useState("");

  // Suggest type confirm dialog
  const [showSuggestConfirm, setShowSuggestConfirm] = useState(false);
  const [suggestedKind, setSuggestedKind] = useState<string | null>(null);
  const [suggestMessage, setSuggestMessage] = useState("");

  // Panels
  const [showHistory, setShowHistory] = useState(false);
  const [showColonyModal, setShowColonyModal] = useState(false);

  const startEditing = () => {
    if (data.place) {
      setEditDisplayName(data.place.display_name);
      setEditPlaceKind(data.place.place_kind || "unknown");
      setSaveError(null);
      setEditingDetails(true);
    }
  };

  const handleSaveDetails = async () => {
    if (!data.place) return;
    setSaving(true);
    setSaveError(null);
    try {
      await postApi(`/api/places/${id}`, { display_name: editDisplayName, place_kind: editPlaceKind }, { method: "PATCH" });
      await data.fetchPlace();
      setEditingDetails(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  const startAddressCorrection = () => {
    setChangeReason(""); setChangeNotes(""); setAddressInput(""); setSaveError(null); setEditingAddress(true);
  };

  interface PlaceDetails {
    place_id: string;
    formatted_address: string;
    name: string;
    geometry: { location: { lat: number; lng: number } };
    address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
  }

  const handleAddressSelect = async (placeDetails: PlaceDetails) => {
    if (!data.place || !changeReason) {
      setSaveError("Please select a reason for this address correction");
      return;
    }
    setSaving(true); setSaveError(null);
    const locality = placeDetails.address_components.find(c => c.types.includes("locality"))?.long_name || null;
    const postal_code = placeDetails.address_components.find(c => c.types.includes("postal_code"))?.long_name || null;
    const state = placeDetails.address_components.find(c => c.types.includes("administrative_area_level_1"))?.short_name || null;
    try {
      await postApi(`/api/places/${id}`, {
        formatted_address: placeDetails.formatted_address, locality, postal_code, state_province: state,
        latitude: placeDetails.geometry.location.lat, longitude: placeDetails.geometry.location.lng,
        change_reason: changeReason, change_notes: changeNotes,
      }, { method: "PATCH" });
      await data.fetchPlace();
      setEditingAddress(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  // Loading / Error states
  if (data.loading) return <div className="loading">Loading place details...</div>;
  if (data.error) {
    return (
      <div>
        <BackButton fallbackHref="/places" />
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ color: "#dc3545" }}>{data.error}</h2>
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>Place ID: <code>{id}</code></p>
        </div>
      </div>
    );
  }
  if (!data.place) return <div className="empty">Place not found</div>;

  const place = data.place;

  const peopleForSection = place.people?.map(p => ({
    person_id: p.person_id, display_name: p.person_name, relationship_type: p.role, confidence: p.confidence,
  })) || [];

  /* Place detail — single column layout */

  const placeTabDefs = [
    { id: "overview", label: "Overview" },
    { id: "connections", label: "Connections", count: (place.cats?.length || 0) + (peopleForSection.length) || undefined },
    { id: "clinic", label: "Clinic Records" },
    { id: "requests", label: "Requests", count: data.requests.length || undefined },
    { id: "ecology", label: "Ecology" },
    { id: "media", label: "Media" },
  ];

  const mainContent = (
    <div>
      {/* Tab Bar */}
      <div style={{ marginBottom: "1.5rem" }}>
        <TabBar tabs={placeTabDefs} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* ── Overview Tab ── */}
      <TabPanel tabId="overview" activeTab={activeTab}>
        {/* Record Info + Location side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
          <Section title="Record Info">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Address</div>
                <div style={{ fontWeight: 500 }}>{place.formatted_address || "Not set"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>City</div>
                <div style={{ fontWeight: 500 }}>{place.locality || "Unknown"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>ZIP</div>
                <div style={{ fontWeight: 500 }}>{place.postal_code || "\u2014"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Geocoded</div>
                <div style={{ fontWeight: 500 }}>{place.is_address_backed ? "Yes" : "Approximate"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Created</div>
                <div style={{ fontWeight: 500 }}>{formatDateLocal(place.created_at)}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.1rem" }}>Updated</div>
                <div style={{ fontWeight: 500 }}>{formatDateLocal(place.updated_at)}</div>
              </div>
            </div>
          </Section>

          <Section title="Context">
            <PlaceContextEditor placeId={place.place_id} address={place.formatted_address || undefined} onContextChange={() => data.fetchPlace()} />
            <div style={{ marginTop: "0.75rem" }}>
              <PlaceLinksSection placeId={place.place_id} placeName={place.display_name || place.formatted_address || "This place"} />
            </div>
          </Section>
        </div>

        {/* Partner Org (if applicable) */}
        {place.partner_org && (
          <Section title="Partner Organization">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Organization</div>
                <div style={{ fontWeight: 600 }}>{place.partner_org.org_name}</div>
              </div>
              {place.partner_org.appointments_count != null && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Appointments</div>
                  <div style={{ fontWeight: 600 }}>{place.partner_org.appointments_count.toLocaleString()}</div>
                </div>
              )}
              {place.partner_org.cats_processed != null && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Cats Processed</div>
                  <div style={{ fontWeight: 600 }}>{place.partner_org.cats_processed.toLocaleString()}</div>
                </div>
              )}
              {place.partner_org.contact_name && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Contact</div>
                  <div style={{ fontWeight: 500 }}>{place.partner_org.contact_name}</div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Journal */}
        <Section title="Journal">
          <JournalSection entries={data.journal} entityType="place" entityId={id} onEntryAdded={data.fetchJournal} />
        </Section>
      </TabPanel>

      {/* ── Connections Tab ── */}
      <TabPanel tabId="connections" activeTab={activeTab}>
        <LinkedCatsSection
          cats={place.cats?.map(cat => ({ cat_id: cat.cat_id, cat_name: cat.cat_name, relationship_type: cat.relationship_type }))}
          context="place" compact
          onEntityClick={(entityType, entityId) => preview.open(entityType as "cat", entityId)}
        />
        <LinkedPeopleSection people={peopleForSection} context="place" title="People" emptyMessage="No people linked to this place."
          onEntityClick={(t, entityId) => preview.open(t as "person", entityId)} compact />
        <Section title="People Verification" collapsible defaultCollapsed>
          <AssociatedPeopleCard placeId={place.place_id} placeName={place.display_name || place.formatted_address || undefined} />
        </Section>
      </TabPanel>

      {/* ── Clinic Records Tab ── */}
      <TabPanel tabId="clinic" activeTab={activeTab}>
        <ClinicNotesSection placeId={place.place_id} />
        <ClinicHistorySection placeId={place.place_id} onCatPreview={(catId) => preview.open("cat", catId)} />
      </TabPanel>

      {/* ── Requests Tab ── */}
      <TabPanel tabId="requests" activeTab={activeTab}>
        {place.cats && place.cats.length > 0 && <CatPresenceReconciliation placeId={place.place_id} onUpdate={() => data.fetchPlace()} />}
        <Section title="Related Requests">
          {data.requests.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {data.requests.map(req => (
                <a key={req.request_id} href={`/requests/${req.request_id}`} onClick={preview.handleClick("request", req.request_id)}
                  style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", background: "var(--card-bg, #f8f9fa)", borderRadius: "8px", textDecoration: "none", color: "inherit", border: "1px solid var(--border, #dee2e6)" }}>
                  <StatusBadge status={req.status} />
                  <PriorityBadge priority={req.priority} />
                  <span style={{ flex: 1, fontWeight: 500 }}>{req.summary || "No summary"}</span>
                  <span className="text-muted text-sm">{formatDateLocal(req.created_at)}</span>
                </a>
              ))}
            </div>
          ) : (
            <div>
              <p className="text-muted">No requests for this place yet.</p>
              <a href={`/requests/new?place_id=${place.place_id}`} style={{ display: "inline-block", marginTop: "0.5rem", padding: "0.5rem 1rem", background: "var(--foreground)", color: "var(--background)", borderRadius: "6px", textDecoration: "none" }}>+ Create Request</a>
            </div>
          )}
        </Section>
        <Section title="Website Submissions" collapsible defaultCollapsed>
          <SubmissionsSection entityType="place" entityId={id} />
        </Section>
      </TabPanel>

      {/* ── Ecology Tab ── */}
      <TabPanel tabId="ecology" activeTab={activeTab}>
        <Section title="Monthly TNR Trends"><TemporalTrendChart placeId={id} months={24} /></Section>
        <Section title="Population Estimate"><PopulationEstimateCard placeId={id} /></Section>
        <Section title="TNR Readiness"><PlaceReadinessCard placeId={id} /></Section>
        <Section title="Lifecycle Events"><PopulationTimeline placeId={id} /></Section>
        <Section title="Site Observations"><ObservationsSection placeId={id} placeName={place.display_name || place.formatted_address || "This location"} /></Section>
        <HistoricalContextCard placeId={id} className="mt-4" />
        <Section title="FFR Activity" collapsible defaultCollapsed><PlaceAlterationHistory placeId={id} /></Section>
        <Section title="Activity Trend" collapsible defaultCollapsed><PopulationTrendChart placeId={id} /></Section>
      </TabPanel>

      {/* ── Media Tab ── */}
      <TabPanel tabId="media" activeTab={activeTab}>
        <Section title="Photos">
          <MediaGallery entityType="place" entityId={place.place_id} allowUpload={true} includeRelated={true} defaultMediaType="site_photo" allowedMediaTypes={["site_photo", "evidence"]} />
        </Section>
      </TabPanel>
    </div>
  );

  return (
    <>
      <div style={{ maxWidth: 1100 }}>
        {/* Breadcrumbs + Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <Breadcrumbs items={navContext.breadcrumbs.length > 0 ? navContext.breadcrumbs : [{ label: "Places", href: "/places" }, { label: place.display_name }]} />
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            <button onClick={startEditing} style={{ padding: "0.4rem 1rem", fontSize: "0.85rem", fontWeight: 600, background: "var(--primary)", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}>Edit</button>
            {place.coordinates && (
              <a href={`/map?lat=${place.coordinates.lat}&lng=${place.coordinates.lng}&zoom=17`} style={{ padding: "0.4rem 0.75rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", textDecoration: "none", color: "inherit" }}>Map</a>
            )}
            <button onClick={() => setShowHistory(!showHistory)} title="History" style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}>{"\u22EE"}</button>
          </div>
        </div>

        {/* Hero Card */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{place.display_name}</h1>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
              <PlaceKindBadge kind={place.place_kind} />
              {place.contexts?.map((ctx) => <ContextBadge key={ctx.context_id} context={ctx} />)}
              {place.has_cat_activity && (
                <span className="badge" style={{ background: "#dcfce7", color: "#166534", fontSize: "0.7rem" }}>Cat Activity</span>
              )}
            </div>
          </div>
          {place.formatted_address && place.formatted_address !== place.display_name && (
            <p style={{ margin: "0 0 1rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>{place.formatted_address}</p>
          )}

          {/* Attribute grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Cats</div>
              <div style={{ fontWeight: 600 }}>{place.cat_count}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>People</div>
              <div style={{ fontWeight: 600 }}>{place.person_count}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Requests</div>
              <div style={{ fontWeight: 600 }}>{data.requests.length}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>City</div>
              <div style={{ fontWeight: 600 }}>{place.locality || "\u2014"}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Last Visit</div>
              <div style={{ fontWeight: 600 }}>{place.last_appointment_date ? formatDateLocal(place.last_appointment_date) : "\u2014"}</div>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        {/* Tabs are inside mainContent — render it directly */}
        {mainContent}
      </div>

      {showHistory && (
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "400px", background: "var(--card-bg)", borderLeft: "1px solid var(--border)", padding: "1.5rem", overflowY: "auto", zIndex: 100, boxShadow: "-4px 0 10px rgba(0,0,0,0.2)" }}>
          <EditHistory entityType="place" entityId={id} limit={50} onClose={() => setShowHistory(false)} />
        </div>
      )}

      <CreateColonyModal isOpen={showColonyModal} onClose={() => setShowColonyModal(false)} placeId={place.place_id} staffName={undefined}
        onSuccess={(result) => { setShowColonyModal(false); addToast({ type: "success", message: `Colony "${result.colony_name}" created successfully!` }); }} />

      <EntityPreviewModal isOpen={preview.isOpen} onClose={preview.close} entityType={preview.entityType} entityId={preview.entityId} />

      <ConfirmDialog
        open={showSuggestConfirm}
        title="Apply Suggested Type?"
        message={suggestMessage}
        confirmLabel="Apply"
        variant="default"
        onConfirm={() => {
          if (suggestedKind) setEditPlaceKind(suggestedKind);
          setShowSuggestConfirm(false);
          setSuggestedKind(null);
        }}
        onCancel={() => {
          setShowSuggestConfirm(false);
          setSuggestedKind(null);
        }}
      />
    </>
  );
}
