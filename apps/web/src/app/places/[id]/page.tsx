"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, usePathname } from "next/navigation";
import JournalSection, { JournalEntry } from "@/components/JournalSection";
import QuickNotes from "@/components/QuickNotes";
import { BackButton } from "@/components/BackButton";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import { EditHistory } from "@/components/EditHistory";
import { PlaceAlterationHistory } from "@/components/PlaceAlterationHistory";
import { ColonyEstimates } from "@/components/ColonyEstimates";
import { PopulationTrendChart } from "@/components/PopulationTrendChart";
import { PopulationTimeline } from "@/components/PopulationTimeline";
import { HistoricalContextCard } from "@/components/HistoricalContextCard";
import ObservationsSection from "@/components/ObservationsSection";
import { SubmissionsSection } from "@/components/SubmissionsSection";
import { EntityLink } from "@/components/EntityLink";
import { PlaceLinksSection } from "@/components/PlaceLinksSection";
import { SiteStatsCard } from "@/components/SiteStatsCard";
import { VerificationBadge, LastVerified } from "@/components/VerificationBadge";
import { formatDateLocal, formatPhone } from "@/lib/formatters";
import { MediaGallery } from "@/components/MediaGallery";
import { HeroGallery } from "@/components/HeroGallery";
import { MediaItem } from "@/components/MediaUploader";
import { QuickActions, usePlaceQuickActionState } from "@/components/QuickActions";
import { CatPresenceReconciliation } from "@/components/CatPresenceReconciliation";
import { CreateColonyModal } from "@/components/CreateColonyModal";
import { PlaceContextEditor } from "@/components/PlaceContextEditor";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import DiseaseStatusSection from "@/components/DiseaseStatusSection";
import ClinicHistorySection from "@/components/ClinicHistorySection";
import { TwoColumnLayout, Section, StatsSidebar, StatRow } from "@/components/layouts";
import { LinkedPeopleSection } from "@/components/LinkedPeopleSection";

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

interface PlaceContext {
  context_id: string;
  context_type: string;
  context_label: string;
  valid_from: string | null;
  evidence_type: string | null;
  confidence: number;
  is_verified: boolean;
  assigned_at: string;
  source_system: string | null;
  organization_name?: string | null;
  known_org_id?: string | null;
  known_org_name?: string | null;
}

interface PartnerOrgInfo {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  org_type: string | null;
  relationship_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  appointments_count: number | null;
  cats_processed: number | null;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
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
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  contexts?: PlaceContext[];
  partner_org?: PartnerOrgInfo | null;
}

interface RelatedRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  created_at: string;
  requester_name: string | null;
}

