import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Appointment Categorization Health Check Endpoint
 *
 * Returns status of appointment source categorization including:
 * - Category breakdown
 * - Potential pattern misses (SCAS, LMFM, Foster)
 * - Recent classification activity
 */

interface CategoryCount {
  appointment_source_category: string;
  count: number;
  percentage: number;
}

interface PatternMiss {
  appointment_id: string;
  client_first_name: string;
  client_last_name: string;
  current_category: string;
  suggested_category: string;
  pattern_type: string;
}

interface ClassificationFunctionStatus {
  function_name: string;
  exists: boolean;
  last_updated: string | null;
}

export async function GET() {
  const startTime = Date.now();

  try {
    // Get category breakdown
    const categoryBreakdown = await queryRows<CategoryCount>(`
      WITH totals AS (
        SELECT COUNT(*) as total FROM ops.appointments
      )
      SELECT
        COALESCE(appointment_source_category, 'unclassified') as appointment_source_category,
        COUNT(*) as count,
        ROUND(100.0 * COUNT(*) / NULLIF(MAX(t.total), 0), 2) as percentage
      FROM ops.appointments, totals t
      GROUP BY appointment_source_category
      ORDER BY count DESC
    `);

    // Check for SCAS pattern misses (hyphenated IDs like A-416620)
    const scasPatternMisses = await queryRows<PatternMiss>(`
      SELECT
        a.appointment_id::text,
        cv.client_first_name,
        cv.client_last_name,
        a.appointment_source_category as current_category,
        'county_scas' as suggested_category,
        'hyphenated_scas_id' as pattern_type
      FROM ops.appointments a
      JOIN source.clinichq_visits cv ON cv.appointment_number = a.appointment_number
      WHERE UPPER(TRIM(cv.client_last_name)) = 'SCAS'
        AND TRIM(cv.client_first_name) ~ '^[AS]-[0-9]+$'
        AND a.appointment_source_category <> 'county_scas'
      LIMIT 20
    `);

    // Check for LMFM pattern misses (hyphenated names like MARY-JANE)
    const lmfmPatternMisses = await queryRows<PatternMiss>(`
      SELECT
        a.appointment_id::text,
        cv.client_first_name,
        cv.client_last_name,
        a.appointment_source_category as current_category,
        'lmfm' as suggested_category,
        'all_caps_hyphenated' as pattern_type
      FROM ops.appointments a
      JOIN source.clinichq_visits cv ON cv.appointment_number = a.appointment_number
      WHERE a.appointment_source_category <> 'lmfm'
        AND cv.client_first_name ~ '^[A-Z-]+$'
        AND cv.client_last_name ~ '^[A-Z-]+$'
        AND LENGTH(cv.client_first_name) > 2
        AND LENGTH(cv.client_last_name) > 2
        AND cv.client_first_name ~ '-'
        AND UPPER(cv.client_last_name) <> 'SCAS'
      LIMIT 20
    `);

    // Check classification function status
    const functionStatus = await queryRows<ClassificationFunctionStatus>(`
      SELECT
        proname as function_name,
        true as exists,
        NULL as last_updated
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'trapper'
        AND proname IN ('is_scas_appointment', 'is_lmfm_appointment', 'is_foster_program_appointment')
    `);

    // Get recent classifications (appointments classified in last 24h via trigger)
    const recentActivity = await queryOne<{
      classified_24h: number;
      scas_24h: number;
      lmfm_24h: number;
      foster_24h: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as classified_24h,
        COUNT(*) FILTER (WHERE appointment_source_category = 'county_scas' AND created_at > NOW() - INTERVAL '24 hours') as scas_24h,
        COUNT(*) FILTER (WHERE appointment_source_category = 'lmfm' AND created_at > NOW() - INTERVAL '24 hours') as lmfm_24h,
        COUNT(*) FILTER (WHERE appointment_source_category = 'foster_program' AND created_at > NOW() - INTERVAL '24 hours') as foster_24h
      FROM ops.appointments
    `);

    // Determine health status
    const totalMisses = scasPatternMisses.length + lmfmPatternMisses.length;
    let status: "healthy" | "degraded" | "unhealthy";
    if (totalMisses > 10) {
      status = "unhealthy";
    } else if (totalMisses > 0) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,

      summary: {
        total_appointments: categoryBreakdown.reduce((sum, c) => sum + c.count, 0),
        categories: categoryBreakdown.length,
        pattern_misses: totalMisses,
      },

      category_breakdown: categoryBreakdown,

      pattern_misses: {
        scas: {
          count: scasPatternMisses.length,
          samples: scasPatternMisses.slice(0, 5),
        },
        lmfm: {
          count: lmfmPatternMisses.length,
          samples: lmfmPatternMisses.slice(0, 5),
        },
      },

      classification_functions: functionStatus,

      recent_activity: recentActivity || {
        classified_24h: 0,
        scas_24h: 0,
        lmfm_24h: 0,
        foster_24h: 0,
      },
    });
  } catch (error) {
    console.error("Categorization health check error:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
