import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

// Google Maps Entry Linking Cron Job
//
// Daily re-evaluation of Google Maps entry linking:
// 1. Updates nearest_place_id for all unlinked entries
// 2. Runs tiered auto-linking for newly eligible entries
// 3. Processes high-confidence AI suggestions
// 4. Flags multi-unit candidates for manual review
// 5. Logs metrics
//
// This is a DAILY job (heavy operation), separate from the incremental
// linking that runs via run_all_entity_linking() every 15 minutes.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/google-entry-linking", "schedule": "0 9 * * *" }]
//   (9 AM UTC = 1-2 AM Pacific)

export const maxDuration = 120; // 2 minutes for heavy batch operations

const CRON_SECRET = process.env.CRON_SECRET;

interface LinkingStats {
  linked: number;
  needs_unit: number;
  unlinked: number;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results: Record<string, number | string> = {};

  try {
    // Step 1: Update nearest_place for all unlinked entries (batch)
    // This is a heavy operation - only run daily
    const nearestResult = await queryOne<{ updated: number }>(`
      WITH updated AS (
        UPDATE source.google_map_entries e
        SET
          nearest_place_id = nearest.place_id,
          nearest_place_distance_m = nearest.distance_m
        FROM (
          SELECT DISTINCT ON (e2.entry_id)
            e2.entry_id,
            p.place_id,
            ST_Distance(
              ST_SetSRID(ST_MakePoint(e2.lng, e2.lat), 4326)::geography,
              p.location::geography
            ) as distance_m
          FROM source.google_map_entries e2
          CROSS JOIN LATERAL (
            SELECT place_id, location
            FROM sot.places p
            WHERE p.merged_into_place_id IS NULL
              AND p.location IS NOT NULL
              AND ST_DWithin(
                ST_SetSRID(ST_MakePoint(e2.lng, e2.lat), 4326)::geography,
                p.location::geography,
                500
              )
            ORDER BY ST_Distance(
              ST_SetSRID(ST_MakePoint(e2.lng, e2.lat), 4326)::geography,
              p.location::geography
            )
            LIMIT 1
          ) p
          WHERE e2.linked_place_id IS NULL
            AND e2.place_id IS NULL
            AND e2.lat IS NOT NULL
        ) nearest
        WHERE e.entry_id = nearest.entry_id
          AND (
            e.nearest_place_id IS NULL
            OR e.nearest_place_id != nearest.place_id
            OR e.nearest_place_distance_m != nearest.distance_m
          )
        RETURNING e.entry_id
      )
      SELECT COUNT(*)::int as updated FROM updated
    `);
    results.nearest_place_updated = nearestResult?.updated || 0;

    // Step 2: Run tiered auto-linking
    const tieredResult = await queryOne<{
      residential_linked: number;
      business_linked: number;
      rural_linked: number;
      multi_unit_flagged: number;
      total_linked: number;
    }>(`SELECT * FROM sot.link_google_entries_tiered(5000, false)`);

    if (tieredResult) {
      results.tiered_residential = tieredResult.residential_linked;
      results.tiered_business = tieredResult.business_linked;
      results.tiered_rural = tieredResult.rural_linked;
      results.tiered_total = tieredResult.total_linked;
      results.multi_unit_flagged = tieredResult.multi_unit_flagged;
    }

    // Step 3: Process AI suggestions
    const aiResult = await queryOne<{ ai_linked: number }>(
      `SELECT * FROM sot.link_google_entries_from_ai(1000, false)`
    );
    results.ai_linked = aiResult?.ai_linked || 0;

    // Step 4: Flag any remaining multi-unit candidates
    const flagResult = await queryOne<{ count: number }>(
      `SELECT trapper.flag_multi_unit_candidates() as count`
    );
    results.additional_flagged = flagResult?.count || 0;

    // Step 5: Get current stats
    const stats = await queryOne<LinkingStats>(`
      SELECT
        COUNT(*) FILTER (WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL)::int as linked,
        COUNT(*) FILTER (WHERE linked_place_id IS NULL AND place_id IS NULL AND requires_unit_selection = true)::int as needs_unit,
        COUNT(*) FILTER (WHERE linked_place_id IS NULL AND place_id IS NULL AND COALESCE(requires_unit_selection, false) = false)::int as unlinked
      FROM source.google_map_entries
      WHERE lat IS NOT NULL
    `);

    return NextResponse.json({
      success: true,
      message: `Daily Google Maps linking complete`,
      operations: results,
      current_stats: stats,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Google entry linking cron error:", error);
    return NextResponse.json(
      {
        error: "Google entry linking failed",
        details: error instanceof Error ? error.message : "Unknown error",
        partial_results: results,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
