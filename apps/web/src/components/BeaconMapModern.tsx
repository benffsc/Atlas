"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  createPinMarker,
  createCircleMarker,
  createStarMarker,
  createClinicMarker,
  createUserLocationMarker
} from "@/lib/map-markers";
import { MAP_COLORS, getPriorityColor } from "@/lib/map-colors";
import {
  buildPlacePopup,
  buildGooglePinPopup,
  buildTNRPriorityPopup,
  buildVolunteerPopup,
  buildClinicClientPopup,
  buildZonePopup,
} from "@/components/map/MapPopup";

// Types for map data
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

interface Volunteer {
  id: string;
  name: string;
  lat: number;
  lng: number;
  role: string;
  role_label: string;
  service_zone: string | null;
  is_active: boolean;
}

interface ClinicClient {
  id: string;
  address: string;
  lat: number;
  lng: number;
  appointment_count: number;
  cat_count: number;
  last_visit: string;
  service_zone: string;
}

interface HistoricalSource {
  place_id: string;
  address: string;
  lat: number;
  lng: number;
  condition_type: string;
  display_label: string;
  display_color: string;
  severity: string;
  valid_from: string;
  valid_to: string | null;
  peak_cat_count: number | null;
  ecological_impact: string | null;
  description: string | null;
  opacity: number;
}

interface DataCoverageZone {
  zone_id: string;
  zone_name: string;
  google_maps_entries: number;
  airtable_requests: number;
  clinic_appointments: number;
  intake_submissions: number;
  coverage_level: string;
}

interface MapSummary {
  total_places: number;
  total_cats: number;
  zones_needing_obs: number;
}

// Layer configuration
interface LayerConfig {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  defaultEnabled: boolean;
}

const LAYER_CONFIGS: LayerConfig[] = [
  { id: "places", label: "Colony Sites", icon: "🐱", color: "#3b82f6", description: "Places with known cat activity", defaultEnabled: true },
  { id: "google_pins", label: "Historical Pins", icon: "📍", color: "#f59e0b", description: "Google Maps historical data (AI classified)", defaultEnabled: false },
  { id: "tnr_priority", label: "TNR Priority", icon: "🎯", color: "#dc2626", description: "Targeted TNR priority areas", defaultEnabled: false },
  { id: "zones", label: "Observation Zones", icon: "📊", color: "#10b981", description: "Mark-recapture sampling zones", defaultEnabled: false },
  { id: "volunteers", label: "Volunteers", icon: "⭐", color: "#FFD700", description: "FFSC trappers and volunteers", defaultEnabled: false },
  { id: "clinic_clients", label: "Clinic Clients", icon: "🏥", color: "#8b5cf6", description: "Recent spay/neuter clients", defaultEnabled: false },
  { id: "historical_sources", label: "Historical Sources", icon: "📜", color: "#9333ea", description: "Places that were significant cat sources historically", defaultEnabled: false },
  { id: "data_coverage", label: "Data Coverage", icon: "📊", color: "#059669", description: "Areas with rich vs sparse historical data", defaultEnabled: false },
];

// Map branding
const MAP_TITLE = "Atlas Map";

const SERVICE_ZONES = [
  "All Zones",
  "Santa Rosa",
  "Petaluma",
  "West County",
  "North County",
  "South County",
  "Sonoma Valley",
  "Other",
];

// Colors now imported from map-colors.ts

