import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

interface RequestDedupCandidate {
  candidate_id: string;
  canonical_request_id: string;
  duplicate_request_id: string;
  match_tier: number;
  match_reasons: Record<string, unknown>;
  canonical_summary: string;
  duplicate_summary: string;
  canonical_place_address: string | null;
  duplicate_place_address: string | null;
  canonical_status: string;
  duplicate_status: string;
  canonical_source: string;
  duplicate_source: string;
  canonical_cat_count: number | null;
  duplicate_cat_count: number | null;
  canonical_created: string;
  duplicate_created: string;
  canonical_trip_reports: number;
  duplicate_trip_reports: number;
}

interface RequestDedupSummary {
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

    const candidates = await queryRows<RequestDedupCandidate>(
      `SELECT
        c.candidate_id,
        c.canonical_request_id,
        c.duplicate_request_id,
        c.match_tier,
        c.match_reasons,
        c.canonical_summary,
        c.duplicate_summary,
        c.canonical_place_address,
        c.duplicate_place_address,
        c.canonical_status,
        c.duplicate_status,
        c.canonical_source,
        c.duplicate_source,
        -- Enriched stats
        r1.estimated_cat_count AS canonical_cat_count,
        r2.estimated_cat_count AS duplicate_cat_count,
        COALESCE(r1.source_created_at, r1.created_at)::text AS canonical_created,
        COALESCE(r2.source_created_at, r2.created_at)::text AS duplicate_created,
        (SELECT COUNT(*)::int FROM ops.trapper_trip_reports WHERE request_id = c.canonical_request_id) AS canonical_trip_reports,
        (SELECT COUNT(*)::int FROM ops.trapper_trip_reports WHERE request_id = c.duplicate_request_id) AS duplicate_trip_reports
      FROM ops.request_dedup_candidates c
      JOIN ops.requests r1 ON r1.request_id = c.canonical_request_id
      JOIN ops.requests r2 ON r2.request_id = c.duplicate_request_id
      WHERE c.status = 'pending'
      ${tierClause}
      ORDER BY c.match_tier, c.created_at
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const summary = await queryRows<RequestDedupSummary>(
      `SELECT
        match_tier,
        CASE match_tier
          WHEN 1 THEN 'Same Place + Same Source'
          WHEN 2 THEN 'Same Place + Different Source'
          WHEN 3 THEN 'Place Family + Close Dates'
        END AS tier_label,
        COUNT(*)::int AS pair_count
      FROM ops.request_dedup_candidates
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
    console.error("Error fetching request dedup candidates:", error);
    if (error instanceof Error && error.message.includes("does not exist")) {
      return apiSuccess({
        candidates: [],
        summary: [],
        pagination: { tier, limit, offset, hasMore: false },
        note: "Migration MIG_2839 needs to be applied",
      });
    }
    return apiError("Failed to fetch request dedup candidates", 500);
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
      }>(`SELECT * FROM ops.refresh_request_dedup_candidates()`);
      return apiSuccess({ action: "refresh_candidates", ...result });
    }

    const pairList: { candidate_id: string; canonical_request_id: string; duplicate_request_id: string }[] =
      pairs || [{
        candidate_id: body.candidate_id,
        canonical_request_id: body.canonical_request_id,
        duplicate_request_id: body.duplicate_request_id,
      }];

    if (!pairList.length || !pairList[0].canonical_request_id || !pairList[0].duplicate_request_id) {
      return apiError("canonical_request_id and duplicate_request_id are required", 400);
    }

    const results: { canonical_request_id: string; duplicate_request_id: string; success: boolean; error?: string }[] = [];

    for (const pair of pairList) {
      try {
        if (action === "merge") {
          const safetyResult = await queryOne<{ request_safe_to_merge: string }>(
            `SELECT ops.request_safe_to_merge($1, $2)`,
            [pair.duplicate_request_id, pair.canonical_request_id]
          );

          const safety = safetyResult?.request_safe_to_merge;
          if (safety !== "safe" && safety !== "both_active") {
            results.push({
              canonical_request_id: pair.canonical_request_id,
              duplicate_request_id: pair.duplicate_request_id,
              success: false,
              error: `Merge blocked: ${safety}`,
            });
            continue;
          }

          await queryOne(
            `SELECT ops.merge_request_into($1, $2, $3, $4)`,
            [pair.duplicate_request_id, pair.canonical_request_id, "admin_request_dedup", "staff"]
          );

          // Update candidate status
          await queryOne(
            `UPDATE ops.request_dedup_candidates
             SET status = 'merged', resolved_at = NOW(), resolved_by = 'staff'
             WHERE status = 'pending'
               AND canonical_request_id = $1 AND duplicate_request_id = $2`,
            [pair.canonical_request_id, pair.duplicate_request_id]
          );

          results.push({
            canonical_request_id: pair.canonical_request_id,
            duplicate_request_id: pair.duplicate_request_id,
            success: true,
          });
        } else {
          // keep_separate or dismiss
          await queryOne(
            `UPDATE ops.request_dedup_candidates
             SET status = $3, resolved_at = NOW(), resolved_by = 'staff'
             WHERE status = 'pending'
               AND canonical_request_id = $1 AND duplicate_request_id = $2`,
            [pair.canonical_request_id, pair.duplicate_request_id, action]
          );

          results.push({
            canonical_request_id: pair.canonical_request_id,
            duplicate_request_id: pair.duplicate_request_id,
            success: true,
          });
        }
      } catch (err) {
        results.push({
          canonical_request_id: pair.canonical_request_id,
          duplicate_request_id: pair.duplicate_request_id,
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
    console.error("Error resolving request dedup:", error);
    return apiError("Failed to resolve request dedup", 500);
  }
}
