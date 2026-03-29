"use client";

import { useState, useCallback } from "react";
import { AdvancedMarker, InfoWindow, CollisionBehavior } from "@vis.gl/react-google-maps";
import { MAP_COLORS, getVolunteerRoleColor, getTrapperTypeColor } from "@/lib/map-colors";
import { formatRelativeTime } from "@/lib/formatters";
import type { GooglePin, Place, Volunteer, ClinicClient, TrapperTerritory } from "@/components/map/types";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface LayerMarkerProps {
  onInfoWindowOpen: () => void;
}

// ---------------------------------------------------------------------------
// GooglePinMarkers
// ---------------------------------------------------------------------------

interface GooglePinMarkersProps extends LayerMarkerProps {
  pins: GooglePin[];
}

export function GooglePinMarkers({ pins, onInfoWindowOpen }: GooglePinMarkersProps) {
  const [selected, setSelected] = useState<GooglePin | null>(null);

  const handleClick = useCallback((pin: GooglePin) => {
    onInfoWindowOpen();
    setSelected(pin);
  }, [onInfoWindowOpen]);

  return (
    <>
      {pins.map(pin => {
        if (!pin.lat || !pin.lng) return null;
        const color = pin.display_color || MAP_COLORS.layers.google_pins;
        const isAlert = pin.staff_alert || false;
        const size = isAlert ? 36 : 28;
        return (
          <AdvancedMarker
            key={pin.id}
            position={{ lat: pin.lat, lng: pin.lng }}
            collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
            zIndex={isAlert ? 3 : 1}
            onClick={() => handleClick(pin)}
          >
            <svg width={size} height={size} viewBox="0 0 28 36" style={{ cursor: "pointer", filter: isAlert ? "drop-shadow(0 0 4px rgba(239,68,68,0.5))" : undefined }}>
              <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill={color} />
              <circle cx="14" cy="14" r="5" fill="white" />
            </svg>
          </AdvancedMarker>
        );
      })}
      {selected && (
        <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} onCloseClick={() => setSelected(null)}>
          <div style={{ minWidth: 220, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{selected.name}</div>
            {selected.display_label && (
              <div style={{ display: "inline-block", background: `${selected.display_color || MAP_COLORS.layers.google_pins}20`, color: selected.display_color || MAP_COLORS.layers.google_pins, padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500, marginBottom: 6 }}>
                {selected.display_label}
              </div>
            )}
            {selected.ai_meaning && (
              <div style={{ fontSize: 12, color: "#374151", marginBottom: 6, fontStyle: "italic" }}>
                {selected.ai_meaning}
              </div>
            )}
            {selected.notes && (
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, maxHeight: 60, overflow: "hidden" }}>
                {selected.notes.slice(0, 200)}{selected.notes.length > 200 ? "..." : ""}
              </div>
            )}
            {selected.cat_count != null && selected.cat_count > 0 && (
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                {selected.cat_count} cat{selected.cat_count !== 1 ? "s" : ""} mentioned
              </div>
            )}
            {selected.staff_alert && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "4px 8px", borderRadius: 6, fontSize: 11, color: "#991b1b", marginBottom: 6 }}>
                Staff Alert
              </div>
            )}
            {selected.disease_mentions && selected.disease_mentions.length > 0 && (
              <div style={{ background: "#fef2f2", padding: "4px 8px", borderRadius: 6, fontSize: 11, color: "#dc2626", marginBottom: 6 }}>
                Disease: {selected.disease_mentions.join(", ")}
              </div>
            )}
            {selected.safety_concerns && selected.safety_concerns.length > 0 && (
              <div style={{ background: "#fff7ed", padding: "4px 8px", borderRadius: 6, fontSize: 11, color: "#c2410c", marginBottom: 6 }}>
                Safety: {selected.safety_concerns.join(", ")}
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// PlaceMarkers
// ---------------------------------------------------------------------------

interface PlaceMarkersProps extends LayerMarkerProps {
  places: Place[];
  onPlaceSelect: (id: string) => void;
}

export function PlaceMarkers({ places, onPlaceSelect, onInfoWindowOpen }: PlaceMarkersProps) {
  const [selected, setSelected] = useState<Place | null>(null);

  const handleClick = useCallback((place: Place) => {
    onInfoWindowOpen();
    setSelected(place);
  }, [onInfoWindowOpen]);

  return (
    <>
      {places.map(place => {
        if (!place.lat || !place.lng) return null;
        const size = place.priority === "high" ? 16 : place.priority === "medium" ? 14 : 12;
        return (
          <AdvancedMarker
            key={place.id}
            position={{ lat: place.lat, lng: place.lng }}
            collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
            zIndex={1}
            onClick={() => handleClick(place)}
          >
            <div style={{
              width: size, height: size, borderRadius: "50%",
              background: MAP_COLORS.layers.places, border: "2px solid white",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)", cursor: "pointer",
            }} />
          </AdvancedMarker>
        );
      })}
      {selected && (
        <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} onCloseClick={() => setSelected(null)}>
          <div style={{ minWidth: 200, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{selected.address}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
              {selected.service_zone || "Unknown zone"}
              {selected.priority && selected.priority !== "unknown" ? ` · ${selected.priority}` : ""}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
                {selected.cat_count} cat{selected.cat_count !== 1 ? "s" : ""}
              </span>
              {selected.person_count != null && selected.person_count > 0 && (
                <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
                  {selected.person_count} people
                </span>
              )}
              {selected.has_observation && (
                <span style={{ background: "#dcfce7", padding: "2px 8px", borderRadius: 10, fontSize: 11, color: "#16a34a" }}>
                  Observed
                </span>
              )}
            </div>
            {selected.primary_person_name && (
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
                Contact: {selected.primary_person_name}
              </div>
            )}
            <button
              onClick={() => { onPlaceSelect(selected.id); setSelected(null); }}
              style={{ width: "100%", padding: "6px 12px", background: "#3b82f6", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
            >
              View Details
            </button>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// VolunteerMarkers
// ---------------------------------------------------------------------------

interface VolunteerMarkersProps extends LayerMarkerProps {
  volunteers: Volunteer[];
  onPersonSelect: (id: string) => void;
}

export function VolunteerMarkers({ volunteers, onPersonSelect, onInfoWindowOpen }: VolunteerMarkersProps) {
  const [selected, setSelected] = useState<Volunteer | null>(null);

  const handleClick = useCallback((vol: Volunteer) => {
    onInfoWindowOpen();
    setSelected(vol);
  }, [onInfoWindowOpen]);

  return (
    <>
      {volunteers.map(vol => {
        if (!vol.lat || !vol.lng) return null;
        const color = getVolunteerRoleColor(vol.role);
        return (
          <AdvancedMarker
            key={vol.id}
            position={{ lat: vol.lat, lng: vol.lng }}
            collisionBehavior={CollisionBehavior.REQUIRED}
            zIndex={2}
            onClick={() => handleClick(vol)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" style={{ cursor: "pointer" }}>
              <polygon points="12,2 15,9 22,9 16,14 18,22 12,17 6,22 8,14 2,9 9,9" fill={color} stroke="white" strokeWidth="1.5" />
            </svg>
          </AdvancedMarker>
        );
      })}
      {selected && (
        <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} onCloseClick={() => setSelected(null)}>
          <div style={{ minWidth: 200, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{selected.name}</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <span style={{ background: `${getVolunteerRoleColor(selected.role)}20`, color: getVolunteerRoleColor(selected.role), padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
                {selected.role_label}
              </span>
              <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500, color: selected.is_active ? "#16a34a" : "#6b7280" }}>
                {selected.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            {selected.service_zone && (
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
                Zone: {selected.service_zone}
              </div>
            )}
            <button
              onClick={() => { onPersonSelect(selected.id); setSelected(null); }}
              style={{ width: "100%", padding: "6px 12px", background: "#3b82f6", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
            >
              View Profile
            </button>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ClinicClientMarkers
// ---------------------------------------------------------------------------

interface ClinicClientMarkersProps extends LayerMarkerProps {
  clients: ClinicClient[];
}

export function ClinicClientMarkers({ clients, onInfoWindowOpen }: ClinicClientMarkersProps) {
  const [selected, setSelected] = useState<ClinicClient | null>(null);

  const handleClick = useCallback((client: ClinicClient) => {
    onInfoWindowOpen();
    setSelected(client);
  }, [onInfoWindowOpen]);

  return (
    <>
      {clients.map(client => {
        if (!client.lat || !client.lng) return null;
        return (
          <AdvancedMarker
            key={client.id}
            position={{ lat: client.lat, lng: client.lng }}
            collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
            zIndex={1}
            onClick={() => handleClick(client)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" style={{ cursor: "pointer" }}>
              <circle cx="7" cy="7" r="6" fill={MAP_COLORS.layers.clinic_clients} stroke="white" strokeWidth="1.5" />
              <path d="M7 3.5v7M3.5 7h7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </AdvancedMarker>
        );
      })}
      {selected && (
        <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} onCloseClick={() => setSelected(null)}>
          <div style={{ minWidth: 200, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{selected.address}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
              {selected.service_zone || "Unknown zone"}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
                {selected.appointment_count} appointment{selected.appointment_count !== 1 ? "s" : ""}
              </span>
              <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
                {selected.cat_count} cat{selected.cat_count !== 1 ? "s" : ""}
              </span>
            </div>
            {selected.last_visit && (
              <div style={{ fontSize: 11, color: "#6b7280" }}>
                Last visit: {formatRelativeTime(selected.last_visit)}
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// TrapperTerritoryMarkers
// ---------------------------------------------------------------------------

interface TrapperTerritoryMarkersProps extends LayerMarkerProps {
  territories: TrapperTerritory[];
  onPersonSelect: (id: string) => void;
}

export function TrapperTerritoryMarkers({ territories, onPersonSelect, onInfoWindowOpen }: TrapperTerritoryMarkersProps) {
  const [selected, setSelected] = useState<TrapperTerritory | null>(null);

  const handleClick = useCallback((territory: TrapperTerritory) => {
    onInfoWindowOpen();
    setSelected(territory);
  }, [onInfoWindowOpen]);

  const typeSizes: Record<string, number> = {
    primary_territory: 24,
    regular: 18,
    occasional: 14,
    home_rescue: 16,
  };

  return (
    <>
      {territories.map((t, i) => {
        if (!t.lat || !t.lng) return null;
        const color = getTrapperTypeColor(t.trapper_type);
        const size = typeSizes[t.service_type] || 14;
        const isPrimary = t.service_type === "primary_territory";
        return (
          <AdvancedMarker
            key={`${t.person_id}-${t.place_id}-${i}`}
            position={{ lat: t.lat, lng: t.lng }}
            collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
            zIndex={isPrimary ? 2 : 1}
            onClick={() => handleClick(t)}
          >
            {isPrimary ? (
              <svg width={size} height={size} viewBox="0 0 28 36" style={{ cursor: "pointer" }}>
                <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill={color} />
                <circle cx="14" cy="14" r="5" fill="white" />
              </svg>
            ) : (
              <div style={{
                width: size, height: size, borderRadius: "50%",
                background: color, border: "2px solid white",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)", cursor: "pointer",
              }} />
            )}
          </AdvancedMarker>
        );
      })}
      {selected && (
        <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} onCloseClick={() => setSelected(null)}>
          <div style={{ minWidth: 200, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{selected.trapper_name}</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <span style={{ background: `${getTrapperTypeColor(selected.trapper_type)}20`, color: getTrapperTypeColor(selected.trapper_type), padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
                {selected.service_type === "primary_territory" ? "Primary Territory"
                  : selected.service_type === "regular" ? "Regular"
                  : selected.service_type === "occasional" ? "Occasional"
                  : selected.service_type === "home_rescue" ? "Home Rescue"
                  : selected.service_type}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 500,
                color: selected.availability_status === "available" ? "#16a34a"
                  : selected.availability_status === "busy" ? "#d97706" : "#6b7280",
              }}>
                {selected.availability_status === "available" ? "Available"
                  : selected.availability_status === "busy" ? "Busy" : "On Leave"}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{selected.place_name}</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
              {selected.active_assignments} active assignment{selected.active_assignments !== 1 ? "s" : ""}
              {selected.tier ? ` · ${selected.tier}` : ""}
            </div>
            <button
              onClick={() => { onPersonSelect(selected.person_id); setSelected(null); }}
              style={{ width: "100%", padding: "6px 12px", background: "#3b82f6", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
            >
              View Profile
            </button>
          </div>
        </InfoWindow>
      )}
    </>
  );
}
