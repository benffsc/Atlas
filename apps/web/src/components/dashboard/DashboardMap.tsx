"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import {
  GroupedLayerControl,
  type LayerGroup,
} from "@/components/map/GroupedLayerControl";
import type { AtlasPin } from "@/hooks/useMapData";

export interface DashboardMapPin {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  place_name: string | null;
  place_address: string | null;
  lat: number;
  lng: number;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  created_at: string;
  layer?: string;
}

export type MapLayer = "active" | "all" | "completed" | "intake";

interface DashboardMapProps {
  requestPins: DashboardMapPin[];
  intakePins: DashboardMapPin[];
  atlasPins: AtlasPin[];
  enabledLayers: Record<string, boolean>;
  onToggleLayer: (layerId: string) => void;
  onPinClick: (entityType: "request" | "place", entityId: string) => void;
  onSearch: (query: string) => void;
  loading?: boolean;
  layerCounts?: Record<string, number>;
}

// Pin style → color (matches AtlasMap.tsx)
const ATLAS_PIN_COLORS: Record<string, string> = {
  disease: "#ea580c",
  watch_list: "#8b5cf6",
  active: "#22c55e",
  active_requests: "#14b8a6",
  has_history: "#6366f1",
  minimal: "#94a3b8",
};

// Match StatusBadge + design-tokens exactly
const STATUS_COLORS: Record<string, string> = {
  new: "#3b82f6",
  triaged: "#3b82f6",
  working: "#f59e0b",
  scheduled: "#f59e0b",
  in_progress: "#f59e0b",
  paused: "#ec4899",
  on_hold: "#ec4899",
  completed: "#10b981",
  redirected: "#9ca3af",
  handed_off: "#0d9488",
  cancelled: "#9ca3af",
  default: "#9ca3af",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const SONOMA_CENTER: [number, number] = [38.45, -122.75];
const DEFAULT_ZOOM = 10;

/** Dashboard layer group definitions */
export const DASHBOARD_LAYER_GROUPS: LayerGroup[] = [
  {
    id: "requests",
    label: "Requests",
    icon: "\u{1F4CB}",
    color: "#3b82f6",
    defaultExpanded: true,
    exclusive: true,
    children: [
      { id: "requests_active", label: "Active", color: "#3b82f6", defaultEnabled: true },
      { id: "requests_all", label: "All", color: "#9ca3af", defaultEnabled: false },
      { id: "requests_completed", label: "Completed", color: "#10b981", defaultEnabled: false },
    ],
  },
  {
    id: "intake",
    label: "Intake",
    icon: "\u{1F4E5}",
    color: "#f97316",
    defaultExpanded: false,
    children: [
      { id: "intake_pending", label: "Pending", color: "#f97316", defaultEnabled: false },
    ],
  },
  {
    id: "atlas",
    label: "Atlas Data",
    icon: "\u{1F4CD}",
    color: "#22c55e",
    defaultExpanded: false,
    children: [
      { id: "atlas_all", label: "All Places", color: "#22c55e", defaultEnabled: false },
      { id: "atlas_disease", label: "Disease Risk", color: "#ea580c", defaultEnabled: false },
      { id: "atlas_watch", label: "Watch List", color: "#8b5cf6", defaultEnabled: false },
    ],
  },
];

/** Get default enabled layers from group definitions */
export function getDefaultEnabledLayers(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const group of DASHBOARD_LAYER_GROUPS) {
    for (const child of group.children) {
      if (child.defaultEnabled) result[child.id] = true;
    }
  }
  return result;
}