export default function BeaconMapModern() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<Record<string, L.LayerGroup>>({});

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>(
    Object.fromEntries(LAYER_CONFIGS.map(l => [l.id, l.defaultEnabled]))
  );

  // Data
  const [places, setPlaces] = useState<Place[]>([]);
  const [googlePins, setGooglePins] = useState<GooglePin[]>([]);
  const [tnrPriority, setTnrPriority] = useState<TnrPriorityPlace[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [clinicClients, setClinicClients] = useState<ClinicClient[]>([]);
  const [historicalSources, setHistoricalSources] = useState<HistoricalSource[]>([]);
  const [dataCoverage, setDataCoverage] = useState<DataCoverageZone[]>([]);
  const [summary, setSummary] = useState<MapSummary | null>(null);

  // Search suggestions
  const [searchResults, setSearchResults] = useState<Array<{ type: string; item: Place | GooglePin | Volunteer; label: string }>>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Fetch map data
  const fetchMapData = useCallback(async () => {
    const layers = Object.entries(enabledLayers)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);

    if (layers.length === 0) {
      setPlaces([]);
      setGooglePins([]);
      setTnrPriority([]);
      setZones([]);
      setVolunteers([]);
      setClinicClients([]);
      setHistoricalSources([]);
      setDataCoverage([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ layers: layers.join(",") });
      if (selectedZone !== "All Zones") {
        params.set("zone", selectedZone);
      }

      const response = await fetch(`/api/beacon/map-data?${params}`);
      if (!response.ok) throw new Error("Failed to fetch map data");

      const data = await response.json();
      setPlaces(data.places || []);
      setGooglePins(data.google_pins || []);
      setTnrPriority(data.tnr_priority || []);
      setZones(data.zones || []);
      setVolunteers(data.volunteers || []);
      setClinicClients(data.clinic_clients || []);
      setHistoricalSources(data.historical_sources || []);
      setDataCoverage(data.data_coverage || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [enabledLayers, selectedZone]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
    }).setView([38.45, -122.75], 10);

    // Add Google-like tile layer (CartoDB Voyager)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    // Custom zoom control position
    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch data on mount and when filters change
  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  // Update places layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.places) {
      mapRef.current.removeLayer(layersRef.current.places);
    }
    if (!enabledLayers.places || places.length === 0) return;

    const layer = L.layerGroup();
    places.forEach((place) => {
      if (!place.lat || !place.lng) return;
      const color = getPriorityColor(place.priority);
      const size = place.priority === "high" ? 16 : place.priority === "medium" ? 14 : 12;

      const marker = L.marker([place.lat, place.lng], {
        icon: createCircleMarker(color, { size }),
      });

      marker.bindPopup(buildPlacePopup({
        id: place.id,
        address: place.address,
        cat_count: place.cat_count,
        priority: place.priority,
        service_zone: place.service_zone,
        has_observation: place.has_observation,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.places = layer;
  }, [places, enabledLayers.places]);

  // Update Google pins layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.google_pins) {
      mapRef.current.removeLayer(layersRef.current.google_pins);
    }
    if (!enabledLayers.google_pins || googlePins.length === 0) return;

    const layer = L.layerGroup();
    googlePins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;

      const color = pin.display_color || MAP_COLORS.layers.google_pins;
      const isAlert = pin.staff_alert || false;
      const size = isAlert ? 36 : 28;

      const marker = L.marker([pin.lat, pin.lng], {
        icon: createPinMarker(color, { size, isAlert }),
      });

      marker.bindPopup(buildGooglePinPopup({
        id: pin.id,
        name: pin.name,
        notes: pin.notes,
        cat_count: pin.cat_count ?? undefined,
        display_label: pin.display_label,
        display_color: pin.display_color,
        ai_meaning: pin.ai_meaning ?? undefined,
        ai_confidence: pin.ai_confidence ?? undefined,
        staff_alert: isAlert ? pin.display_label : undefined,
        disease_mentions: pin.disease_mentions ?? undefined,
        safety_concerns: pin.safety_concerns ?? undefined,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.google_pins = layer;
  }, [googlePins, enabledLayers.google_pins]);

  // Update TNR Priority layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.tnr_priority) {
      mapRef.current.removeLayer(layersRef.current.tnr_priority);
    }
    if (!enabledLayers.tnr_priority || tnrPriority.length === 0) return;

    const layer = L.layerGroup();
    tnrPriority.forEach((place) => {
      if (!place.lat || !place.lng) return;

      const color = MAP_COLORS.priority[place.tnr_priority as keyof typeof MAP_COLORS.priority] || MAP_COLORS.priority.unknown;
      const size = place.tnr_priority === "critical" ? 36 : place.tnr_priority === "high" ? 32 : 28;

      const marker = L.marker([place.lat, place.lng], {
        icon: createPinMarker(color, { size, label: "!" }),
      });

      marker.bindPopup(buildTNRPriorityPopup({
        id: place.id,
        address: place.address,
        cat_count: place.cat_count,
        altered_count: place.altered_count,
        alteration_rate: place.alteration_rate / 100, // Convert to decimal
        tnr_priority: place.tnr_priority,
        service_zone: place.service_zone,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.tnr_priority = layer;
  }, [tnrPriority, enabledLayers.tnr_priority]);

  // Update Zones layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.zones) {
      mapRef.current.removeLayer(layersRef.current.zones);
    }
    if (!enabledLayers.zones || zones.length === 0) return;

    const layer = L.layerGroup();
    zones.forEach((zone) => {
      // Add boundary polygon
      if (zone.boundary) {
        try {
          const geojson = JSON.parse(zone.boundary);
          const color = MAP_COLORS.layers.zones;
          const polygon = L.geoJSON(geojson, {
            style: {
              color,
              weight: 2,
              opacity: 0.8,
              fillColor: color,
              fillOpacity: 0.1,
            },
          });
          polygon.bindPopup(buildZonePopup({
            zone_id: zone.zone_id,
            zone_code: zone.zone_code,
            places_count: zone.places_count,
            total_cats: zone.total_cats,
            observation_status: zone.observation_status,
          }));
          layer.addLayer(polygon);
        } catch (e) {
          console.error("Failed to parse zone boundary:", e);
        }
      }
    });

    layer.addTo(mapRef.current);
    layersRef.current.zones = layer;
  }, [zones, enabledLayers.zones]);

  // Update Volunteers layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.volunteers) {
      mapRef.current.removeLayer(layersRef.current.volunteers);
    }
    if (!enabledLayers.volunteers || volunteers.length === 0) return;

    const layer = L.layerGroup();
    volunteers.forEach((vol) => {
      if (!vol.lat || !vol.lng) return;

      const color = MAP_COLORS.volunteerRoles[vol.role as keyof typeof MAP_COLORS.volunteerRoles] || MAP_COLORS.layers.volunteers;

      const marker = L.marker([vol.lat, vol.lng], {
        icon: createStarMarker(color, { size: 24 }),
      });

      marker.bindPopup(buildVolunteerPopup({
        id: vol.id,
        name: vol.name,
        role: vol.role,
        role_label: vol.role_label,
        service_zone: vol.service_zone || undefined,
        is_active: vol.is_active,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.volunteers = layer;
  }, [volunteers, enabledLayers.volunteers]);

  // Update Clinic Clients layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.clinic_clients) {
      mapRef.current.removeLayer(layersRef.current.clinic_clients);
    }
    if (!enabledLayers.clinic_clients || clinicClients.length === 0) return;

    const layer = L.layerGroup();
    clinicClients.forEach((client) => {
      if (!client.lat || !client.lng) return;

      const marker = L.marker([client.lat, client.lng], {
        icon: createClinicMarker(MAP_COLORS.layers.clinic_clients, { size: 14 }),
      });

      marker.bindPopup(buildClinicClientPopup({
        id: client.id,
        address: client.address,
        appointment_count: client.appointment_count,
        cat_count: client.cat_count,
        last_visit: client.last_visit,
        service_zone: client.service_zone,
      }));
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.clinic_clients = layer;
  }, [clinicClients, enabledLayers.clinic_clients]);

  // Update Historical Sources layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.historical_sources) {
      mapRef.current.removeLayer(layersRef.current.historical_sources);
    }
    if (!enabledLayers.historical_sources || historicalSources.length === 0) return;

    const layer = L.layerGroup();
    historicalSources.forEach((source) => {
      if (!source.lat || !source.lng) return;

      const color = source.display_color || "#9333ea";
      const size = source.peak_cat_count && source.peak_cat_count > 50 ? 32 :
                   source.peak_cat_count && source.peak_cat_count > 20 ? 28 : 24;

      // Create marker with opacity based on how recent
      const markerIcon = L.divIcon({
        className: "historical-source-marker",
        html: `<div style="
          width: ${size}px; height: ${size}px;
          background: ${color};
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          opacity: ${source.opacity};
          display: flex; align-items: center; justify-content: center;
          font-size: ${size * 0.4}px; color: white; font-weight: bold;
        ">📜</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([source.lat, source.lng], { icon: markerIcon });

      const validFrom = new Date(source.valid_from).toLocaleDateString();
      const validTo = source.valid_to ? new Date(source.valid_to).toLocaleDateString() : "Ongoing";

      marker.bindPopup(`
        <div style="min-width: 260px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="display: inline-block; background: ${color}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-bottom: 8px;">
            ${source.display_label}
          </div>
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${source.address}</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            <div style="background: #f3f4f6; padding: 8px; border-radius: 6px; text-align: center;">
              <div style="font-size: 16px; font-weight: 700; color: #374151;">${source.peak_cat_count || "?"}</div>
              <div style="font-size: 10px; color: #6b7280;">Peak Cats</div>
            </div>
            <div style="background: ${color}15; padding: 8px; border-radius: 6px; text-align: center;">
              <div style="font-size: 12px; font-weight: 600; color: ${color};">${source.severity}</div>
              <div style="font-size: 10px; color: #6b7280;">Severity</div>
            </div>
          </div>
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
            <strong>Period:</strong> ${validFrom} — ${validTo}
          </div>
          ${source.ecological_impact ? `
            <div style="font-size: 12px; background: #fef3c7; color: #92400e; padding: 6px 8px; border-radius: 6px; margin-bottom: 8px;">
              ⚠️ Ecological Impact: <strong>${source.ecological_impact}</strong>
            </div>
          ` : ""}
          ${source.description ? `
            <div style="font-size: 12px; color: #374151; background: #f9fafb; padding: 8px; border-radius: 6px; max-height: 80px; overflow-y: auto;">
              ${source.description}
            </div>
          ` : ""}
          <div style="font-size: 10px; color: #9ca3af; margin-top: 8px;">
            📜 Historical ecological context (${source.valid_to ? "resolved" : "ongoing"})
          </div>
        </div>
      `);
      layer.addLayer(marker);
    });

    layer.addTo(mapRef.current);
    layersRef.current.historical_sources = layer;
  }, [historicalSources, enabledLayers.historical_sources]);

  // Update Data Coverage layer (shows zones as colored polygons based on coverage level)
  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.data_coverage) {
      mapRef.current.removeLayer(layersRef.current.data_coverage);
    }
    if (!enabledLayers.data_coverage || dataCoverage.length === 0) return;

    const layer = L.layerGroup();

    // Create a simple info panel showing coverage by zone
    // Since we don't have zone polygons, we'll display as text overlay
    const coverageColors: Record<string, string> = {
      rich: "#059669",      // Green
      moderate: "#0891b2",  // Cyan
      sparse: "#f59e0b",    // Amber
      gap: "#dc2626",       // Red
    };

    // For now, add a text marker at the map center showing coverage summary
    // In the future, this could use actual zone polygons
    dataCoverage.forEach((zone) => {
      const color = coverageColors[zone.coverage_level] || "#6b7280";
      const totalPoints = zone.google_maps_entries + zone.airtable_requests +
                          zone.clinic_appointments + zone.intake_submissions;

      // We don't have lat/lng for zones, so we'll show as a legend/info panel instead
      // This is handled in the Legend section below
    });

    // Add info control
    const InfoControl = L.Control.extend({
      onAdd: function() {
        const div = L.DomUtil.create("div", "data-coverage-legend");
        div.style.cssText = `
          background: white;
          padding: 12px 16px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 12px;
          max-width: 280px;
        `;

        let html = `<div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">📊 Data Coverage by Zone</div>`;

        dataCoverage.forEach((zone) => {
          const color = coverageColors[zone.coverage_level] || "#6b7280";
          const totalPoints = zone.google_maps_entries + zone.airtable_requests +
                              zone.clinic_appointments + zone.intake_submissions;
          html += `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="width: 12px; height: 12px; border-radius: 3px; background: ${color};"></span>
              <span style="flex: 1; font-weight: 500;">${zone.zone_name}</span>
              <span style="color: #6b7280;">${totalPoints} pts</span>
              <span style="
                background: ${color}20;
                color: ${color};
                padding: 1px 6px;
                border-radius: 8px;
                font-size: 10px;
                font-weight: 600;
              ">${zone.coverage_level}</span>
            </div>
          `;
        });

        div.innerHTML = html;
        return div;
      }
    });

    const infoControl = new InfoControl({ position: "bottomleft" });

    // Store the control so we can remove it later
    (layer as L.LayerGroup & { _infoControl?: L.Control })._infoControl = infoControl;
    infoControl.addTo(mapRef.current);

    layer.addTo(mapRef.current);
    layersRef.current.data_coverage = layer;

    // Cleanup function to remove the control when layer is disabled
    return () => {
      if (mapRef.current && infoControl) {
        infoControl.remove();
      }
    };
  }, [dataCoverage, enabledLayers.data_coverage]);

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results: typeof searchResults = [];

    // Search places
    places.filter(p => p.address.toLowerCase().includes(query)).slice(0, 3).forEach(p => {
      results.push({ type: "place", item: p, label: p.address });
    });

    // Search Google pins
    googlePins.filter(p => p.name?.toLowerCase().includes(query) || p.notes?.toLowerCase().includes(query)).slice(0, 3).forEach(p => {
      results.push({ type: "google_pin", item: p, label: p.name || "Unnamed pin" });
    });

    // Search volunteers
    volunteers.filter(v => v.name.toLowerCase().includes(query)).slice(0, 3).forEach(v => {
      results.push({ type: "volunteer", item: v, label: `${v.name} (${v.role_label})` });
    });

    setSearchResults(results);
  }, [searchQuery, places, googlePins, volunteers]);

  const handleSearchSelect = (result: typeof searchResults[0]) => {
    const item = result.item as Place | GooglePin | Volunteer;
    if (mapRef.current && item.lat && item.lng) {
      mapRef.current.setView([item.lat, item.lng], 16, { animate: true, duration: 0.5 });
    }
    setSearchQuery("");
    setShowSearchResults(false);
  };

  const toggleLayer = (layerId: string) => {
    setEnabledLayers(prev => ({ ...prev, [layerId]: !prev[layerId] }));
  };

  // My Location functionality
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locatingUser, setLocatingUser] = useState(false);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const handleMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation([latitude, longitude]);
        setLocatingUser(false);
        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 15, { animate: true, duration: 0.8 });

          // Add/update user location marker
          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([latitude, longitude]);
          } else {
            userMarkerRef.current = L.marker([latitude, longitude], {
              icon: createUserLocationMarker(),
              zIndexOffset: 9999
            })
              .addTo(mapRef.current)
              .bindPopup("You are here");
          }
        }
      },
      (error) => {
        setLocatingUser(false);
        alert(`Unable to get location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Keyboard shortcuts
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          setShowSearchResults(false);
        }
        return;
      }

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "Escape":
          setShowSearchResults(false);
          setShowLayerPanel(false);
          break;
        case "+":
        case "=":
          mapRef.current?.zoomIn();
          break;
        case "-":
          mapRef.current?.zoomOut();
          break;
        case "l":
        case "L":
          setShowLayerPanel(prev => !prev);
          break;
        case "m":
        case "M":
          handleMyLocation();
          break;
        case "1":
          toggleLayer("places");
          break;
        case "2":
          toggleLayer("google_pins");
          break;
        case "3":
          toggleLayer("tnr_priority");
          break;
        case "4":
          toggleLayer("zones");
          break;
        case "5":
          toggleLayer("volunteers");
          break;
        case "6":
          toggleLayer("clinic_clients");
          break;
        case "7":
          toggleLayer("historical_sources");
          break;
        case "8":
          toggleLayer("data_coverage");
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Calculate total counts for display
  const totalMarkers = (enabledLayers.places ? places.length : 0) +
    (enabledLayers.google_pins ? googlePins.length : 0) +
    (enabledLayers.tnr_priority ? tnrPriority.length : 0) +
    (enabledLayers.volunteers ? volunteers.length : 0) +
    (enabledLayers.clinic_clients ? clinicClients.length : 0) +
    (enabledLayers.historical_sources ? historicalSources.length : 0);

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%" }}>
      {/* Map container */}
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

      {/* Search bar - Google style */}
      <div style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        width: "100%",
        maxWidth: 600,
        padding: "0 16px",
      }}>
        <div style={{
          background: "white",
          borderRadius: 24,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          padding: "8px 16px",
        }}>
          <span style={{ fontSize: 20, marginRight: 12, opacity: 0.5 }}>🔍</span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search addresses, pins, or volunteers... (press /)"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 15,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); setShowSearchResults(false); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, opacity: 0.5 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Search results dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <div style={{
            background: "white",
            borderRadius: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            marginTop: 8,
            maxHeight: 300,
            overflowY: "auto",
          }}>
            {searchResults.map((result, i) => (
              <div
                key={i}
                onClick={() => handleSearchSelect(result)}
                style={{
                  padding: "12px 16px",
                  cursor: "pointer",
                  borderBottom: i < searchResults.length - 1 ? "1px solid #f3f4f6" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
              >
                <span style={{ fontSize: 16 }}>
                  {result.type === "place" ? "🐱" : result.type === "google_pin" ? "📍" : "⭐"}
                </span>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{result.label}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {result.type === "place" ? "Colony Site" : result.type === "google_pin" ? "Historical Pin" : "Volunteer"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right side controls */}
      <div style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {/* Layer control button */}
        <button
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          title="Toggle layers (L)"
          style={{
            background: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: 14,
            fontWeight: 500,
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
        >
          <span style={{ fontSize: 18 }}>☰</span>
          Layers
        </button>

        {/* My Location button */}
        <button
          onClick={handleMyLocation}
          disabled={locatingUser}
          title="My location (M)"
          style={{
            background: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            cursor: locatingUser ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: 14,
            fontWeight: 500,
            opacity: locatingUser ? 0.7 : 1,
            transition: "background 0.2s, opacity 0.2s",
          }}
          onMouseEnter={(e) => !locatingUser && (e.currentTarget.style.background = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
        >
          <span style={{ fontSize: 18 }}>{locatingUser ? "⏳" : "📍"}</span>
          {locatingUser ? "Locating..." : "My Location"}
        </button>

        {/* Zoom controls */}
        <div style={{
          background: "white",
          borderRadius: 8,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          overflow: "hidden",
        }}>
          <button
            onClick={() => mapRef.current?.zoomIn()}
            title="Zoom in (+)"
            style={{
              background: "white",
              border: "none",
              borderBottom: "1px solid #e5e7eb",
              padding: "8px 14px",
              cursor: "pointer",
              display: "block",
              width: "100%",
              fontSize: 20,
              fontWeight: 500,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
          >
            +
          </button>
          <button
            onClick={() => mapRef.current?.zoomOut()}
            title="Zoom out (-)"
            style={{
              background: "white",
              border: "none",
              padding: "8px 14px",
              cursor: "pointer",
              display: "block",
              width: "100%",
              fontSize: 20,
              fontWeight: 500,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
          >
            −
          </button>
        </div>
      </div>

      {/* Layer panel */}
      {showLayerPanel && (
        <div style={{
          position: "absolute",
          top: 16,
          right: 180,
          zIndex: 1000,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          width: 300,
          maxHeight: "calc(100vh - 100px)",
          overflowY: "auto",
        }}>
          <div style={{ padding: 16, borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Map Layers</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {totalMarkers.toLocaleString()} markers shown
            </div>
          </div>

          {/* Zone filter */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", marginBottom: 8 }}>
              Service Zone
            </div>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              {SERVICE_ZONES.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          {/* Layer toggles */}
          <div style={{ padding: "8px 0" }}>
            {LAYER_CONFIGS.map((layer) => {
              const count = layer.id === "places" ? places.length :
                layer.id === "google_pins" ? googlePins.length :
                layer.id === "tnr_priority" ? tnrPriority.length :
                layer.id === "zones" ? zones.length :
                layer.id === "volunteers" ? volunteers.length :
                layer.id === "clinic_clients" ? clinicClients.length :
                layer.id === "historical_sources" ? historicalSources.length :
                layer.id === "data_coverage" ? dataCoverage.length : 0;

              return (
                <div
                  key={layer.id}
                  onClick={() => toggleLayer(layer.id)}
                  style={{
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    background: enabledLayers[layer.id] ? `${layer.color}10` : "transparent",
                    borderLeft: enabledLayers[layer.id] ? `3px solid ${layer.color}` : "3px solid transparent",
                  }}
                >
                  <span style={{ fontSize: 20 }}>{layer.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      {layer.label}
                      <span style={{
                        background: "#f3f4f6",
                        padding: "1px 6px",
                        borderRadius: 10,
                        fontSize: 11,
                        color: "#6b7280",
                      }}>
                        {count}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{layer.description}</div>
                  </div>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: `2px solid ${enabledLayers[layer.id] ? layer.color : "#d1d5db"}`,
                    background: enabledLayers[layer.id] ? layer.color : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 12,
                  }}>
                    {enabledLayers[layer.id] && "✓"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          {(enabledLayers.google_pins || enabledLayers.tnr_priority || enabledLayers.historical_sources) && (
            <div style={{ padding: 16, borderTop: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", marginBottom: 8 }}>
                Legend
              </div>

              {enabledLayers.google_pins && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>AI Classifications</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Disease Risk", color: "#FF0000" },
                      { label: "Watch List", color: "#FF6600" },
                      { label: "Volunteer", color: "#FFD700" },
                      { label: "Active Colony", color: "#00AA00" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: `${color}15`,
                        borderRadius: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {enabledLayers.tnr_priority && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>TNR Priority</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Critical", color: "#dc2626" },
                      { label: "High", color: "#ea580c" },
                      { label: "Medium", color: "#ca8a04" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: `${color}15`,
                        borderRadius: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {enabledLayers.historical_sources && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>Historical Conditions</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {[
                      { label: "Hoarding", color: "#9333ea" },
                      { label: "Breeding Crisis", color: "#dc2626" },
                      { label: "Disease Outbreak", color: "#ef4444" },
                      { label: "Resolved", color: "#10b981" },
                    ].map(({ label, color }) => (
                      <span key={label} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        background: `${color}15`,
                        borderRadius: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>
                    Opacity indicates recency (fainter = older)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats bar */}
      {summary && (
        <div style={{
          position: "absolute",
          bottom: 24,
          left: 16,
          zIndex: 1000,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          padding: "10px 16px",
          display: "flex",
          gap: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#374151" }}>
              {summary.total_places.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Total Places</div>
          </div>
          <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#374151" }}>
              {summary.total_cats.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Cats Linked</div>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "white",
          padding: "16px 24px",
          borderRadius: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 1001,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <div style={{
            width: 20,
            height: 20,
            border: "2px solid #e5e7eb",
            borderTopColor: "#3b82f6",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }} />
          <span style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            Loading map data...
          </span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "#fef2f2",
          color: "#b91c1c",
          padding: "16px 24px",
          borderRadius: 12,
          zIndex: 1001,
        }}>
          {error}
        </div>
      )}

      {/* Keyboard shortcuts help */}
      <div style={{
        position: "absolute",
        bottom: 24,
        right: 16,
        zIndex: 999,
        background: "rgba(255,255,255,0.95)",
        borderRadius: 8,
        boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
        padding: "8px 12px",
        fontSize: 11,
        color: "#6b7280",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Keyboard Shortcuts</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
          <span><kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>/</kbd> Search</span>
          <span><kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>L</kbd> Layers</span>
          <span><kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>M</kbd> My Location</span>
          <span><kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>+/-</kbd> Zoom</span>
          <span><kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>1-8</kbd> Toggle layers</span>
          <span><kbd style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>Esc</kbd> Close</span>
        </div>
      </div>

      {/* CSS animations are in beacon-map.css */}
    </div>
  );
}
