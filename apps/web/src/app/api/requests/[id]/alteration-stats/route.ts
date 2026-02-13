import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface LinkedCat {
  cat_id: string;
  cat_name: string;
  microchip: string | null;
  sex: string | null;
  match_reason: "explicit_link" | "place_and_requester" | "place_match" | "requester_match";
  confidence: number;
  procedure_date: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  altered_after_request: boolean;
}

interface AlterationStatsRow {
  request_id: string;
  source_system: string | null;
  source_record_id: string | null;
  status: string;
  summary: string | null;
  estimated_cat_count: number | null;
  effective_request_date: string;
  window_start: string;
  window_end: string;
  window_type: string;
  cats_caught: string; // bigint comes as string
  cats_for_request: string; // NEW: cats caught for this specific request
  cats_altered: string;
  already_altered_before: string;
  males: string;
  females: string;
  alteration_rate_pct: string | null;
  avg_match_confidence: string;
  linked_cats: LinkedCat[];
  is_legacy_request: boolean;
  can_upgrade: boolean;
  place_name: string | null;
  place_name_is_address: boolean;
  place_address: string | null;
  requester_name: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        request_id,
        source_system,
        source_record_id,
        status,
        summary,
        estimated_cat_count,
        effective_request_date,
        window_start,
        window_end,
        window_type,
        cats_caught,
        cats_for_request,
        cats_altered,
        already_altered_before,
        males,
        females,
        alteration_rate_pct,
        avg_match_confidence,
        linked_cats,
        is_legacy_request,
        can_upgrade,
        place_name,
        place_name_is_address,
        place_address,
        requester_name
      FROM ops.v_request_alteration_stats
      WHERE request_id = $1
    `;

    const stats = await queryOne<AlterationStatsRow>(sql, [id]);

    if (!stats) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // Parse linked_cats if it's a string (JSONB comes as object)
    const linkedCats = typeof stats.linked_cats === "string"
      ? JSON.parse(stats.linked_cats)
      : stats.linked_cats || [];

    return NextResponse.json({
      request_id: stats.request_id,
      source_system: stats.source_system,
      source_record_id: stats.source_record_id,
      status: stats.status,
      summary: stats.summary,
      estimated_cat_count: stats.estimated_cat_count,
      effective_request_date: stats.effective_request_date,
      window_start: stats.window_start,
      window_end: stats.window_end,
      window_type: stats.window_type,

      // Core stats (convert from string to number - bigint comes as string from postgres)
      cats_caught: parseInt(stats.cats_caught) || 0,
      cats_for_request: parseInt(stats.cats_for_request) || 0,
      cats_altered: parseInt(stats.cats_altered) || 0,
      already_altered_before: parseInt(stats.already_altered_before) || 0,
      males: parseInt(stats.males) || 0,
      females: parseInt(stats.females) || 0,
      alteration_rate_pct: stats.alteration_rate_pct ? parseFloat(stats.alteration_rate_pct) : null,

      // Safe linking info
      avg_match_confidence: parseFloat(stats.avg_match_confidence) || 0,
      linked_cats: linkedCats,

      // Legacy/upgrade info
      is_legacy_request: stats.is_legacy_request,
      can_upgrade: stats.can_upgrade,

      // Display info
      place_name: stats.place_name,
      place_name_is_address: stats.place_name_is_address,
      place_address: stats.place_address,
      requester_name: stats.requester_name,
    });
  } catch (error) {
    console.error("Error fetching alteration stats:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to fetch alteration stats", details: errorMessage },
      { status: 500 }
    );
  }
}
