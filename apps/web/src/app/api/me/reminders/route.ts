import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

interface Reminder {
  reminder_id: string;
  title: string;
  notes: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_display: string | null;
  due_at: string;
  remind_at: string;
  status: string;
  snooze_count: number;
  created_at: string;
}

/**
 * GET /api/me/reminders
 *
 * List current staff member's reminders
 * Query params: status (pending|due|snoozed|completed|archived|all)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "pending";

    let statusFilter = "";
    if (status === "all") {
      statusFilter = ""; // No filter
    } else if (status === "active") {
      statusFilter = "AND status IN ('pending', 'due', 'snoozed')";
    } else {
      statusFilter = `AND status = '${status}'`;
    }

    const reminders = await queryRows<Reminder>(
      `SELECT
        r.reminder_id,
        r.title,
        r.notes,
        r.entity_type,
        r.entity_id,
        r.due_at,
        r.remind_at,
        r.status,
        r.snooze_count,
        r.created_at,
        CASE
          WHEN r.entity_type = 'place' THEN (
            SELECT p.display_name FROM trapper.places p WHERE p.place_id = r.entity_id
          )
          WHEN r.entity_type = 'cat' THEN (
            SELECT c.display_name FROM trapper.sot_cats c WHERE c.cat_id = r.entity_id
          )
          WHEN r.entity_type = 'person' THEN (
            SELECT per.display_name FROM trapper.sot_people per WHERE per.person_id = r.entity_id
          )
          WHEN r.entity_type = 'request' THEN (
            SELECT req.summary FROM trapper.sot_requests req WHERE req.request_id = r.entity_id
          )
          ELSE NULL
        END as entity_display
      FROM trapper.staff_reminders r
      WHERE r.staff_id = $1
        ${statusFilter}
      ORDER BY
        CASE r.status
          WHEN 'due' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'snoozed' THEN 3
          ELSE 4
        END,
        r.remind_at ASC`,
      [session.staff_id]
    );

    return NextResponse.json({ reminders });
  } catch (error) {
    console.error("Error fetching reminders:", error);
    return NextResponse.json(
      { error: "Failed to fetch reminders" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/me/reminders
 *
 * Create a new reminder from dashboard (alternative to Tippy)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, notes, due_at, entity_type, entity_id } = body;

    if (!title || !due_at) {
      return NextResponse.json(
        { error: "Title and due_at are required" },
        { status: 400 }
      );
    }

    const result = await queryOne<{ reminder_id: string }>(
      `INSERT INTO trapper.staff_reminders (
        staff_id, title, notes, entity_type, entity_id,
        due_at, remind_at, created_via
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $6, 'dashboard'
      )
      RETURNING reminder_id`,
      [
        session.staff_id,
        title,
        notes || null,
        entity_type || null,
        entity_id || null,
        due_at,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create reminder" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      reminder_id: result.reminder_id,
    });
  } catch (error) {
    console.error("Error creating reminder:", error);
    return NextResponse.json(
      { error: "Failed to create reminder" },
      { status: 500 }
    );
  }
}
