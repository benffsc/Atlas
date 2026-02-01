import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Place Map Details API
 *
 * GET - Get comprehensive place details for the map drawer
 *
 * Returns:
 * - Basic place info (address, display name, service zone)
 * - Flags (disease risk, watchlist)
 * - Stats (cat count, person count, request count, altered count)
 * - People linked to the place
 * - Google Maps notes (original and AI summaries)
 * - Journal entries
 */

interface PlaceDetails {
  place_id: string;
  address: string;
  display_name: string | null;
  service_zone: string | null;
  disease_risk: boolean;
  disease_risk_notes: string | null;
  watch_list: boolean;
  watch_list_reason: string | null;
  cat_count: number;
  person_count: number;
  request_count: number;
  active_request_count: number;
  total_altered: number;
}

interface PersonLink {
  person_id: string;
  display_name: string;
}

interface GoogleNote {
  entry_id: string;
  kml_name: string | null;
  original_content: string | null;
  original_redacted: string | null;
  ai_summary: string | null;
  ai_meaning: string | null;
  parsed_date: string | null;
  imported_at: string;
}

interface JournalEntry {
  entry_id: string;
  entry_type: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

interface DiseaseBadge {
  disease_key: string;
  short_code: string;
  color: string;
  status: string;
  last_positive_date: string | null;
  positive_cat_count: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Place ID is required" }, { status: 400 });
  }

  try {
    // Check if place was merged
    const mergeCheck = await queryOne<{ merged_into_place_id: string | null }>(
      `SELECT merged_into_place_id FROM trapper.places WHERE place_id = $1`,
      [id]
    );

    const placeId = mergeCheck?.merged_into_place_id || id;

    // Get place details from the map pins view
    const place = await queryOne<PlaceDetails>(
      `SELECT
        p.place_id,
        p.formatted_address AS address,
        p.display_name,
        p.service_zone,
        COALESCE(p.disease_risk, FALSE) AS disease_risk,
        p.disease_risk_notes,
        COALESCE(p.watch_list, FALSE) AS watch_list,
        p.watch_list_reason,
        COALESCE(cc.cat_count, 0) AS cat_count,
        COALESCE(ppl.person_count, 0) AS person_count,
        COALESCE(req.request_count, 0) AS request_count,
        COALESCE(req.active_request_count, 0) AS active_request_count,
        COALESCE(tnr.total_altered, 0) AS total_altered
      FROM trapper.places p
      LEFT JOIN (
        SELECT place_id, COUNT(DISTINCT cat_id) AS cat_count
        FROM trapper.cat_place_relationships
        GROUP BY place_id
      ) cc ON cc.place_id = p.place_id
      LEFT JOIN (
        SELECT ppr.place_id, COUNT(DISTINCT ppr.person_id) AS person_count
        FROM trapper.person_place_relationships ppr
        JOIN trapper.sot_people per ON per.person_id = ppr.person_id
        WHERE per.merged_into_person_id IS NULL
          AND per.display_name IS NOT NULL
          AND per.display_name !~ ', CA[ ,]'
          AND per.display_name !~ '\\d{5}'
          AND per.display_name !~* '^\\d+\\s+\\w+\\s+(st|rd|ave|blvd|dr|ln|ct|way|pl)\\b'
        GROUP BY ppr.place_id
      ) ppl ON ppl.place_id = p.place_id
      LEFT JOIN (
        SELECT
          place_id,
          COUNT(*) AS request_count,
          COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) AS active_request_count
        FROM trapper.sot_requests
        WHERE place_id IS NOT NULL
        GROUP BY place_id
      ) req ON req.place_id = p.place_id
      LEFT JOIN (
        SELECT place_id, total_cats_altered AS total_altered
        FROM trapper.v_place_alteration_history
      ) tnr ON tnr.place_id = p.place_id
      WHERE p.place_id = $1`,
      [placeId]
    );

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    // Get people linked to this place
    // Use DISTINCT ON to deduplicate when a person has multiple roles (resident, owner, contact)
    // Filter out entries that look like addresses (have state abbreviations or zip codes)
    const people = await queryRows<PersonLink>(
      `SELECT DISTINCT ON (per.person_id)
        per.person_id,
        per.display_name
      FROM trapper.person_place_relationships ppr
      JOIN trapper.sot_people per ON per.person_id = ppr.person_id
      WHERE ppr.place_id = $1
        AND per.merged_into_person_id IS NULL
        -- Exclude entries that look like addresses
        AND per.display_name IS NOT NULL
        AND per.display_name !~ ', CA[ ,]'  -- Contains ", CA " or ", CA,"
        AND per.display_name !~ '\\d{5}'     -- Contains 5-digit zip code
        AND per.display_name !~* '^\\d+\\s+\\w+\\s+(st|rd|ave|blvd|dr|ln|ct|way|pl)\\b'  -- Starts with street address
      ORDER BY per.person_id, per.display_name`,
      [placeId]
    );

    // Get Google Maps notes (both original and AI-processed)
    // Uses get_place_family() to include notes from structurally related places:
    // parent building, child units, sibling units, and co-located places (same point)
    const googleNotes = await queryRows<GoogleNote>(
      `WITH family AS (
        SELECT unnest(trapper.get_place_family($1)) AS fid
      )
      SELECT
        entry_id,
        kml_name,
        original_content,
        original_redacted,
        ai_summary,
        ai_meaning,
        parsed_date::TEXT,
        imported_at::TEXT
      FROM trapper.google_map_entries
      WHERE place_id IN (SELECT fid FROM family)
         OR linked_place_id IN (SELECT fid FROM family)
      ORDER BY parsed_date DESC NULLS LAST, imported_at DESC`,
      [placeId]
    );

    // Get journal entries for this place (if table exists)
    let journalEntries: JournalEntry[] = [];
    try {
      journalEntries = await queryRows<JournalEntry>(
        `SELECT
          entry_id::TEXT,
          entry_type,
          content,
          author_name,
          created_at::TEXT
        FROM trapper.entity_journal
        WHERE entity_type = 'place'
          AND entity_id = $1
          AND is_deleted = FALSE
        ORDER BY created_at DESC`,
        [placeId]
      );
    } catch {
      // Table may not exist yet - return empty array
      journalEntries = [];
    }

    // Get per-disease status badges
    let diseaseBadges: DiseaseBadge[] = [];
    try {
      diseaseBadges = await queryRows<DiseaseBadge>(
        `SELECT
          dt.disease_key,
          dt.short_code,
          dt.color,
          pds.status,
          pds.last_positive_date::TEXT,
          COALESCE(pds.positive_cat_count, 0) AS positive_cat_count
        FROM trapper.place_disease_status pds
        JOIN trapper.disease_types dt ON dt.disease_key = pds.disease_type_key
        WHERE pds.place_id = $1
          AND pds.status NOT IN ('false_flag', 'cleared')
        ORDER BY dt.severity_order`,
        [placeId]
      );
    } catch {
      // Table may not exist yet
      diseaseBadges = [];
    }

    return NextResponse.json({
      ...place,
      people,
      google_notes: googleNotes,
      journal_entries: journalEntries,
      disease_badges: diseaseBadges,
    });
  } catch (error) {
    console.error("Error fetching place map details:", error);
    return NextResponse.json(
      { error: "Failed to fetch place details" },
      { status: 500 }
    );
  }
}
