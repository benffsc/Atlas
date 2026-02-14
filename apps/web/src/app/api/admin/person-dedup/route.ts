import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface DedupCandidate {
  canonical_person_id: string;
  duplicate_person_id: string;
  match_tier: number;
  shared_email: string | null;
  shared_phone: string | null;
  canonical_name: string;
  duplicate_name: string;
  name_similarity: number;
  canonical_created_at: string;
  duplicate_created_at: string;
  canonical_identifiers: number;
  canonical_places: number;
  canonical_cats: number;
  canonical_requests: number;
  duplicate_identifiers: number;
  duplicate_places: number;
  duplicate_cats: number;
  duplicate_requests: number;
  shared_place_count: number;
}

interface DedupSummary {
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

    // Build tier filter clause
    const tierClause = tier > 0 ? "AND c.match_tier = $1" : "";
    const params: (number | string)[] = tier > 0 ? [tier] : [];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(limit, offset);

    // Get paginated candidates with enriched stats
    const candidates = await queryRows<DedupCandidate>(
      `SELECT
        c.canonical_person_id,
        c.duplicate_person_id,
        c.match_tier,
        c.shared_email,
        c.shared_phone,
        c.canonical_name,
        c.duplicate_name,
        c.name_similarity,
        c.canonical_created_at,
        c.duplicate_created_at,
        -- Canonical person stats
        (SELECT COUNT(*)::int FROM sot.person_identifiers WHERE person_id = c.canonical_person_id) AS canonical_identifiers,
        (SELECT COUNT(*)::int FROM sot.person_place_relationships WHERE person_id = c.canonical_person_id) AS canonical_places,
        (SELECT COUNT(*)::int FROM sot.person_cat_relationships WHERE person_id = c.canonical_person_id) AS canonical_cats,
        (SELECT COUNT(*)::int FROM ops.requests WHERE requester_person_id = c.canonical_person_id) AS canonical_requests,
        -- Duplicate person stats
        (SELECT COUNT(*)::int FROM sot.person_identifiers WHERE person_id = c.duplicate_person_id) AS duplicate_identifiers,
        (SELECT COUNT(*)::int FROM sot.person_place_relationships WHERE person_id = c.duplicate_person_id) AS duplicate_places,
        (SELECT COUNT(*)::int FROM sot.person_cat_relationships WHERE person_id = c.duplicate_person_id) AS duplicate_cats,
        (SELECT COUNT(*)::int FROM ops.requests WHERE requester_person_id = c.duplicate_person_id) AS duplicate_requests,
        -- Shared context
        (SELECT COUNT(*)::int FROM sot.person_place_relationships r1
         JOIN sot.person_place_relationships r2 ON r1.place_id = r2.place_id
         WHERE r1.person_id = c.canonical_person_id AND r2.person_id = c.duplicate_person_id) AS shared_place_count
      FROM sot.v_person_dedup_candidates c
      WHERE NOT EXISTS (
        SELECT 1 FROM sot.person_dedup_candidates ppd
        WHERE ppd.status IN ('kept_separate', 'dismissed')
          AND (
            (ppd.person_id = c.duplicate_person_id AND ppd.potential_match_id = c.canonical_person_id)
            OR (ppd.person_id = c.canonical_person_id AND ppd.potential_match_id = c.duplicate_person_id)
          )
      )
      ${tierClause}
      ORDER BY c.match_tier, c.name_similarity DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    // Get summary counts by tier
    const summary = await queryRows<DedupSummary>(
      `SELECT * FROM sot.v_person_dedup_summary`
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
    console.error("Error fetching person dedup candidates:", error);
    if (error instanceof Error && error.message.includes("does not exist")) {
      return NextResponse.json({
        candidates: [],
        summary: [],
        pagination: { tier, limit, offset, hasMore: false },
        note: "Migration MIG_801 needs to be applied",
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch person dedup candidates" },
      { status: 500 }
    );
  }
}

// Resolve one or more dedup candidates
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

    // Support single pair or batch
    const pairList: { canonical_person_id: string; duplicate_person_id: string }[] =
      pairs || [{ canonical_person_id: body.canonical_person_id, duplicate_person_id: body.duplicate_person_id }];

    if (!pairList.length || !pairList[0].canonical_person_id || !pairList[0].duplicate_person_id) {
      return NextResponse.json(
        { error: "canonical_person_id and duplicate_person_id are required" },
        { status: 400 }
      );
    }

    const results: { canonical_person_id: string; duplicate_person_id: string; success: boolean; error?: string }[] = [];

    for (const pair of pairList) {
      try {
        if (action === "merge") {
          // Safety check
          const safetyResult = await queryOne<{ person_safe_to_merge: string }>(
            `SELECT sot.person_safe_to_merge($1, $2)`,
            [pair.canonical_person_id, pair.duplicate_person_id]
          );

          const safety = safetyResult?.person_safe_to_merge;
          if (safety !== "safe" && safety !== "review") {
            results.push({
              ...pair,
              success: false,
              error: `Merge blocked: ${safety}`,
            });
            continue;
          }

          // Execute merge
          await queryOne<{ merge_people: object }>(
            `SELECT sot.merge_people($1, $2, $3, $4)`,
            [pair.duplicate_person_id, pair.canonical_person_id, "admin_person_dedup", "staff"]
          );

          // Update potential_person_duplicates if entry exists
          await queryOne(
            `UPDATE sot.person_dedup_candidates
             SET status = 'merged', resolved_at = NOW(), resolved_by = 'staff'
             WHERE status = 'pending'
               AND (
                 (person_id = $1 AND potential_match_id = $2)
                 OR (person_id = $2 AND potential_match_id = $1)
               )`,
            [pair.duplicate_person_id, pair.canonical_person_id]
          );

          results.push({ ...pair, success: true });
        } else {
          // keep_separate or dismiss — record in potential_person_duplicates
          await queryOne(
            `INSERT INTO sot.person_dedup_candidates (
               person_id, potential_match_id, match_type, matched_identifier,
               new_name, existing_name, name_similarity,
               status, resolved_at, resolved_by
             )
             SELECT
               $1, $2, 'admin_dedup_review', '',
               p1.display_name, p2.display_name,
               sot.name_similarity(p1.display_name, p2.display_name),
               $3, NOW(), 'staff'
             FROM sot.people p1, sot.people p2
             WHERE p1.person_id = $1 AND p2.person_id = $2
             ON CONFLICT (person_id, potential_match_id) DO UPDATE SET
               status = $3,
               resolved_at = NOW(),
               resolved_by = 'staff'`,
            [pair.duplicate_person_id, pair.canonical_person_id, action]
          );

          results.push({ ...pair, success: true });
        }
      } catch (err) {
        results.push({
          ...pair,
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
    console.error("Error resolving person dedup:", error);
    return NextResponse.json(
      { error: "Failed to resolve person dedup" },
      { status: 500 }
    );
  }
}
