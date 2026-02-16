import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/colonies/suggest-details
 *
 * Returns smart suggestions for creating a colony from a request or place.
 * Provides pre-filled data that staff can review and modify before creation.
 *
 * Query params:
 * - request_id: Get suggestions based on a request's place
 * - place_id: Get suggestions based on a specific place
 * - radius: Search radius in meters (default: 200)
 */

interface SuggestedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  distance_m: number;
  cat_count: number;
  person_count: number;
  has_active_request: boolean;
  google_entry_count: number;
  is_primary: boolean;
  relationship_type: string;
}

interface SuggestedPerson {
  person_id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  place_address: string | null;
  distance_m: number;
  relationship_to_place: string | null;
  suggested_role: string;
  role_confidence: number;
  role_evidence: string[];
}

interface GoogleContextEntry {
  entry_id: string;
  kml_name: string | null;
  ai_meaning: string | null;
  ai_summary: string | null;
  parsed_date: string | null;
}

interface SuggestionResponse {
  source_type: "request" | "place";
  source_id: string;
  center: { lat: number; lng: number } | null;

  // Suggested colony name
  suggested_name: string;
  name_alternatives: string[];

  // Places to include in colony
  suggested_places: SuggestedPlace[];

  // People with role suggestions
  suggested_people: SuggestedPerson[];

  // Google Maps context for the area
  google_context: GoogleContextEntry[];

  // Summary statistics
  summary: {
    total_nearby_places: number;
    total_nearby_people: number;
    total_nearby_cats: number;
    has_disease_risk: boolean;
    has_watch_list: boolean;
    area_description: string;
  };
}

// Role detection patterns from note content
const ROLE_PATTERNS = {
  primary_feeder: [
    /feeds?\s*(every|daily|regularly)/i,
    /main\s*(care|caretaker|feeder)/i,
    /primary\s*(care|feeder)/i,
    /been\s*feeding\s*for\s*\d+\s*(year|month)/i,
  ],
  feeder: [
    /feeds?/i,
    /leaves?\s*food/i,
    /puts?\s*out\s*food/i,
    /feeding/i,
  ],
  reporter: [
    /reported/i,
    /called\s*(in|about)/i,
    /contacted\s*us/i,
    /original\s*caller/i,
  ],
  property_owner: [
    /owner/i,
    /landlord/i,
    /property\s*manager/i,
    /owns?\s*the\s*(property|building|house)/i,
  ],
  trapper_assigned: [
    /trapper/i,
    /assigned\s*to\s*trap/i,
    /will\s*trap/i,
    /trapping/i,
  ],
  contact: [
    /contact/i,
    /call\s*them/i,
    /reach\s*out/i,
  ],
};

function detectRole(
  personName: string | null,
  notes: string[],
  relationshipType: string | null
): { role: string; confidence: number; evidence: string[] } {
  const allNotes = notes.join(" ").toLowerCase();
  const name = (personName || "").toLowerCase();
  const evidence: string[] = [];

  // Check relationship type first
  if (relationshipType === "requester") {
    evidence.push("Is the original requester for this location");
    return { role: "reporter", confidence: 0.85, evidence };
  }

  if (relationshipType === "resident" || relationshipType === "owner") {
    evidence.push(`Has ${relationshipType} relationship to place`);
    return { role: "property_owner", confidence: 0.80, evidence };
  }

  // Check notes for role patterns
  let bestRole = "contact";
  let bestConfidence = 0.5;

  for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(allNotes)) {
        const match = allNotes.match(pattern);
        if (match) {
          const roleConfidence = role === "primary_feeder" ? 0.85 :
            role === "feeder" ? 0.75 :
            role === "property_owner" ? 0.80 :
            role === "trapper_assigned" ? 0.70 :
            0.65;

          if (roleConfidence > bestConfidence) {
            bestRole = role;
            bestConfidence = roleConfidence;
            evidence.push(`Notes mention: "${match[0]}"`);
          }
        }
      }
    }
  }

  if (evidence.length === 0) {
    evidence.push("Default contact role - no specific role detected");
  }

  return { role: bestRole, confidence: bestConfidence, evidence };
}