function getPinColor(pin: DashboardMapPin): string {
  if (pin.layer === "intake") return "#f97316";
  return STATUS_COLORS[pin.status] || STATUS_COLORS.default;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function buildRequestPopupHtml(pin: DashboardMapPin, viewDetailsFn: string): string {
  const name = pin.place_name || pin.place_address || "Unknown location";
  const address = pin.place_address && pin.place_name ? pin.place_address.split(",")[0] : "";
  const statusColor = getPinColor(pin);
  const priorityLabel = PRIORITY_LABELS[pin.priority] || pin.priority;
  const catInfo = pin.estimated_cat_count
    ? `${pin.estimated_cat_count} cat${pin.estimated_cat_count > 1 ? "s" : ""}${pin.has_kittens ? " (kittens)" : ""}`
    : pin.has_kittens
      ? "Has kittens"
      : "";

  return `
    <div style="min-width:200px;max-width:280px;font-family:system-ui,-apple-system,sans-serif;">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px;line-height:1.3;">${name}</div>
      ${address ? `<div style="font-size:11px;opacity:0.6;margin-bottom:6px;">${address}</div>` : ""}
      ${pin.summary ? `<div style="font-size:12px;opacity:0.7;margin-bottom:6px;line-height:1.3;">${pin.summary}</div>` : ""}
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
        <span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;background:${statusColor};color:#fff;">${formatStatus(pin.status)}</span>
        <span style="font-size:10px;opacity:0.6;">${priorityLabel}</span>
        <span style="font-size:10px;opacity:0.5;">${timeAgo(pin.created_at)}</span>
      </div>
      ${catInfo ? `<div style="font-size:11px;color:#7c3aed;">${catInfo}</div>` : ""}
      <div style="margin-top:8px;border-top:1px solid rgba(128,128,128,0.25);padding-top:6px;">
        <a href="/requests/${pin.request_id}"
           onclick="event.preventDefault();event.stopPropagation();${viewDetailsFn}('request','${pin.request_id}')"
           style="font-size:11px;color:#3b82f6;text-decoration:none;cursor:pointer;">
          View Details
        </a>
      </div>
    </div>
  `;
}

function buildAtlasPinPopupHtml(pin: AtlasPin, viewDetailsFn: string): string {
  const name = pin.display_name || pin.address || "Unknown location";
  const address = pin.display_name ? pin.address.split(",")[0] : "";
  const pinColor = ATLAS_PIN_COLORS[pin.pin_style] || ATLAS_PIN_COLORS.minimal;

  const stats: string[] = [];
  if (pin.cat_count > 0) stats.push(`${pin.cat_count} cat${pin.cat_count !== 1 ? "s" : ""}`);
  if (pin.person_count > 0) stats.push(`${pin.person_count} ${pin.person_count !== 1 ? "people" : "person"}`);
  if (pin.active_request_count > 0) stats.push(`${pin.active_request_count} active req${pin.active_request_count !== 1 ? "s" : ""}`);

  const diseaseBadgesHtml = pin.disease_badges.length > 0
    ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
        ${pin.disease_badges.slice(0, 3).map((b) =>
          `<span style="font-size:9px;font-weight:600;padding:1px 4px;border-radius:3px;background:${b.color};color:#fff;">${b.short_code}</span>`
        ).join("")}
       </div>`
    : "";

  return `
    <div style="min-width:200px;max-width:280px;font-family:system-ui,-apple-system,sans-serif;">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px;line-height:1.3;">${name}</div>
      ${address ? `<div style="font-size:11px;opacity:0.6;margin-bottom:6px;">${address}</div>` : ""}
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
        <span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;background:${pinColor};color:#fff;">${formatStatus(pin.pin_style)}</span>
        ${pin.service_zone ? `<span style="font-size:10px;opacity:0.5;">${pin.service_zone}</span>` : ""}
      </div>
      ${stats.length > 0 ? `<div style="font-size:11px;color:var(--text-muted,#64748b);margin-bottom:4px;">${stats.join(" \u00B7 ")}</div>` : ""}
      ${diseaseBadgesHtml}
      <div style="margin-top:8px;border-top:1px solid rgba(128,128,128,0.25);padding-top:6px;">
        <a href="/places/${pin.id}"
           onclick="event.preventDefault();event.stopPropagation();${viewDetailsFn}('place','${pin.id}')"
           style="font-size:11px;color:#3b82f6;text-decoration:none;cursor:pointer;">
          Preview
        </a>
        <a href="/places/${pin.id}"
           style="font-size:11px;color:#3b82f6;text-decoration:none;cursor:pointer;margin-left:12px;">
          Full Page &rarr;
        </a>
      </div>
    </div>
  `;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createClusterGroup(L: any, color: string) {
  return L.markerClusterGroup({
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 15,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    iconCreateFunction(clusterObj: any) {
      const count = clusterObj.getChildCount();
      const size = count < 10 ? 32 : count < 50 ? 38 : 44;
      const bg = `rgba(${hexToRgb(color)},${count < 10 ? 0.7 : count < 50 ? 0.75 : 0.8})`;
      return L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${size < 38 ? 12 : 13}px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.6);">${count}</div>`,
        className: "",
        iconSize: L.point(size, size),
        iconAnchor: [size / 2, size / 2],
      });
    },
  });
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export function DashboardMap({
  requestPins,
  intakePins,
  atlasPins,
  enabledLayers,
  onToggleLayer,
  onPinClick,
  onSearch,
  loading,
  layerCounts,
}: DashboardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterGroupsRef = useRef<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable callback ref
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;

  // Register global handler for popup links
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__dashMapPreview = (entityType: "request" | "place", entityId: string) => {
      onPinClickRef.current(entityType, entityId);
    };
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__dashMapPreview;
    };
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      const LCjs = require("leaflet");
      require("leaflet.markercluster");

      if (cancelled || !containerRef.current) return;

      leafletRef.current = LCjs;

      const map = L.map(containerRef.current, {
        center: SONOMA_CENTER,
        zoom: DEFAULT_ZOOM,
        scrollWheelZoom: false,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      map.getContainer().addEventListener("click", () => {
        map.scrollWheelZoom.enable();
      });
      map.on("mouseout", () => {
        map.scrollWheelZoom.disable();
      });

      mapRef.current = map;
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update markers when data or layers change
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    // Remove all existing cluster groups
    Object.values(clusterGroupsRef.current).forEach((group) => {
      if (map.hasLayer(group)) map.removeLayer(group);
    });
    clusterGroupsRef.current = {};

    // Import marker creators dynamically (they depend on leaflet globals)
    const { createAtlasPinMarker, createReferencePinMarker } = require("@/lib/map-markers");

    const bounds = L.latLngBounds([]);
    let hasAnyPins = false;

    // --- Request pins ---
    const showRequests = enabledLayers.requests_active || enabledLayers.requests_all || enabledLayers.requests_completed;
    if (showRequests && requestPins.length > 0) {
      const requestCluster = createClusterGroup(L, "#3b82f6");

      requestPins.forEach((pin) => {
        const color = getPinColor(pin);
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -8],
        });

        const marker = L.marker([pin.lat, pin.lng], { icon });
        marker.bindPopup(buildRequestPopupHtml(pin, "window.__dashMapPreview"), {
          className: "dashboard-map-popup",
          closeButton: true,
          maxWidth: 300,
        });
        requestCluster.addLayer(marker);
        bounds.extend([pin.lat, pin.lng]);
        hasAnyPins = true;
      });

      map.addLayer(requestCluster);
      clusterGroupsRef.current.requests = requestCluster;
    }

    // --- Intake pins ---
    if (enabledLayers.intake_pending && intakePins.length > 0) {
      const intakeCluster = createClusterGroup(L, "#f97316");

      intakePins.forEach((pin) => {
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:14px;height:14px;border-radius:50%;background:#f97316;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -8],
        });

        const marker = L.marker([pin.lat, pin.lng], { icon });
        marker.bindPopup(buildRequestPopupHtml({ ...pin, layer: "intake" }, "window.__dashMapPreview"), {
          className: "dashboard-map-popup",
          closeButton: true,
          maxWidth: 300,
        });
        intakeCluster.addLayer(marker);
        bounds.extend([pin.lat, pin.lng]);
        hasAnyPins = true;
      });

      map.addLayer(intakeCluster);
      clusterGroupsRef.current.intake = intakeCluster;
    }

    // --- Atlas pins ---
    const showAtlas = enabledLayers.atlas_all || enabledLayers.atlas_disease || enabledLayers.atlas_watch;
    if (showAtlas && atlasPins.length > 0) {
      const atlasCluster = createClusterGroup(L, "#22c55e");

      // Filter atlas pins based on which sub-layers are enabled
      const filteredAtlas = atlasPins.filter((pin) => {
        if (enabledLayers.atlas_all) return true;
        if (enabledLayers.atlas_disease && pin.pin_style === "disease") return true;
        if (enabledLayers.atlas_watch && pin.pin_style === "watch_list") return true;
        return false;
      });

      filteredAtlas.forEach((pin) => {
        const color = ATLAS_PIN_COLORS[pin.pin_style] || ATLAS_PIN_COLORS.minimal;
        // Dashboard uses smaller pin sizes: 24px active, 14px reference
        const isActive = pin.pin_tier === "active";
        const icon = isActive
          ? createAtlasPinMarker(color, {
              size: 24,
              pinStyle: pin.pin_style,
              catCount: pin.cat_count,
              diseaseBadges: pin.disease_badges?.slice(0, 2) || [],
            })
          : createReferencePinMarker(color, {
              size: 14,
              pinStyle: pin.pin_style,
            });

        const marker = L.marker([pin.lat, pin.lng], { icon });
        marker.bindPopup(buildAtlasPinPopupHtml(pin, "window.__dashMapPreview"), {
          className: "dashboard-map-popup",
          closeButton: true,
          maxWidth: 300,
        });
        atlasCluster.addLayer(marker);
        bounds.extend([pin.lat, pin.lng]);
        hasAnyPins = true;
      });

      map.addLayer(atlasCluster);
      clusterGroupsRef.current.atlas = atlasCluster;
    }

    // Fit bounds if we have pins
    if (hasAnyPins) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [requestPins, intakePins, atlasPins, enabledLayers]);

  useEffect(() => {
    if (mapReady) updateMarkers();
  }, [mapReady, updateMarkers]);

  const handleSearchInput = (value: string) => {
    setSearchValue(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      onSearch(value);
    }, 400);
  };

  // Total visible pin count
  const totalPins =
    (enabledLayers.requests_active || enabledLayers.requests_all || enabledLayers.requests_completed ? requestPins.length : 0) +
    (enabledLayers.intake_pending ? intakePins.length : 0) +
    (enabledLayers.atlas_all || enabledLayers.atlas_disease || enabledLayers.atlas_watch ? atlasPins.length : 0);

  return (
    <div className="dashboard-map-container">
      {/* Controls overlay */}
      <div className="dashboard-map-controls">
        <GroupedLayerControl
          groups={DASHBOARD_LAYER_GROUPS}
          enabledLayers={enabledLayers}
          onToggleLayer={onToggleLayer}
          counts={layerCounts}
          compact
        />
        <div className="dashboard-map-search">
          <input
            type="text"
            placeholder="Search places..."
            value={searchValue}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="map-search-input"
          />
        </div>
      </div>

      {/* Pin count badge */}
      <div className="dashboard-map-count">
        {totalPins} pin{totalPins !== 1 ? "s" : ""}
        {loading && " ..."}
      </div>

      {loading && totalPins === 0 && (
        <div className="dashboard-map-skeleton">
          <span>Loading map...</span>
        </div>
      )}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", minHeight: "500px" }}
      />
      <a href="/map" className="dashboard-map-fullscreen-link">
        Open Full Map
      </a>
    </div>
  );
}
