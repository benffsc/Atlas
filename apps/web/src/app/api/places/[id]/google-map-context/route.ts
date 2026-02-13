import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * Place Google Map Context API
 *
 * GET - Get historical Google Maps context for a place
 *
 * Returns entries from google_map_entries that are linked to this place,
 * with AI summaries (if available) for display as context cards.
 */

interface GoogleMapEntry {
  entry_id: string;
  kml_name: string | null;
  original_content: string | null;
  ai_summary: string | null;
  display_content: string | null;
  is_ai_summarized: boolean;
  parsed_cat_count: number | null;
  parsed_altered_count: number | null;
  parsed_date: string | null;
  parsed_trapper: string | null;
  match_status: string;
  matched_at: string | null;
  imported_at: string;
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
    // Check if place was merged — follow the merge chain
    const mergeCheck = await queryRows<{ merged_into_place_id: string | null }>(
      `SELECT merged_into_place_id FROM sot.places WHERE place_id = $1`,
      [id]
    );
    const placeId = mergeCheck?.[0]?.merged_into_place_id || id;

    // Include entries from this place AND all structurally related places:
    // - Parent building (if this is a unit)
    // - Child units (if this is a building)
    // - Sibling units (other units of same building)
    // - Co-located places (same geocoded point, within 1m)
    // Uses both place_id and linked_place_id to catch all linking methods
    const sql = `
      WITH family AS (
        SELECT unnest(sot.get_place_family($1)) AS fid
      )
      SELECT
        entry_id,
        kml_name,
        original_content,
        ai_summary,
        COALESCE(ai_summary, original_content) AS display_content,
        ai_processed_at IS NOT NULL AS is_ai_summarized,
        parsed_cat_count,
        parsed_altered_count,
        parsed_date::TEXT,
        parsed_trapper,
        match_status,
        matched_at::TEXT,
        imported_at::TEXT
      FROM source.google_map_entries
      WHERE place_id IN (SELECT fid FROM family)
         OR linked_place_id IN (SELECT fid FROM family)
      ORDER BY parsed_date DESC NULLS LAST, imported_at DESC
    `;

    const entries = await queryRows<GoogleMapEntry>(sql, [placeId]);

    return NextResponse.json({
      entries,
      count: entries.length,
      has_ai_summaries: entries.some(e => e.is_ai_summarized),
    });
  } catch (error) {
    console.error("Error fetching Google Map context:", error);
    return NextResponse.json(
      { error: "Failed to fetch Google Map context" },
      { status: 500 }
    );
  }
}
