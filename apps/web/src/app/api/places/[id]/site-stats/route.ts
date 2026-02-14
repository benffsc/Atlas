import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface SiteStats {
  is_part_of_site: boolean;
  cluster_id: string;
  place_count: number;
  place_names: string[];
  unique_cat_count: number;
  altered_cat_count: number;
  alteration_rate_pct: number | null;
  site_status: string;
}

// GET /api/places/[id]/site-stats - Get aggregate site stats for a place
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    // Use the SQL function to get site stats
    const stats = await queryOne<SiteStats>(`
      SELECT * FROM ops.get_site_stats_for_place($1::uuid)
    `, [id]);

    if (!stats) {
      // Return default stats for place not found in any cluster
      return NextResponse.json({
        is_part_of_site: false,
        cluster_id: id,
        place_count: 1,
        place_names: [],
        unique_cat_count: 0,
        altered_cat_count: 0,
        alteration_rate_pct: null,
        site_status: "unknown",
      });
    }

    return NextResponse.json(stats);
  } catch (err) {
    console.error("Error fetching site stats:", err);

    // If the function doesn't exist yet (migration not run), return graceful fallback
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("get_site_stats_for_place") || errorMessage.includes("does not exist")) {
      return NextResponse.json({
        is_part_of_site: false,
        cluster_id: id,
        place_count: 1,
        place_names: [],
        unique_cat_count: 0,
        altered_cat_count: 0,
        alteration_rate_pct: null,
        site_status: "unknown",
        _note: "Site stats not available - migration may not have been run",
      });
    }

    return NextResponse.json(
      { error: "Failed to fetch site stats" },
      { status: 500 }
    );
  }
}
