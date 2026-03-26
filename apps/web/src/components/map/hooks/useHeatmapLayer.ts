"use client";

import { useEffect, useRef } from "react";
import type { AtlasPin } from "../types";

/**
 * useHeatmapLayer — manages a Leaflet.heat heatmap layer on the map.
 *
 * Two modes:
 * - "density": intensity = cat_count (cat population density)
 * - "disease": intensity = disease-positive cat count
 *
 * leaflet.heat is loaded dynamically (side-effect import) since it attaches
 * itself to the global L object.
 */

type HeatmapMode = "density" | "disease";

interface UseHeatmapLayerOptions {
  map: L.Map | null;
  pins: AtlasPin[];
  enabled: boolean;
  mode: HeatmapMode;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let heatImportPromise: Promise<any> | null = null;

function ensureHeatLoaded(): Promise<void> {
  if (!heatImportPromise) {
    heatImportPromise = import("leaflet.heat");
  }
  return heatImportPromise;
}

function buildHeatData(pins: AtlasPin[], mode: HeatmapMode): [number, number, number][] {
  const result: [number, number, number][] = [];
  for (const p of pins) {
    if (!p.lat || !p.lng) continue;
    const intensity =
      mode === "disease" ? (p.disease_count || 0) : Math.max(p.cat_count, 1);
    if (intensity > 0) {
      result.push([p.lat, p.lng, intensity]);
    }
  }
  return result;
}

export function useHeatmapLayer({ map, pins, enabled, mode }: UseHeatmapLayerOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null);
  const currentModeRef = useRef<HeatmapMode>(mode);

  // Remove layer when disabled or mode changes (will recreate with new config)
  useEffect(() => {
    if (!map) return;
    if (!enabled || mode !== currentModeRef.current) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      currentModeRef.current = mode;
    }
  }, [map, enabled, mode]);

  // Create/update heatmap layer
  useEffect(() => {
    if (!map || !enabled) return;

    ensureHeatLoaded().then(() => {
      if (!map || !enabled) return;

      const data = buildHeatData(pins, mode);

      if (layerRef.current) {
        // Just update data — config (gradient, radius) stays the same
        layerRef.current.setLatLngs(data);
        return;
      }

      // Create new heat layer
      const L = require("leaflet") as typeof import("leaflet");
      const gradient: Record<number, string> =
        mode === "disease"
          ? { 0.2: "#fed976", 0.5: "#fd8d3c", 0.8: "#e31a1c", 1.0: "#800026" }
          : { 0.2: "#ffffb2", 0.4: "#fecc5c", 0.6: "#fd8d3c", 0.8: "#f03b20", 1.0: "#bd0026" };

      // @ts-ignore leaflet.heat extends L with L.heatLayer
      const heat = L.heatLayer(data, {
        radius: 25,
        blur: 15,
        maxZoom: 13,
        max: mode === "disease" ? 5 : 20,
        gradient,
      });
      heat.addTo(map);
      layerRef.current = heat;
    });
  }, [map, pins, enabled, mode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (layerRef.current && map) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
