import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export async function GET() {
  try {
    const stats = await queryOne<{
      total: number;
      by_status: Record<string, number>;
      by_source: Record<string, number>;
      by_geo_confidence: Record<string, number>;
    }>(`
      SELECT
        COUNT(*)::int as total,
        jsonb_object_agg(
          COALESCE(legacy_submission_status, ''),
          status_count
        ) as by_status,
        jsonb_object_agg(
          COALESCE(intake_source::text, ''),
          source_count
        ) as by_source,
        jsonb_object_agg(
          COALESCE(geo_confidence, ''),
          geo_count
        ) as by_geo_confidence
      FROM (
        SELECT
          legacy_submission_status,
          COUNT(*) as status_count
        FROM trapper.web_intake_submissions
        GROUP BY legacy_submission_status
      ) status_agg,
      (
        SELECT
          intake_source,
          COUNT(*) as source_count
        FROM trapper.web_intake_submissions
        GROUP BY intake_source
      ) source_agg,
      (
        SELECT
          geo_confidence,
          COUNT(*) as geo_count
        FROM trapper.web_intake_submissions
        GROUP BY geo_confidence
      ) geo_agg,
      (SELECT COUNT(*) FROM trapper.web_intake_submissions) total_count
    `);

    // The above query is complex - let's simplify with separate queries
    const totalResult = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int as count FROM trapper.web_intake_submissions
    `);

    const statusResult = await queryOne<{ data: Record<string, number> }>(`
      SELECT jsonb_object_agg(COALESCE(legacy_submission_status, '(none)'), cnt) as data
      FROM (
        SELECT legacy_submission_status, COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY legacy_submission_status
        ORDER BY cnt DESC
      ) t
    `);

    const sourceResult = await queryOne<{ data: Record<string, number> }>(`
      SELECT jsonb_object_agg(COALESCE(intake_source::text, '(none)'), cnt) as data
      FROM (
        SELECT intake_source, COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY intake_source
        ORDER BY cnt DESC
      ) t
    `);

    const geoResult = await queryOne<{ data: Record<string, number> }>(`
      SELECT jsonb_object_agg(COALESCE(geo_confidence, '(pending)'), cnt) as data
      FROM (
        SELECT geo_confidence, COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY geo_confidence
        ORDER BY cnt DESC
      ) t
    `);

    return NextResponse.json({
      total: totalResult?.count || 0,
      by_status: statusResult?.data || {},
      by_source: sourceResult?.data || {},
      by_geo_confidence: geoResult?.data || {},
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
