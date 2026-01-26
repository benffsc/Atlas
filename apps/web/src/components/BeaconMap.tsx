"use client";

import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Place {
  id: string;
  address: string;
  lat: number;
  lng: number;
  cat_count: number;
  priority: string;
  has_observation: boolean;
  service_zone: string;
}

interface GooglePin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notes: string;
  entry_type: string;
  signals?: string[];
  cat_count?: number | null;
  // AI classification fields
  ai_meaning?: string | null;
  display_label?: string;
  display_color?: string;
  staff_alert?: boolean;
  ai_confidence?: number | null;
  disease_mentions?: string[] | null;
  safety_concerns?: string[] | null;
}

interface TnrPriorityPlace {
  id: string;
  address: string;
  lat: number;
  lng: number;
  cat_count: number;
  altered_count: number;
  alteration_rate: number;
  tnr_priority: string;
  has_observation: boolean;
  service_zone: string;
}

interface Zone {
  zone_id: string;
  zone_code: string;
  anchor_lat: number;
  anchor_lng: number;
  places_count: number;
  total_cats: number;
  observation_status: string;
  boundary?: string;
}

interface BeaconMapProps {
  places: Place[];
  googlePins: GooglePin[];
  zones: Zone[];
  tnrPriority?: TnrPriorityPlace[];
  loading?: boolean;
}

// Custom marker icons
const createCircleIcon = (color: string, size: number = 10) => {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background-color: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#3b82f6",
};

const ZONE_STATUS_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#eab308",
  refresh: "#8b5cf6",
  current: "#10b981",
  unknown: "#6b7280",
};

// TNR Priority colors (for targeted TNR layer)
const TNR_PRIORITY_COLORS: Record<string, string> = {
  critical: "#dc2626", // Red - <25% altered, 10+ cats
  high: "#ea580c", // Orange - 25-50% altered, 5+ cats
  medium: "#ca8a04", // Yellow - 50-75% altered
  managed: "#16a34a", // Green - >75% altered
  unknown: "#6b7280", // Gray
};

// Google Maps signal colors (meaningful pin types)
const SIGNAL_COLORS: Record<string, string> = {
  pregnant_nursing: "#ec4899", // Pink - active breeding
  mortality: "#1f2937", // Dark gray - deceased cats
  relocated: "#8b5cf6", // Purple - cats moved
  adopted: "#10b981", // Green - successful outcome
  temperament: "#f59e0b", // Orange - behavior notes
  general: "#6366f1", // Indigo - default
};

