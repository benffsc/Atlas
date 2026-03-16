import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Cat Deduplication Health Check Endpoint
 *
 * Returns health metrics for the cat deduplication system:
 * - Pending duplicate reviews
 * - Exact microchip duplicates (should be 0)
 * - Recent merges
 * - High confidence candidates needing review
 */

interface CatDedupHealth {
  pending_review: number;
  high_confidence_pending: number;
  merged_count: number;
  not_duplicate_count: number;
  exact_microchip_duplicates: number;
  cats_without_microchip: number;
  total_active_cats: number;
}

interface PendingDuplicate {
  candidate_id: string;
  cat1_name: string;
  cat2_name: string;
  cat1_microchip: string;
  cat2_microchip: string;
  duplicate_confidence: number;
  likely_cause: string;
  flagged_at: string;
  recommendation: string;
}

export async function GET() {
  const startTime = Date.now();

  try {
    // Get health metrics from the view
    const health = await queryOne<CatDedupHealth>(`
      SELECT * FROM sot.v_cat_dedup_health
    `);

    // Get pending duplicates for review (top 10 by confidence)
    const pendingDuplicates = await queryRows<PendingDuplicate>(`
      SELECT
        candidate_id::text,
        cat1_name,
        cat2_name,
        cat1_microchip,
        cat2_microchip,
        duplicate_confidence::numeric,
        likely_cause,
        flagged_at::text,
        recommendation
      FROM sot.v_cat_duplicate_review
      ORDER BY duplicate_confidence DESC
      LIMIT 10
    `);

    // Get recent merges from ops.cat_dedup_candidates (MIG_2835)
    // Note: ops.cat_dedup_candidates has no resolved_at/resolved_by columns;
    // it stores recommended_action and match_reason. Use created_at as proxy.
    const recentMerges = await queryRows<{
      id: string;
      match_reason: string;
      recommended_action: string;
      created_at: string;
    }>(`
      SELECT
        id::text,
        match_reason,
        recommended_action,
        created_at::text
      FROM ops.cat_dedup_candidates
      WHERE recommended_action = 'auto_merge'
      ORDER BY created_at DESC
      LIMIT 5
    `).catch(() => []);

    // Get duplicate cause breakdown
    const causeBreakdown = await queryRows<{
      likely_cause: string;
      count: number;
    }>(`
      SELECT
        match_reason AS likely_cause,
        COUNT(*) as count
      FROM ops.cat_dedup_candidates
      GROUP BY match_reason
      ORDER BY count DESC
    `).catch(() => []);

    // Determine overall status
    const exactDuplicates = health?.exact_microchip_duplicates || 0;
    const pendingReview = health?.pending_review || 0;
    const highConfidence = health?.high_confidence_pending || 0;

    let status: "healthy" | "degraded" | "unhealthy";
    if (exactDuplicates > 0) {
      // Exact duplicates should never exist
      status = "unhealthy";
    } else if (highConfidence > 10 || pendingReview > 50) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return apiSuccess({
      status,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,

      summary: {
        pending_review: pendingReview,
        high_confidence_pending: highConfidence,
        merged_total: health?.merged_count || 0,
        not_duplicate_total: health?.not_duplicate_count || 0,
        exact_microchip_duplicates: exactDuplicates,
        cats_without_microchip: health?.cats_without_microchip || 0,
        total_active_cats: health?.total_active_cats || 0,
      },

      cause_breakdown: causeBreakdown,

      pending_duplicates: pendingDuplicates,

      recent_merges: recentMerges,

      alerts: [
        ...(exactDuplicates > 0
          ? [
              {
                severity: "critical",
                message: `${exactDuplicates} exact microchip duplicate(s) found. This should never happen.`,
              },
            ]
          : []),
        ...(highConfidence > 10
          ? [
              {
                severity: "warning",
                message: `${highConfidence} high-confidence duplicates need review.`,
              },
            ]
          : []),
      ],
    });
  } catch (error) {
    console.error("Cat dedup health check error:", error);
    return apiServerError(error instanceof Error ? error.message : "Unknown error");
  }
}
