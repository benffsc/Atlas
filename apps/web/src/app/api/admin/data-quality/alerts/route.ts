import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Data Quality Alerts API
 *
 * GET: Get active alerts from v_data_quality_alerts view (MIG_2515)
 */

interface DataQualityAlert {
  alert_type: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  count: number;
  message: string;
  checked_at: string;
}

interface HealthCheck {
  status: string;
  critical_count: number;
  high_count: number;
  total_alerts: number;
  alerts: DataQualityAlert[];
  checked_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const healthCheck = searchParams.get("health") === "true";

  try {
    if (healthCheck) {
      // Use the quick health check function
      const result = await queryOne<{ check_data_quality_health: HealthCheck }>(`
        SELECT ops.check_data_quality_health() as check_data_quality_health
      `);

      if (result?.check_data_quality_health) {
        return NextResponse.json({
          success: true,
          ...result.check_data_quality_health,
        });
      }

      // Fallback if function doesn't exist yet
      return NextResponse.json({
        success: true,
        status: "unknown",
        message: "MIG_2515 not applied yet - run migration first",
      });
    }

    // Get all active alerts
    const alerts = await queryRows<DataQualityAlert>(`
      SELECT
        alert_type,
        severity,
        count::int as count,
        message,
        checked_at
      FROM ops.v_data_quality_alerts
      ORDER BY
        CASE severity
          WHEN 'CRITICAL' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
          ELSE 5
        END,
        count DESC
    `);

    const criticalCount = alerts.filter((a) => a.severity === "CRITICAL").length;
    const highCount = alerts.filter((a) => a.severity === "HIGH").length;
    const mediumCount = alerts.filter((a) => a.severity === "MEDIUM").length;
    const lowCount = alerts.filter((a) => a.severity === "LOW").length;

    // Determine overall status
    let status: string;
    if (criticalCount > 0) {
      status = "critical";
    } else if (highCount > 0) {
      status = "warning";
    } else if (mediumCount > 0 || lowCount > 0) {
      status = "info";
    } else {
      status = "healthy";
    }

    return NextResponse.json({
      success: true,
      status,
      summary: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount,
        total: alerts.length,
      },
      alerts,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    // If view doesn't exist, return helpful message
    if (
      error instanceof Error &&
      error.message.includes("does not exist")
    ) {
      return NextResponse.json({
        success: false,
        status: "unavailable",
        message: "MIG_2515 not applied yet - alerts view not found",
        alerts: [],
      });
    }

    console.error("Error fetching data quality alerts:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
