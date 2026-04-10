import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const orgId = request.nextUrl.searchParams.get("org_id");
    const status = request.nextUrl.searchParams.get("status");
    const priority = request.nextUrl.searchParams.get("priority");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (orgId) {
      conditions.push(`pa.partner_org_id = $${idx}`);
      params.push(orgId);
      idx++;
    }
    if (status && status !== "all") {
      conditions.push(`pa.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (priority && priority !== "all") {
      conditions.push(`pa.priority = $${idx}`);
      params.push(priority);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const animals = await queryRows<Record<string, unknown>>(
      `SELECT
        pa.*,
        po.name AS org_name,
        po.short_name AS org_short_name
      FROM ops.partner_animals pa
      JOIN ops.partner_orgs po ON po.id = pa.partner_org_id
      ${where}
      ORDER BY
        CASE pa.priority
          WHEN 'Yellow' THEN 1
          WHEN 'Blue' THEN 2
          WHEN 'Red' THEN 3
          WHEN 'Pink' THEN 4
          ELSE 5
        END,
        CASE pa.status
          WHEN 'needed' THEN 1
          WHEN 'scheduled' THEN 2
          WHEN 'foster_handling' THEN 3
          WHEN 'already_done' THEN 4
          WHEN 'completed' THEN 5
          ELSE 6
        END,
        pa.name NULLS LAST`,
      params
    );

    // Summary stats
    const stats = await queryOne<{
      total: number;
      needed: number;
      scheduled: number;
      completed: number;
      already_done: number;
      foster_handling: number;
      red: number;
      blue: number;
      yellow: number;
      pink: number;
    }>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'needed')::int AS needed,
        COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'already_done')::int AS already_done,
        COUNT(*) FILTER (WHERE status = 'foster_handling')::int AS foster_handling,
        COUNT(*) FILTER (WHERE priority = 'Red')::int AS red,
        COUNT(*) FILTER (WHERE priority = 'Blue')::int AS blue,
        COUNT(*) FILTER (WHERE priority = 'Yellow')::int AS yellow,
        COUNT(*) FILTER (WHERE priority = 'Pink')::int AS pink
      FROM ops.partner_animals pa
      ${orgId ? "WHERE pa.partner_org_id = $1" : ""}`,
      orgId ? [orgId] : []
    );

    // Org list for filter
    const orgs = await queryRows<{ id: string; name: string; short_name: string; animal_count: number }>(
      `SELECT po.id, po.name, po.short_name,
        (SELECT COUNT(*)::int FROM ops.partner_animals pa WHERE pa.partner_org_id = po.id) AS animal_count
      FROM ops.partner_orgs po WHERE po.is_active = TRUE
      ORDER BY po.name`
    );

    return apiSuccess({ animals, stats, orgs });
  } catch (error) {
    console.error("[PARTNER-ANIMALS] Error:", error);
    return apiServerError("Failed to fetch partner animals");
  }
}
