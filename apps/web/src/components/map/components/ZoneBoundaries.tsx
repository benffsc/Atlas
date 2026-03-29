"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMap, InfoWindow } from "@vis.gl/react-google-maps";
import { MAP_COLORS } from "@/lib/map-colors";
import type { Zone } from "@/components/map/types";

// ---------------------------------------------------------------------------
// GeoJSON → google.maps.LatLngLiteral[] conversion
// ---------------------------------------------------------------------------

function geoJsonToLatLngPaths(geoJsonStr: string): google.maps.LatLngLiteral[][] {
  try {
    const geojson = JSON.parse(geoJsonStr);
    if (geojson.type === "Polygon") {
      // Polygon: coordinates is [ring[]], each ring is [[lng, lat], ...]
      return geojson.coordinates.map((ring: number[][]) =>
        ring.map(([lng, lat]: number[]) => ({ lat, lng }))
      );
    }
    if (geojson.type === "MultiPolygon") {
      // MultiPolygon: coordinates is [polygon[]], each polygon is [ring[]]
      return geojson.coordinates.flatMap((polygon: number[][][]) =>
        polygon.map((ring: number[][]) =>
          ring.map(([lng, lat]: number[]) => ({ lat, lng }))
        )
      );
    }
    return [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ZoneBoundaries
// ---------------------------------------------------------------------------

interface ZoneBoundariesProps {
  zones: Zone[];
}

export function ZoneBoundaries({ zones }: ZoneBoundariesProps) {
  const map = useMap();
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);

  const handleZoneClick = useCallback((zone: Zone) => {
    setSelectedZone(zone);
  }, []);

  // Draw polygons imperatively (no Polygon component in @vis.gl/react-google-maps)
  useEffect(() => {
    // Clean up previous polygons
    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current = [];

    if (!map || zones.length === 0) return;

    const color = MAP_COLORS.layers.zones;

    for (const zone of zones) {
      if (!zone.boundary) continue;
      const paths = geoJsonToLatLngPaths(zone.boundary);
      if (paths.length === 0) continue;

      for (const path of paths) {
        const polygon = new google.maps.Polygon({
          paths: path,
          strokeColor: color,
          strokeWeight: 2,
          strokeOpacity: 0.8,
          fillColor: color,
          fillOpacity: 0.1,
          map,
          clickable: true,
        });

        polygon.addListener("click", () => handleZoneClick(zone));
        polygonsRef.current.push(polygon);
      }
    }

    return () => {
      polygonsRef.current.forEach(p => {
        google.maps.event.clearInstanceListeners(p);
        p.setMap(null);
      });
      polygonsRef.current = [];
    };
  }, [map, zones, handleZoneClick]);

  if (!selectedZone) return null;

  return (
    <InfoWindow
      position={{ lat: selectedZone.anchor_lat, lng: selectedZone.anchor_lng }}
      onCloseClick={() => setSelectedZone(null)}
    >
      <div style={{ minWidth: 200, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          Zone: {selectedZone.zone_code}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
            {selectedZone.places_count} place{selectedZone.places_count !== 1 ? "s" : ""}
          </span>
          <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
            {selectedZone.total_cats} cat{selectedZone.total_cats !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>
          Status: <span style={{
            fontWeight: 500,
            color: selectedZone.observation_status === "current" ? "#16a34a"
              : selectedZone.observation_status === "critical" ? "#dc2626"
              : "#6b7280",
          }}>
            {selectedZone.observation_status}
          </span>
        </div>
      </div>
    </InfoWindow>
  );
}
