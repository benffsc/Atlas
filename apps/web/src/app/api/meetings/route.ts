import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { parsePagination } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

// GET /api/meetings — list meetings
export async function GET(request: NextRequest) {
  try {
    const { limit, offset } = parsePagination(request.nextUrl.searchParams);
    const status = request.nextUrl.searchParams.get("status");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (status && status !== "all") {
      conditions.push(`m.status = $${paramIdx++}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ops.trapper_meetings m ${where}`,
      params
    );

    const meetings = await queryRows<{
      meeting_id: string;
      title: string;
      meeting_date: string | null;
      status: string;
      description: string | null;
      slide_count: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT m.meeting_id, m.title, m.meeting_date, m.status, m.description,
              (SELECT COUNT(*)::int FROM ops.meeting_slides s WHERE s.meeting_id = m.meeting_id) AS slide_count,
              m.created_at, m.updated_at
       FROM ops.trapper_meetings m
       ${where}
       ORDER BY COALESCE(m.meeting_date, m.created_at) DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    return apiSuccess(
      { meetings },
      { total: countResult?.count ?? 0, limit, offset }
    );
  } catch (error) {
    console.error("[meetings] GET error:", error);
    return apiServerError("Failed to list meetings");
  }
}

// POST /api/meetings — create meeting
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, meeting_date, description } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return apiBadRequest("title is required");
    }

    const meeting = await queryOne<{
      meeting_id: string;
      title: string;
      meeting_date: string | null;
      status: string;
      description: string | null;
      created_at: string;
    }>(
      `INSERT INTO ops.trapper_meetings (title, meeting_date, description)
       VALUES ($1, $2, $3)
       RETURNING meeting_id, title, meeting_date, status, description, created_at`,
      [title.trim(), meeting_date || null, description || null]
    );

    return apiSuccess({ meeting }, { status: 201 });
  } catch (error) {
    console.error("[meetings] POST error:", error);
    return apiServerError("Failed to create meeting");
  }
}
