/**
 * useMapClustering - SuperCluster integration for Atlas Map
 *
 * Provides efficient clustering for large pin datasets.
 * Performance: 500k markers in 1-2 seconds vs 6+ minutes with markercluster.
 *
 * Usage:
 *   const { clusters, supercluster, getClusterExpansionZoom } = useMapClustering({
 *     pins: atlasPins,
 *     bounds: mapBounds,
 *     zoom: currentZoom,
 *   });
 */

import { useMemo, useRef } from "react";
import useSupercluster from "use-supercluster";
import type { AtlasPin } from "../types";

// GeoJSON Feature type for SuperCluster
interface ClusterFeature {
  type: "Feature";
  properties: {
    cluster: boolean;
    cluster_id?: number;
    point_count?: number;
    point_count_abbreviated?: string;
    // Original pin data (for non-clusters)
    pin?: AtlasPin;
    // Aggregated data for clusters
    disease_count?: number;
    watch_list_count?: number;
    needs_trapper_count?: number;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
}

interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface UseMapClusteringOptions {
  /** Atlas pins to cluster */
  pins: AtlasPin[];
  /** Current map bounds */
  bounds: MapBounds | null;
  /** Current zoom level */
  zoom: number;
  /** Cluster radius in pixels (default: 80) */
  radius?: number;
  /** Maximum zoom level for clustering (default: 16) */
  maxZoom?: number;
  /** Minimum points to form a cluster (default: 3) */
  minPoints?: number;
  /** Whether clustering is enabled */
  enabled?: boolean;
}

interface UseMapClusteringReturn {
  /** Clustered features (clusters + individual pins) */
  clusters: ClusterFeature[];
  /** SuperCluster instance for expansion zoom calculation */
  supercluster: any;
  /** Get zoom level to expand a cluster */
  getClusterExpansionZoom: (clusterId: number) => number;
  /** Total number of points */
  totalPoints: number;
  /** Number of visible clusters/points */
  visibleCount: number;
}

export function useMapClustering({
  pins,
  bounds,
  zoom,
  radius = 80,
  maxZoom = 16,
  minPoints = 3,
  enabled = true,
}: UseMapClusteringOptions): UseMapClusteringReturn {
  // Convert pins to GeoJSON features
  const points = useMemo(() => {
    if (!enabled) return [];

    return pins
      .filter((pin) => pin.lat && pin.lng)
      .map((pin) => ({
        type: "Feature" as const,
        properties: {
          cluster: false,
          pin,
          // Include for cluster aggregation
          disease_count: pin.disease_risk ? 1 : 0,
          watch_list_count: pin.watch_list ? 1 : 0,
          needs_trapper_count: pin.needs_trapper_count > 0 ? 1 : 0,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [pin.lng, pin.lat] as [number, number],
        },
      }));
  }, [pins, enabled]);

  // Calculate bounds array for supercluster
  const boundsArray = useMemo(() => {
    if (!bounds) return undefined;
    return [bounds.west, bounds.south, bounds.east, bounds.north] as [
      number,
      number,
      number,
      number
    ];
  }, [bounds]);

  // Stable options ref — prevents use-supercluster from rebuilding the index on every render
  const optionsRef = useRef({
    radius,
    maxZoom,
    minPoints,
    map: (props: any) => ({
      disease_count: props.disease_count || 0,
      watch_list_count: props.watch_list_count || 0,
      needs_trapper_count: props.needs_trapper_count || 0,
    }),
    reduce: (accumulated: any, props: any) => {
      accumulated.disease_count += props.disease_count;
      accumulated.watch_list_count += props.watch_list_count;
      accumulated.needs_trapper_count += props.needs_trapper_count;
    },
  });

  // Use supercluster hook
  const { clusters, supercluster } = useSupercluster({
    points,
    bounds: boundsArray,
    zoom,
    options: optionsRef.current,
  });

  // Get expansion zoom for a cluster
  const getClusterExpansionZoom = (clusterId: number): number => {
    if (!supercluster) return zoom + 2;
    try {
      return supercluster.getClusterExpansionZoom(clusterId);
    } catch {
      return zoom + 2;
    }
  };

  return {
    clusters: clusters as ClusterFeature[],
    supercluster,
    getClusterExpansionZoom,
    totalPoints: points.length,
    visibleCount: clusters.length,
  };
}

/**
 * Helper to check if a feature is a cluster
 */
export function isCluster(
  feature: ClusterFeature
): feature is ClusterFeature & { properties: { cluster: true; cluster_id: number; point_count: number } } {
  return feature.properties.cluster === true;
}

/**
 * Helper to get cluster color based on aggregated properties
 */
export function getClusterColor(feature: ClusterFeature): string {
  const { disease_count = 0, watch_list_count = 0 } = feature.properties;

  if (disease_count > 0) return "#ea580c"; // Disease risk - orange
  if (watch_list_count > 0) return "#8b5cf6"; // Watch list - purple
  return "#3b82f6"; // Default blue
}

/**
 * Helper to get cluster size class
 */
export function getClusterSizeClass(pointCount: number): "small" | "medium" | "large" {
  if (pointCount < 10) return "small";
  if (pointCount < 50) return "medium";
  return "large";
}
