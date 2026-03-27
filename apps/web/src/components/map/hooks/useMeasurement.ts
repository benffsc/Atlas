import { useState, useCallback, useRef, useEffect } from "react";
import type * as LType from "leaflet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseMeasurementOptions {
  mapRef: React.MutableRefObject<LType.Map | null>;
  isActive: boolean;
}

interface UseMeasurementReturn {
  points: Array<{ lat: number; lng: number }>;
  totalDistance: number;
  addPoint: (latlng: { lat: number; lng: number }) => void;
  undoLastPoint: () => void;
  clearMeasurement: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function formatDistance(meters: number): string {
  if (meters < 400) {
    const feet = Math.round(meters * 3.28084);
    const m = Math.round(meters);
    return `${feet} ft (${m} m)`;
  }
  const miles = meters / 1609.344;
  const km = meters / 1000;
  return `${miles.toFixed(1)} mi (${km.toFixed(1)} km)`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMeasurement({
  mapRef,
  isActive,
}: UseMeasurementOptions): UseMeasurementReturn {
  const [points, setPoints] = useState<Array<{ lat: number; lng: number }>>([]);

  // Dynamic Leaflet import (Next.js SSR-safe)
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    import("leaflet").then((mod) => {
      leafletRef.current = mod;
    });
  }, []);

  // Leaflet layer refs
  const polylineRef = useRef<LType.Polyline | null>(null);
  const markersRef = useRef<LType.CircleMarker[]>([]);
  const tooltipsRef = useRef<LType.Tooltip[]>([]);
  const rubberBandRef = useRef<LType.Polyline | null>(null);

  // Keep a stable ref to the latest points so event handlers see current state
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // ------- Layer drawing -------

  const removeAllLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }
    for (const m of markersRef.current) {
      map.removeLayer(m);
    }
    markersRef.current = [];
    for (const t of tooltipsRef.current) {
      map.removeLayer(t);
    }
    tooltipsRef.current = [];
    if (rubberBandRef.current) {
      map.removeLayer(rubberBandRef.current);
      rubberBandRef.current = null;
    }
  }, [mapRef]);

  const redrawLayers = useCallback(
    (pts: Array<{ lat: number; lng: number }>) => {
      const map = mapRef.current;
      const L = leafletRef.current;
      if (!map || !L) return;

      // Remove existing layers before redrawing
      removeAllLayers();

      if (pts.length === 0) return;

      // Polyline
      const latlngs = pts.map((p) => L.latLng(p.lat, p.lng));
      polylineRef.current = L.polyline(latlngs, {
        color: "#3b82f6",
        weight: 3,
        dashArray: "8,8",
      }).addTo(map);

      // Circle markers at each point
      for (const p of pts) {
        const marker = L.circleMarker(L.latLng(p.lat, p.lng), {
          radius: 5,
          color: "#3b82f6",
          fillColor: "#3b82f6",
          fillOpacity: 1,
        }).addTo(map);
        markersRef.current.push(marker);
      }

      // Tooltips at segment midpoints
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const midLat = (a.lat + b.lat) / 2;
        const midLng = (a.lng + b.lng) / 2;
        const dist = haversine(a, b);

        const tooltip = L.tooltip({
          permanent: true,
          direction: "center",
          className: "map-measure-tooltip",
        })
          .setLatLng(L.latLng(midLat, midLng))
          .setContent(formatDistance(dist))
          .addTo(map);
        tooltipsRef.current.push(tooltip);
      }
    },
    [mapRef, removeAllLayers],
  );

  // ------- Public actions -------

  const addPoint = useCallback(
    (latlng: { lat: number; lng: number }) => {
      setPoints((prev) => {
        const next = [...prev, latlng];
        // Defer redraw to after state update via effect
        return next;
      });
    },
    [],
  );

  const undoLastPoint = useCallback(() => {
    setPoints((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const clearMeasurement = useCallback(() => {
    setPoints([]);
    removeAllLayers();
  }, [removeAllLayers]);

  // ------- Derived state -------

  const totalDistance = points.reduce((sum, pt, i) => {
    if (i === 0) return 0;
    return sum + haversine(points[i - 1], pt);
  }, 0);

  // ------- Effects -------

  // Redraw layers whenever points change
  useEffect(() => {
    if (isActive) {
      redrawLayers(points);
    }
  }, [points, isActive, redrawLayers]);

  // Rubber-band mousemove handler
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !isActive) return;

    const onMouseMove = (e: LType.LeafletMouseEvent) => {
      const pts = pointsRef.current;
      if (pts.length === 0) {
        if (rubberBandRef.current) {
          map.removeLayer(rubberBandRef.current);
          rubberBandRef.current = null;
        }
        return;
      }

      const lastPt = pts[pts.length - 1];
      const from = L.latLng(lastPt.lat, lastPt.lng);
      const to = e.latlng;

      if (rubberBandRef.current) {
        rubberBandRef.current.setLatLngs([from, to]);
      } else {
        rubberBandRef.current = L.polyline([from, to], {
          color: "#3b82f6",
          weight: 2,
          dashArray: "4,4",
          opacity: 0.5,
        }).addTo(map);
      }
    };

    map.on("mousemove", onMouseMove);

    return () => {
      map.off("mousemove", onMouseMove);
      if (rubberBandRef.current) {
        map.removeLayer(rubberBandRef.current);
        rubberBandRef.current = null;
      }
    };
  }, [mapRef, isActive]);

  // Clean up when deactivated
  useEffect(() => {
    if (!isActive) {
      removeAllLayers();
      setPoints([]);
    }
  }, [isActive, removeAllLayers]);

  return {
    points,
    totalDistance,
    addPoint,
    undoLastPoint,
    clearMeasurement,
  };
}
