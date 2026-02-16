import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";

/**
 * AI Data Guardian Cron Job
 * =========================
 *
 * Maintains the place context system for the Data Guardian:
 *
 * OPERATIONAL MAINTENANCE:
 * 1. Refreshes the materialized view for fast context lookups
 * 2. Pre-generates context summaries for active places
 * 3. Identifies places with significant activity but no request
 *
 * ECOLOGICAL DATA MAINTENANCE:
 * 4. Refreshes zone data coverage statistics
 * 5. Updates data freshness tracking
 * 6. Checks for stale data categories
 *
 * Run: Daily at 6 AM PT (before business hours)
 *
 * This is a MAINTENANCE job - it does NOT modify source data.
 * It only refreshes computed views and summaries.
 */

export const maxDuration = 120; // Allow up to 2 minutes

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    materialized_view_refreshed: false,
    places_with_context: 0,
    places_needing_attention: 0,
    zone_coverage_refreshed: false,
    stale_data_categories: [] as string[],
    freshness_updated: false,
    errors: [] as string[],
  };

  try {
    // ============================================================
    // 1. Refresh Materialized View for Place Context
    // ============================================================

    try {
      await query(`
        REFRESH MATERIALIZED VIEW CONCURRENTLY sot.v_place_context_summary
      `);
      results.materialized_view_refreshed = true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`MV refresh failed: ${errorMsg}`);

      // If CONCURRENTLY fails (first run, no unique index), try without
      try {
        await query(`
          REFRESH MATERIALIZED VIEW sot.v_place_context_summary
        `);
        results.materialized_view_refreshed = true;
      } catch (error2) {
        const errorMsg2 = error2 instanceof Error ? error2.message : String(error2);
        results.errors.push(`MV refresh (non-concurrent) failed: ${errorMsg2}`);
      }
    }

    // ============================================================
    // 2. Count Places with Context Information
    // ============================================================

    try {
      const contextStats = await queryOne<{
        total_places: number;
        with_active_request: number;
        with_clinic_activity: number;
        with_google_history: number;
      }>(`
        SELECT
          COUNT(*)::INT as total_places,
          COUNT(*) FILTER (WHERE has_active_request = true)::INT as with_active_request,
          COUNT(*) FILTER (WHERE clinic_activity_level != 'none')::INT as with_clinic_activity,
          COUNT(*) FILTER (WHERE has_google_history = true)::INT as with_google_history
        FROM sot.v_place_context_summary
      `);

      if (contextStats) {
        results.places_with_context =
          contextStats.with_active_request +
          contextStats.with_clinic_activity +
          contextStats.with_google_history;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`Context stats failed: ${errorMsg}`);
    }

    // ============================================================
    // 3. Identify Places with High Activity but No Request
    // ============================================================
    // These are places that might benefit from proactive outreach

    try {
      const placesNeedingAttention = await queryRows<{
        place_id: string;
        formatted_address: string;
        clinic_cats_6mo: number;
      }>(`
        SELECT
          p.place_id,
          p.formatted_address,
          COUNT(DISTINCT a.cat_id)::INT as clinic_cats_6mo
        FROM sot.places p
        -- V2: Uses sot.cat_place instead of sot.cat_place_relationships
        JOIN sot.cat_place cpr ON cpr.place_id = p.place_id
        JOIN ops.appointments a ON a.cat_id = cpr.cat_id
        WHERE a.appointment_date > NOW() - INTERVAL '6 months'
          AND NOT EXISTS (
            SELECT 1 FROM ops.requests r
            WHERE r.place_id = p.place_id
              AND r.status NOT IN ('completed', 'cancelled')
          )
          AND p.merged_into_place_id IS NULL
        GROUP BY p.place_id, p.formatted_address
        HAVING COUNT(DISTINCT a.cat_id) >= 3
        ORDER BY COUNT(DISTINCT a.cat_id) DESC
        LIMIT 100
      `);

      results.places_needing_attention = placesNeedingAttention.length;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`Attention places query failed: ${errorMsg}`);
    }

    // ============================================================
    // 4. Refresh Zone Data Coverage Statistics
    // ============================================================
    // Tracks where we have good data vs gaps for Beacon/Tippy

    try {
      await query(`SELECT sot.refresh_zone_data_coverage()`);
      results.zone_coverage_refreshed = true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`Zone coverage refresh failed: ${errorMsg}`);
    }

    // ============================================================
    // 5. Update Data Freshness Tracking
    // ============================================================
    // Records counts and timestamps for each data category

    try {
      // Update Google Maps classification count
      await query(`
        UPDATE ops.data_freshness_tracking
        SET records_count = (
          SELECT COUNT(*) FROM source.google_map_entries WHERE ai_classified_at IS NOT NULL
        ),
        last_incremental_update = NOW(),
        updated_at = NOW()
        WHERE data_category = 'google_maps_classification'
      `);

      // Update colony estimates count
      await query(`
        UPDATE ops.data_freshness_tracking
        SET records_count = (
          SELECT COUNT(*) FROM sot.place_colony_estimates
        ),
        last_incremental_update = NOW(),
        updated_at = NOW()
        WHERE data_category = 'colony_estimates'
      `);

      // Update place conditions count
      await query(`
        UPDATE ops.data_freshness_tracking
        SET records_count = (
          SELECT COUNT(*) FROM sot.place_condition_history WHERE superseded_at IS NULL
        ),
        last_incremental_update = NOW(),
        updated_at = NOW()
        WHERE data_category = 'place_conditions'
      `);

      results.freshness_updated = true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`Freshness tracking update failed: ${errorMsg}`);
    }

    // ============================================================
    // 6. Check for Stale Data Categories
    // ============================================================

    try {
      const staleCategories = await queryRows<{ data_category: string }>(`
        SELECT data_category
        FROM ops.v_data_staleness_alerts
        WHERE freshness_status IN ('stale', 'never_refreshed')
      `);

      results.stale_data_categories = staleCategories.map((c) => c.data_category);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`Staleness check failed: ${errorMsg}`);
    }

    // ============================================================
    // Summary
    // ============================================================

    const duration = Date.now() - startTime;

    const staleWarning =
      results.stale_data_categories.length > 0
        ? ` Warning: ${results.stale_data_categories.length} stale data categories.`
        : "";

    return NextResponse.json({
      success: results.errors.length === 0,
      duration_ms: duration,
      results,
      message:
        results.errors.length === 0
          ? `Guardian maintenance complete. MV refreshed, ${results.places_with_context} places have context data. Zone coverage updated.${staleWarning}`
          : `Guardian maintenance completed with ${results.errors.length} error(s).${staleWarning}`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Guardian cron error:", error);

    return NextResponse.json(
      {
        success: false,
        duration_ms: Date.now() - startTime,
        error: errorMessage,
        results,
      },
      { status: 500 }
    );
  }
}
