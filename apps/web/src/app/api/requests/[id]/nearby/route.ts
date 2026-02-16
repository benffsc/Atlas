import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/requests/[id]/nearby
 *
 * Returns nearby entities (requests, places, people, cats) for a given request.
 * Used for the "Nearby" tab on request detail pages.
 */

interface NearbyRequest {
  request_id: string;
  summary: string | null;
  status: string;
  priority: string;
  place_address: string | null;
  estimated_cat_count: number | null;
  distance_m: number;
  created_at: string;
}

interface NearbyPlace {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  distance_m: number;
  cat_count: number;
  has_active_request: boolean;
}

interface NearbyPerson {
  person_id: string;
  display_name: string;
  place_name: string | null;
  relationship_type: string | null;
  distance_m: number;
  cat_count: number;
}

interface NearbyCat {
  cat_id: string;
  display_name: string;
  microchip: string | null;
  place_name: string | null;
  distance_m: number;
  altered_status: string | null;
}

interface PlaceContextFlags {
  has_active_request: boolean;
  has_recent_clinic: boolean;
  has_google_history: boolean;
  has_nearby_activity: boolean;
}

interface PlaceContext {
  place_id: string;
  address: string;
  context_flags: PlaceContextFlags;
  active_requests_count: number;
  clinic_cats_6mo: number;
  google_entries_nearby: number;
  nearby_requests_count: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const radius = parseInt(searchParams.get("radius") || "5000", 10); // Default 5km

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    // Get the request's place coordinates
    const requestInfo = await queryOne<{
      lat: number | null;
      lng: number | null;
      place_id: string | null;
      formatted_address: string | null;
    }>(
      `SELECT p.lat, p.lng, r.place_id, p.formatted_address
       FROM ops.requests r
       LEFT JOIN sot.places p ON p.place_id = r.place_id
       WHERE r.request_id = $1`,
      [id]
    );

    if (!requestInfo?.lat || !requestInfo?.lng) {
      return NextResponse.json({
        request_id: id,
        center: null,
        nearby: {
          requests: [],
          places: [],
          people: [],
          cats: [],
        },
        summary: {
          total_requests: 0,
          total_places: 0,
          total_people: 0,
          total_cats: 0,
          radius_meters: radius,
        },
        message: "Request has no place with coordinates",
      });
    }

    // Fetch place context if we have a place_id
    let placeContext: PlaceContext | null = null;
    if (requestInfo.place_id) {
      const contextResult = await queryOne<{ context: any }>(
        `SELECT sot.get_place_context($1) as context`,
        [requestInfo.place_id]
      );

      if (contextResult?.context && !contextResult.context.error) {
        const ctx = contextResult.context;
        placeContext = {
          place_id: requestInfo.place_id,
          address: requestInfo.formatted_address || ctx.address || "",
          context_flags: ctx.context_flags || {
            has_active_request: false,
            has_recent_clinic: false,
            has_google_history: false,
            has_nearby_activity: false,
          },
          active_requests_count: ctx.active_requests?.length || 0,
          clinic_cats_6mo: ctx.clinic_activity?.total_cats_6mo || 0,
          google_entries_nearby: ctx.google_context?.length || 0,
          nearby_requests_count: ctx.nearby_requests?.length || 0,
        };
      }
    }

