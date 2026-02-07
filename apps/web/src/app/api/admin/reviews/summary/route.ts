import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Unified Review Dashboard Summary API
 *
 * Returns counts for all review queues to power the dashboard
 */

interface QueueSummary {
  identity: {
    total: number;
    tier1_email: number;
    tier2_phone_name: number;
    tier3_phone_only: number;
    tier4_name_address: number;
    tier5_name_only: number;
    data_engine_pending: number;
  };
  places: {
    total: number;
    close_similar: number;
    close_different: number;
  };
  quality: {
    total: number;
  };
  ai_parsed: {
    total: number;
    colony_estimates: number;
    reproduction: number;
    mortality: number;
  };
  priority_items: Array<{
    id: string;
    type: string;
    title: string;
    subtitle: string;
    priority: "high" | "medium" | "low";
    age_hours: number;
    href: string;
  }>;
}

export async function GET() {
  try {
    // Get identity review counts from multiple sources
    const personDedupStats = await queryOne<{
      total: number;
      tier1: number;
      tier2: number;
      tier3: number;
      tier4: number;
      tier5: number;
    }>(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE match_tier = 1)::int as tier1,
        COUNT(*) FILTER (WHERE match_tier = 2)::int as tier2,
        COUNT(*) FILTER (WHERE match_tier = 3)::int as tier3,
        COUNT(*) FILTER (WHERE match_tier = 4)::int as tier4,
        COUNT(*) FILTER (WHERE match_tier = 5)::int as tier5
      FROM trapper.v_person_dedup_candidates
      WHERE status = 'pending' OR status IS NULL
    `, []);

    // Get Tier 4 prevention queue (from merge-review)
    const tier4Stats = await queryOne<{ total: number }>(`
      SELECT COUNT(*)::int as total
      FROM trapper.v_tier4_pending_review
    `, []);

    // Get data engine pending reviews
    const dataEngineStats = await queryOne<{ total: number }>(`
      SELECT COUNT(*)::int as total
      FROM trapper.data_engine_match_decisions
      WHERE decision_type = 'review_pending'
        AND reviewed_at IS NULL
    `, []);

    // Get place dedup counts
    const placeStats = await queryOne<{
      total: number;
      close_similar: number;
      close_different: number;
    }>(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE match_tier = 1)::int as close_similar,
        COUNT(*) FILTER (WHERE match_tier = 2)::int as close_different
      FROM trapper.v_place_dedup_candidates
      WHERE status = 'pending' OR status IS NULL
    `, []);

    // Get data quality review counts
    const qualityStats = await queryOne<{ total: number }>(`
      SELECT COUNT(*)::int as total
      FROM trapper.sot_people
      WHERE data_quality = 'needs_review'
        AND merged_into_person_id IS NULL
    `, []);

    // Get AI-parsed items needing verification
    const aiStats = await queryOne<{
      total: number;
      colony_estimates: number;
      reproduction: number;
      mortality: number;
    }>(`
      SELECT
        COALESCE(
          (SELECT COUNT(*) FROM trapper.place_colony_estimates WHERE confidence < 0.7 AND reviewed_at IS NULL),
          0
        )::int +
        COALESCE(
          (SELECT COUNT(*) FROM trapper.cat_birth_events WHERE confidence < 0.7 AND reviewed_at IS NULL),
          0
        )::int +
        COALESCE(
          (SELECT COUNT(*) FROM trapper.cat_mortality_events WHERE confidence < 0.7 AND reviewed_at IS NULL),
          0
        )::int as total,
        COALESCE(
          (SELECT COUNT(*) FROM trapper.place_colony_estimates WHERE confidence < 0.7 AND reviewed_at IS NULL),
          0
        )::int as colony_estimates,
        COALESCE(
          (SELECT COUNT(*) FROM trapper.cat_birth_events WHERE confidence < 0.7 AND reviewed_at IS NULL),
          0
        )::int as reproduction,
        COALESCE(
          (SELECT COUNT(*) FROM trapper.cat_mortality_events WHERE confidence < 0.7 AND reviewed_at IS NULL),
          0
        )::int as mortality
    `, []);

    // Get priority items (top 10 oldest across all queues)
    const priorityItems = await queryRows<{
      id: string;
      type: string;
      title: string;
      subtitle: string;
      age_hours: number;
    }>(`
      WITH all_items AS (
        -- Tier 4 same-name-same-address (highest priority)
        SELECT
          duplicate_id::text as id,
          'tier4' as type,
          existing_name as title,
          'Same name + address: ' || COALESCE(shared_address, 'unknown') as subtitle,
          EXTRACT(EPOCH FROM (NOW() - detected_at)) / 3600 as age_hours
        FROM trapper.v_tier4_pending_review

        UNION ALL

        -- Person dedup candidates
        SELECT
          canonical_person_id::text || '|' || duplicate_person_id::text as id,
          'dedup_tier' || match_tier::text as type,
          canonical_name as title,
          CASE match_tier
            WHEN 1 THEN 'Email match: ' || COALESCE(shared_email, '')
            WHEN 2 THEN 'Phone + name match'
            WHEN 3 THEN 'Phone only: ' || COALESCE(shared_phone, '')
            WHEN 4 THEN 'Name + place match'
            WHEN 5 THEN 'Name only match'
          END as subtitle,
          EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as age_hours
        FROM trapper.v_person_dedup_candidates
        WHERE status = 'pending' OR status IS NULL

        UNION ALL

        -- Place dedup candidates
        SELECT
          canonical_place_id::text || '|' || duplicate_place_id::text as id,
          'place' as type,
          canonical_address as title,
          distance_meters::int || 'm apart, ' || (address_similarity * 100)::int || '% similar' as subtitle,
          EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as age_hours
        FROM trapper.v_place_dedup_candidates
        WHERE status = 'pending' OR status IS NULL
      )
      SELECT id, type, title, subtitle, age_hours
      FROM all_items
      ORDER BY age_hours DESC
      LIMIT 10
    `, []);

    const summary: QueueSummary = {
      identity: {
        total: (personDedupStats?.total || 0) + (tier4Stats?.total || 0) + (dataEngineStats?.total || 0),
        tier1_email: personDedupStats?.tier1 || 0,
        tier2_phone_name: personDedupStats?.tier2 || 0,
        tier3_phone_only: personDedupStats?.tier3 || 0,
        tier4_name_address: (personDedupStats?.tier4 || 0) + (tier4Stats?.total || 0),
        tier5_name_only: personDedupStats?.tier5 || 0,
        data_engine_pending: dataEngineStats?.total || 0,
      },
      places: {
        total: placeStats?.total || 0,
        close_similar: placeStats?.close_similar || 0,
        close_different: placeStats?.close_different || 0,
      },
      quality: {
        total: qualityStats?.total || 0,
      },
      ai_parsed: {
        total: aiStats?.total || 0,
        colony_estimates: aiStats?.colony_estimates || 0,
        reproduction: aiStats?.reproduction || 0,
        mortality: aiStats?.mortality || 0,
      },
      priority_items: priorityItems.map((item) => ({
        ...item,
        priority: item.age_hours > 72 ? "high" : item.age_hours > 24 ? "medium" : "low",
        href: item.type === "tier4"
          ? `/admin/reviews/identity?filter=tier4`
          : item.type.startsWith("dedup_tier")
            ? `/admin/reviews/identity?filter=${item.type.replace("dedup_", "")}`
            : item.type === "place"
              ? `/admin/reviews/places`
              : `/admin/reviews/identity`,
      })),
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Error fetching review summary:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
