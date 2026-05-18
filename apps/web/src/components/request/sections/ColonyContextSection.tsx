"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/Button";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/components/forms/PlaceResolver";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";

// ── Types ──

interface ColonyContextPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  relationship: string; // "self" | "corridor" | "nearby"
  place_role: string | null;
  is_primary: boolean;
  cat_count: number;
  altered_count: number;
  primary_contact: string | null;
  request_status: string | null;
  request_id: string | null;
  request_summary: string | null;
}

interface ColonyContextRequest {
  request_id: string;
  status: string;
  summary: string | null;
  requester_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface ColonyInfo {
  colony_id: string;
  colony_name: string;
  status: string;
}

type ContextMode = "colony" | "corridor" | "nearby" | "none";

interface ColonyContextPerson {
  person_id: string;
  display_name: string | null;
  role_type: string;
  role_label: string;
  phone: string | null;
}

interface SiteTrapperRef {
  person_id: string;
  display_name: string | null;
  is_primary: boolean;
}

export interface ColonyContext {
  mode: ContextMode;
  colony: ColonyInfo | null;
  places: ColonyContextPlace[];
  requests: ColonyContextRequest[];
  people?: ColonyContextPerson[];
  site_trappers?: SiteTrapperRef[];
  total_cats: number;
  altered_cats: number;
}

const PLACE_ROLE_OPTIONS = [
  { value: "core_site", label: "Core Site" },
  { value: "feeding_station", label: "Feeding Station" },
  { value: "shelter_location", label: "Shelter Location" },
  { value: "territory_boundary", label: "Territory Boundary" },
];

function formatPlaceRole(role: string | null): string | null {
  if (!role || role === "core_site") return null; // don't show default
  return PLACE_ROLE_OPTIONS.find(o => o.value === role)?.label || role.replace(/_/g, " ");
}

// ── Component ──

interface ColonyContextSectionProps {
  placeId: string;
  currentRequestId: string;
  onPlaceClick?: (placeId: string) => void;
  onCreateColony?: () => void;
}

export function ColonyContextSection({ placeId, currentRequestId, onPlaceClick, onCreateColony }: ColonyContextSectionProps) {
  const [data, setData] = useState<ColonyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const toast = useToast();

  // Add Place drawer
  const [showAddPlace, setShowAddPlace] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<ResolvedPlace | null>(null);
  const [addPlaceRole, setAddPlaceRole] = useState("core_site");
  const [addPlaceNotes, setAddPlaceNotes] = useState("");

  // Confirm remove
  const [confirmRemove, setConfirmRemove] = useState<{ placeId: string; name: string } | null>(null);

  const fetchContext = useCallback(async () => {
    try {
      const result = await fetchApi<ColonyContext>(`/api/places/${placeId}/colony-context`);
      setData(result);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  useEffect(() => { fetchContext(); }, [fetchContext]);

  if (loading || !data || data.mode === "none") return null;
  if (data.mode === "nearby" && dismissed) return null;

  // ── "nearby" mode: gentle discovery banner ──
  if (data.mode === "nearby") {
    return <NearbyActivityBanner data={data} currentRequestId={currentRequestId} onDismiss={() => setDismissed(true)} onCreateColony={onCreateColony} onPlaceClick={onPlaceClick} />;
  }

  // ── "colony" or "corridor" mode: full management section ──
  const { colony, places, requests, total_cats, altered_cats } = data;
  const activeRequests = requests.filter(r => !["completed", "cancelled", "partial"].includes(r.status));
  const completedRequests = requests.filter(r => ["completed", "cancelled", "partial"].includes(r.status));
  const isCorridorOnly = data.mode === "corridor";

  // ── Handlers ──

  const handleAddPlace = async () => {
    if (!selectedPlace || !colony) return;
    setAddingPlace(true);
    try {
      await postApi(`/api/colonies/${colony.colony_id}/places`, {
        place_id: selectedPlace.place_id,
        relationship_type: addPlaceRole,
        is_primary: false,
        added_by: "web_user",
      });
      toast.success(`Added ${selectedPlace.display_name || selectedPlace.formatted_address}`);
      resetAddDrawer();
      await fetchContext();
    } catch {
      toast.error("Failed to add place");
    } finally {
      setAddingPlace(false);
    }
  };

  const resetAddDrawer = () => {
    setShowAddPlace(false);
    setSelectedPlace(null);
    setAddPlaceRole("core_site");
    setAddPlaceNotes("");
  };

  const handleRemovePlace = async (removePlaceId: string) => {
    if (!colony) return;
    try {
      await fetchApi(`/api/colonies/${colony.colony_id}/places?placeId=${removePlaceId}`, { method: "DELETE" });
      toast.success("Place removed");
      setConfirmRemove(null);
      await fetchContext();
    } catch {
      toast.error("Failed to remove place");
    }
  };

  const handleSetPrimary = async (targetPlaceId: string) => {
    if (!colony) return;
    try {
      await postApi(`/api/colonies/${colony.colony_id}/places`, {
        place_id: targetPlaceId,
        relationship_type: "colony_site",
        is_primary: true,
        added_by: "web_user",
      });
      toast.success("Set as primary address");
      await fetchContext();
    } catch {
      toast.error("Failed to update");
    }
  };

  const statusLabel = colony?.status === "active" ? "Active" :
    colony?.status === "monitored" ? "Monitored" :
    colony?.status === "resolved" ? "Resolved" :
    colony?.status || "Corridor";

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "6px 8px", fontSize: "0.85rem",
    border: "1px solid var(--border)", borderRadius: "6px",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", marginBottom: "4px", fontSize: "0.8rem", fontWeight: 500,
  };

  return (
    <>
      <div className="card" style={{ padding: 0, marginBottom: "1rem", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          padding: "0.6rem 1rem",
          background: isCorridorOnly
            ? "linear-gradient(135deg, #374151 0%, #6b7280 100%)"
            : "linear-gradient(135deg, #065f46 0%, #059669 100%)",
          color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
            <Icon name="trees" size={16} color="#fff" />
            <span style={{ fontWeight: 700, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {colony?.colony_name || "Site Corridor"}
            </span>
            <span style={{ fontSize: "0.7rem", padding: "1px 8px", borderRadius: "10px", background: "rgba(255,255,255,0.2)", whiteSpace: "nowrap" }}>
              {statusLabel}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.8rem", whiteSpace: "nowrap", opacity: 0.9 }}>
            <span>{places.length} address{places.length !== 1 ? "es" : ""}</span>
            <span>{total_cats} cat{total_cats !== 1 ? "s" : ""}</span>
            {altered_cats > 0 && total_cats > 0 && (
              <span>{Math.round((altered_cats / total_cats) * 100)}% altered</span>
            )}
          </div>
        </div>

        {/* Place rows */}
        <div style={{ padding: "0.25rem 0" }}>
          {places.map((place, idx) => (
            <PlaceRow
              key={place.place_id}
              place={place}
              isLast={idx === places.length - 1}
              currentRequestId={currentRequestId}
              colony={colony}
              onPlaceClick={onPlaceClick}
              onSetPrimary={handleSetPrimary}
              onRemove={(p) => setConfirmRemove({ placeId: p.place_id, name: p.display_name || p.formatted_address })}
            />
          ))}
        </div>

        {/* Colony people (feeders, coordinators, contacts) */}
        {data.people && data.people.length > 0 && (
          <div style={{
            padding: "0.4rem 1rem",
            borderTop: "1px solid var(--border, #f0f0f0)",
            display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
            fontSize: "0.8rem", color: "var(--text-muted)",
          }}>
            <span style={{ fontWeight: 500, fontSize: "0.7rem", textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.03em" }}>People:</span>
            {data.people.map(p => (
              <span key={p.person_id} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                <span style={{ fontWeight: 500, color: "var(--foreground)" }}>{p.display_name}</span>
                <span style={{ fontSize: "0.65rem", padding: "0 3px", borderRadius: "3px", background: "var(--muted-bg, #f3f4f6)" }}>{p.role_label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Site trappers */}
        {data.site_trappers && data.site_trappers.length > 0 && (
          <div style={{
            padding: "0.4rem 1rem",
            borderTop: "1px solid var(--border, #f0f0f0)",
            display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
            fontSize: "0.8rem",
          }}>
            <Icon name="target" size={13} color="var(--primary)" />
            <span style={{ fontWeight: 500, fontSize: "0.7rem", textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.03em" }}>Trapper:</span>
            {data.site_trappers.map(t => (
              <a key={t.person_id} href={`/people/${t.person_id}`} style={{ fontWeight: 500, color: "var(--primary)", textDecoration: "none" }}>
                {t.display_name || "Unknown"}
              </a>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "0.5rem 1rem", borderTop: "1px solid var(--border, #e5e7eb)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: "0.5rem", fontSize: "0.8rem", color: "var(--text-muted)",
        }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {requests.length > 0 ? (
              <span>
                {activeRequests.length > 0 && `${activeRequests.length} active`}
                {activeRequests.length > 0 && completedRequests.length > 0 && " \u00B7 "}
                {completedRequests.length > 0 && `${completedRequests.length} completed`}
              </span>
            ) : (
              <span>No other requests at these addresses</span>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {colony && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setShowAddPlace(true)} style={{ fontSize: "0.75rem" }}>+ Add Place</Button>
                <a href={`/colonies/${colony.colony_id}`} className="btn btn-sm btn-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", textDecoration: "none" }}>
                  Open Colony
                </a>
              </>
            )}
            {isCorridorOnly && onCreateColony && (
              <Button variant="secondary" size="sm" onClick={onCreateColony} style={{ fontSize: "0.75rem" }}>Create Colony</Button>
            )}
          </div>
        </div>
      </div>

      {/* Add Place Drawer */}
      <ActionDrawer isOpen={showAddPlace} onClose={resetAddDrawer} title="Add Place to Colony" width="sm" footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" size="sm" onClick={resetAddDrawer}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleAddPlace} disabled={!selectedPlace || addingPlace} loading={addingPlace}>Add Place</Button>
        </div>
      }>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={labelStyle}>Address *</label>
            <PlaceResolver value={selectedPlace} onChange={(p: ResolvedPlace | null) => setSelectedPlace(p)} placeholder="Search for an address..." />
          </div>
          <div>
            <label style={labelStyle}>Role in Colony</label>
            <select value={addPlaceRole} onChange={(e) => setAddPlaceRole(e.target.value)} style={inputStyle}>
              {PLACE_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {addPlaceRole === "core_site" && "Standard address in this colony's territory."}
              {addPlaceRole === "feeding_station" && "Where food is left for cats (may not be where they live)."}
              {addPlaceRole === "shelter_location" && "Shelters or structures cats use for cover."}
              {addPlaceRole === "territory_boundary" && "Edge of colony range \u2014 cats sometimes wander here."}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea value={addPlaceNotes} onChange={(e) => setAddPlaceNotes(e.target.value)} placeholder="e.g., cats seen crossing from this yard, neighbor feeds them..." rows={3} style={{ ...inputStyle, resize: "vertical" as const }} />
          </div>
          {selectedPlace && (
            <div style={{ padding: "0.5rem 0.75rem", background: "#f0fdf4", borderRadius: "6px", fontSize: "0.8rem", border: "1px solid #bbf7d0" }}>
              Adding <strong>{selectedPlace.display_name || selectedPlace.formatted_address}</strong> as <strong>{PLACE_ROLE_OPTIONS.find(o => o.value === addPlaceRole)?.label}</strong> to {colony?.colony_name || "colony"}
            </div>
          )}
        </div>
      </ActionDrawer>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove Place from Colony"
        message={`Remove \u201C${confirmRemove?.name}\u201D from ${colony?.colony_name || "this colony"}? The place won\u2019t be deleted \u2014 just unlinked.`}
        confirmLabel="Remove" variant="danger"
        onConfirm={() => confirmRemove && handleRemovePlace(confirmRemove.placeId)}
        onCancel={() => setConfirmRemove(null)}
      />
    </>
  );
}

// ── PlaceRow: shared between colony/corridor modes ──

function PlaceRow({ place, isLast, currentRequestId, colony, onPlaceClick, onSetPrimary, onRemove }: {
  place: ColonyContextPlace;
  isLast: boolean;
  currentRequestId: string;
  colony: ColonyInfo | null;
  onPlaceClick?: (placeId: string) => void;
  onSetPrimary: (placeId: string) => void;
  onRemove: (place: ColonyContextPlace) => void;
}) {
  const isSelf = place.relationship === "self";
  const roleLabel = formatPlaceRole(place.place_role);
  const isActive = place.request_status && ["new", "triaged", "scheduled", "in_progress"].includes(place.request_status);
  const isComplete = place.request_status && ["completed", "partial"].includes(place.request_status);
  const isOtherRequest = place.request_id !== currentRequestId;

  const rowActions: { label: string; onClick: () => void; variant?: "danger"; dividerBefore?: boolean }[] = [];
  if (colony && !isSelf && !place.is_primary) {
    rowActions.push({ label: "Set as primary", onClick: () => onSetPrimary(place.place_id) });
  }
  if (colony && !isSelf) {
    rowActions.push({ label: "Remove from colony", onClick: () => onRemove(place), variant: "danger", dividerBefore: rowActions.length > 0 });
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.5rem",
      padding: "0.45rem 1rem",
      borderBottom: isLast ? "none" : "1px solid var(--border, #f0f0f0)",
      background: isSelf ? "var(--primary-bg, #f0fdf4)" : "transparent",
      fontSize: "0.85rem",
    }}>
      <span style={{ color: "var(--muted)", fontSize: "0.75rem", width: "16px", textAlign: "center", flexShrink: 0 }}>
        {isLast ? "\u2514" : "\u251C"}
      </span>

      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
        <a
          href={`/places/${place.place_id}?from=requests`}
          onClick={(e) => { if (onPlaceClick && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onPlaceClick(place.place_id); } }}
          style={{ color: "var(--foreground)", textDecoration: "none", fontWeight: isSelf ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {place.display_name || place.formatted_address}
        </a>
        {isSelf && <span style={{ fontSize: "0.65rem", color: "var(--primary)", fontWeight: 500 }}>(this request)</span>}
        {place.is_primary && !isSelf && <span style={{ fontSize: "0.6rem", padding: "0 4px", borderRadius: "3px", background: "#059669", color: "#fff", fontWeight: 600 }}>PRIMARY</span>}
        {roleLabel && <span style={{ fontSize: "0.65rem", padding: "0 4px", borderRadius: "3px", background: "var(--muted-bg, #f3f4f6)", color: "var(--text-muted)" }}>{roleLabel}</span>}
      </div>

      {isActive && isOtherRequest && (
        <a href={`/requests/${place.request_id}?from=requests`} title={place.request_summary || "Active request"} style={{ textDecoration: "none", flexShrink: 0 }}>
          <StatusBadge status={place.request_status!} size="sm" />
        </a>
      )}
      {isComplete && isOtherRequest && (
        <span style={{ fontSize: "0.65rem", color: "var(--success)", flexShrink: 0 }} title={`Completed: ${place.request_summary || ""}`}>Done</span>
      )}

      <span style={{ fontSize: "0.8rem", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
        {place.cat_count > 0 ? `${place.cat_count} cat${place.cat_count !== 1 ? "s" : ""}` : ""}
      </span>

      {place.primary_contact && (
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "110px", flexShrink: 0 }}>
          {place.primary_contact}
        </span>
      )}

      {rowActions.length > 0 && <RowActionMenu actions={rowActions} />}
    </div>
  );
}

// ── NearbyActivityBanner: gentle discovery mode ──
// Staff doesn't know this is part of something bigger yet.
// Show as a soft info banner, not a full management section.

function NearbyActivityBanner({ data, currentRequestId, onDismiss, onCreateColony, onPlaceClick }: {
  data: ColonyContext;
  currentRequestId: string;
  onDismiss: () => void;
  onCreateColony?: () => void;
  onPlaceClick?: (placeId: string) => void;
}) {
  const nearbyPlaces = data.places.filter(p => p.relationship === "nearby");
  const nearbyWithRequests = nearbyPlaces.filter(p => p.request_status);
  const nearbyWithCats = nearbyPlaces.filter(p => p.cat_count > 0);

  // Build a human-readable summary
  let summary = "";
  if (nearbyWithRequests.length > 0 && nearbyWithCats.length > 0) {
    summary = `${nearbyWithRequests.length} nearby address${nearbyWithRequests.length !== 1 ? "es have" : " has"} requests and ${data.total_cats} cats are tracked in this area.`;
  } else if (nearbyWithRequests.length > 0) {
    summary = `${nearbyWithRequests.length} nearby address${nearbyWithRequests.length !== 1 ? "es have" : " has"} requests. These cats may be part of the same population.`;
  } else {
    summary = `${nearbyWithCats.length} nearby address${nearbyWithCats.length !== 1 ? "es have" : " has"} tracked cats. They may roam between these properties.`;
  }

  return (
    <div style={{
      marginBottom: "1rem",
      padding: "0.75rem 1rem",
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
      borderRadius: "8px",
      fontSize: "0.85rem",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Icon name="info" size={16} color="#2563eb" />
          <span style={{ fontWeight: 600, color: "#1e40af" }}>Nearby Activity</span>
        </div>
        <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "1rem", lineHeight: 1, padding: 0 }} title="Dismiss">
          &times;
        </button>
      </div>

      <p style={{ margin: "0.4rem 0 0.6rem 0", color: "#1e3a5f" }}>{summary}</p>

      {/* Compact place list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", marginBottom: "0.5rem" }}>
        {nearbyPlaces.map(place => (
          <div key={place.place_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem" }}>
            <span style={{ color: "#6b7280", width: "12px" }}>&bull;</span>
            <a
              href={`/places/${place.place_id}?from=requests`}
              onClick={(e) => { if (onPlaceClick && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onPlaceClick(place.place_id); } }}
              style={{ color: "#1e40af", textDecoration: "none", fontWeight: 500 }}
            >
              {place.display_name || place.formatted_address}
            </a>
            {place.cat_count > 0 && <span style={{ color: "#6b7280" }}>{place.cat_count} cats</span>}
            {place.primary_contact && <span style={{ color: "#9ca3af" }}>{place.primary_contact}</span>}
            {place.request_status && place.request_id !== currentRequestId && (
              <a href={`/requests/${place.request_id}?from=requests`} style={{ textDecoration: "none" }}>
                <StatusBadge status={place.request_status} size="sm" />
              </a>
            )}
          </div>
        ))}
      </div>

      {onCreateColony && (
        <Button variant="secondary" size="sm" onClick={onCreateColony} style={{ fontSize: "0.75rem" }}>
          Link as Colony
        </Button>
      )}
    </div>
  );
}
