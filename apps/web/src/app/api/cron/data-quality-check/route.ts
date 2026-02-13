import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// Data Quality Check Cron Job
//
// Runs every 6 hours to monitor data quality metrics.
// Alerts when thresholds are exceeded:
// - Cats without places > 5%
// - Pending reviews > 100
// - Geocoding queue > 100
// - Invalid people created in 24h > 10
//
// Vercel Cron: "0 */6 * * *" (every 6 hours)

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

interface DataQualityMetrics {
  total_cats: number;
  cats_with_places: number;
  cat_place_coverage_pct: number;
  pending_reviews: number;
  geocoding_queue: number;
  invalid_people_24h: number;
  total_people: number;
  valid_people: number;
  invalid_people: number;
  orgs_as_people: number;
  total_appointments: number;
  appointments_with_person: number;
  appointments_with_trapper: number;
}

interface Alert {
  level: "warning" | "critical";
  metric: string;
  current: number;
  threshold: number;
  message: string;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // Get comprehensive data quality metrics
    const metrics = await queryOne<DataQualityMetrics>(`
      SELECT
        -- Cat-place coverage (CRITICAL for Beacon)
        (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) as total_cats,
        (SELECT COUNT(DISTINCT cpr.cat_id)
         FROM sot.cat_place_relationships cpr
         JOIN sot.cats c ON c.cat_id = cpr.cat_id
         WHERE c.merged_into_cat_id IS NULL) as cats_with_places,
        ROUND(100.0 *
          (SELECT COUNT(DISTINCT cpr.cat_id)
           FROM sot.cat_place_relationships cpr
           JOIN sot.cats c ON c.cat_id = cpr.cat_id
           WHERE c.merged_into_cat_id IS NULL) /
          NULLIF((SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 0), 1
        ) as cat_place_coverage_pct,

        -- Data Engine review queue
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions
         WHERE review_status = 'pending') as pending_reviews,

        -- Geocoding queue
        (SELECT COUNT(*) FROM sot.places
         WHERE merged_into_place_id IS NULL AND latitude IS NULL) as geocoding_queue,

        -- Invalid people created in last 24 hours
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND created_at > NOW() - INTERVAL '24 hours'
         AND NOT trapper.is_valid_person_name(display_name)) as invalid_people_24h,

        -- People quality breakdown
        (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL) as total_people,
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND trapper.is_valid_person_name(display_name)) as valid_people,
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND NOT trapper.is_valid_person_name(display_name)) as invalid_people,
        (SELECT COUNT(*) FROM sot.people
         WHERE merged_into_person_id IS NULL
         AND trapper.is_organization_name(display_name)) as orgs_as_people,

        -- Appointment linking
        (SELECT COUNT(*) FROM ops.appointments) as total_appointments,
        (SELECT COUNT(*) FROM ops.appointments WHERE person_id IS NOT NULL) as appointments_with_person,
        (SELECT COUNT(*) FROM ops.appointments WHERE trapper_person_id IS NOT NULL) as appointments_with_trapper
    `);

    if (!metrics) {
      throw new Error("Failed to fetch data quality metrics");
    }

    // Check thresholds and generate alerts
    const alerts: Alert[] = [];

    // Critical: Cats without places > 5%
    if (metrics.cat_place_coverage_pct < 95) {
      alerts.push({
        level: metrics.cat_place_coverage_pct < 90 ? "critical" : "warning",
        metric: "cat_place_coverage",
        current: metrics.cat_place_coverage_pct,
        threshold: 95,
        message: `Cat-place coverage is ${metrics.cat_place_coverage_pct}% (target: 95%+). ${metrics.total_cats - metrics.cats_with_places} cats need place links.`,
      });
    }

    // Warning: Pending reviews > 100
    if (metrics.pending_reviews > 100) {
      alerts.push({
        level: metrics.pending_reviews > 500 ? "critical" : "warning",
        metric: "pending_reviews",
        current: metrics.pending_reviews,
        threshold: 100,
        message: `${metrics.pending_reviews} identity matches pending human review.`,
      });
    }

    // Warning: Geocoding queue > 100
    if (metrics.geocoding_queue > 100) {
      alerts.push({
        level: metrics.geocoding_queue > 500 ? "critical" : "warning",
        metric: "geocoding_queue",
        current: metrics.geocoding_queue,
        threshold: 100,
        message: `${metrics.geocoding_queue} places waiting for geocoding.`,
      });
    }

    // Warning: Invalid people created in 24h > 10
    if (metrics.invalid_people_24h > 10) {
      alerts.push({
        level: metrics.invalid_people_24h > 50 ? "critical" : "warning",
        metric: "invalid_people_24h",
        current: metrics.invalid_people_24h,
        threshold: 10,
        message: `${metrics.invalid_people_24h} invalid people created in last 24 hours. Check data ingestion.`,
      });
    }

    // Warning: Organizations as people > 200
    if (metrics.orgs_as_people > 200) {
      alerts.push({
        level: "warning",
        metric: "orgs_as_people",
        current: metrics.orgs_as_people,
        threshold: 200,
        message: `${metrics.orgs_as_people} organizations stored as people. Run conversion.`,
      });
    }

    const hasAlerts = alerts.length > 0;
    const hasCritical = alerts.some((a) => a.level === "critical");

    return NextResponse.json({
      success: true,
      status: hasCritical ? "critical" : hasAlerts ? "warning" : "healthy",
      checked_at: new Date().toISOString(),
      metrics: {
        cat_place_coverage_pct: metrics.cat_place_coverage_pct,
        cats_without_places: metrics.total_cats - metrics.cats_with_places,
        pending_reviews: metrics.pending_reviews,
        geocoding_queue: metrics.geocoding_queue,
        invalid_people_24h: metrics.invalid_people_24h,
        invalid_people_total: metrics.invalid_people,
        orgs_as_people: metrics.orgs_as_people,
        appointment_person_pct: Math.round(
          (100 * metrics.appointments_with_person) / metrics.total_appointments
        ),
        appointment_trapper_pct: Math.round(
          (100 * metrics.appointments_with_trapper) / metrics.total_appointments
        ),
      },
      alerts,
      alert_count: alerts.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Data quality check error:", error);
    return NextResponse.json(
      {
        error: "Data quality check failed",
        details: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
