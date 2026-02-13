import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface SourceTypeStat {
  source_type: string;
  count: number;
}

export async function GET() {
  try {
    // Get total count
    const totalResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::INT AS count FROM sot.place_colony_estimates`
    );

    // Get places with estimates
    const placesResult = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT place_id)::INT AS count FROM sot.place_colony_estimates`
    );

    // Get average colony size
    const avgResult = await queryOne<{ avg: number }>(
      `SELECT AVG(total_cats)::FLOAT AS avg FROM sot.place_colony_estimates WHERE total_cats IS NOT NULL`
    );

    // Get by source type
    const bySourceType = await queryRows<SourceTypeStat>(
      `SELECT source_type, COUNT(*)::INT AS count
       FROM sot.place_colony_estimates
       GROUP BY source_type
       ORDER BY count DESC`
    );

    return NextResponse.json({
      total_estimates: totalResult?.count || 0,
      places_with_estimates: placesResult?.count || 0,
      avg_colony_size: avgResult?.avg || 0,
      by_source_type: Object.fromEntries(bySourceType.map((r) => [r.source_type, r.count])),
    });
  } catch (error) {
    console.error("Colony estimates stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
