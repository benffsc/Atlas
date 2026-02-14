import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Google Map Entries API (Review Queue)
 *
 * GET - List unmatched/uncertain Google Map entries for review
 * PATCH - Update an entry (link to place, add AI summary)
 *
 * Used by:
 * - Admin Google Map review page
 * - AI summarization job
 */

interface GoogleMapEntry {
  entry_id: string;
  kml_name: string | null;
  content_preview: string | null;
  lat: number;
  lng: number;
  match_status: string;
  nearest_place_distance_m: number | null;
  nearest_place_address: string | null;
  nearest_place_name: string | null;
  parsed_cat_count: number | null;
  ai_summary: string | null;
  imported_at: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // 'unmatched', 'uncertain', 'all'
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Build where clause based on status filter
    let whereClause = "WHERE gme.match_status IN ('unmatched', 'uncertain') AND gme.place_id IS NULL";
    if (status === "uncertain") {
      whereClause = "WHERE gme.match_status = 'uncertain' AND gme.place_id IS NULL";
    } else if (status === "unmatched") {
      whereClause = "WHERE gme.match_status = 'unmatched' AND gme.place_id IS NULL";
    } else if (status === "matched") {
      whereClause = "WHERE gme.place_id IS NOT NULL";
    } else if (status === "all") {
      whereClause = ""; // Show all
    }

    const sql = `
      SELECT
        gme.entry_id,
        gme.kml_name,
        LEFT(gme.original_content, 200) AS content_preview,
        gme.lat,
        gme.lng,
        gme.match_status,
        gme.nearest_place_distance_m,
        np.formatted_address AS nearest_place_address,
        np.display_name AS nearest_place_name,
        gme.parsed_cat_count,
        gme.ai_summary,
        gme.imported_at::TEXT
      FROM source.google_map_entries gme
      LEFT JOIN sot.places np ON np.place_id = gme.nearest_place_id
      ${whereClause}
      ORDER BY
        CASE gme.match_status
          WHEN 'uncertain' THEN 1
          WHEN 'unmatched' THEN 2
          ELSE 3
        END,
        gme.nearest_place_distance_m ASC NULLS LAST
      LIMIT $1 OFFSET $2
    `;

    const entries = await queryRows<GoogleMapEntry>(sql, [limit, offset]);

    // Get counts by status
    const countsSql = `
      SELECT
        match_status,
        COUNT(*) as count
      FROM source.google_map_entries
      GROUP BY match_status
    `;
    const counts = await queryRows<{ match_status: string; count: string }>(countsSql);
    const statusCounts = Object.fromEntries(
      counts.map((c) => [c.match_status, parseInt(c.count)])
    );

    return NextResponse.json({
      entries,
      counts: statusCounts,
      pagination: { limit, offset },
    });
  } catch (error) {
    console.error("Error fetching Google Map entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch Google Map entries" },
      { status: 500 }
    );
  }
}

interface LinkBody {
  entry_id: string;
  place_id: string;
  review_notes?: string;
}

interface AiSummaryBody {
  entry_id: string;
  ai_summary: string;
  ai_confidence?: number;
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    // Determine if this is a link operation or AI summary update
    if (body.place_id) {
      // Link to place using the database function
      const linkBody = body as LinkBody;
      const result = await queryOne<{ success: boolean; error?: string }>(
        `SELECT * FROM sot.link_google_map_entry($1, $2, $3, $4)`,
        [
          linkBody.entry_id,
          linkBody.place_id,
          "atlas_user",
          linkBody.review_notes || null,
        ]
      );

      if (!result?.success) {
        return NextResponse.json(
          { error: result?.error || "Failed to link entry" },
          { status: 400 }
        );
      }

      return NextResponse.json(result);
    } else if (body.ai_summary) {
      // Update AI summary
      const summaryBody = body as AiSummaryBody;
      const result = await queryOne<{ found: boolean }>(
        `SELECT ops.update_google_map_ai_summary($1, $2, $3) as found`,
        [
          summaryBody.entry_id,
          summaryBody.ai_summary,
          summaryBody.ai_confidence || 0.8,
        ]
      );

      if (!result?.found) {
        return NextResponse.json(
          { error: "Entry not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: "Must provide either place_id (to link) or ai_summary (to update)" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error updating Google Map entry:", error);
    return NextResponse.json(
      { error: "Failed to update entry" },
      { status: 500 }
    );
  }
}
