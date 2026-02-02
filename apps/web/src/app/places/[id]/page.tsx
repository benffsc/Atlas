"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, usePathname } from "next/navigation";
import JournalSection, { JournalEntry } from "@/components/JournalSection";
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
import { formatDateLocal } from "@/lib/formatters";
import { MediaGallery } from "@/components/MediaGallery";
import { HeroGallery } from "@/components/HeroGallery";
import { MediaItem } from "@/components/MediaUploader";
import { QuickActions, usePlaceQuickActionState } from "@/components/QuickActions";
import { CatPresenceReconciliation } from "@/components/CatPresenceReconciliation";
import { CreateColonyModal } from "@/components/CreateColonyModal";
import { PlaceContextEditor } from "@/components/PlaceContextEditor";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { ProfileLayout } from "@/components/ProfileLayout";
import DiseaseStatusSection from "@/components/DiseaseStatusSection";

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
    const params = new URLSearchParams();
    params.set("tab", "media");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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

      // Refresh place data
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

    // Extract locality from address components
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

      // Refresh place data
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

  const placeKindColors: Record<string, string> = {
    residential_house: "#198754",
    apartment_unit: "#0d6efd",
    apartment_building: "#6610f2",
    business: "#fd7e14",
    clinic: "#dc3545",
    outdoor_site: "#20c997",
    neighborhood: "#6c757d",
    mobile_home_space: "#795548",
  };

  // Context type colors for badges
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

  /* ── Header (always visible) ── */
  const profileHeader = (
    <div>
      <BackButton fallbackHref="/places" />

      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
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
          {place.contexts && place.contexts.length > 0 && place.contexts.map((ctx) => {
            const colors = contextTypeColors[ctx.context_type] || { bg: "#6c757d", color: "#fff" };
            return (
              <span
                key={ctx.context_id}
                className="badge"
                style={{
                  fontSize: "0.5em",
                  background: colors.bg,
                  color: colors.color,
                }}
                title={`${ctx.context_label}${ctx.is_verified ? " (Verified)" : ""} - ${Math.round(ctx.confidence * 100)}% confidence`}
              >
                {ctx.context_label}
                {ctx.is_verified && " ✓"}
              </span>
            );
          })}
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <a
              href={`/places/${place.place_id}/print`}
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
            {place.coordinates && (
              <a
                href={`/map?lat=${place.coordinates.lat}&lng=${place.coordinates.lng}&zoom=17`}
                style={{
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.875rem",
                  background: "#6366f1",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                View on Map
              </a>
            )}
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
            <button
              onClick={() => setShowColonyModal(true)}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.875rem",
                background: "transparent",
                color: "#059669",
                border: "1px solid #059669",
                borderRadius: "4px",
              }}
              title="Create a colony from this location"
            >
              Create Colony
            </button>
          </div>
        </h1>
        {place.formatted_address && place.formatted_address !== place.display_name && (
          <p className="text-muted">{place.formatted_address}</p>
        )}
        <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
          ID: {place.place_id}
        </p>
      </div>
    </div>
  );

  /* ── Tab: Overview ── */
  const overviewTab = (
    <>
      {/* Quick Actions */}
      <div className="card" style={{ padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
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
      </div>

      {/* Organization Profile (shown when place is linked to a partner org) */}
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
              {place.partner_org.relationship_type && (
                <span className="badge" style={{ fontSize: "0.7em", background: "#cff4fc", color: "#055160" }}>
                  {place.partner_org.relationship_type.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>

          {/* Org stats row */}
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
              {place.partner_org.first_appointment_date && (
                <div style={{ color: "var(--muted)" }}>
                  Since {formatDateLocal(place.partner_org.first_appointment_date)}
                </div>
              )}
            </div>
          )}

          {/* Contact info */}
          {(place.partner_org.contact_name || place.partner_org.contact_email || place.partner_org.contact_phone) && (
            <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.85rem", flexWrap: "wrap" }}>
              {place.partner_org.contact_name && (
                <div><span style={{ color: "var(--muted)" }}>Contact:</span> {place.partner_org.contact_name}</div>
              )}
              {place.partner_org.contact_email && (
                <div>
                  <a href={`mailto:${place.partner_org.contact_email}`} style={{ color: "var(--primary)" }}>
                    {place.partner_org.contact_email}
                  </a>
                </div>
              )}
              {place.partner_org.contact_phone && (
                <div>
                  <a href={`tel:${place.partner_org.contact_phone}`} style={{ color: "var(--primary)" }}>
                    {place.partner_org.contact_phone}
                  </a>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
            <a
              href={`/admin/partner-orgs/${place.partner_org.org_id}`}
              style={{ fontSize: "0.8rem", color: "var(--primary)" }}
            >
              View full organization profile
            </a>
          </div>
        </div>
      )}

      {/* Disease Status */}
      <div style={{ marginBottom: "1.5rem" }}>
        <DiseaseStatusSection placeId={place.place_id} onStatusChange={fetchPlace} />
      </div>

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

      {/* Location Details */}
      <Section
        title="Location Details"
        onEdit={startEditing}
        editMode={editingDetails}
      >
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
                the display name (label) and type, but the underlying address data will remain
                linked to its geocoded location.
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
                  placeholder="e.g., Old Stony Point, OSP, Mrs. Johnson's House"
                  style={{ width: "100%", maxWidth: "400px" }}
                />
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  A friendly name for this place. The full address will still be shown.
                </p>
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
                          alert("No suggestion available — not enough context tags to infer type.");
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
                      color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Suggest Type
                  </button>
                </div>
                <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                  Helps categorize locations for filtering and reporting.
                </p>
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
                    <p className="text-sm" style={{ marginBottom: "1rem", color: "#666" }}>
                      Use this when you discover the cats actually come from a different address (e.g., behind a fence, across a field). The place identity stays the same but the location is corrected.
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
                        <option value="location_clarified">Location clarified (cats actually from different spot)</option>
                        <option value="data_entry_error">Data entry error</option>
                        <option value="refinement">Address refinement (more specific location)</option>
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
                        placeholder="Explain what you learned, e.g., 'Cats are fed behind the fence on the adjacent property'"
                        rows={2}
                        style={{ width: "100%", resize: "vertical" }}
                      />
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        onClick={() => setEditingAddress(false)}
                        disabled={saving}
                        style={{ background: "transparent", border: "1px solid var(--border)" }}
                      >
                        Cancel
                      </button>
                    </div>
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

      {/* Site Stats */}
      <SiteStatsCard placeId={place.place_id} />

      {/* Classifications */}
      <div style={{ marginBottom: "1.5rem" }}>
        <PlaceContextEditor
          placeId={place.place_id}
          address={place.formatted_address || undefined}
          onContextChange={() => fetchPlace()}
        />
      </div>

      {/* Activity Summary */}
      <Section title="Activity Summary">
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

      {/* Cats */}
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

      {/* People */}
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

      {/* Linked Places */}
      <Section title="Linked Places">
        <PlaceLinksSection
          placeId={place.place_id}
          placeName={place.display_name || place.formatted_address || "This place"}
        />
      </Section>
    </>
  );

  /* ── Tab: Requests ── */
  const requestsTab = (
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

      {/* Website Submissions */}
      <Section title="Website Submissions">
        <SubmissionsSection entityType="place" entityId={id} />
      </Section>
    </>
  );

  /* ── Tab: Ecology ── */
  const ecologyTab = (
    <>
      <Section title="Colony Size Estimates">
        <ColonyEstimates placeId={id} />
      </Section>

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

      <Section title="FFR Activity">
        <PlaceAlterationHistory placeId={id} />
      </Section>

      <Section title="Activity Trend">
        <PopulationTrendChart placeId={id} />
      </Section>
    </>
  );

  /* ── Tab: Media ── */
  const mediaTab = (
    <Section title="Photos">
      <MediaGallery
        entityType="place"
        entityId={place.place_id}
        allowUpload={true}
        defaultMediaType="site_photo"
        allowedMediaTypes={["site_photo", "evidence"]}
      />
    </Section>
  );

  /* ── Tab: Activity ── */
  const activityTab = (
    <>
      <Section title="Journal">
        <JournalSection
          entries={journal}
          entityType="place"
          entityId={id}
          onEntryAdded={fetchJournal}
        />
      </Section>

      <Section title="Metadata">
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Source</span>
            <span className="detail-value">
              {place.is_address_backed ? "Geocoded (Google)" : "Manual Entry"}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Created</span>
            <span className="detail-value">
              {formatDateLocal(place.created_at)}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Updated</span>
            <span className="detail-value">
              {formatDateLocal(place.updated_at)}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Verification</span>
            <span className="detail-value" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
            </span>
          </div>
        </div>
      </Section>
    </>
  );

  return (
    <ProfileLayout
      header={profileHeader}
      tabs={[
        { id: "overview", label: "Overview", content: overviewTab },
        { id: "requests", label: "Requests", content: requestsTab, badge: requests.length || undefined },
        { id: "ecology", label: "Ecology", content: ecologyTab },
        { id: "media", label: "Media", content: mediaTab },
        { id: "activity", label: "Activity", content: activityTab, badge: journal.length || undefined },
      ]}
      defaultTab="overview"
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
    </ProfileLayout>
  );
}
