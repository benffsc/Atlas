import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

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

    // Get recent merges
    const recentMerges = await queryRows<{
      candidate_id: string;
      resolved_at: string;
      resolved_by: string;
      resolution_notes: string;
    }>(`
      SELECT
        candidate_id::text,
        resolved_at::text,
        resolved_by,
        resolution_notes
      FROM sot.cat_dedup_candidates
      WHERE resolution = 'merged'
      ORDER BY resolved_at DESC
      LIMIT 5
    `);

    // Get duplicate cause breakdown
    const causeBreakdown = await queryRows<{
      likely_cause: string;
      count: number;
    }>(`
      SELECT
        likely_cause,
        COUNT(*) as count
      FROM sot.cat_dedup_candidates
      WHERE resolution = 'pending'
      GROUP BY likely_cause
      ORDER BY count DESC
    `);

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

    return NextResponse.json({
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
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
