import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

interface LegacyRequestRow {
  request_id: string;
  summary: string | null;
  status: string;
  priority: string;
  effective_request_date: string;
  place_name: string | null;
  place_address: string | null;
  requester_name: string | null;
  estimated_cat_count: number | null;
  cats_caught: number;
  cats_altered: number;
  already_altered_before: number;
  alteration_rate_pct: number | null;
  can_upgrade: boolean;
  upgrade_blocked_reason: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Build where clause
    const conditions: string[] = ["vas.is_legacy_request = TRUE"];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`vas.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    // Add limit and offset
    params.push(limit, offset);

    const sql = `
      SELECT
        vas.request_id,
        vas.summary,
        vas.status,
        r.priority,
        vas.effective_request_date,
        vas.place_name,
        vas.place_address,
        vas.requester_name,
        vas.estimated_cat_count,
        vas.cats_caught,
        vas.cats_altered,
        vas.already_altered_before,
        vas.alteration_rate_pct,
        vas.can_upgrade,
        CASE
          WHEN vas.status = 'cancelled' AND r.resolution_notes LIKE 'Upgraded to Atlas request%'
          THEN 'Already upgraded'
          WHEN vas.status = 'completed'
          THEN 'Request already completed'
          ELSE NULL
        END AS upgrade_blocked_reason
      FROM ops.v_request_alteration_stats vas
      JOIN ops.requests r ON r.request_id = vas.request_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY vas.effective_request_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM ops.v_request_alteration_stats vas
      WHERE ${conditions.join(" AND ")}
    `;

    const [requestsResult, countResult] = await Promise.all([
      query<LegacyRequestRow>(sql, params),
      query<{ total: string }>(countSql, params.slice(0, -2)),
    ]);

    const requests = requestsResult.rows;
    const total = parseInt(countResult.rows[0]?.total || "0");

    return NextResponse.json({
      requests: requests.map((r) => ({
        request_id: r.request_id,
        summary: r.summary,
        status: r.status,
        priority: r.priority,
        effective_request_date: r.effective_request_date,
        place_name: r.place_name,
        place_address: r.place_address,
        requester_name: r.requester_name,
        estimated_cat_count: r.estimated_cat_count,
        cats_caught: r.cats_caught,
        cats_altered: r.cats_altered,
        already_altered_before: r.already_altered_before,
        alteration_rate_pct: r.alteration_rate_pct,
        can_upgrade: r.can_upgrade,
        upgrade_blocked_reason: r.upgrade_blocked_reason,
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching legacy requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch legacy requests" },
      { status: 500 }
    );
  }
}
