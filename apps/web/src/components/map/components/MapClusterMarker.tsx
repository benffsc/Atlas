"use client";

/**
 * MapClusterMarker - Cluster marker component for SuperCluster integration
 *
 * Renders cluster markers with:
 * - Point count display
 * - Color based on aggregated properties (disease, watch list)
 * - Size based on point count
 * - Click handler for zoom expansion
 */

import { useEffect, useRef } from "react";
import * as L from "leaflet";
import { getClusterColor, getClusterSizeClass } from "../hooks/useMapClustering";

interface ClusterProperties {
  cluster: boolean;
  cluster_id?: number;
  point_count?: number;
  point_count_abbreviated?: string;
  disease_count?: number;
  watch_list_count?: number;
  needs_trapper_count?: number;
}

interface ClusterFeature {
  type: "Feature";
  properties: ClusterProperties;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

interface MapClusterMarkerProps {
  /** The cluster feature to render */
  cluster: ClusterFeature;
  /** Leaflet map instance */
  map: L.Map;
  /** Layer group to add marker to */
  layerGroup: L.LayerGroup;
  /** Callback when cluster is clicked (for expansion) */
  onClusterClick?: (clusterId: number, coordinates: [number, number]) => void;
}

const SIZE_CONFIG = {
  small: { size: 30, fontSize: 12 },
  medium: { size: 40, fontSize: 14 },
  large: { size: 50, fontSize: 16 },
};

/**
 * Creates a cluster marker icon
 */
function createClusterIcon(
  pointCount: number,
  color: string,
  sizeClass: "small" | "medium" | "large"
): L.DivIcon {
  const { size, fontSize } = SIZE_CONFIG[sizeClass];

  return L.divIcon({
    className: "atlas-cluster-marker",
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border: 3px solid white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 700;
        font-size: ${fontSize}px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      ">
        ${pointCount}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Hook to manage a single cluster marker
 */
export function useClusterMarker({
  cluster,
  map,
  layerGroup,
  onClusterClick,
}: MapClusterMarkerProps): void {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!cluster.properties.cluster || !cluster.properties.cluster_id) {
      return;
    }

    const [lng, lat] = cluster.geometry.coordinates;
    const pointCount = cluster.properties.point_count || 0;
    const color = getClusterColor(cluster);
    const sizeClass = getClusterSizeClass(pointCount);

    const icon = createClusterIcon(pointCount, color, sizeClass);

    const marker = L.marker([lat, lng], { icon }).addTo(layerGroup);

    // Click handler for expansion
    if (onClusterClick && cluster.properties.cluster_id) {
      marker.on("click", () => {
        onClusterClick(cluster.properties.cluster_id!, cluster.geometry.coordinates);
      });
    }

    // Tooltip showing details
    const tooltipContent = buildClusterTooltip(cluster.properties);
    marker.bindTooltip(tooltipContent, {
      direction: "top",
      offset: [0, -10],
    });

    markerRef.current = marker;

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [cluster, map, layerGroup, onClusterClick]);
}

/**
 * Build tooltip content for a cluster
 */
function buildClusterTooltip(properties: ClusterProperties): string {
  const {
    point_count = 0,
    disease_count = 0,
    watch_list_count = 0,
    needs_trapper_count = 0,
  } = properties;

  let content = `<strong>${point_count} locations</strong>`;

  const badges: string[] = [];
  if (disease_count > 0) {
    badges.push(`<span style="color: #ea580c;">${disease_count} disease</span>`);
  }
  if (watch_list_count > 0) {
    badges.push(`<span style="color: #8b5cf6;">${watch_list_count} watch list</span>`);
  }
  if (needs_trapper_count > 0) {
    badges.push(`<span style="color: #f97316;">${needs_trapper_count} need trapper</span>`);
  }

  if (badges.length > 0) {
    content += `<br/><span style="font-size: 11px;">${badges.join(" · ")}</span>`;
  }

  content += `<br/><span style="font-size: 10px; color: #6b7280;">Click to zoom</span>`;

  return content;
}

/**
 * Render multiple cluster markers efficiently
 */
export function renderClusterMarkers(
  clusters: ClusterFeature[],
  map: L.Map,
  layerGroup: L.LayerGroup,
  onClusterClick: (clusterId: number, coordinates: [number, number]) => void
): void {
  // Clear existing markers
  layerGroup.clearLayers();

  // Add cluster markers
  clusters.forEach((cluster) => {
    if (!cluster.properties.cluster) {
      // This is an individual point, not a cluster
      // It will be rendered by the regular pin layer
      return;
    }

    const [lng, lat] = cluster.geometry.coordinates;
    const pointCount = cluster.properties.point_count || 0;
    const color = getClusterColor(cluster);
    const sizeClass = getClusterSizeClass(pointCount);

    const icon = createClusterIcon(pointCount, color, sizeClass);
    const marker = L.marker([lat, lng], { icon }).addTo(layerGroup);

    // Click handler
    if (cluster.properties.cluster_id) {
      marker.on("click", () => {
        onClusterClick(cluster.properties.cluster_id!, cluster.geometry.coordinates);
      });
    }

    // Tooltip
    const tooltipContent = buildClusterTooltip(cluster.properties);
    marker.bindTooltip(tooltipContent, {
      direction: "top",
      offset: [0, -10],
    });
  });
}