    // Fetch all nearby entities in parallel
    const [nearbyRequests, nearbyPlaces, nearbyPeople, nearbyCats] = await Promise.all([
      // Nearby requests (excluding current request)
      queryRows<NearbyRequest>(
        `SELECT
          r.request_id,
          r.summary,
          r.status::TEXT,
          r.priority::TEXT,
          p.formatted_address as place_address,
          r.estimated_cat_count,
          r.created_at,
          ST_Distance(
            p.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) as distance_m
        FROM ops.requests r
        JOIN sot.places p ON p.place_id = r.place_id
        WHERE r.request_id != $4
          AND p.lat IS NOT NULL
          AND ST_DWithin(
            p.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
          )
        ORDER BY distance_m
        LIMIT 50`,
        [requestInfo.lat, requestInfo.lng, radius, id]
      ),

      // Nearby places with cat activity
      // V2: Uses sot.cat_place instead of sot.cat_place_relationships
      queryRows<NearbyPlace>(
        `SELECT
          p.place_id,
          p.display_name,
          p.formatted_address,
          ST_Distance(
            p.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) as distance_m,
          COALESCE((
            SELECT COUNT(DISTINCT cp.cat_id)
            FROM sot.cat_place cp
            WHERE cp.place_id = p.place_id
          ), 0)::INT as cat_count,
          EXISTS (
            SELECT 1 FROM ops.requests r
            WHERE r.place_id = p.place_id
              AND r.status NOT IN ('completed', 'cancelled')
          ) as has_active_request
        FROM sot.places p
        WHERE p.place_id != $4
          AND p.lat IS NOT NULL
          AND ST_DWithin(
            p.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
          )
        ORDER BY distance_m
        LIMIT 50`,
        [requestInfo.lat, requestInfo.lng, radius, requestInfo.place_id || ""]
      ),

      // Nearby people (via their place relationships)
      // V2: Uses sot.person_place instead of sot.person_place_relationships, sot.person_cat instead of sot.person_cat_relationships
      queryRows<NearbyPerson>(
        `SELECT DISTINCT ON (per.person_id)
          per.person_id,
          per.display_name,
          COALESCE(pl.display_name, split_part(pl.formatted_address, ',', 1)) as place_name,
          pp.relationship_type,
          ST_Distance(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) as distance_m,
          COALESCE((
            SELECT COUNT(DISTINCT pc.cat_id)
            FROM sot.person_cat pc
            WHERE pc.person_id = per.person_id
          ), 0)::INT as cat_count
        FROM sot.person_place pp
        JOIN sot.people per ON per.person_id = pp.person_id
          AND per.merged_into_person_id IS NULL
        JOIN sot.places pl ON pl.place_id = pp.place_id
        WHERE pl.lat IS NOT NULL
          AND ST_DWithin(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
          )
        ORDER BY per.person_id, distance_m
        LIMIT 50`,
        [requestInfo.lat, requestInfo.lng, radius]
      ),

      // Nearby cats (via their place relationships)
      // V2: Uses sot.cat_place instead of sot.cat_place_relationships
      queryRows<NearbyCat>(
        `SELECT DISTINCT ON (c.cat_id)
          c.cat_id,
          c.display_name,
          ci.id_value as microchip,
          COALESCE(pl.display_name, split_part(pl.formatted_address, ',', 1)) as place_name,
          ST_Distance(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) as distance_m,
          c.altered_status
        FROM sot.cat_place cp
        JOIN sot.cats c ON c.cat_id = cp.cat_id
        JOIN sot.places pl ON pl.place_id = cp.place_id
        LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
        WHERE pl.lat IS NOT NULL
          AND ST_DWithin(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
          )
        ORDER BY c.cat_id, distance_m
        LIMIT 50`,
        [requestInfo.lat, requestInfo.lng, radius]
      ),
    ]);

    return NextResponse.json({
      request_id: id,
      center: { lat: requestInfo.lat, lng: requestInfo.lng },
      place_id: requestInfo.place_id,
      context: placeContext,
      nearby: {
        requests: nearbyRequests,
        places: nearbyPlaces,
        people: nearbyPeople,
        cats: nearbyCats,
      },
      summary: {
        total_requests: nearbyRequests.length,
        total_places: nearbyPlaces.length,
        total_people: nearbyPeople.length,
        total_cats: nearbyCats.length,
        radius_meters: radius,
        has_active_request: placeContext?.context_flags.has_active_request || false,
        has_recent_clinic: placeContext?.context_flags.has_recent_clinic || false,
        has_google_history: placeContext?.context_flags.has_google_history || false,
        has_nearby_activity: placeContext?.context_flags.has_nearby_activity || false,
      },
    });
  } catch (error) {
    console.error("Error fetching nearby entities:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to fetch nearby entities", details: errorMessage },
      { status: 500 }
    );
  }
}
