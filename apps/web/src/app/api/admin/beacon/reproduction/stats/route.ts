import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface BySource {
  source_system: string;
  count: number;
}

export async function GET() {
  try {
    // Get vitals stats
    const vitalsStats = await queryOne<{
      total_records: number;
      pregnant_count: number;
      lactating_count: number;
      in_heat_count: number;
      unique_cats: number;
    }>(`
      SELECT
        COUNT(*)::INT AS total_records,
        COUNT(*) FILTER (WHERE is_pregnant)::INT AS pregnant_count,
        COUNT(*) FILTER (WHERE is_lactating)::INT AS lactating_count,
        COUNT(*) FILTER (WHERE is_in_heat)::INT AS in_heat_count,
        COUNT(DISTINCT cat_id)::INT AS unique_cats
      FROM ops.cat_vitals
      WHERE is_pregnant = TRUE OR is_lactating = TRUE OR is_in_heat = TRUE
    `);

    // Get birth events stats
    const birthStats = await queryOne<{
      total_births: number;
      unique_mothers: number;
      unique_litters: number;
      births_this_year: number;
    }>(`
      SELECT
        COUNT(*)::INT AS total_births,
        COUNT(DISTINCT mother_cat_id)::INT AS unique_mothers,
        COUNT(DISTINCT litter_id)::INT AS unique_litters,
        COUNT(*) FILTER (WHERE birth_year = EXTRACT(YEAR FROM CURRENT_DATE))::INT AS births_this_year
      FROM sot.cat_birth_events
    `);

    // Get births by source
    const birthsBySource = await queryRows<BySource>(`
      SELECT
        COALESCE(source_system, 'unknown') AS source_system,
        COUNT(*)::INT AS count
      FROM sot.cat_birth_events
      GROUP BY source_system
      ORDER BY count DESC
    `);

    // Get births by season
    const birthsBySeason = await queryRows<{ season: string; count: number }>(`
      SELECT
        COALESCE(birth_season, 'unknown') AS season,
        COUNT(*)::INT AS count
      FROM sot.cat_birth_events
      GROUP BY birth_season
      ORDER BY
        CASE birth_season
          WHEN 'spring' THEN 1
          WHEN 'summer' THEN 2
          WHEN 'fall' THEN 3
          WHEN 'winter' THEN 4
          ELSE 5
        END
    `);

    return NextResponse.json({
      vitals: vitalsStats || {
        total_records: 0,
        pregnant_count: 0,
        lactating_count: 0,
        in_heat_count: 0,
        unique_cats: 0,
      },
      births: birthStats || {
        total_births: 0,
        unique_mothers: 0,
        unique_litters: 0,
        births_this_year: 0,
      },
      births_by_source: Object.fromEntries(birthsBySource.map(r => [r.source_system, r.count])),
      births_by_season: Object.fromEntries(birthsBySeason.map(r => [r.season, r.count])),
    });
  } catch (error) {
    console.error("Reproduction stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
