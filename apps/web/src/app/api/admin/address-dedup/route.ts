import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

interface AddressDedupCandidate {
  candidate_id: string;
  canonical_address_id: string;
  duplicate_address_id: string;
  match_tier: number;
  address_similarity: number;
  distance_meters: number | null;
  canonical_formatted: string;
  duplicate_formatted: string;
  canonical_city: string | null;
  duplicate_city: string | null;
  canonical_place_count: number;
  duplicate_place_count: number;
  canonical_people_count: number;
  duplicate_people_count: number;
  canonical_geocoding_status: string | null;
  duplicate_geocoding_status: string | null;
}

interface AddressDedupSummary {
  match_tier: number;
  tier_label: string;
  pair_count: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tier = parseInt(searchParams.get("tier") || "0", 10);
  const { limit, offset } = parsePagination(searchParams);

  try {
    await requireRole(request, ["admin"]);

    const tierClause = tier > 0 ? "AND c.match_tier = $1" : "";
    const params: (number | string)[] = tier > 0 ? [tier] : [];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(limit, offset);

    const candidates = await queryRows<AddressDedupCandidate>(
      `SELECT
        c.candidate_id,
        c.canonical_address_id,
        c.duplicate_address_id,
        c.match_tier,
        c.address_similarity,
        c.distance_meters,
        c.canonical_formatted,
        c.duplicate_formatted,
        c.canonical_city,
        c.duplicate_city,
        -- Canonical stats
        (SELECT COUNT(*)::int FROM sot.places WHERE sot_address_id = c.canonical_address_id AND merged_into_place_id IS NULL) AS canonical_place_count,
        (SELECT COUNT(*)::int FROM sot.people WHERE primary_address_id = c.canonical_address_id AND merged_into_person_id IS NULL) AS canonical_people_count,
        (SELECT geocoding_status FROM sot.addresses WHERE address_id = c.canonical_address_id) AS canonical_geocoding_status,
        -- Duplicate stats
        (SELECT COUNT(*)::int FROM sot.places WHERE sot_address_id = c.duplicate_address_id AND merged_into_place_id IS NULL) AS duplicate_place_count,
        (SELECT COUNT(*)::int FROM sot.people WHERE primary_address_id = c.duplicate_address_id AND merged_into_person_id IS NULL) AS duplicate_people_count,
        (SELECT geocoding_status FROM sot.addresses WHERE address_id = c.duplicate_address_id) AS duplicate_geocoding_status
      FROM ops.address_dedup_candidates c
      WHERE c.status = 'pending'
      ${tierClause}
      ORDER BY c.match_tier, c.address_similarity DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const summary = await queryRows<AddressDedupSummary>(
      `SELECT
        match_tier,
        CASE match_tier
          WHEN 1 THEN 'Exact Key Match'
          WHEN 2 THEN 'High Similarity + Same City'
          WHEN 3 THEN 'Close Proximity'
        END AS tier_label,
        COUNT(*)::int AS pair_count
      FROM ops.address_dedup_candidates
      WHERE status = 'pending'
      GROUP BY match_tier
      ORDER BY match_tier`
    );

    return apiSuccess({
      candidates,
      summary,
      pagination: { tier, limit, offset, hasMore: candidates.length === limit },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError(error.message, error.statusCode);
    }
    console.error("Error fetching address dedup candidates:", error);
    if (error instanceof Error && error.message.includes("does not exist")) {
      return apiSuccess({
        candidates: [],
        summary: [],
        pagination: { tier, limit, offset, hasMore: false },
        note: "Migration MIG_2838 needs to be applied",
      });
    }
    return apiError("Failed to fetch address dedup candidates", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const { action, pairs } = body;

    if (!action || !["merge", "keep_separate", "dismiss", "refresh_candidates"].includes(action)) {
      return apiError("action must be 'merge', 'keep_separate', 'dismiss', or 'refresh_candidates'", 400);
    }

    if (action === "refresh_candidates") {
      const result = await queryOne<{
        tier1_count: number;
        tier2_count: number;
        tier3_count: number;
        total: number;
      }>(`SELECT * FROM ops.refresh_address_dedup_candidates()`);
      return apiSuccess({ action: "refresh_candidates", ...result });
    }

    const pairList: { candidate_id: string; canonical_address_id: string; duplicate_address_id: string }[] =
      pairs || [{
        candidate_id: body.candidate_id,
        canonical_address_id: body.canonical_address_id,
        duplicate_address_id: body.duplicate_address_id,
      }];

    if (!pairList.length || !pairList[0].canonical_address_id || !pairList[0].duplicate_address_id) {
      return apiError("canonical_address_id and duplicate_address_id are required", 400);
    }

    const results: { canonical_address_id: string; duplicate_address_id: string; success: boolean; error?: string }[] = [];

    for (const pair of pairList) {
      try {
        if (action === "merge") {
          const safetyResult = await queryOne<{ address_safe_to_merge: string }>(
            `SELECT sot.address_safe_to_merge($1, $2)`,
            [pair.duplicate_address_id, pair.canonical_address_id]
          );

          const safety = safetyResult?.address_safe_to_merge;
          if (safety !== "safe") {
            results.push({
              canonical_address_id: pair.canonical_address_id,
              duplicate_address_id: pair.duplicate_address_id,
              success: false,
              error: `Merge blocked: ${safety}`,
            });
            continue;
          }

          await queryOne(
            `SELECT sot.merge_address_into($1, $2, $3, $4)`,
            [pair.duplicate_address_id, pair.canonical_address_id, "admin_address_dedup", "staff"]
          );

          // Update candidate status
          await queryOne(
            `UPDATE ops.address_dedup_candidates
             SET status = 'merged', resolved_at = NOW(), resolved_by = 'staff'
             WHERE status = 'pending'
               AND canonical_address_id = $1 AND duplicate_address_id = $2`,
            [pair.canonical_address_id, pair.duplicate_address_id]
          );

          results.push({
            canonical_address_id: pair.canonical_address_id,
            duplicate_address_id: pair.duplicate_address_id,
            success: true,
          });
        } else {
          // keep_separate or dismiss
          await queryOne(
            `UPDATE ops.address_dedup_candidates
             SET status = $3, resolved_at = NOW(), resolved_by = 'staff'
             WHERE status = 'pending'
               AND canonical_address_id = $1 AND duplicate_address_id = $2`,
            [pair.canonical_address_id, pair.duplicate_address_id, action]
          );

          results.push({
            canonical_address_id: pair.canonical_address_id,
            duplicate_address_id: pair.duplicate_address_id,
            success: true,
          });
        }
      } catch (err) {
        results.push({
          canonical_address_id: pair.canonical_address_id,
          duplicate_address_id: pair.duplicate_address_id,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;

    return apiSuccess({
      action,
      total: results.length,
      success: successCount,
      errors: errorCount,
      results,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError(error.message, error.statusCode);
    }
    console.error("Error resolving address dedup:", error);
    return apiError("Failed to resolve address dedup", 500);
  }
}
