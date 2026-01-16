import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

// Cache stats for 5 minutes - they don't need to be real-time
export const revalidate = 300;

export async function GET() {
  try {
    // Combine all stats into a single efficient query
    const stats = await queryOne<{
      total: number;
      by_status: Record<string, number>;
      by_source: Record<string, number>;
      by_geo_confidence: Record<string, number>;
    }>(`
      WITH status_counts AS (
        SELECT
          COALESCE(submission_status::text, '(none)') as status,
          COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY submission_status
      ),
      source_counts AS (
        SELECT
          COALESCE(intake_source::text, '(none)') as source,
          COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY intake_source
      ),
      geo_counts AS (
        SELECT
          COALESCE(geo_confidence, '(pending)') as geo,
          COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY geo_confidence
      )
      SELECT
        (SELECT COUNT(*)::int FROM trapper.web_intake_submissions) as total,
        (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}') FROM status_counts) as by_status,
        (SELECT COALESCE(jsonb_object_agg(source, cnt), '{}') FROM source_counts) as by_source,
        (SELECT COALESCE(jsonb_object_agg(geo, cnt), '{}') FROM geo_counts) as by_geo_confidence
    `);

    // Get geocoding queue stats for visibility into pending/failed geocoding
    let geocodingQueue: {
      geocoded: number;
      pending: number;
      failed: number;
      ready_to_process: number;
    } | null = null;

    let geocodingFailures: {
      place_id: string;
      formatted_address: string;
      geocode_error: string;
    }[] = [];

    try {
      geocodingQueue = await queryOne<{
        geocoded: number;
        pending: number;
        failed: number;
        ready_to_process: number;
      }>("SELECT * FROM trapper.v_geocoding_stats");

      // Get recent failures for visibility
      if (geocodingQueue && geocodingQueue.failed > 0) {
        geocodingFailures = await queryRows<{
          place_id: string;
          formatted_address: string;
          geocode_error: string;
        }>(
          "SELECT place_id, formatted_address, geocode_error FROM trapper.v_geocoding_failures LIMIT 5"
        );
      }
    } catch {
      // Views might not exist, gracefully continue
    }

    return NextResponse.json({
      total: stats?.total || 0,
      by_status: stats?.by_status || {},
      by_source: stats?.by_source || {},
      by_geo_confidence: stats?.by_geo_confidence || {},
      geocoding: geocodingQueue ? {
        places_geocoded: geocodingQueue.geocoded,
        places_pending: geocodingQueue.pending,
        places_failed: geocodingQueue.failed,
        ready_to_process: geocodingQueue.ready_to_process,
        recent_failures: geocodingFailures,
      } : null,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      }
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
