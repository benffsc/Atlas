"use client";

import { useState } from "react";
import { usePlaceDetail } from "@/hooks/usePlaceDetail";
import { JournalSection, ObservationsSection, PlaceLinksSection, DiseaseStatusSection, ClinicHistorySection, ClinicNotesSection, LinkedPeopleSection, LinkedCatsSection } from "@/components/sections";
import { QuickNotes, BackButton, EditHistory, QuickActions, usePlaceQuickActionState, SubmissionsSection } from "@/components/common";
import { AddressAutocomplete, PlaceContextEditor } from "@/components/forms";
import { PlaceAlterationHistory, CatPresenceReconciliation } from "@/components/admin";
import { ColonyEstimates, PopulationTrendChart, PopulationTimeline, TemporalTrendChart, PopulationEstimateCard } from "@/components/charts";
import { PlaceReadinessCard } from "@/components/place/PlaceReadinessCard";
import { HistoricalContextCard, SiteStatsCard } from "@/components/cards";
import { VerificationBadge, LastVerified, StatusBadge, PriorityBadge } from "@/components/badges";
import { CreateColonyModal } from "@/components/modals";
import { EntityPreviewModal } from "@/components/search";
import { useEntityPreviewModal } from "@/hooks/useEntityPreviewModal";
import { MediaGallery, HeroGallery } from "@/components/media";
import { TwoColumnLayout, Section, StatsSidebar, StatRow } from "@/components/layouts";
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

  const [activeTab, setActiveTab] = useState("details");

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

  const handleSetHero = async (mediaId: string) => {
    try {
      await postApi(`/api/media/${mediaId}/hero`, {}, { method: "PATCH" });
      await data.fetchHeroMedia();
    } catch (err) {
      console.error("Failed to set hero:", err);
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

  /* ── Header ── */
  const headerContent = (
    <div>
      {navContext.breadcrumbs.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}><Breadcrumbs items={navContext.breadcrumbs} /></div>
      )}
      <BackButton fallbackHref={navContext.backHref} />
      <div style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{place.display_name}</h1>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <PlaceKindBadge kind={place.place_kind} />
            {place.contexts?.map((ctx) => <ContextBadge key={ctx.context_id} context={ctx} />)}
            {place.has_cat_activity && (
              <span className="badge" style={{ background: "#dcfce7", color: "#166534", fontSize: "0.7rem" }}>Cat Activity</span>
            )}
          </div>
        </div>
        {place.formatted_address && place.formatted_address !== place.display_name && (
          <p className="text-muted" style={{ margin: "0.5rem 0 0 0" }}>{place.formatted_address}</p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
          {place.coordinates && (
            <a href={`/map?lat=${place.coordinates.lat}&lng=${place.coordinates.lng}&zoom=17`}
              style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", background: "#6366f1", color: "white", border: "none", borderRadius: "6px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              {"\uD83D\uDCCD"} View on Map
            </a>
          )}
          <a href={`/places/${place.place_id}/print`} target="_blank" rel="noopener noreferrer"
            style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", background: "transparent", color: "inherit", border: "1px solid var(--border)", borderRadius: "6px", textDecoration: "none" }}>
            Print
          </a>
          <button onClick={() => setShowColonyModal(true)}
            style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", background: "transparent", color: "#059669", border: "1px solid #059669", borderRadius: "6px", cursor: "pointer" }}>
            Create Colony
          </button>
          <button onClick={() => setShowHistory(!showHistory)}
            style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", background: showHistory ? "var(--primary)" : "transparent", color: showHistory ? "white" : "inherit", border: showHistory ? "none" : "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}>
            History
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Sidebar ── */
  const sidebarContent = (
    <div className="space-y-4">
      <StatsSidebar
        stats={[
          { label: "Cats", value: place.cat_count, icon: "\uD83D\uDC31", href: "#cats" },
          { label: "People", value: place.person_count, icon: "\uD83D\uDC64" },
          { label: "Requests", value: data.requests.length, icon: "\uD83D\uDCCB", href: `/requests?place_id=${place.place_id}` },
        ]}
        sections={[{
          title: "Quick Actions",
          content: (
            <QuickActions entityType="place" entityId={place.place_id}
              state={usePlaceQuickActionState({ lat: place.coordinates?.lat, lng: place.coordinates?.lng, request_count: data.requests.length, cat_count: place.cat_count, colony_estimate: null, last_observation_days: null })}
              onActionComplete={data.fetchPlace} />
          ),
        }]}
      />
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b"><h4 className="text-sm font-semibold text-gray-900">Colony Size</h4></div>
        <div className="p-4"><ColonyEstimates placeId={id} /></div>
      </div>
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b"><h4 className="text-sm font-semibold text-gray-900">Disease Status</h4></div>
        <div className="p-4"><DiseaseStatusSection placeId={place.place_id} onStatusChange={data.fetchPlace} /></div>
      </div>
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b"><h4 className="text-sm font-semibold text-gray-900">TNR Progress</h4></div>
        <div className="p-4"><SiteStatsCard placeId={place.place_id} /></div>
      </div>
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b"><h4 className="text-sm font-semibold text-gray-900">Location</h4></div>
        <div className="p-4">
          <StatRow label="City" value={place.locality || "Unknown"} />
          <StatRow label="ZIP" value={place.postal_code || "\u2014"} />
          <StatRow label="Geocoded" value={place.is_address_backed ? "Yes" : "Approx"} />
          {place.coordinates && (
            <div className="text-xs text-gray-500 mt-2 font-mono">{place.coordinates.lat.toFixed(5)}, {place.coordinates.lng.toFixed(5)}</div>
          )}
        </div>
      </div>
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b"><h4 className="text-sm font-semibold text-gray-900">Verification</h4></div>
        <div className="p-4">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <VerificationBadge table="places" recordId={place.place_id} verifiedAt={place.verified_at} verifiedBy={place.verified_by_name} onVerify={() => data.fetchPlace()} />
            {place.verified_at && <LastVerified verifiedAt={place.verified_at} verifiedBy={place.verified_by_name} />}
          </div>
        </div>
      </div>
      {place.last_appointment_date && (
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 border-b"><h4 className="text-sm font-semibold text-gray-900">Activity</h4></div>
          <div className="p-4">
            <StatRow label="Last Clinic Visit" value={formatRelativeTime(place.last_appointment_date) || "\u2014"} />
            <StatRow label="Last Visit Date" value={formatDateLocal(place.last_appointment_date)} />
          </div>
        </div>
      )}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b"><h4 className="text-sm font-semibold text-gray-900">Record Info</h4></div>
        <div className="p-4">
          <StatRow label="First Seen" value={formatDateLocal(place.source_created_at || place.created_at)} />
          <StatRow label="Created" value={formatDateLocal(place.created_at)} />
          <StatRow label="Updated" value={formatDateLocal(place.updated_at)} />
          <div className="text-xs text-gray-500 mt-2 font-mono break-all">{place.place_id}</div>
        </div>
      </div>
    </div>
  );

  /* ── Main content ── */
  const mainContent = (
    <div>
      <QuickNotes entityType="place" entityId={place.place_id} entries={data.journal} onNoteAdded={data.fetchJournal} />
      <ClinicNotesSection placeId={place.place_id} />

      {/* Partner Org Profile */}
      {place.partner_org && (
        <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem", borderLeft: "4px solid #0dcaf0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
            <div>
              <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "0.25rem" }}>Partner Organization</div>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{place.partner_org.org_name}</h3>
              {place.partner_org.org_name_short && place.partner_org.org_name_short !== place.partner_org.org_name && (
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{place.partner_org.org_name_short}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {place.partner_org.org_type && <span className="badge" style={{ fontSize: "0.7em", background: "var(--bg-secondary)" }}>{formatPlaceKind(place.partner_org.org_type)}</span>}
            </div>
          </div>
          {(place.partner_org.appointments_count || place.partner_org.cats_processed) && (
            <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
              {place.partner_org.appointments_count != null && <div><span style={{ fontWeight: 600 }}>{place.partner_org.appointments_count.toLocaleString()}</span><span style={{ color: "var(--muted)", marginLeft: "0.25rem" }}>appointments</span></div>}
              {place.partner_org.cats_processed != null && <div><span style={{ fontWeight: 600 }}>{place.partner_org.cats_processed.toLocaleString()}</span><span style={{ color: "var(--muted)", marginLeft: "0.25rem" }}>cats processed</span></div>}
            </div>
          )}
          {(place.partner_org.first_appointment_date || place.partner_org.last_appointment_date) && (
            <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
              {place.partner_org.first_appointment_date && <div><span style={{ color: "var(--muted)" }}>First:</span> {formatDateLocal(place.partner_org.first_appointment_date)}</div>}
              {place.partner_org.last_appointment_date && <div><span style={{ color: "var(--muted)" }}>Last:</span> {formatDateLocal(place.partner_org.last_appointment_date)}</div>}
            </div>
          )}
          {(place.partner_org.contact_name || place.partner_org.contact_email || place.partner_org.contact_phone) && (
            <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.85rem", flexWrap: "wrap" }}>
              {place.partner_org.contact_name && <div><span style={{ color: "var(--muted)" }}>Contact:</span> {place.partner_org.contact_name}</div>}
              {place.partner_org.contact_email && <a href={`mailto:${place.partner_org.contact_email}`} style={{ color: "var(--primary)" }}>{place.partner_org.contact_email}</a>}
              {place.partner_org.contact_phone && <a href={`tel:${place.partner_org.contact_phone}`} style={{ color: "var(--primary)" }}>{formatPhone(place.partner_org.contact_phone)}</a>}
            </div>
          )}
          <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
            <a href={`/admin/partner-orgs/${place.partner_org.org_id}`} style={{ fontSize: "0.8rem", color: "var(--primary)" }}>View full organization profile</a>
          </div>
        </div>
      )}

      {data.heroMedia.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <HeroGallery media={data.heroMedia} onSetHero={handleSetHero} onViewAll={() => setActiveTab("media")} />
        </div>
      )}

      <LinkedCatsSection
        cats={place.cats?.map(cat => ({ cat_id: cat.cat_id, cat_name: cat.cat_name, relationship_type: cat.relationship_type }))}
        context="place" compact
        onEntityClick={(entityType, entityId) => preview.open(entityType as "cat", entityId)}
      />
      <LinkedPeopleSection people={peopleForSection} context="place" title="People" emptyMessage="No people linked to this place."
        onEntityClick={(t, entityId) => preview.open(t as "person", entityId)} compact />
      <Section title="People Verification" collapsible defaultCollapsed className="mb-4">
        <AssociatedPeopleCard placeId={place.place_id} placeName={place.display_name || place.formatted_address || undefined} />
      </Section>
      <ClinicHistorySection placeId={place.place_id} onCatPreview={(catId) => preview.open("cat", catId)} />
      <div style={{ marginBottom: "1.5rem" }}>
        <PlaceContextEditor placeId={place.place_id} address={place.formatted_address || undefined} onContextChange={() => data.fetchPlace()} />
      </div>
      <Section title="Linked Places" collapsible defaultCollapsed>
        <PlaceLinksSection placeId={place.place_id} placeName={place.display_name || place.formatted_address || "This place"} />
      </Section>

      {/* Tabs */}
      <div style={{ marginTop: "2rem" }}>
        <TabBar
          tabs={[
            { id: "details", label: "Details", icon: "\uD83D\uDCCB" },
            { id: "requests", label: "Requests", icon: "\uD83D\uDCE8", count: data.requests.length },
            { id: "ecology", label: "Ecology", icon: "\uD83C\uDF3F" },
            { id: "media", label: "Media", icon: "\uD83D\uDCF7" },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <TabPanel tabId="details" activeTab={activeTab}>
          <Section title="Location Details">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
              {!editingDetails && <button onClick={startEditing} style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}>Edit</button>}
            </div>
            {editingDetails ? (
              <div>
                {place.is_address_backed && (
                  <div style={{ padding: "0.75rem 1rem", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "6px", marginBottom: "1rem", color: "#856404" }}>
                    <strong>Note:</strong> This place has a verified Google address. You can change the display name and type, but the underlying address data will remain linked.
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Display Name / Label</label>
                    <input type="text" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} placeholder="e.g., Old Stony Point, Mrs. Johnson's House" style={{ width: "100%", maxWidth: "400px" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Place Type</label>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <select value={editPlaceKind} onChange={(e) => setEditPlaceKind(e.target.value)} style={{ minWidth: "200px" }}>
                        {PLACE_KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                      </select>
                      <button type="button" onClick={async () => {
                        try {
                          const suggestData = await fetchApi<{ suggested_kind: string | null; confidence: number; reason: string }>(`/api/places/${place.place_id}/suggest-type`);
                          if (suggestData.suggested_kind) {
                            setSuggestedKind(suggestData.suggested_kind);
                            setSuggestMessage(`Suggestion: ${formatPlaceKind(suggestData.suggested_kind)} (${Math.round(suggestData.confidence * 100)}% confidence)\n\nReason: ${suggestData.reason}`);
                            setShowSuggestConfirm(true);
                          } else { addToast({ type: "warning", message: "No suggestion available." }); }
                        } catch { addToast({ type: "error", message: "Failed to get suggestion" }); }
                      }} style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}>
                        Suggest Type
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Address</label>
                    <p style={{ margin: 0 }}>{place.formatted_address || "No address set"}</p>
                    {!editingAddress ? (
                      <button onClick={startAddressCorrection} style={{ marginTop: "0.5rem", padding: "0.25rem 0.5rem", fontSize: "0.8rem", background: "transparent", border: "1px solid var(--border)" }}>Correct Address</button>
                    ) : (
                      <div style={{ marginTop: "0.75rem", padding: "1rem", background: "#fff8f5", border: "1px solid #e65100", borderRadius: "8px" }}>
                        <p style={{ marginTop: 0, marginBottom: "0.75rem", fontWeight: 500, color: "#e65100" }}>Address Correction</p>
                        <div style={{ marginBottom: "0.75rem" }}>
                          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Reason for correction *</label>
                          <select value={changeReason} onChange={(e) => setChangeReason(e.target.value)} style={{ width: "100%" }}>
                            <option value="">Select a reason...</option>
                            <option value="location_clarified">Location clarified</option>
                            <option value="data_entry_error">Data entry error</option>
                            <option value="refinement">Address refinement</option>
                            <option value="correction">General correction</option>
                          </select>
                        </div>
                        <div style={{ marginBottom: "0.75rem" }}>
                          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>New Address</label>
                          <AddressAutocomplete value={addressInput} onChange={setAddressInput} onPlaceSelect={handleAddressSelect} placeholder="Search for the correct address..." disabled={saving} />
                        </div>
                        <div style={{ marginBottom: "0.75rem" }}>
                          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Notes (optional)</label>
                          <textarea value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} placeholder="Explain what you learned..." rows={2} style={{ width: "100%", resize: "vertical" }} />
                        </div>
                        <button onClick={() => setEditingAddress(false)} disabled={saving} style={{ background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                  {saveError && <div style={{ color: "#dc3545" }}>{saveError}</div>}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <button onClick={handleSaveDetails} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
                    <button onClick={() => { setEditingDetails(false); setSaveError(null); }} disabled={saving} style={{ background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="detail-grid">
                <div className="detail-item"><span className="detail-label">Address</span><span className="detail-value">{place.formatted_address || "Not set"}</span></div>
                <div className="detail-item"><span className="detail-label">City</span><span className="detail-value">{place.locality || "Unknown"}</span></div>
                <div className="detail-item"><span className="detail-label">Postal Code</span><span className="detail-value">{place.postal_code || "Unknown"}</span></div>
                <div className="detail-item"><span className="detail-label">State</span><span className="detail-value">{place.state_province || "Unknown"}</span></div>
              </div>
            )}
          </Section>
          <Section title="Journal">
            <JournalSection entries={data.journal} entityType="place" entityId={id} onEntryAdded={data.fetchJournal} />
          </Section>
        </TabPanel>

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
                {data.requests.length >= 10 && <a href={`/requests?place_id=${place.place_id}`} className="text-sm" style={{ marginTop: "0.5rem" }}>View all requests...</a>}
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

        <TabPanel tabId="media" activeTab={activeTab}>
          <Section title="Photos">
            <MediaGallery entityType="place" entityId={place.place_id} allowUpload={true} includeRelated={true} defaultMediaType="site_photo" allowedMediaTypes={["site_photo", "evidence"]} />
          </Section>
        </TabPanel>
      </div>
    </div>
  );

  return (
    <>
      <TwoColumnLayout header={headerContent} main={mainContent} sidebar={sidebarContent} />

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
