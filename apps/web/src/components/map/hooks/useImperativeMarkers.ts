/**
 * useImperativeMarkers — Imperative marker pool for Google Maps AdvancedMarkerElement
 *
 * Instead of rendering 1000+ <AdvancedMarker> React components that unmount/remount
 * on every cluster change (causing DOM overlay accumulation + GC pressure), this hook
 * manages AdvancedMarkerElement instances directly via a ref-based pool.
 *
 * On each cluster update, it diffs against existing markers:
 * - New keys → create AdvancedMarkerElement with DOM content
 * - Removed keys → set marker.map = null, delete from pool
 * - Existing keys → update position only if changed
 *
 * Visual parity with AtlasPinMarker.tsx is maintained by generating equivalent
 * DOM elements (same SVG paths, colors, sizes, status dots).
 */

import { useEffect, useRef, useCallback } from "react";
import { CollisionBehavior } from "@vis.gl/react-google-maps";
import type { ClusterFeature } from "./useMapClustering";
import { isCluster, getClusterColor, getClusterSizeClass } from "./useMapClustering";
import { computePinSize } from "../components/AtlasPinMarker";
import type { AtlasPin } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseImperativeMarkersOptions {
  map: google.maps.Map | null;
  clusters: ClusterFeature[];
  quantizedZoomLevel: number;
  bulkSelectedPlaceIds: Set<string>;
  onPinClick: (pin: AtlasPin, domEvent: MouseEvent) => void;
  onClusterClick: (clusterId: number, lat: number, lng: number) => void;
  /** Called when a pin needs an InfoWindow (e.g. non-modifier click) */
  onPinSelect: (pin: AtlasPin) => void;
}

