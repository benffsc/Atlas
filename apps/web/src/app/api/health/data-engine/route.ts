import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Data Engine Health Check Endpoint
 *
 * Returns detailed status of the Data Engine including:
 * - Identity resolution statistics
 * - Pending reviews count
 * - Household statistics
 * - Processing performance metrics
 */

interface DataEngineHealth {
  decisions_24h: number;
  auto_matches_24h: number;
  new_entities_24h: number;
  pending_reviews: number;
  queued_jobs: number;
  processing_jobs: number;
  failed_jobs: number;
  total_households: number;
  active_household_members: number;
  soft_blacklisted_identifiers: number;
  avg_processing_ms: number;
}

interface RecentDecision {
  decision_id: string;
  decision_type: string;
  source_system: string;
  incoming_name: string;
  confidence_score: number;
  processed_at: string;
}

interface MatchingRule {
  rule_name: string;
  rule_category: string;
  primary_signal: string;
  base_confidence: number;
  is_active: boolean;
  matches_24h: number;
}

export async function GET() {
  const startTime = Date.now();

  try {
    // Get Data Engine health metrics
    const health = await queryOne<DataEngineHealth>(`
      SELECT * FROM ops.v_data_engine_health
    `);

    // Get recent decisions (last 10)
    const recentDecisions = await queryRows<RecentDecision>(`
      SELECT
        decision_id::text,
        decision_type,
        source_system,
        incoming_name,
        COALESCE(top_candidate_score, 0)::numeric as confidence_score,
        processed_at::text
      FROM sot.data_engine_match_decisions
      ORDER BY processed_at DESC
      LIMIT 10
    `);

    // Get matching rule performance
    const ruleStats = await queryRows<MatchingRule>(`
      SELECT
        r.rule_name,
        r.rule_category,
        r.primary_signal,
        r.base_confidence::numeric,
        r.is_active,
        COUNT(d.decision_id) FILTER (WHERE d.processed_at > NOW() - INTERVAL '24 hours') as matches_24h
      FROM sot.data_engine_matching_rules r
      LEFT JOIN sot.data_engine_match_decisions d
        ON d.rules_applied::jsonb ? r.rule_name
      GROUP BY r.rule_id, r.rule_name, r.rule_category, r.primary_signal, r.base_confidence, r.is_active
      ORDER BY r.priority DESC
    `);

    // Calculate decision type breakdown
    const decisionBreakdown = await queryOne<{
      auto_match_pct: number;
      new_entity_pct: number;
      review_pending_pct: number;
      rejected_pct: number;
      household_member_pct: number;
    }>(`
      WITH totals AS (
        SELECT COUNT(*) as total FROM sot.data_engine_match_decisions
        WHERE processed_at > NOW() - INTERVAL '24 hours'
      ),
      by_type AS (
        SELECT
          decision_type,
          COUNT(*) as cnt
        FROM sot.data_engine_match_decisions
        WHERE processed_at > NOW() - INTERVAL '24 hours'
        GROUP BY decision_type
      )
      SELECT
        COALESCE(ROUND(100.0 * SUM(CASE WHEN decision_type = 'auto_match' THEN cnt END) / NULLIF(MAX(total), 0), 1), 0) as auto_match_pct,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN decision_type = 'new_entity' THEN cnt END) / NULLIF(MAX(total), 0), 1), 0) as new_entity_pct,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN decision_type = 'review_pending' THEN cnt END) / NULLIF(MAX(total), 0), 1), 0) as review_pending_pct,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN decision_type = 'rejected' THEN cnt END) / NULLIF(MAX(total), 0), 1), 0) as rejected_pct,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN decision_type = 'household_member' THEN cnt END) / NULLIF(MAX(total), 0), 1), 0) as household_member_pct
      FROM by_type, totals
    `);

    // Determine overall health
    const pendingReviews = health?.pending_reviews || 0;
    const failedJobs = health?.failed_jobs || 0;

    let status: "healthy" | "degraded" | "unhealthy";
    if (failedJobs > 5 || pendingReviews > 100) {
      status = "unhealthy";
    } else if (failedJobs > 0 || pendingReviews > 20) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,

      summary: {
        decisions_24h: health?.decisions_24h || 0,
        auto_matches_24h: health?.auto_matches_24h || 0,
        new_entities_24h: health?.new_entities_24h || 0,
        pending_reviews: pendingReviews,
        avg_processing_ms: health?.avg_processing_ms || 0,
      },

      decision_breakdown: decisionBreakdown || {
        auto_match_pct: 0,
        new_entity_pct: 0,
        review_pending_pct: 0,
        rejected_pct: 0,
        household_member_pct: 0,
      },

      households: {
        total: health?.total_households || 0,
        active_members: health?.active_household_members || 0,
      },

      queue: {
        queued: health?.queued_jobs || 0,
        processing: health?.processing_jobs || 0,
        failed: health?.failed_jobs || 0,
      },

      soft_blacklist: {
        count: health?.soft_blacklisted_identifiers || 0,
      },

      matching_rules: ruleStats,

      recent_decisions: recentDecisions,
    });
  } catch (error) {
    console.error("Data Engine health check error:", error);
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
