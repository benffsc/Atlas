import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface PlaceUnit {
  place_id: string;
  unit_identifier: string;
  cat_count: number;
}

interface NearbyPlace {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  distance_m: number;
  cat_count: number;
  person_count: number;
  is_multi_unit: boolean;
  place_kind: string;
  units?: PlaceUnit[];
}

// GET /api/google-map-entries/[id]/nearby-places - Get places near this entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Entry ID is required" },
      { status: 400 }
    );
  }

  try {
    // Get entry details first
    const entry = await queryOne<{
      entry_id: string;
      kml_name: string;
      lat: number;
      lng: number;
      linked_place_id: string | null;
      nearest_place_id: string | null;
      nearest_place_distance_m: number | null;
      requires_unit_selection: boolean;
      suggested_parent_place_id: string | null;
      ai_place_id: string | null;
      ai_place_confidence: string | null;
      ai_is_same_as_nearby: boolean | null;
    }>(
      `SELECT
        entry_id, kml_name, lat, lng, linked_place_id,
        nearest_place_id, nearest_place_distance_m,
        requires_unit_selection, suggested_parent_place_id,
        ai_classification->'entity_links'->>'place_id' as ai_place_id,
        ai_classification->'entity_links'->>'place_confidence' as ai_place_confidence,
        (ai_classification->'entity_links'->>'is_same_as_nearby_place')::boolean as ai_is_same_as_nearby
       FROM source.google_map_entries
       WHERE entry_id = $1`,
      [id]
    );

    if (!entry) {
      return NextResponse.json(
        { error: "Entry not found" },
        { status: 404 }
      );
    }

    // Get nearby places within 500m with multi-unit detection
    const nearbyPlaces = await queryRows<{
      place_id: string;
      formatted_address: string;
      display_name: string | null;
      distance_m: number;
      cat_count: number;
      person_count: number;
      is_multi_unit: boolean;
      place_kind: string;
      parent_place_id: string | null;
    }>(
      `SELECT
        p.place_id,
        p.formatted_address,
        p.display_name,
        ST_Distance(
          p.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) as distance_m,
        COALESCE(cc.cat_count, 0) as cat_count,
        COALESCE(pc.person_count, 0) as person_count,
        sot.is_multi_unit_place(p.place_id) as is_multi_unit,
        p.place_kind::text as place_kind,
        p.parent_place_id
      FROM sot.places p
      LEFT JOIN (
        SELECT place_id, COUNT(*) as cat_count
        FROM sot.cat_place_relationships
        GROUP BY place_id
      ) cc ON cc.place_id = p.place_id
      LEFT JOIN (
        SELECT place_id, COUNT(*) as person_count
        FROM sot.person_place_relationships
        GROUP BY place_id
      ) pc ON pc.place_id = p.place_id
      WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND ST_DWithin(
          p.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          500
        )
      ORDER BY distance_m
      LIMIT 15`,
      [entry.lat, entry.lng]
    );

    // For multi-unit places, get their units
    const multiUnitPlaceIds = nearbyPlaces
      .filter(p => p.is_multi_unit && p.place_kind === 'apartment_building')
      .map(p => p.place_id);

    let unitsMap: Record<string, PlaceUnit[]> = {};

    if (multiUnitPlaceIds.length > 0) {
      const units = await queryRows<{
        parent_place_id: string;
        place_id: string;
        unit_identifier: string;
        cat_count: number;
      }>(
        `SELECT
          p.parent_place_id,
          p.place_id,
          COALESCE(p.unit_identifier, p.formatted_address) as unit_identifier,
          COALESCE(cc.cat_count, 0) as cat_count
        FROM sot.places p
        LEFT JOIN (
          SELECT place_id, COUNT(*) as cat_count
          FROM sot.cat_place_relationships
          GROUP BY place_id
        ) cc ON cc.place_id = p.place_id
        WHERE p.parent_place_id = ANY($1)
          AND p.merged_into_place_id IS NULL
        ORDER BY p.unit_identifier`,
        [multiUnitPlaceIds]
      );

      // Group units by parent
      for (const unit of units) {
        if (!unitsMap[unit.parent_place_id]) {
          unitsMap[unit.parent_place_id] = [];
        }
        unitsMap[unit.parent_place_id].push({
          place_id: unit.place_id,
          unit_identifier: unit.unit_identifier,
          cat_count: unit.cat_count,
        });
      }
    }

    // Build response with units attached
    const placesWithUnits: NearbyPlace[] = nearbyPlaces.map(p => ({
      place_id: p.place_id,
      formatted_address: p.formatted_address,
      display_name: p.display_name,
      distance_m: p.distance_m,
      cat_count: p.cat_count,
      person_count: p.person_count,
      is_multi_unit: p.is_multi_unit,
      place_kind: p.place_kind,
      units: unitsMap[p.place_id],
    }));

    // Build AI suggestion if available
    let aiSuggestion = null;
    if (entry.ai_place_id && entry.ai_place_confidence) {
      const aiPlace = await queryOne<{
        formatted_address: string;
      }>(
        `SELECT formatted_address FROM sot.places WHERE place_id = $1`,
        [entry.ai_place_id]
      );
      if (aiPlace) {
        aiSuggestion = {
          place_id: entry.ai_place_id,
          address: aiPlace.formatted_address,
          confidence: entry.ai_place_confidence,
          is_same_as_nearby_place: entry.ai_is_same_as_nearby,
        };
      }
    }

    return NextResponse.json({
      entry: {
        id: entry.entry_id,
        name: entry.kml_name,
        lat: entry.lat,
        lng: entry.lng,
        linked_place_id: entry.linked_place_id,
        requires_unit_selection: entry.requires_unit_selection,
        suggested_parent_place_id: entry.suggested_parent_place_id,
      },
      nearby_places: placesWithUnits,
      ai_suggestion: aiSuggestion,
    });
  } catch (error) {
    console.error("Error fetching nearby places:", error);
    return NextResponse.json(
      { error: "Failed to fetch nearby places" },
      { status: 500 }
    );
  }
}