interface ManagedMarker {
  marker: google.maps.marker.AdvancedMarkerElement;
  clickListener?: google.maps.MapsEventListener;
  /** For individual pins, the pin data. Null for clusters. */
  pin: AtlasPin | null;
  /** Stable key for diffing */
  key: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLUSTER_SIZE_CONFIG: Record<string, { size: number; fontSize: number }> = {
  small: { size: 30, fontSize: 12 },
  medium: { size: 40, fontSize: 14 },
  large: { size: 50, fontSize: 16 },
};

const STATUS_DOT_RED = "#dc2626";
const STATUS_DOT_ORANGE = "#f97316";
const STATUS_DOT_VIOLET = "#7c3aed";

// ---------------------------------------------------------------------------
// DOM Content Generators (plain DOM — no React, no ReactDOM.render)
// ---------------------------------------------------------------------------

/**
 * Reference pin: simple colored circle with white border
 */
function createReferencePinDOM(
  color: string,
  opacity: number,
  isSelected: boolean,
  title?: string,
): HTMLDivElement {
  const div = document.createElement("div");
  if (title) div.title = title;
  div.className = "atlas-pin-ref";
  Object.assign(div.style, {
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    background: color,
    border: "2px solid white",
    opacity: String(opacity),
    cursor: "pointer",
    transition: "transform 0.12s ease, box-shadow 0.12s ease",
    transform: isSelected ? "scale(1.25)" : "",
    boxShadow: isSelected
      ? "0 0 0 3px #facc15, 0 1px 3px rgba(0,0,0,0.3)"
      : "0 1px 3px rgba(0,0,0,0.3)",
  });
  return div;
}

/**
 * Active pin: teardrop SVG with inner circle, cat count, status dot, disease codes.
 * Uses innerHTML with the exact SVG path from AtlasPinMarker.tsx.
 */
function createActivePinDOM(opts: {
  color: string;
  pinStyle: string;
  catCount: number;
  diseaseCount: number;
  needsTrapper: boolean;
  hasVolunteer: boolean;
  diseaseBadges: Array<{ short_code: string; color: string }>;
  isSelected: boolean;
  zoomLevel: number;
  size: number;
  title?: string;
}): HTMLDivElement {
  const {
    color, catCount, diseaseCount, needsTrapper, hasVolunteer,
    diseaseBadges, isSelected, zoomLevel, size, title,
  } = opts;

  // Status dot (priority cascade)
  let statusDotColor: string | null = null;
  if (zoomLevel >= 11) {
    if (diseaseCount > 0) statusDotColor = STATUS_DOT_RED;
    else if (needsTrapper) statusDotColor = STATUS_DOT_ORANGE;
    else if (hasVolunteer) statusDotColor = STATUS_DOT_VIOLET;
  }

  // Inner content by zoom level
  let innerSVG = "";
  const showInnerCircle = zoomLevel >= 11;

  if (showInnerCircle) {
    if (zoomLevel >= 16 && diseaseBadges.length > 0) {
      const codes = diseaseBadges.slice(0, 3).map(b => b.short_code).join(" ");
      const countText = catCount > 0
        ? `<text x="12" y="12.5" text-anchor="middle" fill="${color}" font-size="7" font-weight="bold" font-family="system-ui">${catCount > 99 ? "99" : catCount}</text>`
        : `<circle cx="12" cy="10" r="2" fill="${color}"/>`;
      innerSVG = `
        <circle cx="12" cy="10" r="5" fill="white"/>
        ${countText}
        <rect x="${12 - codes.length * 2.2}" y="27" width="${codes.length * 4.4}" height="7" rx="2" fill="rgba(0,0,0,0.7)"/>
        <text x="12" y="32.5" text-anchor="middle" fill="white" font-size="4.5" font-weight="bold" font-family="system-ui" letter-spacing="0.5">${codes}</text>
      `;
    } else if (zoomLevel >= 14 && catCount > 0) {
      innerSVG = `
        <circle cx="12" cy="10" r="5" fill="white"/>
        <text x="12" y="12.5" text-anchor="middle" fill="${color}" font-size="7" font-weight="bold" font-family="system-ui">${catCount > 99 ? "99" : catCount}</text>
      `;
    } else {
      innerSVG = `
        <circle cx="12" cy="10" r="5" fill="white"/>
        <circle cx="12" cy="10" r="2.5" fill="${color}"/>
      `;
    }
  }

  // Status dot SVG
  const statusDotSVG = statusDotColor
    ? `<circle cx="19" cy="16" r="4" fill="${statusDotColor}" stroke="white" stroke-width="1.5"/>`
    : "";

  // ViewBox
  const hasCodeBar = zoomLevel >= 16 && diseaseBadges.length > 0;
  const viewBoxHeight = hasCodeBar ? 38 : 32;
  const svgHeight = Math.round(size * 1.35 * (viewBoxHeight / 32));

  const wrapper = document.createElement("div");
  if (title) wrapper.title = title;
  wrapper.className = "atlas-pin-active";
  Object.assign(wrapper.style, {
    cursor: "pointer",
    transition: "transform 0.12s ease",
    transform: isSelected ? "scale(1.25)" : "",
    filter: isSelected
      ? "drop-shadow(0 0 4px #facc15) drop-shadow(0 2px 1.5px rgba(0,0,0,0.35))"
      : "drop-shadow(0 2px 1.5px rgba(0,0,0,0.35))",
  });

  wrapper.innerHTML = `<svg width="${size}" height="${svgHeight}" viewBox="0 0 24 ${viewBoxHeight}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="12" cy="30" rx="5" ry="2" fill="rgba(0,0,0,0.2)"/>
    <path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"/>
    ${innerSVG}
    ${statusDotSVG}
  </svg>`;

  return wrapper;
}

/**
 * Cluster marker: colored circle with point count
 */
function createClusterDOM(
  pointCount: number,
  color: string,
  size: number,
  fontSize: number,
): HTMLDivElement {
  const div = document.createElement("div");
  Object.assign(div.style, {
    width: `${size}px`,
    height: `${size}px`,
    background: color,
    border: "3px solid white",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontWeight: "700",
    fontSize: `${fontSize}px`,
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    cursor: "pointer",
  });
  div.textContent = String(pointCount);
  return div;
}

// ---------------------------------------------------------------------------
// Pin color + collision helpers (duplicated from AtlasMapV2 to avoid circular imports)
// ---------------------------------------------------------------------------

function getPinColor(style: string): string {
  // Mirror of MAP_COLORS.pinStyle — inline to avoid importing the full map-colors module
  switch (style) {
    case "disease": return "#ea580c";
    case "watch_list": return "#8b5cf6";
    case "active": return "#22c55e";
    case "active_requests": return "#14b8a6";
    case "has_history": return "#6366f1";
    case "minimal": return "#94a3b8";
    default: return "#3b82f6";
  }
}

function getPinZIndex(pinStyle: string): number {
  switch (pinStyle) {
    case "disease": return 4;
    case "active_requests": return 3;
    case "watch_list": return 3;
    case "active": return 2;
    case "has_history": return 1;
    default: return 0;
  }
}

function getPinCollisionBehavior(pinTier: string): string {
  if (pinTier === "active") return CollisionBehavior.REQUIRED;
  return CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useImperativeMarkers({
  map,
  clusters,
  quantizedZoomLevel,
  bulkSelectedPlaceIds,
  onPinClick,
  onClusterClick,
  onPinSelect,
}: UseImperativeMarkersOptions) {
  const markersRef = useRef<Map<string, ManagedMarker>>(new Map());

  // Keep callback refs stable to avoid re-creating click listeners
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  const onClusterClickRef = useRef(onClusterClick);
  onClusterClickRef.current = onClusterClick;
  const onPinSelectRef = useRef(onPinSelect);
  onPinSelectRef.current = onPinSelect;
  const bulkSelectedRef = useRef(bulkSelectedPlaceIds);
  bulkSelectedRef.current = bulkSelectedPlaceIds;

  // Build set of current keys and diff against existing markers
  useEffect(() => {
    if (!map) return;

    const currentKeys = new Set<string>();
    const pool = markersRef.current;

    for (const feature of clusters) {
      const [lng, lat] = feature.geometry.coordinates;

      if (isCluster(feature)) {
        const key = `cluster-${feature.properties.cluster_id}`;
        currentKeys.add(key);

        const existing = pool.get(key);
        if (existing) {
          // Update position if changed (rare for clusters)
          const pos = existing.marker.position as google.maps.LatLng | google.maps.LatLngLiteral | null;
          if (pos) {
            const eLat = typeof pos.lat === "function" ? (pos as google.maps.LatLng).lat() : (pos as google.maps.LatLngLiteral).lat;
            const eLng = typeof pos.lng === "function" ? (pos as google.maps.LatLng).lng() : (pos as google.maps.LatLngLiteral).lng;
            if (Math.abs(eLat - lat) > 0.00001 || Math.abs(eLng - lng) > 0.00001) {
              existing.marker.position = { lat, lng };
            }
          }
          // Update content (point count may have changed)
          const pointCount = feature.properties.point_count || 0;
          const color = getClusterColor(feature);
          const sizeClass = getClusterSizeClass(pointCount);
          const { size, fontSize } = CLUSTER_SIZE_CONFIG[sizeClass];
          existing.marker.content = createClusterDOM(pointCount, color, size, fontSize);
          continue;
        }

        // Create new cluster marker
        const pointCount = feature.properties.point_count || 0;
        const color = getClusterColor(feature);
        const sizeClass = getClusterSizeClass(pointCount);
        const { size, fontSize } = CLUSTER_SIZE_CONFIG[sizeClass];
        const clusterId = feature.properties.cluster_id;

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat, lng },
          content: createClusterDOM(pointCount, color, size, fontSize),
          collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
          zIndex: 10,
        });

        const clickListener = marker.addListener("click", () => {
          onClusterClickRef.current(clusterId, lat, lng);
        });

        pool.set(key, { marker, clickListener, pin: null, key });
      } else {
        // Individual pin
        const pin = feature.properties.pin;
        if (!pin) continue;

        const pinTier = pin.pin_tier || (pin.pin_style === "has_history" || pin.pin_style === "minimal" ? "reference" : "active");

        // Gate: hide reference pins at zoom < 11
        if (pinTier === "reference" && quantizedZoomLevel < 11) continue;

        const key = pin.id;
        currentKeys.add(key);

        const isSelected = bulkSelectedRef.current.has(pin.id);
        const hasVol = Array.isArray(pin.people) && pin.people.some(
          (p: { roles: string[]; is_staff: boolean }) =>
            p.is_staff || p.roles?.some((r: string) => r === "trapper" || r === "foster" || r === "staff" || r === "caretaker"),
        );

        const existing = pool.get(key);
        if (existing) {
          // Update position if changed
          const pos = existing.marker.position as google.maps.LatLng | google.maps.LatLngLiteral | null;
          if (pos) {
            const eLat = typeof pos.lat === "function" ? (pos as google.maps.LatLng).lat() : (pos as google.maps.LatLngLiteral).lat;
            const eLng = typeof pos.lng === "function" ? (pos as google.maps.LatLng).lng() : (pos as google.maps.LatLngLiteral).lng;
            if (Math.abs(eLat - lat) > 0.00001 || Math.abs(eLng - lng) > 0.00001) {
              existing.marker.position = { lat, lng };
            }
          }
          // Always update content — zoom level or selection state may have changed
          existing.marker.content = createPinContent(pin, pinTier, isSelected, hasVol, quantizedZoomLevel);
          existing.pin = pin;
          continue;
        }

        // Create new pin marker
        const content = createPinContent(pin, pinTier, isSelected, hasVol, quantizedZoomLevel);

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat, lng },
          content,
          collisionBehavior: getPinCollisionBehavior(pinTier) as google.maps.CollisionBehavior,
          zIndex: getPinZIndex(pin.pin_style),
        });