export default function BeaconMap({
  places,
  googlePins,
  zones,
  tnrPriority = [],
  loading = false,
}: BeaconMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<{
    places?: L.LayerGroup;
    googlePins?: L.LayerGroup;
    zones?: L.LayerGroup;
    zoneBoundaries?: L.LayerGroup;
    tnrPriority?: L.LayerGroup;
  }>({});

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Sonoma County center
    const map = L.map(mapContainerRef.current).setView([38.45, -122.75], 10);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update places layer
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing places layer
    if (layersRef.current.places) {
      mapRef.current.removeLayer(layersRef.current.places);
    }

    if (places.length === 0) return;

    const placesLayer = L.layerGroup();

    places.forEach((place) => {
      if (!place.lat || !place.lng) return;

      const color = PRIORITY_COLORS[place.priority] || "#3b82f6";
      const size = place.priority === "high" ? 14 : place.priority === "medium" ? 12 : 10;

      const marker = L.marker([place.lat, place.lng], {
        icon: createCircleIcon(color, size),
      });

      marker.bindPopup(`
        <div style="min-width: 200px;">
          <strong>${place.address}</strong><br/>
          <span style="color: ${color};">● ${place.cat_count} cats</span><br/>
          <span style="font-size: 0.75rem; color: #6b7280;">
            ${place.service_zone}
            ${place.has_observation ? " • Has observation data" : " • Needs observation"}
          </span><br/>
          <a href="/places/${place.id}" target="_blank" style="font-size: 0.75rem;">View place →</a>
        </div>
      `);

      placesLayer.addLayer(marker);
    });

    placesLayer.addTo(mapRef.current);
    layersRef.current.places = placesLayer;
  }, [places]);

  // Update Google pins layer (with AI classification support)
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing layer
    if (layersRef.current.googlePins) {
      mapRef.current.removeLayer(layersRef.current.googlePins);
    }

    if (googlePins.length === 0) return;

    const pinsLayer = L.layerGroup();

    googlePins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;

      // Use AI classification color if available, otherwise fall back to signal colors
      let color: string;
      let size = 12;

      if (pin.display_color && pin.ai_meaning) {
        // AI classified - use AI-derived color
        color = pin.display_color;
        // Larger size for staff alerts
        if (pin.staff_alert) {
          size = 16;
        } else if (pin.ai_meaning === 'active_colony') {
          size = 14;
        }
      } else {
        // Fallback to old signal-based colors
        const primarySignal = pin.signals?.[0] || pin.entry_type || "general";
        color = SIGNAL_COLORS[primarySignal] || SIGNAL_COLORS.general;
      }

      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: "google-pin-marker",
          html: `<div style="
            width: ${size}px;
            height: ${size}px;
            background-color: ${color};
            border: 2px solid ${pin.staff_alert ? '#000' : 'white'};
            border-radius: 50%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            ${pin.staff_alert ? 'animation: pulse 2s infinite;' : ''}
          "></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      });

      // Truncate notes for popup
      const truncatedNotes =
        pin.notes.length > 300 ? pin.notes.substring(0, 300) + "..." : pin.notes;

      // Build staff alert section if applicable
      let staffAlertHtml = '';
      if (pin.staff_alert && pin.display_label) {
        staffAlertHtml = `
          <div style="
            background-color: #fef2f2;
            border: 1px solid #ef4444;
            border-radius: 0.25rem;
            padding: 0.5rem;
            margin-bottom: 0.5rem;
          ">
            <strong style="color: #dc2626;">⚠️ STAFF ALERT: ${pin.display_label}</strong>
            ${pin.disease_mentions?.length ? `<div style="font-size: 0.75rem; margin-top: 0.25rem;">Disease: ${pin.disease_mentions.join(', ')}</div>` : ''}
            ${pin.safety_concerns?.length ? `<div style="font-size: 0.75rem; margin-top: 0.25rem;">Safety: ${pin.safety_concerns.join(', ')}</div>` : ''}
          </div>
        `;
      }

      // Build classification badge
      let classificationBadge = '';
      if (pin.ai_meaning && pin.display_label) {
        classificationBadge = `
          <span style="
            display: inline-block;
            padding: 0.125rem 0.5rem;
            margin-bottom: 0.25rem;
            font-size: 0.65rem;
            font-weight: 600;
            background-color: ${color}20;
            color: ${color};
            border-radius: 0.25rem;
            border: 1px solid ${color}40;
          ">${pin.display_label}</span>
        `;
      }

      // Format signals as badges (legacy)
      const signalBadges = (pin.signals || [])
        .filter(s => s && s !== pin.ai_meaning) // Don't duplicate AI classification
        .map((s) => {
          const badgeColor = SIGNAL_COLORS[s] || SIGNAL_COLORS.general;
          return `<span style="
            display: inline-block;
            padding: 0.125rem 0.375rem;
            margin: 0.125rem;
            font-size: 0.625rem;
            background-color: ${badgeColor}20;
            color: ${badgeColor};
            border-radius: 0.25rem;
            border: 1px solid ${badgeColor}40;
          ">${s.replace(/_/g, " ")}</span>`;
        })
        .join("");

      marker.bindPopup(`
        <div style="min-width: 250px; max-width: 350px;">
          ${staffAlertHtml}
          ${classificationBadge}
          <strong style="color: ${color};">📍 ${pin.name || "Unnamed"}</strong>
          ${pin.cat_count ? `<span style="margin-left: 0.5rem; font-size: 0.75rem;">(${pin.cat_count} cats)</span>` : ""}
          ${pin.ai_confidence ? `<span style="margin-left: 0.25rem; font-size: 0.65rem; color: #9ca3af;">${Math.round((pin.ai_confidence || 0) * 100)}% conf</span>` : ""}
          <br/>
          ${signalBadges ? `<div style="margin-top: 0.25rem;">${signalBadges}</div>` : ""}
          ${
            truncatedNotes
              ? `<div style="margin-top: 0.5rem; font-size: 0.8rem; white-space: pre-wrap; max-height: 150px; overflow-y: auto; line-height: 1.3;">${truncatedNotes}</div>`
              : ""
          }
          <div style="margin-top: 0.5rem; font-size: 0.65rem; color: #9ca3af;">
            ${pin.ai_meaning ? 'AI classified Google Maps entry' : 'Historical Google Maps entry'}
          </div>
        </div>
      `);

      pinsLayer.addLayer(marker);
    });

    pinsLayer.addTo(mapRef.current);
    layersRef.current.googlePins = pinsLayer;
  }, [googlePins]);

  // Update zones layer
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing layers
    if (layersRef.current.zones) {
      mapRef.current.removeLayer(layersRef.current.zones);
    }
    if (layersRef.current.zoneBoundaries) {
      mapRef.current.removeLayer(layersRef.current.zoneBoundaries);
    }

    if (zones.length === 0) return;

    const zonesLayer = L.layerGroup();
    const boundariesLayer = L.layerGroup();

    zones.forEach((zone) => {
      // Add anchor point marker
      if (zone.anchor_lat && zone.anchor_lng) {
        const color = ZONE_STATUS_COLORS[zone.observation_status] || "#6b7280";

        const marker = L.marker([zone.anchor_lat, zone.anchor_lng], {
          icon: L.divIcon({
            className: "zone-marker",
            html: `<div style="
              width: 20px;
              height: 20px;
              background-color: ${color};
              border: 3px solid white;
              border-radius: 4px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 10px;
              font-weight: bold;
              color: white;
            ">Z</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
        });

        marker.bindPopup(`
          <div style="min-width: 200px;">
            <strong>Zone ${zone.zone_code}</strong><br/>
            <span style="color: ${color};">● ${zone.observation_status}</span><br/>
            <div style="margin-top: 0.5rem; font-size: 0.875rem;">
              <div>Places in zone: ${zone.places_count}</div>
              <div>Cats linked: ${zone.total_cats}</div>
            </div>
          </div>
        `);

        zonesLayer.addLayer(marker);
      }

      // Add boundary polygon if available
      if (zone.boundary) {
        try {
          const geojson = JSON.parse(zone.boundary);
          const color = ZONE_STATUS_COLORS[zone.observation_status] || "#6b7280";

          const polygon = L.geoJSON(geojson, {
            style: {
              color: color,
              weight: 2,
              opacity: 0.7,
              fillColor: color,
              fillOpacity: 0.1,
            },
          });

          boundariesLayer.addLayer(polygon);
        } catch (e) {
          console.error("Failed to parse zone boundary:", e);
        }
      }
    });

    zonesLayer.addTo(mapRef.current);
    boundariesLayer.addTo(mapRef.current);
    layersRef.current.zones = zonesLayer;
    layersRef.current.zoneBoundaries = boundariesLayer;
  }, [zones]);

  // Update TNR Priority layer
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing layer
    if (layersRef.current.tnrPriority) {
      mapRef.current.removeLayer(layersRef.current.tnrPriority);
    }

    if (tnrPriority.length === 0) return;

    const tnrLayer = L.layerGroup();

    tnrPriority.forEach((place) => {
      if (!place.lat || !place.lng) return;

      const color = TNR_PRIORITY_COLORS[place.tnr_priority] || TNR_PRIORITY_COLORS.unknown;
      const size = place.tnr_priority === "critical" ? 16 : place.tnr_priority === "high" ? 14 : 12;

      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: "tnr-priority-marker",
          html: `<div style="
            width: ${size}px;
            height: ${size}px;
            background-color: ${color};
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            ${place.tnr_priority === "critical" ? "animation: pulse 2s infinite;" : ""}
          "></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      });

      // Calculate work remaining
      const unalteredCount = place.cat_count - place.altered_count;

      marker.bindPopup(`
        <div style="min-width: 220px;">
          <div style="
            display: inline-block;
            padding: 0.125rem 0.5rem;
            margin-bottom: 0.5rem;
            font-size: 0.65rem;
            font-weight: 600;
            text-transform: uppercase;
            background-color: ${color}20;
            color: ${color};
            border-radius: 0.25rem;
            border: 1px solid ${color};
          ">${place.tnr_priority} PRIORITY</div>
          <br/>
          <strong>${place.address}</strong><br/>
          <div style="margin-top: 0.5rem; font-size: 0.875rem;">
            <div style="display: flex; justify-content: space-between;">
              <span>Total cats:</span>
              <strong>${place.cat_count}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Altered:</span>
              <strong>${place.altered_count}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: ${color};">
              <span>Need TNR:</span>
              <strong>${unalteredCount}</strong>
            </div>
            <div style="margin-top: 0.25rem; display: flex; justify-content: space-between;">
              <span>Alteration rate:</span>
              <strong>${place.alteration_rate}%</strong>
            </div>
          </div>
          <div style="
            margin-top: 0.5rem;
            height: 6px;
            background-color: #e5e7eb;
            border-radius: 3px;
            overflow: hidden;
          ">
            <div style="
              height: 100%;
              width: ${Math.min(place.alteration_rate, 100)}%;
              background-color: ${place.alteration_rate >= 75 ? '#16a34a' : place.alteration_rate >= 50 ? '#ca8a04' : '#dc2626'};
            "></div>
          </div>
          <div style="margin-top: 0.5rem; font-size: 0.75rem; color: #6b7280;">
            ${place.service_zone}
            ${place.has_observation ? " • Has observation" : " • Needs observation"}
          </div>
          <a href="/places/${place.id}" target="_blank" style="font-size: 0.75rem;">View place →</a>
        </div>
      `);

      tnrLayer.addLayer(marker);
    });

    tnrLayer.addTo(mapRef.current);
    layersRef.current.tnrPriority = tnrLayer;
  }, [tnrPriority]);

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.7; }
        }
      `}</style>
      <div
        ref={mapContainerRef}
        style={{
          height: "600px",
          borderRadius: "0.5rem",
          border: "1px solid #e5e7eb",
        }}
      />
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(255,255,255,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "0.5rem",
          }}
        >
          Loading map data...
        </div>
      )}
    </div>
  );
}
