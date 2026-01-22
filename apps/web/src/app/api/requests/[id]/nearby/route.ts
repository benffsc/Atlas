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
    }>(
      `SELECT p.lat, p.lng, r.place_id
       FROM trapper.sot_requests r
       LEFT JOIN trapper.places p ON p.place_id = r.place_id
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
        FROM trapper.sot_requests r
        JOIN trapper.places p ON p.place_id = r.place_id
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
            SELECT COUNT(DISTINCT cpr.cat_id)
            FROM trapper.cat_place_relationships cpr
            WHERE cpr.place_id = p.place_id
          ), 0)::INT as cat_count,
          EXISTS (
            SELECT 1 FROM trapper.sot_requests r
            WHERE r.place_id = p.place_id
              AND r.status NOT IN ('completed', 'cancelled')
          ) as has_active_request
        FROM trapper.places p
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
      queryRows<NearbyPerson>(
        `SELECT DISTINCT ON (per.person_id)
          per.person_id,
          per.display_name,
          pl.display_name as place_name,
          ppr.relationship_type,
          ST_Distance(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) as distance_m,
          COALESCE((
            SELECT COUNT(DISTINCT pcr.cat_id)
            FROM trapper.person_cat_relationships pcr
            WHERE pcr.person_id = per.person_id
          ), 0)::INT as cat_count
        FROM trapper.person_place_relationships ppr
        JOIN trapper.sot_people per ON per.person_id = ppr.person_id
          AND per.merged_into_person_id IS NULL
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
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
      queryRows<NearbyCat>(
        `SELECT DISTINCT ON (c.cat_id)
          c.cat_id,
          c.display_name,
          ci.id_value as microchip,
          pl.display_name as place_name,
          ST_Distance(
            pl.location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) as distance_m,
          c.altered_status
        FROM trapper.cat_place_relationships cpr
        JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
        JOIN trapper.places pl ON pl.place_id = cpr.place_id
        LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
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
      },
    });
  } catch (error) {
    console.error("Error fetching nearby entities:", error);
    return NextResponse.json(
      { error: "Failed to fetch nearby entities" },
      { status: 500 }
    );
  }
}