        const clickListener = marker.addListener("click", (e: google.maps.MapMouseEvent) => {
          const domEvent = (e as any)?.domEvent as MouseEvent | undefined;
          if (domEvent && (domEvent.ctrlKey || domEvent.metaKey)) {
            onPinClickRef.current(pin, domEvent);
          } else {
            onPinSelectRef.current(pin);
          }
        });

        pool.set(key, { marker, clickListener, pin, key });
      }
    }

    // Remove markers no longer in the cluster set
    for (const [key, managed] of pool) {
      if (!currentKeys.has(key)) {
        managed.marker.map = null;
        if (managed.clickListener) {
          google.maps.event.removeListener(managed.clickListener);
        }
        pool.delete(key);
      }
    }
  }, [map, clusters, quantizedZoomLevel]);

  // Update selection visuals when bulkSelectedPlaceIds changes (without recreating all markers)
  useEffect(() => {
    const pool = markersRef.current;
    for (const [key, managed] of pool) {
      if (!managed.pin) continue; // skip clusters
      const pin = managed.pin;
      const pinTier = pin.pin_tier || (pin.pin_style === "has_history" || pin.pin_style === "minimal" ? "reference" : "active");
      const isSelected = bulkSelectedPlaceIds.has(pin.id);
      const hasVol = Array.isArray(pin.people) && pin.people.some(
        (p: { roles: string[]; is_staff: boolean }) =>
          p.is_staff || p.roles?.some((r: string) => r === "trapper" || r === "foster" || r === "staff" || r === "caretaker"),
      );
      managed.marker.content = createPinContent(pin, pinTier, isSelected, hasVol, quantizedZoomLevel);
    }
  }, [bulkSelectedPlaceIds, quantizedZoomLevel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const pool = markersRef.current;
      for (const [, managed] of pool) {
        managed.marker.map = null;
        if (managed.clickListener) {
          google.maps.event.removeListener(managed.clickListener);
        }
      }
      pool.clear();
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Helper: create pin DOM content (reference or active)
// ---------------------------------------------------------------------------

function createPinContent(
  pin: AtlasPin,
  pinTier: string,
  isSelected: boolean,
  hasVolunteer: boolean,
  zoomLevel: number,
): HTMLDivElement {
  const color = getPinColor(pin.pin_style);

  if (pinTier === "reference") {
    const opacity = zoomLevel >= 16 ? 0.8 : zoomLevel >= 14 ? 0.65 : 0.5;
    return createReferencePinDOM(color, opacity, isSelected, pin.address);
  }

  const size = computePinSize(
    pinTier as "active" | "reference",
    pin.cat_count,
    pin.disease_count,
    pin.active_request_count,
  );

  return createActivePinDOM({
    color,
    pinStyle: pin.pin_style,
    catCount: pin.cat_count,
    diseaseCount: pin.disease_count,
    needsTrapper: pin.needs_trapper_count > 0,
    hasVolunteer,
    diseaseBadges: pin.disease_badges || [],
    isSelected,
    zoomLevel,
    size,
    title: pin.address,
  });
}
