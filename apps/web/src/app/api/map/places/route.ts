import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Map Places API
 *
 * GET - Returns places with attached Google Maps context for map display
 *
 * Query params:
 *   - bounds: "minLat,minLng,maxLat,maxLng" - filter by map bounds
 *   - hasContext: "true" - only places with attached Google Maps entries
 *   - limit: number (default 500, max 2000)
 *
 * Response includes:
 *   - Place location and basic info
 *   - Colony size estimates
 *   - Active request status
 *   - Attached Google Maps entries (as JSON array)
 *   - AI-extracted attributes
 */

interface MapPlace {
  place_id: string;
  display_name: string;
  formatted_address: string;
  lat: number;
  lng: number;
  colony_size: number;
  altered_count: number;
  active_request_id: string | null;
  request_status: string | null;
  attached_context: AttachedEntry[];
  attached_count: number;
  ai_attributes: Record<string, unknown>;
}

interface AttachedEntry {
  entry_id: string;
  classification: string | null;
  confidence: string | null;
  original_text: string;
  kml_name: string | null;
  original_lat: number;
  original_lng: number;
  distance_m: number | null;
  parsed_date: string | null;
  icon_type: string | null;
  icon_color: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const bounds = searchParams.get("bounds");
  const hasContext = searchParams.get("hasContext") === "true";
  const limit = Math.min(parseInt(searchParams.get("limit") || "500"), 2000);

  try {
    let boundsFilter = "";
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Parse bounds if provided
    if (bounds) {
      const [minLat, minLng, maxLat, maxLng] = bounds.split(",").map(parseFloat);
      if ([minLat, minLng, maxLat, maxLng].every((v) => !isNaN(v))) {
        boundsFilter = `
          AND ST_Y(p.location::geometry) BETWEEN $${paramIndex} AND $${paramIndex + 2}
          AND ST_X(p.location::geometry) BETWEEN $${paramIndex + 1} AND $${paramIndex + 3}
        `;
        params.push(minLat, minLng, maxLat, maxLng);
        paramIndex += 4;
      }
    }

    // Context filter
    const contextFilter = hasContext
      ? `AND EXISTS (
           SELECT 1 FROM trapper.google_map_entries g
           WHERE g.linked_place_id = p.place_id
         )`
      : "";

    params.push(limit);
    const limitParam = paramIndex;

    const sql = `
      SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        ST_Y(p.location::geometry) as lat,
        ST_X(p.location::geometry) as lng,

        -- Latest colony estimate
        COALESCE(
          (SELECT total_cats FROM trapper.place_colony_estimates
           WHERE place_id = p.place_id
           ORDER BY observation_date DESC LIMIT 1),
          0
        ) as colony_size,
        COALESCE(
          (SELECT altered_count FROM trapper.place_colony_estimates
           WHERE place_id = p.place_id
           ORDER BY observation_date DESC LIMIT 1),
          0
        ) as altered_count,

        -- Active request
        (SELECT request_id FROM trapper.sot_requests
         WHERE place_id = p.place_id
           AND status NOT IN ('completed', 'cancelled')
         ORDER BY created_at DESC LIMIT 1) as active_request_id,
        (SELECT status FROM trapper.sot_requests
         WHERE place_id = p.place_id
           AND status NOT IN ('completed', 'cancelled')
         ORDER BY created_at DESC LIMIT 1) as request_status,

        -- Attached Google Maps entries
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              'entry_id', g.entry_id,
              'classification', g.ai_classification->>'primary_meaning',
              'confidence', g.ai_classification->>'confidence',
              'original_text', LEFT(g.original_content, 500),
              'kml_name', g.kml_name,
              'original_lat', g.lat,
              'original_lng', g.lng,
              'distance_m', ROUND(g.match_distance_m::numeric, 1),
              'parsed_date', g.parsed_date,
              'icon_type', g.icon_type,
              'icon_color', g.icon_color
            ) ORDER BY g.parsed_date DESC NULLS LAST
          )
          FROM trapper.google_map_entries g
          WHERE g.linked_place_id = p.place_id
          ),
          '[]'::jsonb
        ) as attached_context,

        -- Count of attached entries
        (SELECT COUNT(*)::INT FROM trapper.google_map_entries g
         WHERE g.linked_place_id = p.place_id) as attached_count,

        -- AI-extracted attributes
        COALESCE(
          (SELECT jsonb_object_agg(attribute_key, attribute_value)
           FROM trapper.entity_attributes ea
           WHERE ea.entity_type = 'place'
             AND ea.entity_id = p.place_id
             AND ea.superseded_at IS NULL),
          '{}'::jsonb
        ) as ai_attributes

      FROM trapper.places p
      WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        ${boundsFilter}
        ${contextFilter}
      ORDER BY attached_count DESC, colony_size DESC
      LIMIT $${limitParam}
    `;

    const places = await queryRows<MapPlace>(sql, params);

    // Get total counts for pagination info
    const countSql = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM trapper.google_map_entries g
          WHERE g.linked_place_id = p.place_id
        )) as with_context
      FROM trapper.places p
      WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
    `;
    const counts = await queryOne<{ total: number; with_context: number }>(countSql);

    return NextResponse.json({
      places,
      count: places.length,
      total_places: counts?.total || 0,
      total_with_context: counts?.with_context || 0,
      has_more: places.length === limit,
    });
  } catch (error) {
    console.error("Error fetching map places:", error);
    return NextResponse.json(
      { error: "Failed to fetch map places" },
      { status: 500 }
    );
  }
}
