import { NextRequest, NextResponse } from "next/server";
import { queryRows, query, queryOne } from "@/lib/db";

// Modern journal entry schema (MIG_140 + MIG_244)
interface JournalEntryRow {
  id: string;
  entry_kind: string;
  title: string | null;
  body: string;
  primary_cat_id: string | null;
  primary_person_id: string | null;
  primary_place_id: string | null;
  primary_request_id: string | null;
  created_by: string | null;
  created_by_staff_id: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_staff_id: string | null;
  updated_at: string;
  occurred_at: string | null;
  is_archived: boolean;
  is_pinned: boolean;
  edit_count: number;
  tags: string[];
  // Joined fields
  cat_name?: string;
  person_name?: string;
  place_name?: string;
  created_by_staff_name?: string;
  created_by_staff_role?: string;
}

// GET /api/journal - Fetch journal entries
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const catId = searchParams.get("cat_id");
  const personId = searchParams.get("person_id");
  const placeId = searchParams.get("place_id");
  const requestId = searchParams.get("request_id");
  const entryKind = searchParams.get("entry_kind");
  const includeArchived = searchParams.get("include_archived") === "true";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Filter by archived status
  if (!includeArchived) {
    conditions.push("je.is_archived = FALSE");
  }

  if (catId) {
    conditions.push(`je.primary_cat_id = $${paramIndex}`);
    params.push(catId);
    paramIndex++;
  }

  if (personId) {
    conditions.push(`je.primary_person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  if (placeId) {
    conditions.push(`je.primary_place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (requestId) {
    conditions.push(`je.primary_request_id = $${paramIndex}`);
    params.push(requestId);
    paramIndex++;
  }

  if (entryKind) {
    conditions.push(`je.entry_kind = $${paramIndex}::trapper.journal_entry_kind`);
    params.push(entryKind);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const sql = `
      SELECT
        je.id,
        je.entry_kind::TEXT AS entry_kind,
        je.title,
        je.body,
        je.primary_cat_id,
        je.primary_person_id,
        je.primary_place_id,
        je.primary_request_id,
        je.created_by,
        je.created_by_staff_id,
        je.created_at,
        je.updated_by,
        je.updated_by_staff_id,
        je.updated_at,
        je.occurred_at,
        je.is_archived,
        je.is_pinned,
        je.edit_count,
        je.tags,
        c.display_name AS cat_name,
        p.display_name AS person_name,
        pl.display_name AS place_name,
        s.display_name AS created_by_staff_name,
        s.role AS created_by_staff_role
      FROM trapper.journal_entries je
      LEFT JOIN trapper.sot_cats c ON c.cat_id = je.primary_cat_id
      LEFT JOIN trapper.sot_people p ON p.person_id = je.primary_person_id
      LEFT JOIN trapper.places pl ON pl.place_id = je.primary_place_id
      LEFT JOIN trapper.staff s ON s.staff_id = je.created_by_staff_id
      ${whereClause}
      ORDER BY je.is_pinned DESC, COALESCE(je.occurred_at, je.created_at) DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.journal_entries je
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<JournalEntryRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      entries: dataResult,
      total: parseInt(countResult.rows[0]?.total || "0", 10),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching journal entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch journal entries" },
      { status: 500 }
    );
  }
}

// POST /api/journal - Create a new journal entry
interface CreateEntryBody {
  body: string;
  entry_kind?: string;
  title?: string;
  cat_id?: string;
  person_id?: string;
  place_id?: string;
  request_id?: string;
  occurred_at?: string;
  created_by?: string;
  created_by_staff_id?: string;
  tags?: string[];
}

interface UpdateEntryBody {
  body?: string;
  title?: string;
  occurred_at?: string;
  is_pinned?: boolean;
  is_archived?: boolean;
  updated_by?: string;
  updated_by_staff_id?: string;
  tags?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const data: CreateEntryBody = await request.json();

    // Validation
    if (!data.body || data.body.trim() === "") {
      return NextResponse.json(
        { error: "body is required" },
        { status: 400 }
      );
    }

    // At least one entity must be linked
    if (!data.cat_id && !data.person_id && !data.place_id && !data.request_id) {
      return NextResponse.json(
        { error: "At least one of cat_id, person_id, place_id, or request_id is required" },
        { status: 400 }
      );
    }

    const entryKind = data.entry_kind || "note";
    const createdBy = data.created_by || "app_user"; // TODO: Get from auth context

    const result = await queryOne<{ id: string }>(
      `INSERT INTO trapper.journal_entries (
        body,
        entry_kind,
        title,
        primary_cat_id,
        primary_person_id,
        primary_place_id,
        primary_request_id,
        created_by,
        created_by_staff_id,
        occurred_at,
        tags
      ) VALUES (
        $1,
        $2::trapper.journal_entry_kind,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11
      )
      RETURNING id`,
      [
        data.body.trim(),
        entryKind,
        data.title?.trim() || null,
        data.cat_id || null,
        data.person_id || null,
        data.place_id || null,
        data.request_id || null,
        createdBy,
        data.created_by_staff_id || null,
        data.occurred_at || null,
        data.tags || [],
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create journal entry" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: result.id,
      success: true,
    });
  } catch (error) {
    console.error("Error creating journal entry:", error);
    return NextResponse.json(
      { error: "Failed to create journal entry" },
      { status: 500 }
    );
  }
}

// PATCH /api/journal - Update a journal entry
export async function PATCH(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "id parameter is required" },
      { status: 400 }
    );
  }

  try {
    const data: UpdateEntryBody = await request.json();

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (data.body !== undefined) {
      setClauses.push(`body = $${paramIndex}`);
      params.push(data.body.trim());
      paramIndex++;
    }

    if (data.title !== undefined) {
      setClauses.push(`title = $${paramIndex}`);
      params.push(data.title?.trim() || null);
      paramIndex++;
    }

    if (data.occurred_at !== undefined) {
      setClauses.push(`occurred_at = $${paramIndex}`);
      params.push(data.occurred_at || null);
      paramIndex++;
    }

    if (data.is_pinned !== undefined) {
      setClauses.push(`is_pinned = $${paramIndex}`);
      params.push(data.is_pinned);
      paramIndex++;
    }

    if (data.is_archived !== undefined) {
      setClauses.push(`is_archived = $${paramIndex}`);
      params.push(data.is_archived);
      paramIndex++;
    }

    if (data.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex}`);
      params.push(data.tags);
      paramIndex++;
    }

    // Always update these on edit
    setClauses.push(`updated_at = NOW()`);
    setClauses.push(`edit_count = edit_count + 1`);

    if (data.updated_by) {
      setClauses.push(`updated_by = $${paramIndex}`);
      params.push(data.updated_by);
      paramIndex++;
    }

    if (data.updated_by_staff_id) {
      setClauses.push(`updated_by_staff_id = $${paramIndex}`);
      params.push(data.updated_by_staff_id);
      paramIndex++;
    }

    if (setClauses.length === 2) {
      // Only updated_at and edit_count, no actual changes
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    params.push(id);

    const result = await queryOne<{ id: string }>(
      `UPDATE trapper.journal_entries
       SET ${setClauses.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING id`,
      params
    );

    if (!result) {
      return NextResponse.json(
        { error: "Journal entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ id: result.id, success: true });
  } catch (error) {
    console.error("Error updating journal entry:", error);
    return NextResponse.json(
      { error: "Failed to update journal entry" },
      { status: 500 }
    );
  }
}
