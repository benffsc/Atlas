import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiBadRequest, apiServerError } from "@/lib/api-response";
import { randomBytes } from "crypto";

/**
 * POST /api/trappers/send-survey
 *
 * Generate survey tokens for trappers and return their survey URLs.
 * Body: { person_ids?: string[], tier?: "ffsc" | "community" | "all" }
 *
 * If person_ids provided, generates for those specific trappers.
 * If tier provided, generates for all active trappers of that tier.
 * Returns list of { person_id, name, email, survey_url, already_completed }.
 */

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiError("Authentication required", 401);

  try {
    const body = await request.json().catch(() => ({}));
    const { person_ids, tier } = body as { person_ids?: string[]; tier?: string };

    if (!person_ids && !tier) {
      return apiBadRequest("Provide person_ids or tier (ffsc, community, all)");
    }

    // Build filter
    let whereClause: string;
    const params: unknown[] = [];

    if (person_ids?.length) {
      whereClause = `tp.person_id = ANY($1)`;
      params.push(person_ids);
    } else if (tier === "ffsc") {
      whereClause = `tp.trapper_type IN ('ffsc_volunteer', 'ffsc_staff')`;
    } else if (tier === "community") {
      whereClause = `tp.trapper_type = 'community_trapper'`;
    } else {
      whereClause = `1=1`;
    }

    const trappers = await queryRows<{
      person_id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      survey_token: string | null;
      survey_completed_at: string | null;
    }>(
      `SELECT tp.person_id, p.first_name, p.last_name,
              sot.get_email(tp.person_id) AS email,
              tp.survey_token, tp.survey_completed_at
       FROM sot.trapper_profiles tp
       JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
       WHERE tp.is_active = true AND ${whereClause}
       ORDER BY p.last_name, p.first_name`,
      params
    );

    const results: Array<{
      person_id: string;
      name: string;
      email: string | null;
      survey_url: string;
      already_completed: boolean;
    }> = [];

    for (const t of trappers) {
      let token = t.survey_token;

      // Generate token if doesn't exist
      if (!token) {
        token = randomBytes(16).toString("hex");
        await queryOne(
          `UPDATE sot.trapper_profiles SET survey_token = $1 WHERE person_id = $2`,
          [token, t.person_id]
        );
      }

      results.push({
        person_id: t.person_id,
        name: `${t.first_name} ${t.last_name}`,
        email: t.email,
        survey_url: `/trapper-survey/${token}`,
        already_completed: !!t.survey_completed_at,
      });
    }

    return apiSuccess({
      total: results.length,
      completed: results.filter((r) => r.already_completed).length,
      pending: results.filter((r) => !r.already_completed).length,
      trappers: results,
    });
  } catch (error) {
    console.error("[TRAPPER-SURVEY] Generate error:", error);
    return apiServerError("Failed to generate survey links");
  }
}
