import { NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * Map Layer Stats API
 *
 * GET - Returns statistics for map layer controls
 *
 * Provides counts by layer type for UI toggle controls:
 *   - places: Total SOT places with locations
 *   - google_maps_attached: Google Maps entries linked to places
 *   - google_maps_unattached: Google Maps entries not linked
 *   - google_maps_by_classification: Breakdown by AI classification
 */

interface LayerStat {
  layer: string;
  count: number;
  with_active_requests: number;
}

export async function GET() {
  try {
    const stats = await queryRows<LayerStat>(`
      -- SOT Places
      SELECT
        'places' as layer,
        COUNT(*)::INT as count,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM trapper.sot_requests r
          WHERE r.place_id = p.place_id
          AND r.status NOT IN ('completed', 'cancelled')
        ))::INT as with_active_requests
      FROM trapper.places p
      WHERE p.merged_into_place_id IS NULL AND p.location IS NOT NULL

      UNION ALL

      -- Google Maps attached to places
      SELECT
        'google_maps_attached' as layer,
        COUNT(*)::INT as count,
        0 as with_active_requests
      FROM trapper.google_map_entries
      WHERE linked_place_id IS NOT NULL

      UNION ALL

      -- Google Maps not attached (with coordinates)
      SELECT
        'google_maps_unattached' as layer,
        COUNT(*)::INT as count,
        0 as with_active_requests
      FROM trapper.google_map_entries
      WHERE linked_place_id IS NULL AND lat IS NOT NULL

      UNION ALL

      -- Google Maps by classification type
      SELECT
        'google_maps_' || COALESCE(ai_classification->>'primary_meaning', 'unclassified') as layer,
        COUNT(*)::INT as count,
        0 as with_active_requests
      FROM trapper.google_map_entries
      WHERE lat IS NOT NULL
      GROUP BY ai_classification->>'primary_meaning'
      ORDER BY count DESC
    `);

    // Organize stats for easier consumption
    const layerStats: Record<string, { count: number; with_active_requests: number }> = {};
    const classificationStats: Record<string, number> = {};

    for (const stat of stats) {
      if (stat.layer.startsWith("google_maps_") &&
          !["google_maps_attached", "google_maps_unattached"].includes(stat.layer)) {
        const classification = stat.layer.replace("google_maps_", "");
        classificationStats[classification] = stat.count;
      } else {
        layerStats[stat.layer] = {
          count: stat.count,
          with_active_requests: stat.with_active_requests,
        };
      }
    }

    return NextResponse.json({
      layers: layerStats,
      classifications: classificationStats,
      summary: {
        total_places: layerStats.places?.count || 0,
        places_with_requests: layerStats.places?.with_active_requests || 0,
        google_maps_attached: layerStats.google_maps_attached?.count || 0,
        google_maps_unattached: layerStats.google_maps_unattached?.count || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching layer stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch layer stats" },
      { status: 500 }
    );
  }
}
