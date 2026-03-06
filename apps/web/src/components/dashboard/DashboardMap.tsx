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
}

interface DashboardMapProps {
  pins: DashboardMapPin[];
  onPinClick: (requestId: string) => void;
  loading?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  new: "#3b82f6",
  triaged: "#3b82f6",
  scheduled: "#f59e0b",
  in_progress: "#f59e0b",
  on_hold: "#ec4899",
  default: "#6b7280",
};

const SONOMA_CENTER: [number, number] = [38.45, -122.75];
const DEFAULT_ZOOM = 10;

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || STATUS_COLORS.default;
}

export function DashboardMap({ pins, onPinClick, loading }: DashboardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // Stable callback ref
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;

  // Initialize map — dynamic import of Leaflet to avoid SSR window error
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

      // Enable scroll zoom on focus
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

    // Clear existing markers
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

      const tooltipContent = [
        pin.place_name || pin.place_address || "Unknown location",
        pin.status.replace(/_/g, " "),
      ].join(" \u2014 ");

      marker.bindTooltip(tooltipContent, {
        direction: "top",
        offset: [0, -8],
        className: "dashboard-map-tooltip",
      });

      marker.on("click", () => {
        onPinClickRef.current(pin.request_id);
      });

      bounds.extend([pin.lat, pin.lng]);
      markersRef.current.push(marker);
    });

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [pins]);

  useEffect(() => {
    if (mapReady) updateMarkers();
  }, [mapReady, updateMarkers]);

  return (
    <div className="dashboard-map-container">
      {loading && (
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
