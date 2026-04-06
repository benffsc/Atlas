import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import { runCDS } from "@/lib/cds";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * POST /api/admin/clinic-days/[date]/rematch
 *
 * Re-runs matching for a clinic day via the CDS pipeline.
 * Preserves manual matches (match_confidence = 'manual').
 * Runs all 7 CDS phases: SQL → waiver bridge → weight → composite →
 * constraint propagation → LLM tiebreaker → results assembly.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    // Check clinic day exists with entries
    const clinicDay = await queryOne<{
      clinic_day_id: string;
      entry_count: number;
    }>(
      `SELECT cd.clinic_day_id, COUNT(e.entry_id)::int as entry_count
       FROM ops.clinic_days cd
       LEFT JOIN ops.clinic_day_entries e ON e.clinic_day_id = cd.clinic_day_id
       WHERE cd.clinic_date = $1
       GROUP BY cd.clinic_day_id`,
      [date]
    );

    if (!clinicDay) {
      return apiNotFound("clinic day", date);
    }

    if (clinicDay.entry_count === 0) {
      return apiBadRequest("No entries exist for this clinic day. Import a master list first.");
    }

    // Snapshot before state
    const beforeStats = await queryOne<{
      matched: number;
      unmatched: number;
      manual: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE match_confidence IS NOT NULL AND match_confidence != 'unmatched') ::int as matched,
         COUNT(*) FILTER (WHERE match_confidence IS NULL OR match_confidence = 'unmatched') ::int as unmatched,
         COUNT(*) FILTER (WHERE match_confidence = 'manual') ::int as manual
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1`,
      [date]
    );

    // Run full CDS pipeline (handles clearing auto-matches internally)
    const cdsResult = await runCDS(date, "rematch");

    return apiSuccess({
      date,
      cds_run_id: cdsResult.run_id,
      phases: cdsResult.phases,
      before: {
        matched: beforeStats?.matched || 0,
        unmatched: beforeStats?.unmatched || 0,
        manual: beforeStats?.manual || 0,
      },
      after: {
        matched: cdsResult.matched_after,
        unmatched: cdsResult.unmatched_remaining,
        manual: cdsResult.manual_preserved,
      },
    });
  } catch (error) {
    console.error("Rematch error:", error);
    return apiServerError("Failed to rematch clinic day");
  }
}