function generateColonyName(
  address: string | null,
  displayName: string | null
): { suggested: string; alternatives: string[] } {
  const alternatives: string[] = [];

  if (!address) {
    return {
      suggested: displayName || "New Colony",
      alternatives: ["New Colony"],
    };
  }

  // Parse address components
  const streetMatch = address.match(/^(\d+)\s+([^,]+)/);
  const cityMatch = address.match(/,\s*([^,]+),?\s*CA/i);

  if (streetMatch) {
    const streetNum = streetMatch[1];
    let streetName = streetMatch[2].trim();

    // Remove common suffixes for shorter name
    streetName = streetName.replace(
      /\s+(Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Cir|Place|Pl)\.?$/i,
      ""
    );

    // Main suggestion: Street name
    const mainName = `${streetName} Colony`;
    alternatives.push(mainName);

    // With street number
    alternatives.push(`${streetNum} ${streetName}`);

    // With city if available
    if (cityMatch) {
      const city = cityMatch[1].trim();
      alternatives.push(`${streetName} (${city})`);
    }
  }

  // Use display name if available
  if (displayName && displayName !== address) {
    alternatives.push(displayName);
  }

  // Fallback to address
  if (alternatives.length === 0) {
    alternatives.push(address.split(",")[0]);
  }

  return {
    suggested: alternatives[0],
    alternatives: alternatives.slice(0, 4),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("request_id");
  const placeId = searchParams.get("place_id");
  const radius = parseInt(searchParams.get("radius") || "200", 10);

  if (!requestId && !placeId) {
    return NextResponse.json(
      { error: "Either request_id or place_id is required" },
      { status: 400 }
    );
  }

  try {
    // Get the center point (from request or place)
    interface CenterInfo {
      lat: number | null;
      lng: number | null;
      place_id: string | null;
      formatted_address: string | null;
      display_name: string | null;
    }

    let centerInfo: CenterInfo | null = null;

    if (requestId) {
      centerInfo = await queryOne<CenterInfo>(
        `SELECT
          p.lat,
          p.lng,
          p.place_id,
          p.formatted_address,
          p.display_name
        FROM ops.requests r
        LEFT JOIN sot.places p ON p.place_id = r.place_id
        WHERE r.request_id = $1`,
        [requestId]
      );
    } else if (placeId) {
      centerInfo = await queryOne<CenterInfo>(
        `SELECT
          lat,
          lng,
          place_id,
          formatted_address,
          display_name
        FROM sot.places
        WHERE place_id = $1`,
        [placeId]
      );
    }

    if (!centerInfo?.lat || !centerInfo?.lng) {
      return NextResponse.json(
        { error: "Could not find coordinates for the specified entity" },
        { status: 404 }
      );
    }

    // Generate colony name suggestions
    const nameInfo = generateColonyName(
      centerInfo.formatted_address,
      centerInfo.display_name
    );

    // Fetch nearby places
    const nearbyPlaces = await queryRows<SuggestedPlace>(
      `SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        ST_Distance(
          p.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        )::INT as distance_m,
        -- V2: Uses sot.cat_place instead of sot.cat_place_relationships
        COALESCE((
          SELECT COUNT(DISTINCT cpr.cat_id)
          FROM sot.cat_place cpr
          WHERE cpr.place_id = p.place_id
        ), 0)::INT as cat_count,
        -- V2: Uses sot.person_place instead of sot.person_place_relationships
        COALESCE((
          SELECT COUNT(DISTINCT ppr.person_id)
          FROM sot.person_place ppr
          WHERE ppr.place_id = p.place_id
        ), 0)::INT as person_count,
        EXISTS (
          SELECT 1 FROM ops.requests r
          WHERE r.place_id = p.place_id
            AND r.status NOT IN ('completed', 'cancelled')
        ) as has_active_request,
        COALESCE((
          SELECT COUNT(*)
          FROM source.google_map_entries gme
          WHERE gme.place_id = p.place_id OR gme.linked_place_id = p.place_id
        ), 0)::INT as google_entry_count,
        CASE WHEN p.place_id = $3 THEN TRUE ELSE FALSE END as is_primary,
        CASE
          WHEN p.place_id = $3 THEN 'primary_location'
          ELSE 'nearby_location'
        END as relationship_type
      FROM sot.places p
      WHERE p.location IS NOT NULL
        AND ST_DWithin(
          p.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $4
        )
        AND p.merged_into_place_id IS NULL
      ORDER BY
        CASE WHEN p.place_id = $3 THEN 0 ELSE 1 END,
        distance_m ASC
      LIMIT 20`,
      [centerInfo.lat, centerInfo.lng, centerInfo.place_id || "", radius]
    );

    // Fetch nearby people with role detection
    const nearbyPeopleRaw = await queryRows<{
      person_id: string;
      display_name: string;
      primary_phone: string | null;
      primary_email: string | null;
      place_address: string | null;
      distance_m: number;
      relationship_type: string | null;
      notes: string[];
    }>(
      `SELECT DISTINCT ON (per.person_id)
        per.person_id,
        per.display_name,
        per.primary_phone,
        per.primary_email,
        pl.formatted_address as place_address,
        ST_Distance(
          pl.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        )::INT as distance_m,
        ppr.relationship_type,
        COALESCE(
          ARRAY(
            SELECT COALESCE(gme.ai_summary, gme.original_content)
            FROM source.google_map_entries gme
            WHERE (gme.place_id = pl.place_id OR gme.linked_place_id = pl.place_id)
              AND (
                LOWER(gme.kml_name) ILIKE '%' || LOWER(SPLIT_PART(per.display_name, ' ', 1)) || '%'
                OR LOWER(COALESCE(gme.ai_summary, gme.original_content, '')) ILIKE '%' || LOWER(SPLIT_PART(per.display_name, ' ', 1)) || '%'
              )
            LIMIT 5
          ),
          ARRAY[]::TEXT[]
        ) as notes
      -- V2: Uses sot.person_place instead of sot.person_place_relationships
      FROM sot.person_place ppr
      JOIN sot.people per ON per.person_id = ppr.person_id
        AND per.merged_into_person_id IS NULL
      JOIN sot.places pl ON pl.place_id = ppr.place_id
      WHERE pl.location IS NOT NULL
        AND ST_DWithin(
          pl.location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
      ORDER BY per.person_id, distance_m
      LIMIT 30`,
      [centerInfo.lat, centerInfo.lng, radius]
    );

    // Also get requester from the request if applicable
    let requesterPerson: typeof nearbyPeopleRaw[0] | null = null;
    if (requestId) {
      requesterPerson = await queryOne<typeof nearbyPeopleRaw[0]>(
        `SELECT
          per.person_id,
          per.display_name,
          per.primary_phone,
          per.primary_email,
          pl.formatted_address as place_address,
          0 as distance_m,
          'requester' as relationship_type,
          ARRAY[]::TEXT[] as notes
        FROM ops.requests r
        JOIN sot.people per ON per.person_id = r.requester_person_id
          AND per.merged_into_person_id IS NULL
        LEFT JOIN sot.places pl ON pl.place_id = r.place_id
        WHERE r.request_id = $1`,
        [requestId]
      );
    }

    // Combine and deduplicate people
    const peopleMap = new Map<string, typeof nearbyPeopleRaw[0]>();
    if (requesterPerson) {
      peopleMap.set(requesterPerson.person_id, requesterPerson);
    }
    for (const person of nearbyPeopleRaw) {
      if (!peopleMap.has(person.person_id)) {
        peopleMap.set(person.person_id, person);
      }
    }

    // Detect roles for each person
    const suggestedPeople: SuggestedPerson[] = Array.from(peopleMap.values())
      .map((person) => {
        const roleInfo = detectRole(
          person.display_name,
          person.notes || [],
          person.relationship_type
        );
        return {
          person_id: person.person_id,
          display_name: person.display_name,
          primary_phone: person.primary_phone,
          primary_email: person.primary_email,
          place_address: person.place_address,
          distance_m: person.distance_m,
          relationship_to_place: person.relationship_type,
          suggested_role: roleInfo.role,
          role_confidence: roleInfo.confidence,
          role_evidence: roleInfo.evidence,
        };
      })
      .sort((a, b) => b.role_confidence - a.role_confidence)
      .slice(0, 15);

    // Fetch Google Maps context for the area
    const googleContext = await queryRows<GoogleContextEntry>(
      `SELECT
        gme.entry_id,
        gme.kml_name,
        gme.ai_meaning,
        gme.ai_summary,
        gme.parsed_date::TEXT
      FROM source.google_map_entries gme
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
      ORDER BY
        CASE WHEN gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') THEN 0 ELSE 1 END,
        gme.parsed_date DESC NULLS LAST
      LIMIT 20`,
      [centerInfo.lat, centerInfo.lng, radius]
    );

    // Calculate summary statistics
    const totalCats = nearbyPlaces.reduce((sum, p) => sum + p.cat_count, 0);
    const hasDiseaseRisk = googleContext.some((g) =>
      ["disease_risk", "felv_colony", "fiv_colony"].includes(g.ai_meaning || "")
    );
    const hasWatchList = googleContext.some(
      (g) => g.ai_meaning === "watch_list"
    );

    // Generate area description
    let areaDescription = `${nearbyPlaces.length} location${nearbyPlaces.length !== 1 ? "s" : ""}`;
    if (totalCats > 0) {
      areaDescription += `, ${totalCats} known cat${totalCats !== 1 ? "s" : ""}`;
    }
    if (hasDiseaseRisk) {
      areaDescription += ", disease risk noted";
    }
    if (hasWatchList) {
      areaDescription += ", on watch list";
    }

    const response: SuggestionResponse = {
      source_type: requestId ? "request" : "place",
      source_id: requestId || placeId!,
      center: { lat: centerInfo.lat, lng: centerInfo.lng },

      suggested_name: nameInfo.suggested,
      name_alternatives: nameInfo.alternatives,

      suggested_places: nearbyPlaces,
      suggested_people: suggestedPeople,
      google_context: googleContext,

      summary: {
        total_nearby_places: nearbyPlaces.length,
        total_nearby_people: suggestedPeople.length,
        total_nearby_cats: totalCats,
        has_disease_risk: hasDiseaseRisk,
        has_watch_list: hasWatchList,
        area_description: areaDescription,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error generating colony suggestions:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to generate suggestions", details: errorMessage },
      { status: 500 }
    );
  }
}
