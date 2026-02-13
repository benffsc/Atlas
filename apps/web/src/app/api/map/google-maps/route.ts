import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Map Google Maps API
 *
 * GET - Returns unattached Google Maps entries for separate map layer
 *
 * Query params:
 *   - bounds: "minLat,minLng,maxLat,maxLng" - filter by map bounds
 *   - classification: filter by AI classification type
 *   - limit: number (default 1000, max 5000)
 *
 * These are historical context pins that aren't linked to any SOT place.
 * Staff can view them as a separate layer to identify potential colony sites.
 */

interface GoogleMapPin {
  entry_id: string;
  kml_name: string | null;
  lat: number;
  lng: number;
  classification: string | null;
  confidence: string | null;
  content_preview: string;
  parsed_date: string | null;
  icon_type: string | null;
  icon_color: string | null;
  nearest_place_id: string | null;
  nearest_place_distance_m: number | null;
  nearest_place_name: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const bounds = searchParams.get("bounds");
  const classification = searchParams.get("classification");
  const limit = Math.min(parseInt(searchParams.get("limit") || "1000"), 5000);

  try {
    const params: (string | number)[] = [];
    let paramIndex = 1;
    const conditions: string[] = [
      "g.linked_place_id IS NULL",
      "g.lat IS NOT NULL",
      "g.lng IS NOT NULL",
    ];

    // Parse bounds if provided
    if (bounds) {
      const [minLat, minLng, maxLat, maxLng] = bounds.split(",").map(parseFloat);
      if ([minLat, minLng, maxLat, maxLng].every((v) => !isNaN(v))) {
        conditions.push(`g.lat BETWEEN $${paramIndex} AND $${paramIndex + 2}`);
        conditions.push(`g.lng BETWEEN $${paramIndex + 1} AND $${paramIndex + 3}`);
        params.push(minLat, minLng, maxLat, maxLng);
        paramIndex += 4;
      }
    }

    // Classification filter
    if (classification) {
      conditions.push(`g.ai_classification->>'primary_meaning' = $${paramIndex}`);
      params.push(classification);
      paramIndex++;
    }

    params.push(limit);
    const limitParam = paramIndex;

    const sql = `
      SELECT
        g.entry_id,
        g.kml_name,
        g.lat,
        g.lng,
        g.ai_classification->>'primary_meaning' as classification,
        g.ai_classification->>'confidence' as confidence,
        LEFT(g.original_content, 300) as content_preview,
        g.parsed_date::TEXT,
        g.icon_type,
        g.icon_color,
        g.nearest_place_id,
        g.nearest_place_distance_m,
        p.display_name as nearest_place_name
      FROM source.google_map_entries g
      LEFT JOIN sot.places p ON p.place_id = g.nearest_place_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY g.parsed_date DESC NULLS LAST
      LIMIT $${limitParam}
    `;

    const pins = await queryRows<GoogleMapPin>(sql, params);

    // Get count by classification
    const countSql = `
      SELECT
        COALESCE(ai_classification->>'primary_meaning', 'unclassified') as classification,
        COUNT(*)::INT as count
      FROM source.google_map_entries
      WHERE linked_place_id IS NULL AND lat IS NOT NULL
      GROUP BY ai_classification->>'primary_meaning'
      ORDER BY count DESC
    `;
    const classifications = await queryRows<{ classification: string; count: number }>(countSql);

    // Total unattached count
    const totalCount = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::INT as count
      FROM source.google_map_entries
      WHERE linked_place_id IS NULL AND lat IS NOT NULL
    `);

    return NextResponse.json({
      pins,
      count: pins.length,
      total_unattached: totalCount?.count || 0,
      classifications: classifications.reduce((acc, c) => {
        acc[c.classification] = c.count;
        return acc;
      }, {} as Record<string, number>),
      has_more: pins.length === limit,
    });
  } catch (error) {
    console.error("Error fetching Google Maps pins:", error);
    return NextResponse.json(
      { error: "Failed to fetch Google Maps pins" },
      { status: 500 }
    );
  }
}
