import { NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Program Statistics Health Check Endpoint
 *
 * Returns status of program statistics views including:
 * - Foster, County, LMFM program counts
 * - Quarterly aggregation availability
 * - Year-over-year comparisons
 */

interface QuarterlyStats {
  year: number;
  quarter: number;
  quarter_label: string;
  total_cats: number;
  total_alterations: number;
}

interface ProgramSummary {
  program: string;
  total_cats_ytd: number;
  total_alterations_ytd: number;
  has_quarterly_view: boolean;
}

interface ViewAvailability {
  view_name: string;
  exists: boolean;
  row_count: number | null;
}

export async function GET() {
  const startTime = Date.now();
  const currentYear = new Date().getFullYear();

  try {
    // Check which program views exist
    const viewChecks = await queryRows<ViewAvailability>(`
      WITH views AS (
        SELECT 'v_foster_program_stats' as view_name
        UNION ALL SELECT 'v_foster_program_quarterly'
        UNION ALL SELECT 'v_county_cat_stats'
        UNION ALL SELECT 'v_county_cat_quarterly'
        UNION ALL SELECT 'v_lmfm_stats'
        UNION ALL SELECT 'v_lmfm_quarterly'
        UNION ALL SELECT 'v_program_comparison_quarterly'
      )
      SELECT
        v.view_name,
        EXISTS (
          SELECT 1 FROM information_schema.views
          WHERE table_schema = 'trapper' AND table_name = v.view_name
        ) as exists,
        NULL::bigint as row_count
      FROM views v
    `);

    // Get foster quarterly data
    let fosterQuarterly: QuarterlyStats[] = [];
    try {
      fosterQuarterly = await queryRows<QuarterlyStats>(`
        SELECT year, quarter, quarter_label, total_cats, total_alterations
        FROM trapper.v_foster_program_quarterly
        WHERE year >= ${currentYear - 1}
        ORDER BY year DESC, quarter DESC
        LIMIT 8
      `);
    } catch {
      // View may not exist yet
    }

    // Get county quarterly data
    let countyQuarterly: QuarterlyStats[] = [];
    try {
      countyQuarterly = await queryRows<QuarterlyStats>(`
        SELECT year, quarter, quarter_label, total_cats, total_alterations
        FROM trapper.v_county_cat_quarterly
        WHERE year >= ${currentYear - 1}
        ORDER BY year DESC, quarter DESC
        LIMIT 8
      `);
    } catch {
      // View may not exist yet
    }

    // Get LMFM quarterly data
    let lmfmQuarterly: QuarterlyStats[] = [];
    try {
      lmfmQuarterly = await queryRows<QuarterlyStats>(`
        SELECT year, quarter, quarter_label, total_cats, total_alterations
        FROM trapper.v_lmfm_quarterly
        WHERE year >= ${currentYear - 1}
        ORDER BY year DESC, quarter DESC
        LIMIT 8
      `);
    } catch {
      // View may not exist yet
    }

    // Get program comparison (if available)
    let programComparison: any[] = [];
    try {
      programComparison = await queryRows(`
        SELECT quarter_label, foster_alterations, county_alterations, lmfm_alterations,
               total_alterations, foster_pct, county_pct, lmfm_pct
        FROM trapper.v_program_comparison_quarterly
        WHERE year = ${currentYear}
        ORDER BY quarter
      `);
    } catch {
      // View may not exist yet
    }

    // Get YTD summaries from appointments
    const ytdSummary = await queryOne<{
      foster_ytd: number;
      county_ytd: number;
      lmfm_ytd: number;
      other_internal_ytd: number;
      regular_ytd: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE appointment_source_category = 'foster_program') as foster_ytd,
        COUNT(*) FILTER (WHERE appointment_source_category = 'county_scas') as county_ytd,
        COUNT(*) FILTER (WHERE appointment_source_category = 'lmfm') as lmfm_ytd,
        COUNT(*) FILTER (WHERE appointment_source_category = 'other_internal') as other_internal_ytd,
        COUNT(*) FILTER (WHERE appointment_source_category = 'regular') as regular_ytd
      FROM trapper.sot_appointments
      WHERE EXTRACT(YEAR FROM appointment_date) = ${currentYear}
    `);

    // Calculate data freshness
    const lastAppointment = await queryOne<{ last_date: string }>(`
      SELECT MAX(appointment_date)::text as last_date
      FROM trapper.sot_appointments
    `);

    // Determine health status
    const quarterlyViewsExist = viewChecks.filter(v =>
      v.view_name.includes('quarterly') && v.exists
    ).length;

    let status: "healthy" | "degraded" | "unhealthy";
    if (quarterlyViewsExist === 0) {
      status = "unhealthy";
    } else if (quarterlyViewsExist < 4) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,

      summary: {
        current_year: currentYear,
        foster_ytd: ytdSummary?.foster_ytd || 0,
        county_ytd: ytdSummary?.county_ytd || 0,
        lmfm_ytd: ytdSummary?.lmfm_ytd || 0,
        quarterly_views_available: quarterlyViewsExist,
        last_appointment_date: lastAppointment?.last_date,
      },

      view_availability: viewChecks,

      quarterly_data: {
        foster: fosterQuarterly,
        county: countyQuarterly,
        lmfm: lmfmQuarterly,
      },

      program_comparison: programComparison,

      ytd_by_category: {
        foster_program: ytdSummary?.foster_ytd || 0,
        county_scas: ytdSummary?.county_ytd || 0,
        lmfm: ytdSummary?.lmfm_ytd || 0,
        other_internal: ytdSummary?.other_internal_ytd || 0,
        regular: ytdSummary?.regular_ytd || 0,
      },
    });
  } catch (error) {
    console.error("Program stats health check error:", error);
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
