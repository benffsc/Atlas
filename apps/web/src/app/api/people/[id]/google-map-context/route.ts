import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * Person Google Map Context API
 *
 * GET - Get Google Maps context for places linked to a person
 *
 * Shows "this person's location has this context" on person detail.
 */

// Uses source.google_map_entries (source of truth)
interface PersonPlaceContext {
  person_id: string;
  place_id: string;
  relationship_type: string;
  place_name: string;
  formatted_address: string;
  entry_id: string;
  context_preview: string;
  parsed_cat_count: number | null;
  is_ai_summarized: boolean;
  imported_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Person ID is required" }, { status: 400 });
  }

  try {
    // V2: Uses sot.person_place and source.google_map_entries
    const sql = `
      SELECT
        ppr.person_id,
        ppr.place_id,
        ppr.relationship_type,
        p.display_name AS place_name,
        p.formatted_address,
        gme.entry_id,
        COALESCE(gme.ai_summary, LEFT(gme.original_content, 200)) AS context_preview,
        gme.ai_summary IS NOT NULL AS is_ai_summarized,
        gme.imported_at::TEXT
      FROM sot.person_place ppr
      JOIN sot.places p ON p.place_id = ppr.place_id
      JOIN source.google_map_entries gme ON gme.place_id = ppr.place_id
      WHERE ppr.person_id = $1
        AND ppr.valid_to IS NULL
      ORDER BY gme.imported_at DESC
      LIMIT 10
    `;

    const contexts = await queryRows<PersonPlaceContext>(sql, [id]);

    return NextResponse.json({
      contexts,
      count: contexts.length,
    });
  } catch (error) {
    console.error("Error fetching person Google Map context:", error);
    return NextResponse.json(
      { error: "Failed to fetch context" },
      { status: 500 }
    );
  }
}
