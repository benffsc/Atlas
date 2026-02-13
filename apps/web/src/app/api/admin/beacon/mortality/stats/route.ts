import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface CauseStat {
  death_cause: string;
  count: number;
}

interface AgeStat {
  death_age_category: string;
  count: number;
}

export async function GET() {
  try {
    // Check if table exists
    const tableExists = await queryRows<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'cat_mortality_events'
      ) AS exists
    `);

    if (!tableExists[0]?.exists) {
      return NextResponse.json({
        total_events: 0,
        by_cause: {},
        by_age_category: {},
        with_cat_id: 0,
        unique_places: 0,
      });
    }

    // Get totals
    const totals = await queryOne<{
      total_events: number;
      with_cat_id: number;
      unique_places: number;
    }>(`
      SELECT
        COUNT(*)::INT AS total_events,
        COUNT(*) FILTER (WHERE cat_id IS NOT NULL)::INT AS with_cat_id,
        COUNT(DISTINCT place_id)::INT AS unique_places
      FROM sot.cat_mortality_events
    `);

    // Get by cause
    const byCause = await queryRows<CauseStat>(`
      SELECT death_cause::TEXT, COUNT(*)::INT AS count
      FROM sot.cat_mortality_events
      GROUP BY death_cause
      ORDER BY count DESC
    `);

    // Get by age category
    const byAge = await queryRows<AgeStat>(`
      SELECT death_age_category::TEXT, COUNT(*)::INT AS count
      FROM sot.cat_mortality_events
      GROUP BY death_age_category
      ORDER BY count DESC
    `);

    // Get by source system
    const bySource = await queryRows<{ source_system: string; count: number }>(`
      SELECT
        COALESCE(source_system, 'unknown') AS source_system,
        COUNT(*)::INT AS count
      FROM sot.cat_mortality_events
      GROUP BY source_system
      ORDER BY count DESC
    `);

    // Get this year's deaths
    const thisYear = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::INT AS count
      FROM sot.cat_mortality_events
      WHERE death_year = EXTRACT(YEAR FROM CURRENT_DATE)
    `);

    return NextResponse.json({
      total_events: totals?.total_events || 0,
      with_cat_id: totals?.with_cat_id || 0,
      unique_places: totals?.unique_places || 0,
      deaths_this_year: thisYear?.count || 0,
      by_cause: Object.fromEntries(byCause.map((r) => [r.death_cause, r.count])),
      by_age_category: Object.fromEntries(byAge.map((r) => [r.death_age_category, r.count])),
      by_source: Object.fromEntries(bySource.map((r) => [r.source_system, r.count])),
    });
  } catch (error) {
    console.error("Mortality stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
