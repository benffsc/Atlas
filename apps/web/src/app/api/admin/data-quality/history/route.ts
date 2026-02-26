import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Data Quality History API
 *
 * GET: Get historical metrics trend (MIG_2515)
 * POST: Take a snapshot of current metrics
 */

interface MetricsTrend {
  metric_date: string;
  active_cats: number;
  active_people: number;
  active_places: number;
  garbage_cats: number;
  needs_review_cats: number;
  verified_person_place: number;
  alert_count: number;
}

interface HistoryRecord {
  id: string;
  metric_date: string;
  metrics: Record<string, number>;
  alerts: Array<{
    alert_type: string;
    severity: string;
    count: number;
    message: string;
  }>;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const days = parseInt(searchParams.get("days") || "30", 10);
  const format = searchParams.get("format") || "trend"; // "trend" or "full"

  try {
    if (format === "trend") {
      // Use the trend function for simplified data
      const trend = await queryRows<MetricsTrend>(`
        SELECT * FROM ops.get_data_quality_trend($1)
      `, [Math.min(days, 365)]);

      return NextResponse.json({
        success: true,
        days,
        data: trend,
        generated_at: new Date().toISOString(),
      });
    }

    // Full format - get raw history records
    const history = await queryRows<HistoryRecord>(`
      SELECT
        id,
        metric_date::text,
        metrics,
        alerts,
        created_at
      FROM ops.data_quality_history
      WHERE metric_date >= CURRENT_DATE - $1
      ORDER BY metric_date DESC
    `, [Math.min(days, 365)]);

    return NextResponse.json({
      success: true,
      days,
      records: history.length,
      data: history,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    // If tables/functions don't exist yet
    if (
      error instanceof Error &&
      error.message.includes("does not exist")
    ) {
      return NextResponse.json({
        success: false,
        message: "MIG_2515 not applied yet - history not available",
        data: [],
      });
    }

    console.error("Error fetching data quality history:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    // Take a snapshot using the new function
    const result = await queryOne<{ snapshot_data_quality_metrics: Record<string, unknown> }>(`
      SELECT ops.snapshot_data_quality_metrics() as snapshot_data_quality_metrics
    `);

    if (result?.snapshot_data_quality_metrics) {
      return NextResponse.json({
        success: true,
        message: "Data quality snapshot captured",
        snapshot: result.snapshot_data_quality_metrics,
      });
    }

    // Fallback to legacy snapshot function if new one doesn't exist
    const legacyResult = await queryOne<{ take_quality_snapshot: string }>(`
      SELECT ops.take_quality_snapshot('api')
    `);

    return NextResponse.json({
      success: true,
      message: "Quality snapshot taken (legacy)",
      snapshot_id: legacyResult?.take_quality_snapshot,
    });
  } catch (error) {
    console.error("Error taking data quality snapshot:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
