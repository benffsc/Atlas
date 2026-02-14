import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "unresolved";
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Build status filter
    const statusFilter =
      status === "all"
        ? ""
        : "WHERE q.resolution_status = $1";
    const params = status === "all" ? [] : [status];

    // Get questions
    const questions = await queryRows(
      `
      SELECT
        q.question_id::text,
        q.question_text,
        q.normalized_question,
        q.reason,
        q.attempted_tools,
        q.error_details,
        q.response_given,
        q.occurrence_count,
        q.first_asked_at,
        q.last_asked_at,
        q.resolution_status,
        q.resolution_notes,
        q.related_view,
        q.resolved_at,
        -- Staff info
        s.display_name as asked_by_name,
        rs.display_name as resolved_by_name,
        -- Priority score
        (q.occurrence_count * 10 +
         CASE q.reason
           WHEN 'no_view' THEN 5
           WHEN 'no_data' THEN 4
           WHEN 'tool_failed' THEN 3
           WHEN 'complex_query' THEN 2
           ELSE 1
         END +
         CASE WHEN q.last_asked_at > NOW() - INTERVAL '7 days' THEN 5 ELSE 0 END
        ) as priority_score
      FROM ops.tippy_capability_gaps q
      LEFT JOIN ops.staff s ON s.staff_id = q.staff_id
      LEFT JOIN ops.staff rs ON rs.staff_id = q.resolved_by
      ${statusFilter}
      ORDER BY
        CASE q.resolution_status WHEN 'unresolved' THEN 0 ELSE 1 END,
        (q.occurrence_count * 10 +
         CASE q.reason WHEN 'no_view' THEN 5 WHEN 'no_data' THEN 4 ELSE 1 END +
         CASE WHEN q.last_asked_at > NOW() - INTERVAL '7 days' THEN 5 ELSE 0 END
        ) DESC,
        q.last_asked_at DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      params
    );

    // Get stats
    const stats = await queryOne<{
      unresolved: string;
      view_created: string;
      data_added: string;
      out_of_scope: string;
      total: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE resolution_status = 'unresolved') as unresolved,
        COUNT(*) FILTER (WHERE resolution_status = 'view_created') as view_created,
        COUNT(*) FILTER (WHERE resolution_status = 'data_added') as data_added,
        COUNT(*) FILTER (WHERE resolution_status = 'out_of_scope') as out_of_scope,
        COUNT(*) as total
      FROM ops.tippy_capability_gaps
      `
    );

    return NextResponse.json({
      questions,
      stats: stats
        ? {
            unresolved: parseInt(stats.unresolved),
            view_created: parseInt(stats.view_created),
            data_added: parseInt(stats.data_added),
            out_of_scope: parseInt(stats.out_of_scope),
            total: parseInt(stats.total),
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching questions:", error);
    return NextResponse.json(
      { error: "Failed to fetch questions" },
      { status: 500 }
    );
  }
}
