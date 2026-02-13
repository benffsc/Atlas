import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Data Engine Statistics API
 *
 * GET: Comprehensive statistics for the Data Engine
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const days = Math.min(parseInt(searchParams.get("days") || "30"), 365);

  try {
    // Overall stats
    const overallStats = await queryOne<{
      total_decisions: number;
      total_auto_matches: number;
      total_new_entities: number;
      total_reviews: number;
      total_households: number;
      total_household_members: number;
      avg_processing_ms: number;
      avg_confidence_score: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions) as total_decisions,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'auto_match') as total_auto_matches,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'new_entity') as total_new_entities,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE review_status = 'pending') as total_reviews,
        (SELECT COUNT(*) FROM trapper.households) as total_households,
        (SELECT COUNT(*) FROM trapper.household_members WHERE valid_to IS NULL) as total_household_members,
        (SELECT ROUND(AVG(processing_duration_ms)::numeric, 2) FROM sot.data_engine_match_decisions WHERE processing_duration_ms IS NOT NULL) as avg_processing_ms,
        (SELECT ROUND(AVG(top_candidate_score)::numeric, 3) FROM sot.data_engine_match_decisions WHERE top_candidate_score IS NOT NULL) as avg_confidence_score
    `);

    // Decisions by day (last N days)
    const decisionsByDay = await queryRows<{
      date: string;
      total: number;
      auto_match: number;
      new_entity: number;
      review_pending: number;
      rejected: number;
    }>(`
      SELECT
        DATE(processed_at) as date,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE decision_type = 'auto_match')::int as auto_match,
        COUNT(*) FILTER (WHERE decision_type = 'new_entity')::int as new_entity,
        COUNT(*) FILTER (WHERE decision_type = 'review_pending')::int as review_pending,
        COUNT(*) FILTER (WHERE decision_type = 'rejected')::int as rejected
      FROM sot.data_engine_match_decisions
      WHERE processed_at > NOW() - ($1 || ' days')::interval
      GROUP BY DATE(processed_at)
      ORDER BY date DESC
    `, [days]);

    // Decisions by source system
    const decisionsBySource = await queryRows<{
      source_system: string;
      total: number;
      auto_match_pct: number;
      new_entity_pct: number;
      avg_confidence: number;
    }>(`
      SELECT
        source_system,
        COUNT(*)::int as total,
        ROUND(100.0 * COUNT(*) FILTER (WHERE decision_type = 'auto_match') / NULLIF(COUNT(*), 0), 1) as auto_match_pct,
        ROUND(100.0 * COUNT(*) FILTER (WHERE decision_type = 'new_entity') / NULLIF(COUNT(*), 0), 1) as new_entity_pct,
        ROUND(AVG(top_candidate_score)::numeric, 3) as avg_confidence
      FROM sot.data_engine_match_decisions
      GROUP BY source_system
      ORDER BY total DESC
    `);

    // Matching rule effectiveness
    const ruleEffectiveness = await queryRows<{
      rule_name: string;
      is_active: boolean;
      total_matches: number;
      avg_score: number;
    }>(`
      WITH rule_usage AS (
        SELECT
          jsonb_array_elements_text(rules_applied)::text as rule_name,
          top_candidate_score
        FROM sot.data_engine_match_decisions
        WHERE rules_applied IS NOT NULL
          AND rules_applied != 'null'::jsonb
      )
      SELECT
        r.rule_name,
        r.is_active,
        COUNT(ru.rule_name)::int as total_matches,
        COALESCE(ROUND(AVG(ru.top_candidate_score)::numeric, 3), 0) as avg_score
      FROM sot.data_engine_matching_rules r
      LEFT JOIN rule_usage ru ON ru.rule_name = r.rule_name
      GROUP BY r.rule_id, r.rule_name, r.is_active
      ORDER BY total_matches DESC
    `);

    // Review queue stats
    const reviewStats = await queryOne<{
      pending: number;
      approved: number;
      merged: number;
      rejected: number;
      avg_time_to_review_hours: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE review_status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE review_status = 'approved')::int as approved,
        COUNT(*) FILTER (WHERE review_status = 'merged')::int as merged,
        COUNT(*) FILTER (WHERE review_status = 'rejected')::int as rejected,
        ROUND(
          EXTRACT(EPOCH FROM AVG(reviewed_at - processed_at) FILTER (WHERE reviewed_at IS NOT NULL)) / 3600.0,
          1
        ) as avg_time_to_review_hours
      FROM sot.data_engine_match_decisions
      WHERE decision_type = 'review_pending' OR review_status != 'not_required'
    `);

    return NextResponse.json({
      period_days: days,
      generated_at: new Date().toISOString(),

      overall: overallStats,

      by_day: decisionsByDay,

      by_source: decisionsBySource,

      rule_effectiveness: ruleEffectiveness,

      review_queue: reviewStats,
    });
  } catch (error) {
    console.error("Error fetching Data Engine stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
