import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * People Search API
 *
 * GET /api/people/search?q=query&limit=10
 *
 * Searches people by name, email, or phone
 */

interface PersonSearchResult {
  person_id: string;
  display_name: string;
  entity_type: string;
  cat_count: number;
  emails: string | null;
  phones: string | null;
  addresses: Array<{
    place_id: string;
    formatted_address: string;
    display_name: string;
    role: string;
    confidence: number;
  }> | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "20");

  if (query.length < 2) {
    return NextResponse.json({ people: [] });
  }

  const searchPattern = `%${query}%`;

  // V2: Uses sot.person_cat instead of sot.person_cat_relationships, sot.person_place instead of person_place_relationships
  const people = await queryRows<PersonSearchResult>(`
    SELECT DISTINCT ON (p.person_id)
      p.person_id,
      p.display_name,
      p.entity_type,
      (
        -- V2: Uses sot.person_cat instead of sot.person_cat_relationships
        SELECT COUNT(*)
        FROM sot.person_cat pcr
        WHERE pcr.person_id = p.person_id
          AND pcr.relationship_type NOT LIKE 'former_%'
      ) as cat_count,
      (
        SELECT string_agg(DISTINCT pi.id_value_raw, ', ')
        FROM sot.person_identifiers pi
        WHERE pi.person_id = p.person_id
          AND pi.id_type = 'email'
          AND pi.confidence >= 0.5
      ) as emails,
      (
        SELECT string_agg(DISTINCT pi.id_value_raw, ', ')
        FROM sot.person_identifiers pi
        WHERE pi.person_id = p.person_id
          AND pi.id_type = 'phone'
      ) as phones,
      (
        -- V2: Uses sot.person_place instead of sot.person_place_relationships, relationship_type instead of role
        SELECT jsonb_agg(
          jsonb_build_object(
            'place_id', ppr.place_id,
            'formatted_address', pl.formatted_address,
            'display_name', pl.display_name,
            'role', ppr.relationship_type,
            'confidence', ppr.confidence
          )
          ORDER BY ppr.confidence DESC NULLS LAST
        )
        FROM sot.person_place ppr
        JOIN sot.places pl ON pl.place_id = ppr.place_id
        WHERE ppr.person_id = p.person_id
          AND pl.merged_into_place_id IS NULL
      ) as addresses
    FROM sot.people p
    LEFT JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
      AND pi.confidence >= 0.5
    WHERE p.merged_into_person_id IS NULL
      AND p.is_canonical = TRUE
      AND (
        p.display_name ILIKE $1
        OR pi.id_value_norm ILIKE $1
        OR pi.id_value_raw ILIKE $1
      )
    ORDER BY p.person_id, p.display_name
    LIMIT $2
  `, [searchPattern, limit]);

  return NextResponse.json({
    people,
    query,
  });
}
