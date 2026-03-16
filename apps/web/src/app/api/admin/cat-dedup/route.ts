import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

interface CatDedupCandidate {
  cat_id_1: string;
  cat_id_2: string;
  name_1: string | null;
  name_2: string | null;
  chip_1: string | null;
  chip_2: string | null;
  chq_1: string | null;
  chq_2: string | null;
  sex_1: string | null;
  sex_2: string | null;
  color_1: string | null;
  color_2: string | null;
  owner_1: string | null;
  owner_2: string | null;
  confidence: number;
  match_reason: string;
  recommended_action: string;
  place_1: string | null;
  place_2: string | null;
  appointments_1: number;
  appointments_2: number;
}

interface CatDedupSummary {
  recommended_action: string;
  pair_count: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "";
  const { limit, offset } = parsePagination(searchParams);

  try {
    await requireRole(request, ["admin"]);

    const actionClause = action ? "AND recommended_action = $1" : "";
    const params: (string | number)[] = action ? [action] : [];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(limit, offset);

    const candidates = await queryRows<CatDedupCandidate>(
      `SELECT
        v.cat_id_1::text,
        v.cat_id_2::text,
        v.name_1,
        v.name_2,
        v.chip_1,
        v.chip_2,
        v.chq_1,
        v.chq_2,
        v.sex_1,
        v.sex_2,
        v.color_1,
        v.color_2,
        v.owner_1,
        v.owner_2,
        v.confidence::numeric,
        v.match_reason,
        v.recommended_action,
        -- Place for cat 1
        (SELECT pl.formatted_address FROM sot.cat_place cp
         JOIN sot.places pl ON pl.place_id = cp.place_id
         WHERE cp.cat_id = v.cat_id_1 AND pl.merged_into_place_id IS NULL
         ORDER BY cp.created_at DESC LIMIT 1) AS place_1,
        -- Place for cat 2
        (SELECT pl.formatted_address FROM sot.cat_place cp
         JOIN sot.places pl ON pl.place_id = cp.place_id
         WHERE cp.cat_id = v.cat_id_2 AND pl.merged_into_place_id IS NULL
         ORDER BY cp.created_at DESC LIMIT 1) AS place_2,
        -- Appointment counts
        (SELECT COUNT(*)::int FROM ops.appointments WHERE cat_id = v.cat_id_1) AS appointments_1,
        (SELECT COUNT(*)::int FROM ops.appointments WHERE cat_id = v.cat_id_2) AS appointments_2
      FROM ops.v_cat_dedup_candidates v
      WHERE 1=1
      ${actionClause}
      ORDER BY v.confidence DESC, v.match_reason
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const summary = await queryRows<CatDedupSummary>(
      `SELECT
        recommended_action,
        COUNT(*)::int AS pair_count
      FROM ops.v_cat_dedup_candidates
      GROUP BY recommended_action
      ORDER BY
        CASE recommended_action
          WHEN 'auto_merge' THEN 1
          WHEN 'review_high' THEN 2
          WHEN 'review_medium' THEN 3
          WHEN 'review_low' THEN 4
          ELSE 5
        END`
    );

    return apiSuccess({
      candidates,
      summary,
      pagination: { action, limit, offset, hasMore: candidates.length === limit },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError(error.message, error.statusCode);
    }
    console.error("Error fetching cat dedup candidates:", error);
    if (error instanceof Error && error.message.includes("does not exist")) {
      return apiSuccess({
        candidates: [],
        summary: [],
        pagination: { action, limit, offset, hasMore: false },
        note: "Migration MIG_2835 needs to be applied",
      });
    }
    return apiError("Failed to fetch cat dedup candidates", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const { action, pairs } = body;

    if (!action || !["merge", "keep_separate", "scan"].includes(action)) {
      return apiError("action must be 'merge', 'keep_separate', or 'scan'", 400);
    }

    if (action === "scan") {
      const result = await queryOne<{
        same_owner_count: number;
        chip_typo_count: number;
        duplicate_id_count: number;
        phonetic_count: number;
      }>(`SELECT * FROM ops.run_cat_dedup_scan()`);
      return apiSuccess({ action: "scan", ...result });
    }

    const pairList: { cat_id_1: string; cat_id_2: string }[] =
      pairs || [{
        cat_id_1: body.cat_id_1,
        cat_id_2: body.cat_id_2,
      }];

    if (!pairList.length || !pairList[0].cat_id_1 || !pairList[0].cat_id_2) {
      return apiError("cat_id_1 and cat_id_2 are required", 400);
    }

    const results: { cat_id_1: string; cat_id_2: string; success: boolean; error?: string }[] = [];

    for (const pair of pairList) {
      try {
        if (action === "merge") {
          // Winner = cat with more appointments, or the one with a microchip
          const catInfo = await queryOne<{
            winner_id: string;
            loser_id: string;
          }>(
            `SELECT
              CASE
                WHEN (SELECT COUNT(*) FROM ops.appointments WHERE cat_id = $1)
                   + CASE WHEN (SELECT microchip FROM sot.cats WHERE cat_id = $1) IS NOT NULL THEN 100 ELSE 0 END
                   >= (SELECT COUNT(*) FROM ops.appointments WHERE cat_id = $2)
                    + CASE WHEN (SELECT microchip FROM sot.cats WHERE cat_id = $2) IS NOT NULL THEN 100 ELSE 0 END
                THEN $1::text ELSE $2::text
              END AS winner_id,
              CASE
                WHEN (SELECT COUNT(*) FROM ops.appointments WHERE cat_id = $1)
                   + CASE WHEN (SELECT microchip FROM sot.cats WHERE cat_id = $1) IS NOT NULL THEN 100 ELSE 0 END
                   >= (SELECT COUNT(*) FROM ops.appointments WHERE cat_id = $2)
                    + CASE WHEN (SELECT microchip FROM sot.cats WHERE cat_id = $2) IS NOT NULL THEN 100 ELSE 0 END
                THEN $2::text ELSE $1::text
              END AS loser_id`,
            [pair.cat_id_1, pair.cat_id_2]
          );

          if (!catInfo) {
            results.push({
              cat_id_1: pair.cat_id_1,
              cat_id_2: pair.cat_id_2,
              success: false,
              error: "Could not determine winner/loser",
            });
            continue;
          }

          // Safety check
          const safetyResult = await queryOne<{ cat_safe_to_merge: string }>(
            `SELECT sot.cat_safe_to_merge($1, $2)`,
            [catInfo.loser_id, catInfo.winner_id]
          );

          const safety = safetyResult?.cat_safe_to_merge;
          if (safety !== "safe") {
            results.push({
              cat_id_1: pair.cat_id_1,
              cat_id_2: pair.cat_id_2,
              success: false,
              error: `Merge blocked: ${safety}`,
            });
            continue;
          }

          // Merge
          await queryOne(
            `SELECT sot.merge_cats($1, $2, $3, $4)`,
            [catInfo.loser_id, catInfo.winner_id, "admin_cat_dedup", "staff"]
          );

          results.push({
            cat_id_1: pair.cat_id_1,
            cat_id_2: pair.cat_id_2,
            success: true,
          });
        } else {
          // keep_separate — log to entity_edits so the pair won't reappear
          await queryOne(
            `INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source)
             VALUES (
               'cat',
               $1::uuid,
               'dedup_keep_separate',
               jsonb_build_object('cat_id_1', $1, 'cat_id_2', $2),
               NULL,
               'staff',
               'web_ui'
             )`,
            [pair.cat_id_1, pair.cat_id_2]
          );

          results.push({
            cat_id_1: pair.cat_id_1,
            cat_id_2: pair.cat_id_2,
            success: true,
          });
        }
      } catch (err) {
        results.push({
          cat_id_1: pair.cat_id_1,
          cat_id_2: pair.cat_id_2,
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
    console.error("Error resolving cat dedup:", error);
    return apiError("Failed to resolve cat dedup", 500);
  }
}