// Tab navigation component
function TabNav({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: { id: string; label: string; badge?: number }[];
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <div style={{
      display: "flex",
      gap: "0.25rem",
      borderBottom: "1px solid var(--border)",
      marginBottom: "1.5rem",
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            padding: "0.75rem 1rem",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
            color: activeTab === tab.id ? "var(--foreground)" : "var(--muted)",
            fontWeight: activeTab === tab.id ? 600 : 400,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span
              className="badge"
              style={{
                fontSize: "0.7rem",
                padding: "0.1rem 0.4rem",
                background: activeTab === tab.id ? "var(--primary)" : "#6c757d",
              }}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// Place kind badge component
function PlaceKindBadge({ kind }: { kind: string | null | undefined }) {
  if (!kind || kind === "unknown") return null;

  const kindConfig: Record<string, { label: string; bg: string; color: string }> = {
    residential_house: { label: "House", bg: "#dcfce7", color: "#166534" },
    single_family: { label: "House", bg: "#dcfce7", color: "#166534" },
    apartment_unit: { label: "Unit", bg: "#dbeafe", color: "#1d4ed8" },
    apartment_building: { label: "Apts", bg: "#e0e7ff", color: "#4338ca" },
    mobile_home: { label: "Mobile", bg: "#ede9fe", color: "#7c3aed" },
    mobile_home_space: { label: "Mobile", bg: "#ede9fe", color: "#7c3aed" },
    business: { label: "Business", bg: "#fef3c7", color: "#b45309" },
    farm: { label: "Farm", bg: "#ecfccb", color: "#4d7c0f" },
    outdoor_site: { label: "Outdoor", bg: "#ccfbf1", color: "#0d9488" },
    clinic: { label: "Clinic", bg: "#fee2e2", color: "#dc2626" },
    shelter: { label: "Shelter", bg: "#f3e8ff", color: "#9333ea" },
    neighborhood: { label: "Area", bg: "#f3f4f6", color: "#6b7280" },
  };

  const config = kindConfig[kind] || { label: kind.replace(/_/g, " "), bg: "#f3f4f6", color: "#6b7280" };

  return (
    <span
      className="badge"
      style={{ background: config.bg, color: config.color, fontSize: "0.75rem" }}
    >
      {config.label}
    </span>
  );
}

// Context type badge
function ContextBadge({ context }: { context: PlaceContext }) {
  const contextTypeColors: Record<string, { bg: string; color: string }> = {
    colony_site: { bg: "#dc3545", color: "#fff" },
    foster_home: { bg: "#198754", color: "#fff" },
    adopter_residence: { bg: "#0d6efd", color: "#fff" },
    volunteer_location: { bg: "#6610f2", color: "#fff" },
    trapper_base: { bg: "#fd7e14", color: "#000" },
    trap_pickup: { bg: "#ffc107", color: "#000" },
    clinic: { bg: "#20c997", color: "#000" },
    shelter: { bg: "#6f42c1", color: "#fff" },
    partner_org: { bg: "#0dcaf0", color: "#000" },
    feeding_station: { bg: "#adb5bd", color: "#000" },
  };

  const colors = contextTypeColors[context.context_type] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{
        fontSize: "0.7rem",
        background: colors.bg,
        color: colors.color,
      }}
      title={`${context.context_label}${context.is_verified ? " (Verified)" : ""} - ${Math.round(context.confidence * 100)}% confidence`}
    >
      {context.context_label}
      {context.is_verified && " ✓"}
    </span>
  );
}

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
  { value: "mobile_home_space", label: "Mobile Home Space" },
];

export default function PlaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.id as string;

  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [heroMedia, setHeroMedia] = useState<(MediaItem & { is_hero?: boolean })[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [requests, setRequests] = useState<RelatedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Edit history panel
  const [showHistory, setShowHistory] = useState(false);
  const [showColonyModal, setShowColonyModal] = useState(false);

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

  const fetchHeroMedia = useCallback(async () => {
    try {
      const response = await fetch(`/api/places/${id}/media`);
      if (response.ok) {
        const data = await response.json();
        setHeroMedia(data.media || []);
      }
    } catch (err) {
      console.error("Failed to fetch media:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchPlace(), fetchJournal(), fetchRequests(), fetchHeroMedia()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchPlace, fetchJournal, fetchRequests, fetchHeroMedia]);

  const handleSetHero = async (mediaId: string) => {
    try {
      const res = await fetch(`/api/media/${mediaId}/hero`, { method: "PATCH" });
      if (res.ok) {
        await fetchHeroMedia();
      }
    } catch (err) {
      console.error("Failed to set hero:", err);
    }
  };

  const handleViewAllMedia = () => {
    setActiveTab("media");
  };

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

      await fetchPlace();
      setEditingDetails(false);
    } catch (err) {
      setSaveError("Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  const startAddressCorrection = () => {
    setChangeReason("");
    setChangeNotes("");
    setAddressInput("");
    setSaveError(null);
    setEditingAddress(true);
  };

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

  const handleAddressSelect = async (placeDetails: PlaceDetails) => {
    if (!place || !changeReason) {
      setSaveError("Please select a reason for this address correction");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const locality = placeDetails.address_components.find(c => c.types.includes("locality"))?.long_name || null;
    const postal_code = placeDetails.address_components.find(c => c.types.includes("postal_code"))?.long_name || null;
    const state = placeDetails.address_components.find(c => c.types.includes("administrative_area_level_1"))?.short_name || null;

    try {
      const response = await fetch(`/api/places/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formatted_address: placeDetails.formatted_address,
          locality,
          postal_code,
          state_province: state,
          latitude: placeDetails.geometry.location.lat,
          longitude: placeDetails.geometry.location.lng,
          change_reason: changeReason,
          change_notes: changeNotes,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setSaveError(result.error || "Failed to save address correction");
        return;
      }

      await fetchPlace();
      setEditingAddress(false);
    } catch (err) {
      setSaveError("Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading place details...</div>;
  }

  if (error) {
    return (
      <div>
        <BackButton fallbackHref="/places" />
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

  // Transform people for LinkedPeopleSection
  const peopleForSection = place.people?.map(p => ({
    person_id: p.person_id,
    display_name: p.person_name,
    relationship_type: p.role,
    confidence: p.confidence,
  })) || [];

  /* ── Header Content ── */
  const headerContent = (
    <div>
      <BackButton fallbackHref="/places" />

      <div style={{ marginTop: "1rem" }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{place.display_name}</h1>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <PlaceKindBadge kind={place.place_kind} />
            {place.contexts?.map((ctx) => (
              <ContextBadge key={ctx.context_id} context={ctx} />
            ))}
            {place.has_cat_activity && (
              <span className="badge" style={{ background: "#dcfce7", color: "#166534", fontSize: "0.7rem" }}>
                Cat Activity
              </span>
            )}
          </div>
        </div>

        {/* Address subtitle */}
        {place.formatted_address && place.formatted_address !== place.display_name && (
          <p className="text-muted" style={{ margin: "0.5rem 0 0 0" }}>{place.formatted_address}</p>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
          {place.coordinates && (
            <a
              href={`/map?lat=${place.coordinates.lat}&lng=${place.coordinates.lng}&zoom=17`}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                background: "#6366f1",
                color: "white",
                border: "none",
                borderRadius: "6px",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              📍 View on Map
            </a>
          )}
          <a
            href={`/places/${place.place_id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: "transparent",
              color: "inherit",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Print
          </a>
          <button
            onClick={() => setShowColonyModal(true)}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: "transparent",
              color: "#059669",
              border: "1px solid #059669",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Create Colony
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: showHistory ? "var(--primary)" : "transparent",
              color: showHistory ? "white" : "inherit",
              border: showHistory ? "none" : "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            History
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Sidebar Content ── */
  const sidebarContent = (
    <div className="space-y-4">
      {/* Quick Stats */}
      <StatsSidebar
        stats={[
          { label: "Cats", value: place.cat_count, icon: "🐱", href: `#cats` },
          { label: "People", value: place.person_count, icon: "👤" },
          { label: "Requests", value: requests.length, icon: "📋", href: `/requests?place_id=${place.place_id}` },
        ]}
        sections={[
          {
            title: "Quick Actions",
            content: (
              <QuickActions
                entityType="place"
                entityId={place.place_id}
                state={usePlaceQuickActionState({
                  lat: place.coordinates?.lat,
                  lng: place.coordinates?.lng,
                  request_count: requests.length,
                  cat_count: place.cat_count,
                  colony_estimate: null,
                  last_observation_days: null,
                })}
                onActionComplete={fetchPlace}
              />
            ),
          },
        ]}
      />

      {/* Colony Estimates - Always visible */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b">
          <h4 className="text-sm font-semibold text-gray-900">Colony Size</h4>
        </div>
        <div className="p-4">
          <ColonyEstimates placeId={id} />
        </div>
      </div>

      {/* Disease Status - Always visible */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b">
          <h4 className="text-sm font-semibold text-gray-900">Disease Status</h4>
        </div>
        <div className="p-4">
          <DiseaseStatusSection placeId={place.place_id} onStatusChange={fetchPlace} />
        </div>
      </div>

      {/* Site Stats / TNR Progress */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b">
          <h4 className="text-sm font-semibold text-gray-900">TNR Progress</h4>
        </div>
        <div className="p-4">
          <SiteStatsCard placeId={place.place_id} />
        </div>
      </div>

      {/* Location Info */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b">
          <h4 className="text-sm font-semibold text-gray-900">Location</h4>
        </div>
        <div className="p-4">
          <StatRow label="City" value={place.locality || "Unknown"} />
          <StatRow label="ZIP" value={place.postal_code || "—"} />
          <StatRow label="Geocoded" value={place.is_address_backed ? "Yes" : "Approx"} />
          {place.coordinates && (
            <div className="text-xs text-gray-500 mt-2 font-mono">
              {place.coordinates.lat.toFixed(5)}, {place.coordinates.lng.toFixed(5)}
            </div>
          )}
        </div>
      </div>

      {/* Verification */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b">
          <h4 className="text-sm font-semibold text-gray-900">Verification</h4>
        </div>
        <div className="p-4">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <VerificationBadge
              table="places"
              recordId={place.place_id}
              verifiedAt={place.verified_at}
              verifiedBy={place.verified_by_name}
              onVerify={() => fetchPlace()}
            />
            {place.verified_at && (
              <LastVerified verifiedAt={place.verified_at} verifiedBy={place.verified_by_name} />
            )}
          </div>
        </div>
      </div>

      {/* Record Info */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b">
          <h4 className="text-sm font-semibold text-gray-900">Record Info</h4>
        </div>
        <div className="p-4">
          <StatRow label="Created" value={formatDateLocal(place.created_at)} />
          <StatRow label="Updated" value={formatDateLocal(place.updated_at)} />
          <div className="text-xs text-gray-500 mt-2 font-mono break-all">
            {place.place_id}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── Main Content ── */
  const mainContent = (
    <div>
      {/* Staff Quick Notes */}
      <QuickNotes
        entityType="place"
        entityId={place.place_id}
        entries={journal}
        onNoteAdded={fetchJournal}
      />

      {/* Partner Org Profile */}
      {place.partner_org && (
        <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem", borderLeft: "4px solid #0dcaf0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
            <div>
              <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "0.25rem" }}>
                Partner Organization
              </div>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{place.partner_org.org_name}</h3>
              {place.partner_org.org_name_short && place.partner_org.org_name_short !== place.partner_org.org_name && (
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{place.partner_org.org_name_short}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {place.partner_org.org_type && (
                <span className="badge" style={{ fontSize: "0.7em", background: "#e9ecef" }}>
                  {place.partner_org.org_type.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>

          {(place.partner_org.appointments_count || place.partner_org.cats_processed) && (
            <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
              {place.partner_org.appointments_count != null && (
                <div>
                  <span style={{ fontWeight: 600 }}>{place.partner_org.appointments_count.toLocaleString()}</span>
                  <span style={{ color: "var(--muted)", marginLeft: "0.25rem" }}>appointments</span>
                </div>
              )}
              {place.partner_org.cats_processed != null && (
                <div>
                  <span style={{ fontWeight: 600 }}>{place.partner_org.cats_processed.toLocaleString()}</span>
                  <span style={{ color: "var(--muted)", marginLeft: "0.25rem" }}>cats processed</span>
                </div>
              )}
            </div>
          )}

          {(place.partner_org.contact_name || place.partner_org.contact_email || place.partner_org.contact_phone) && (
            <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.85rem", flexWrap: "wrap" }}>
              {place.partner_org.contact_name && (
                <div><span style={{ color: "var(--muted)" }}>Contact:</span> {place.partner_org.contact_name}</div>
              )}
              {place.partner_org.contact_email && (
                <a href={`mailto:${place.partner_org.contact_email}`} style={{ color: "var(--primary)" }}>
                  {place.partner_org.contact_email}
                </a>
              )}
              {place.partner_org.contact_phone && (
                <a href={`tel:${place.partner_org.contact_phone}`} style={{ color: "var(--primary)" }}>
                  {formatPhone(place.partner_org.contact_phone)}
                </a>
              )}
            </div>
          )}

          <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
            <a href={`/admin/partner-orgs/${place.partner_org.org_id}`} style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
              View full organization profile
            </a>
          </div>
        </div>
      )}

      {/* Hero Gallery */}
      {heroMedia.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <HeroGallery
            media={heroMedia}
            onSetHero={handleSetHero}
            onViewAll={handleViewAllMedia}
          />
        </div>
      )}

      {/* Cats Section */}
      <Section title={`Cats${place.cat_count > 0 ? ` (${place.cat_count})` : ""}`} collapsible>
        {place.cats && place.cats.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {place.cats.map((cat) => (
              <EntityLink
                key={cat.cat_id}
                href={`/cats/${cat.cat_id}`}
                label={cat.cat_name}
                badge={cat.relationship_type}
                badgeColor={cat.relationship_type === "residence" || cat.relationship_type === "home" ? "#198754" : "#6c757d"}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No cats linked to this place.</p>
        )}
      </Section>

      {/* People Section */}
      <LinkedPeopleSection
        people={peopleForSection}
        context="place"
        title="People"
        emptyMessage="No people linked to this place."
      />

      {/* Clinic History */}
      <ClinicHistorySection placeId={place.place_id} />

      {/* Classifications */}
      <div style={{ marginBottom: "1.5rem" }}>
        <PlaceContextEditor
          placeId={place.place_id}
          address={place.formatted_address || undefined}
          onContextChange={() => fetchPlace()}
        />
      </div>

      {/* Linked Places */}
      <Section title="Linked Places" collapsible defaultCollapsed>
        <PlaceLinksSection
          placeId={place.place_id}
          placeName={place.display_name || place.formatted_address || "This place"}
        />
      </Section>

      {/* Tabs for Details/Requests/Admin */}
      <div style={{ marginTop: "2rem" }}>
        <TabNav
          tabs={[
            { id: "details", label: "Details" },
            { id: "requests", label: "Requests", badge: requests.length },
            { id: "ecology", label: "Ecology" },
            { id: "media", label: "Media" },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* Details Tab */}
        {activeTab === "details" && (
          <>
            {/* Location Details Edit */}
            <Section title="Location Details">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
                {!editingDetails && (
                  <button
                    onClick={startEditing}
                    style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
                  >
                    Edit
                  </button>
                )}
              </div>

              {editingDetails ? (
                <div>
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
                      the display name and type, but the underlying address data will remain linked.
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Display Name / Label
                      </label>
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        placeholder="e.g., Old Stony Point, Mrs. Johnson's House"
                        style={{ width: "100%", maxWidth: "400px" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Place Type
                      </label>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/places/${place.place_id}/suggest-type`);
                              if (!res.ok) return;
                              const data = await res.json();
                              if (data.suggested_kind) {
                                if (confirm(`Suggestion: ${data.suggested_kind.replace(/_/g, " ")} (${Math.round(data.confidence * 100)}% confidence)\n\nReason: ${data.reason}\n\nApply this?`)) {
                                  setEditPlaceKind(data.suggested_kind);
                                }
                              } else {
                                alert("No suggestion available.");
                              }
                            } catch {
                              alert("Failed to get suggestion");
                            }
                          }}
                          style={{
                            padding: "0.25rem 0.75rem",
                            fontSize: "0.8rem",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Suggest Type
                        </button>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                        Address
                      </label>
                      <p style={{ margin: 0 }}>
                        {place.formatted_address || "No address set"}
                      </p>
                      {!editingAddress ? (
                        <button
                          onClick={startAddressCorrection}
                          style={{
                            marginTop: "0.5rem",
                            padding: "0.25rem 0.5rem",
                            fontSize: "0.8rem",
                            background: "transparent",
                            border: "1px solid var(--border)",
                          }}
                        >
                          Correct Address
                        </button>
                      ) : (
                        <div style={{ marginTop: "0.75rem", padding: "1rem", background: "#fff8f5", border: "1px solid #e65100", borderRadius: "8px" }}>
                          <p style={{ marginTop: 0, marginBottom: "0.75rem", fontWeight: 500, color: "#e65100" }}>
                            Address Correction
                          </p>
                          <div style={{ marginBottom: "0.75rem" }}>
                            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                              Reason for correction *
                            </label>
                            <select
                              value={changeReason}
                              onChange={(e) => setChangeReason(e.target.value)}
                              style={{ width: "100%" }}
                            >
                              <option value="">Select a reason...</option>
                              <option value="location_clarified">Location clarified</option>
                              <option value="data_entry_error">Data entry error</option>
                              <option value="refinement">Address refinement</option>
                              <option value="correction">General correction</option>
                            </select>
                          </div>

                          <div style={{ marginBottom: "0.75rem" }}>
                            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                              New Address
                            </label>
                            <AddressAutocomplete
                              value={addressInput}
                              onChange={setAddressInput}
                              onPlaceSelect={handleAddressSelect}
                              placeholder="Search for the correct address..."
                              disabled={saving}
                            />
                          </div>

                          <div style={{ marginBottom: "0.75rem" }}>
                            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                              Notes (optional)
                            </label>
                            <textarea
                              value={changeNotes}
                              onChange={(e) => setChangeNotes(e.target.value)}
                              placeholder="Explain what you learned..."
                              rows={2}
                              style={{ width: "100%", resize: "vertical" }}
                            />
                          </div>

                          <button
                            onClick={() => setEditingAddress(false)}
                            disabled={saving}
                            style={{ background: "transparent", border: "1px solid var(--border)" }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {saveError && (
                      <div style={{ color: "#dc3545" }}>{saveError}</div>
                    )}

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
                </div>
              )}
            </Section>

            {/* Journal */}
            <Section title="Journal">
              <JournalSection
                entries={journal}
                entityType="place"
                entityId={id}
                onEntryAdded={fetchJournal}
              />
            </Section>
          </>
        )}

        {/* Requests Tab */}
        {activeTab === "requests" && (
          <>
            {/* Cat Presence Reconciliation */}
            {place.cats && place.cats.length > 0 && (
              <CatPresenceReconciliation
                placeId={place.place_id}
                onUpdate={() => fetchPlace()}
              />
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
                        {formatDateLocal(req.created_at)}
                      </span>
                    </a>
                  ))}
                  {requests.length >= 10 && (
                    <a href={`/requests?place_id=${place.place_id}`} className="text-sm" style={{ marginTop: "0.5rem" }}>
                      View all requests...
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

            {/* Website Submissions */}
            <Section title="Website Submissions" collapsible defaultCollapsed>
              <SubmissionsSection entityType="place" entityId={id} />
            </Section>
          </>
        )}

        {/* Ecology Tab */}
        {activeTab === "ecology" && (
          <>
            <Section title="Population Events">
              <PopulationTimeline placeId={id} />
            </Section>

            <Section title="Site Observations">
              <ObservationsSection
                placeId={id}
                placeName={place.display_name || place.formatted_address || 'This location'}
              />
            </Section>

            <HistoricalContextCard placeId={id} className="mt-4" />

            <Section title="FFR Activity" collapsible defaultCollapsed>
              <PlaceAlterationHistory placeId={id} />
            </Section>

            <Section title="Activity Trend" collapsible defaultCollapsed>
              <PopulationTrendChart placeId={id} />
            </Section>
          </>
        )}

        {/* Media Tab */}
        {activeTab === "media" && (
          <Section title="Photos">
            <MediaGallery
              entityType="place"
              entityId={place.place_id}
              allowUpload={true}
              includeRelated={true}
              defaultMediaType="site_photo"
              allowedMediaTypes={["site_photo", "evidence"]}
            />
          </Section>
        )}
      </div>
    </div>
  );

  return (
    <>
      <TwoColumnLayout
        header={headerContent}
        main={mainContent}
        sidebar={sidebarContent}
      />

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
            entityType="place"
            entityId={id}
            limit={50}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}

      {/* Create Colony Modal */}
      <CreateColonyModal
        isOpen={showColonyModal}
        onClose={() => setShowColonyModal(false)}
        placeId={place.place_id}
        staffName={undefined}
        onSuccess={(result) => {
          setShowColonyModal(false);
          alert(`Colony "${result.colony_name}" created successfully!`);
        }}
      />
    </>
  );
}
