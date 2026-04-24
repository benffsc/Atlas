import { NextRequest } from "next/server";
import { queryOne, execute } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";

// Population Estimate Decay Cron Job (CATS-4)
//
// 1. Increases variance (decreases confidence) for places that haven't been
//    observed recently. Without this, a place observed once 3 years ago would
//    still show "medium confidence" — this makes stale estimates visually
//    degrade to "low confidence" over time, signaling they need fresh observations.
//
// 2. Sweeps cat_place rows where presence_status = 'unknown' AND last_observed_at
//    is 3+ years old → sets to 'presumed_departed'. These cats are excluded from
//    colony floor counts (same as 'departed'). MIG_3110.
//
// Formula: variance += Q * months_since_last_observation
// Q = 1.0 (same as the Kalman prediction step)
//
// Also refreshes the Beacon matview so map pins reflect updated confidence.
//
// Vercel Cron: "0 4 * * 0" (weekly, Sunday 4 AM)

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const startTime = Date.now();

  try {
    // Decay variance for stale observations
    // Q = 1.0 per month (same as Kalman prediction step)
    const decayResult = await queryOne<{ updated: number; avg_new_variance: number }>(`
      WITH decayed AS (
        UPDATE sot.place_population_state
        SET
          variance = variance + 1.0 * EXTRACT(EPOCH FROM (NOW() - updated_at)) / (30.44 * 86400),
          updated_at = NOW()
        WHERE last_observation_date < CURRENT_DATE - INTERVAL '30 days'
          AND updated_at < NOW() - INTERVAL '7 days'
        RETURNING variance
      )
      SELECT
        COUNT(*)::INTEGER AS updated,
        ROUND(AVG(variance), 1) AS avg_new_variance
      FROM decayed
    `);

    // Presumed-departed sweep: cats not seen in 3+ years with 'unknown' status
    // → set to 'presumed_departed' (excluded from colony counts like 'departed')
    let presumedDepartedCount = 0;
    try {
      const sweepResult = await queryOne<{ swept: number }>(`
        WITH swept AS (
          UPDATE sot.cat_place
          SET
            presence_status = 'presumed_departed',
            presence_confirmed_at = NOW(),
            presence_confirmed_by = 'attrition_sweep',
            updated_at = NOW()
          WHERE presence_status = 'unknown'
            AND last_observed_at IS NOT NULL
            AND last_observed_at < CURRENT_DATE - INTERVAL '3 years'
            AND relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
            AND (presence_confirmed_by IS NULL
                 OR presence_confirmed_by IN ('system_backfill', 'attrition_sweep'))
          RETURNING place_id
        )
        SELECT COUNT(*)::INTEGER AS swept FROM swept
      `);
      presumedDepartedCount = sweepResult?.swept || 0;
    } catch (sweepErr) {
      console.warn("Presumed-departed sweep failed (non-blocking):", sweepErr);
    }

    // Refresh Beacon matview so map shows updated confidence
    let matviewRefreshed = false;
    try {
      await execute(`REFRESH MATERIALIZED VIEW CONCURRENTLY ops.mv_beacon_place_metrics`);
      matviewRefreshed = true;
    } catch (mvErr) {
      console.warn("Beacon matview refresh failed (non-blocking):", mvErr);
    }

    return apiSuccess({
      decayed_places: decayResult?.updated || 0,
      avg_new_variance: decayResult?.avg_new_variance || null,
      presumed_departed_swept: presumedDepartedCount,
      matview_refreshed: matviewRefreshed,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Population decay cron error:", error);
    return apiServerError("Population decay failed");
  }
}
