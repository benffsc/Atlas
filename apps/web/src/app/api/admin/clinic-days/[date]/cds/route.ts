import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import { queryOne } from "@/lib/db";
import { runCDS, getLatestCDSRun } from "@/lib/cds";
import { runCdsAi } from "@/lib/cds-ai";

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * POST /api/admin/clinic-days/[date]/cds
 * Trigger a CDS run for a clinic day.
 *
 * Query params:
 *   - pipeline=ai  — Run CDS-AI (classify → chunk → match photos)
 *   - (default)    — Run CDS-SQL (deterministic master list matching)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const pipeline = request.nextUrl.searchParams.get("pipeline");

    // CDS-AI pipeline: classify → chunk → match evidence photos
    if (pipeline === "ai") {
      if (!process.env.ANTHROPIC_API_KEY) {
        return apiBadRequest("ANTHROPIC_API_KEY not configured");
      }

      const result = await runCdsAi(date, {
        apply: true,
        log: (msg) => console.log(`[cds-ai:${date}] ${msg}`),
      });

      return apiSuccess({
        date: result.date,
        classified: result.classified,
        classification_errors: result.classification_errors,
        chunks_formed: result.chunks_formed,
        matched: result.matched,
        unmatched: result.unmatched,
        agreements: result.agreements,
        disagreements: result.disagreements,
        elapsed_ms: result.elapsed_ms,
      });
    }

    // Default: CDS-SQL pipeline (deterministic master list matching)
    const clinicDay = await queryOne<{
      clinic_day_id: string;
      entry_count: number;
    }>(
      `SELECT cd.clinic_day_id, COUNT(e.entry_id)::int AS entry_count
       FROM ops.clinic_days cd
       LEFT JOIN ops.clinic_day_entries e ON e.clinic_day_id = cd.clinic_day_id
       WHERE cd.clinic_date = $1
       GROUP BY cd.clinic_day_id`,
      [date]
    );

    if (!clinicDay) return apiNotFound("clinic day", date);
    if (clinicDay.entry_count === 0) {
      return apiBadRequest("No entries exist for this clinic day.");
    }

    const result = await runCDS(date, "manual");

    return apiSuccess(result);
  } catch (error) {
    console.error("CDS run error:", error);
    return apiServerError("CDS run failed");
  }
}

/**
 * GET /api/admin/clinic-days/[date]/cds
 * Get the latest CDS run results and pending suggestions.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const latestRun = await getLatestCDSRun(date);

    // Get pending CDS suggestions
    const suggestions = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
         AND e.cds_method = 'cds_suggestion'`,
      [date]
    );

    // Get method breakdown
    const methods = await queryOne<{
      sql_owner_name: number;
      sql_cat_name: number;
      sql_sex: number;
      sql_cardinality: number;
      waiver_bridge: number;
      weight_disambiguation: number;
      composite: number;
      constraint_propagation: number;
      cds_suggestion: number;
      manual: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE e.cds_method = 'sql_owner_name')::int AS sql_owner_name,
         COUNT(*) FILTER (WHERE e.cds_method = 'sql_cat_name')::int AS sql_cat_name,
         COUNT(*) FILTER (WHERE e.cds_method = 'sql_sex')::int AS sql_sex,
         COUNT(*) FILTER (WHERE e.cds_method = 'sql_cardinality')::int AS sql_cardinality,
         COUNT(*) FILTER (WHERE e.cds_method = 'waiver_bridge')::int AS waiver_bridge,
         COUNT(*) FILTER (WHERE e.cds_method = 'weight_disambiguation')::int AS weight_disambiguation,
         COUNT(*) FILTER (WHERE e.cds_method = 'composite')::int AS composite,
         COUNT(*) FILTER (WHERE e.cds_method = 'constraint_propagation')::int AS constraint_propagation,
         COUNT(*) FILTER (WHERE e.cds_method = 'cds_suggestion')::int AS cds_suggestion,
         COUNT(*) FILTER (WHERE e.cds_method = 'manual')::int AS manual
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
         AND e.matched_appointment_id IS NOT NULL`,
      [date]
    );

    return apiSuccess({
      latest_run: latestRun,
      pending_suggestions: suggestions?.count ?? 0,
      method_breakdown: methods ?? {},
    });
  } catch (error) {
    console.error("CDS status error:", error);
    return apiServerError("Failed to fetch CDS status");
  }
}
