import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface RequestListRow {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  scheduled_date: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  source_created_at: string | null;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_person_id: string | null;
  requester_name: string | null;
  linked_cat_count: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const placeId = searchParams.get("place_id");
  const personId = searchParams.get("person_id");
  const sortBy = searchParams.get("sort_by") || "status"; // status, created, priority
  const sortOrder = searchParams.get("sort_order") || "asc"; // asc, desc
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex}::trapper.request_status`);
    params.push(status);
    paramIndex++;
  }

  if (priority) {
    conditions.push(`priority = $${paramIndex}::trapper.request_priority`);
    params.push(priority);
    paramIndex++;
  }

  if (placeId) {
    conditions.push(`place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (personId) {
    conditions.push(`requester_person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Build ORDER BY clause based on sort parameters
  const buildOrderBy = () => {
    const dir = sortOrder === "desc" ? "DESC" : "ASC";
    const dirInverse = sortOrder === "desc" ? "ASC" : "DESC";

    switch (sortBy) {
      case "created":
        // Sort by original Airtable creation date (source_created_at)
        return `source_created_at ${dir} NULLS LAST, created_at ${dir}`;
      case "priority":
        return `
          CASE priority
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            WHEN 'low' THEN 4
          END ${dir},
          source_created_at DESC NULLS LAST
        `;
      case "status":
      default:
        // Default: status order, then by creation date
        return `
          CASE status
            WHEN 'new' THEN 1
            WHEN 'triaged' THEN 2
            WHEN 'scheduled' THEN 3
            WHEN 'in_progress' THEN 4
            WHEN 'on_hold' THEN 5
            WHEN 'completed' THEN 6
            WHEN 'cancelled' THEN 7
          END ${dir},
          source_created_at ${dirInverse} NULLS LAST
        `;
    }
  };

  try {
    const sql = `
      SELECT
        request_id,
        status,
        priority,
        summary,
        estimated_cat_count,
        has_kittens,
        scheduled_date,
        assigned_to,
        created_at,
        updated_at,
        source_created_at,
        place_id,
        place_name,
        place_address,
        place_city,
        requester_person_id,
        requester_name,
        linked_cat_count
      FROM trapper.v_request_list
      ${whereClause}
      ORDER BY ${buildOrderBy()}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const requests = await queryRows<RequestListRow>(sql, params);

    return NextResponse.json({
      requests,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch requests" },
      { status: 500 }
    );
  }
}

// Valid status and priority values
const VALID_STATUSES = ["new", "triaged", "scheduled", "in_progress", "completed", "cancelled", "on_hold"];
const VALID_PRIORITIES = ["urgent", "high", "normal", "low"];

interface CreateRequestBody {
  place_id?: string;
  requester_person_id?: string;
  summary?: string;
  notes?: string;
  estimated_cat_count?: number;
  has_kittens?: boolean;
  cats_are_friendly?: boolean;
  preferred_contact_method?: string;
  priority?: string;
  created_by?: string;
}

interface RequestIdRow {
  request_id: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateRequestBody = await request.json();

    // Validate priority if provided
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      return NextResponse.json(
        { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
        { status: 400 }
      );
    }

    // At minimum, we need a place or some way to identify where the request is
    if (!body.place_id && !body.summary) {
      return NextResponse.json(
        { error: "Either place_id or summary is required" },
        { status: 400 }
      );
    }

    const result = await queryOne<RequestIdRow>(
      `INSERT INTO trapper.sot_requests (
        place_id,
        requester_person_id,
        summary,
        notes,
        estimated_cat_count,
        has_kittens,
        cats_are_friendly,
        preferred_contact_method,
        priority,
        data_source,
        source_system,
        created_by
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        COALESCE($9, 'normal')::trapper.request_priority,
        'app',
        'app',
        $10
      )
      RETURNING request_id`,
      [
        body.place_id || null,
        body.requester_person_id || null,
        body.summary || null,
        body.notes || null,
        body.estimated_cat_count || null,
        body.has_kittens || false,
        body.cats_are_friendly ?? null,
        body.preferred_contact_method || null,
        body.priority || null,
        body.created_by || "app_user",
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create request" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      request_id: result.request_id,
      success: true,
    });
  } catch (error) {
    console.error("Error creating request:", error);
    return NextResponse.json(
      { error: "Failed to create request" },
      { status: 500 }
    );
  }
}
