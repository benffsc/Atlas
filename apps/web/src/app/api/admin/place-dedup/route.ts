import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface PlaceDedupCandidate {
  candidate_id: string;
  canonical_place_id: string;
  duplicate_place_id: string;
  match_tier: number;
  address_similarity: number;
  distance_meters: number;
  canonical_address: string;
  canonical_name: string | null;
  canonical_kind: string;
  duplicate_address: string;
  duplicate_name: string | null;
  duplicate_kind: string;
  canonical_requests: number;
  canonical_cats: number;
  canonical_children: number;
  duplicate_requests: number;
  duplicate_cats: number;
  duplicate_children: number;
}

interface PlaceDedupSummary {
  match_tier: number;
  tier_label: string;
  pair_count: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tier = parseInt(searchParams.get("tier") || "0", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    await requireRole(request, ["admin"]);

    const tierClause = tier > 0 ? "AND c.match_tier = $1" : "";
    const params: (number | string)[] = tier > 0 ? [tier] : [];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(limit, offset);

    const candidates = await queryRows<PlaceDedupCandidate>(
      `SELECT
        c.candidate_id,
        c.canonical_place_id,
        c.duplicate_place_id,
        c.match_tier,
        c.address_similarity,
        c.distance_meters,
        c.canonical_address,
        c.canonical_name,
        c.canonical_kind,
        c.duplicate_address,
        c.duplicate_name,
        c.duplicate_kind,
        -- Canonical place stats
        (SELECT COUNT(*)::int FROM trapper.sot_requests WHERE place_id = c.canonical_place_id) AS canonical_requests,
        (SELECT COUNT(*)::int FROM trapper.cat_place_relationships WHERE place_id = c.canonical_place_id) AS canonical_cats,
        (SELECT COUNT(*)::int FROM trapper.places ch WHERE ch.parent_place_id = c.canonical_place_id AND ch.merged_into_place_id IS NULL) AS canonical_children,
        -- Duplicate place stats
        (SELECT COUNT(*)::int FROM trapper.sot_requests WHERE place_id = c.duplicate_place_id) AS duplicate_requests,
        (SELECT COUNT(*)::int FROM trapper.cat_place_relationships WHERE place_id = c.duplicate_place_id) AS duplicate_cats,
        (SELECT COUNT(*)::int FROM trapper.places ch WHERE ch.parent_place_id = c.duplicate_place_id AND ch.merged_into_place_id IS NULL) AS duplicate_children
      FROM trapper.place_dedup_candidates c
      WHERE c.status = 'pending'
      ${tierClause}
      ORDER BY c.match_tier, c.address_similarity DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const summary = await queryRows<PlaceDedupSummary>(
      `SELECT
        match_tier,
        CASE match_tier
          WHEN 1 THEN 'Close + Similar Address'
          WHEN 2 THEN 'Close + Different Address'
          WHEN 3 THEN 'Farther + Very Similar'
        END AS tier_label,
        COUNT(*)::int AS pair_count
      FROM trapper.place_dedup_candidates
      WHERE status = 'pending'
      GROUP BY match_tier
      ORDER BY match_tier`
    );

    return NextResponse.json({
      candidates,
      summary,
      pagination: { tier, limit, offset, hasMore: candidates.length === limit },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching place dedup candidates:", error);
    if (error instanceof Error && error.message.includes("does not exist")) {
      return NextResponse.json({
        candidates: [],
        summary: [],
        pagination: { tier, limit, offset, hasMore: false },
        note: "Migration MIG_803 needs to be applied",
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch place dedup candidates" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const { action, pairs } = body;

    if (!action || !["merge", "keep_separate", "dismiss"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'merge', 'keep_separate', or 'dismiss'" },
        { status: 400 }
      );
    }

    const pairList: { candidate_id: string; canonical_place_id: string; duplicate_place_id: string }[] =
      pairs || [{
        candidate_id: body.candidate_id,
        canonical_place_id: body.canonical_place_id,
        duplicate_place_id: body.duplicate_place_id,
      }];

    if (!pairList.length || !pairList[0].canonical_place_id || !pairList[0].duplicate_place_id) {
      return NextResponse.json(
        { error: "canonical_place_id and duplicate_place_id are required" },
        { status: 400 }
      );
    }

    const results: { canonical_place_id: string; duplicate_place_id: string; success: boolean; error?: string }[] = [];

    for (const pair of pairList) {
      try {
        if (action === "merge") {
          const safetyResult = await queryOne<{ place_safe_to_merge: string }>(
            `SELECT trapper.place_safe_to_merge($1, $2)`,
            [pair.canonical_place_id, pair.duplicate_place_id]
          );

          const safety = safetyResult?.place_safe_to_merge;
          if (safety !== "safe" && safety !== "review") {
            results.push({
              canonical_place_id: pair.canonical_place_id,
              duplicate_place_id: pair.duplicate_place_id,
              success: false,
              error: `Merge blocked: ${safety}`,
            });
            continue;
          }

          await queryOne(
            `SELECT trapper.merge_place_into($1, $2, $3, $4)`,
            [pair.duplicate_place_id, pair.canonical_place_id, "admin_place_dedup", "staff"]
          );

          // Update candidate status
          await queryOne(
            `UPDATE trapper.place_dedup_candidates
             SET status = 'merged', resolved_at = NOW(), resolved_by = 'staff'
             WHERE status = 'pending'
               AND canonical_place_id = $1 AND duplicate_place_id = $2`,
            [pair.canonical_place_id, pair.duplicate_place_id]
          );

          results.push({
            canonical_place_id: pair.canonical_place_id,
            duplicate_place_id: pair.duplicate_place_id,
            success: true,
          });
        } else {
          // keep_separate or dismiss
          await queryOne(
            `UPDATE trapper.place_dedup_candidates
             SET status = $3, resolved_at = NOW(), resolved_by = 'staff'
             WHERE status = 'pending'
               AND canonical_place_id = $1 AND duplicate_place_id = $2`,
            [pair.canonical_place_id, pair.duplicate_place_id, action]
          );

          results.push({
            canonical_place_id: pair.canonical_place_id,
            duplicate_place_id: pair.duplicate_place_id,
            success: true,
          });
        }
      } catch (err) {
        results.push({
          canonical_place_id: pair.canonical_place_id,
          duplicate_place_id: pair.duplicate_place_id,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      action,
      total: results.length,
      success: successCount,
      errors: errorCount,
      results,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error resolving place dedup:", error);
    return NextResponse.json(
      { error: "Failed to resolve place dedup" },
      { status: 500 }
    );
  }
}
