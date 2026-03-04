/**
 * useStreetView - Street View integration for Atlas Map
 *
 * Handles:
 * - Street View coordinates and positioning
 * - POV (heading/pitch) tracking via postMessage from iframe
 * - Fullscreen mode toggle
 * - Cone-only mode for drawer integration
 * - Cone marker position updates when user "walks" in Street View
 */

import { useState, useEffect, useCallback, useRef } from "react";
import * as L from "leaflet";

interface StreetViewCoords {
  lat: number;
  lng: number;
  address?: string;
}

interface UseStreetViewOptions {
  /** Leaflet map ref for cone marker */
  mapRef: React.MutableRefObject<L.Map | null>;
}

interface UseStreetViewReturn {
  // State
  coords: StreetViewCoords | null;
  heading: number;
  pitch: number;
  fullscreen: boolean;
  coneOnly: boolean;

  // Refs for external access
  markerRef: React.MutableRefObject<L.Marker | null>;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  conePosRef: React.MutableRefObject<StreetViewCoords | null>;
  coneOnlyRef: React.MutableRefObject<boolean>;
  miniMapRef: React.MutableRefObject<L.Map | null>;
  miniMapContainerRef: React.RefObject<HTMLDivElement>;

  // Actions
  open: (coords: StreetViewCoords) => void;
  close: () => void;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setConeOnly: (coneOnly: boolean) => void;
  toggleFullscreen: () => void;
}

export function useStreetView({
  mapRef,
}: UseStreetViewOptions): UseStreetViewReturn {
  const [coords, setCoords] = useState<StreetViewCoords | null>(null);
  const [heading, setHeading] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [coneOnly, setConeOnly] = useState(false);

  // Refs
  const markerRef = useRef<L.Marker | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const conePosRef = useRef<StreetViewCoords | null>(null);
  const coneOnlyRef = useRef(false);
  const miniMapRef = useRef<L.Map | null>(null);
  const miniMapContainerRef = useRef<HTMLDivElement>(null);

  // Keep coneOnlyRef in sync
  useEffect(() => {
    coneOnlyRef.current = coneOnly;
  }, [coneOnly]);

  // Listen for postMessage from interactive Street View iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data?.type) return;

      if (event.data.type === "streetview-pov") {
        setHeading(event.data.heading);
        setPitch(event.data.pitch);
      } else if (event.data.type === "streetview-position") {
        // User "walked" — move the cone marker directly
        conePosRef.current = { lat: event.data.lat, lng: event.data.lng };

        if (markerRef.current) {
          markerRef.current.setLatLng([event.data.lat, event.data.lng]);
        }

        // Update mini map center if it exists
        if (miniMapRef.current) {
          miniMapRef.current.setView([event.data.lat, event.data.lng], 16, {
            animate: true,
          });
          // Move mini map cone marker
          const layers = miniMapRef.current._miniMapConeMarker;
          if (layers) {
            layers.setLatLng([event.data.lat, event.data.lng]);
          }
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const open = useCallback((newCoords: StreetViewCoords) => {
    setCoords(newCoords);
    setHeading(0);
    setPitch(0);
    conePosRef.current = null;
  }, []);

  const close = useCallback(() => {
    setCoords(null);
    setFullscreen(false);
    setConeOnly(false);
    conePosRef.current = null;

    // Remove marker from map
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => !prev);
  }, []);

  return {
    coords,
    heading,
    pitch,
    fullscreen,
    coneOnly,
    markerRef,
    iframeRef,
    conePosRef,
    coneOnlyRef,
    miniMapRef,
    miniMapContainerRef,
    open,
    close,
    setHeading,
    setPitch,
    setFullscreen,
    setConeOnly,
    toggleFullscreen,
  };
}
