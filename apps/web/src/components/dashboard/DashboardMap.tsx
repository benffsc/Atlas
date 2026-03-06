"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import "leaflet/dist/leaflet.css";

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

export type MapLayer = "active" | "all" | "completed";

interface DashboardMapProps {
  pins: DashboardMapPin[];
  onPinClick: (requestId: string) => void;
  onLayerChange: (layer: MapLayer) => void;
  onSearch: (query: string) => void;
  activeLayer: MapLayer;
  loading?: boolean;
  pinCount?: number;
}

const STATUS_COLORS: Record<string, string> = {
  new: "#3b82f6",
  triaged: "#3b82f6",
  scheduled: "#f59e0b",
  in_progress: "#f59e0b",
  on_hold: "#ec4899",
  completed: "#22c55e",
  cancelled: "#6b7280",
  default: "#6b7280",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const SONOMA_CENTER: [number, number] = [38.45, -122.75];
const DEFAULT_ZOOM = 10;

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || STATUS_COLORS.default;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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

function buildPopupHtml(pin: DashboardMapPin): string {
  const name = pin.place_name || pin.place_address || "Unknown location";
  const address = pin.place_address && pin.place_name ? pin.place_address.split(",")[0] : "";
  const statusColor = getStatusColor(pin.status);
  const priorityLabel = PRIORITY_LABELS[pin.priority] || pin.priority;
  const catInfo = pin.estimated_cat_count
    ? `${pin.estimated_cat_count} cat${pin.estimated_cat_count > 1 ? "s" : ""}${pin.has_kittens ? " (kittens)" : ""}`
    : pin.has_kittens ? "Has kittens" : "";

  return `
    <div style="min-width:200px;max-width:280px;font-family:system-ui,-apple-system,sans-serif;">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px;line-height:1.3;">${name}</div>
      ${address ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">${address}</div>` : ""}
      ${pin.summary ? `<div style="font-size:12px;color:#cbd5e1;margin-bottom:6px;line-height:1.3;">${pin.summary}</div>` : ""}
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
        <span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;background:${statusColor};color:#fff;">${formatStatus(pin.status)}</span>
        <span style="font-size:10px;color:#94a3b8;">${priorityLabel}</span>
        <span style="font-size:10px;color:#64748b;">${timeAgo(pin.created_at)}</span>
      </div>
      ${catInfo ? `<div style="font-size:11px;color:#a78bfa;">${catInfo}</div>` : ""}
      <div style="margin-top:8px;border-top:1px solid #334155;padding-top:6px;">
        <a href="/requests/${pin.request_id}"
           onclick="event.preventDefault();event.stopPropagation();window.__dashMapViewDetails&&window.__dashMapViewDetails('${pin.request_id}')"
           style="font-size:11px;color:#60a5fa;text-decoration:none;cursor:pointer;">
          View Details
        </a>
      </div>
    </div>
  `;
}

const LAYERS: { key: MapLayer; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
];

export function DashboardMap({ pins, onPinClick, onLayerChange, onSearch, activeLayer, loading, pinCount }: DashboardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable callback ref
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;

  // Register global handler for popup "View Details" link
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__dashMapViewDetails = (requestId: string) => {
      onPinClickRef.current(requestId);
    };
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__dashMapViewDetails;
    };
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const L = await import("leaflet");

      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;

      const map = L.map(containerRef.current, {
        center: SONOMA_CENTER,
        zoom: DEFAULT_ZOOM,
        scrollWheelZoom: false,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
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

  // Update markers when pins change or map becomes ready
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    markersRef.current.forEach((m: { remove: () => void }) => m.remove());
    markersRef.current = [];

    if (pins.length === 0) return;

    const bounds = L.latLngBounds([]);

    pins.forEach((pin: DashboardMapPin) => {
      const color = getStatusColor(pin.status);
      const marker = L.circleMarker([pin.lat, pin.lng], {
        radius: 7,
        fillColor: color,
        color: "#fff",
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.85,
      }).addTo(map);

      marker.bindPopup(buildPopupHtml(pin), {
        className: "dashboard-map-popup",
        closeButton: true,
        maxWidth: 300,
      });

      marker.on("click", () => {
        marker.openPopup();
      });

      bounds.extend([pin.lat, pin.lng]);
      markersRef.current.push(marker);
    });

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [pins]);

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

  return (
    <div className="dashboard-map-container">
      {/* Controls overlay */}
      <div className="dashboard-map-controls">
        <div className="dashboard-map-layers">
          {LAYERS.map(l => (
            <button
              key={l.key}
              className={`map-layer-btn${activeLayer === l.key ? " active" : ""}`}
              onClick={() => onLayerChange(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>
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
      {pinCount !== undefined && (
        <div className="dashboard-map-count">
          {pinCount} pin{pinCount !== 1 ? "s" : ""}
          {loading && " ..."}
        </div>
      )}

      {loading && pins.length === 0 && (
        <div className="dashboard-map-skeleton">
          <span>Loading map...</span>
        </div>
      )}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", minHeight: "400px" }}
      />
      <a href="/map" className="dashboard-map-fullscreen-link">
        Open Full Map
      </a>
    </div>
  );
}
