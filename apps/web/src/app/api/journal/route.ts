import { NextRequest, NextResponse } from "next/server";
import { queryRows, query, queryOne } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Validate UUID format
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Modern journal entry schema (MIG_140 + MIG_244 + MIG_276)
interface JournalEntryRow {
  id: string;
  entry_kind: string;
  title: string | null;
  body: string;
  primary_cat_id: string | null;
  primary_person_id: string | null;
  primary_place_id: string | null;
  primary_request_id: string | null;
  primary_submission_id: string | null;
  primary_annotation_id: string | null;
  contact_method: string | null;
  contact_result: string | null;
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
  submission_name?: string;
  annotation_label?: string;
  created_by_staff_name?: string;
  created_by_staff_role?: string;
  cross_ref_source?: string | null;
}

// ── Cross-entity journal linking ──
// When include_related=true, also fetch journal entries from linked entities
// within a 2-month attribution window (or while request is open).
const ENTITY_NAME_JOINS = `
  LEFT JOIN trapper.sot_cats c ON c.cat_id = d.primary_cat_id
  LEFT JOIN trapper.sot_people p ON p.person_id = d.primary_person_id
  LEFT JOIN trapper.places pl ON pl.place_id = d.primary_place_id
  LEFT JOIN trapper.web_intake_submissions sub ON sub.submission_id = d.primary_submission_id
  LEFT JOIN trapper.map_annotations ma ON ma.annotation_id = d.primary_annotation_id
  LEFT JOIN trapper.staff s ON s.staff_id = d.created_by_staff_id
`;

const ENTITY_NAME_COLS = `
  c.display_name AS cat_name,
  p.display_name AS person_name,
  pl.display_name AS place_name,
  sub.first_name || ' ' || sub.last_name AS submission_name,
  ma.label AS annotation_label,
  s.display_name AS created_by_staff_name,
  s.role AS created_by_staff_role
`;

const WINDOW_CONDITION = `
  AND (r.resolved_at IS NULL
    OR COALESCE(je.occurred_at, je.created_at)
       BETWEEN COALESCE(r.source_created_at, r.created_at) - INTERVAL '2 months'
       AND COALESCE(r.resolved_at, NOW()) + INTERVAL '2 months')`;

function buildCrossRefQuery(
  entityType: "request" | "person" | "cat",
  entityId: string,
  includeArchived: boolean,
  entryKind: string | null,
  limit: number,
  offset: number,
): { sql: string; countSql: string; params: unknown[] } {
  const archivedFilter = includeArchived ? "" : "AND je.is_archived = FALSE";
  const crossRefArchived = "AND je.is_archived = FALSE";
  const noQuickNotes = "AND NOT (je.tags @> ARRAY['quick_note'])";

  const params: unknown[] = [entityId];
  let paramIdx = 2;
  let kindFilter = "";
  if (entryKind) {
    kindFilter = `AND je.entry_kind = $${paramIdx}::trapper.journal_entry_kind`;
    params.push(entryKind);
    paramIdx++;
  }

  const unions: string[] = [];

  if (entityType === "request") {
    // Direct entries on this request
    unions.push(`
      SELECT je.*, NULL::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      WHERE je.primary_request_id = $1 ${archivedFilter} ${kindFilter}
    `);
    // Requester person's entries
    unions.push(`
      SELECT je.*, 'person'::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      JOIN trapper.sot_requests r ON r.request_id = $1
      WHERE je.primary_person_id = r.requester_person_id
        AND r.requester_person_id IS NOT NULL
        AND je.primary_request_id IS DISTINCT FROM $1
        ${crossRefArchived} ${noQuickNotes} ${kindFilter} ${WINDOW_CONDITION}
    `);
    // Linked cats' entries
    unions.push(`
      SELECT je.*, 'cat'::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      JOIN trapper.request_cat_links rcl ON rcl.cat_id = je.primary_cat_id
      JOIN trapper.sot_requests r ON r.request_id = $1
      WHERE rcl.request_id = $1
        AND je.primary_request_id IS DISTINCT FROM $1
        ${crossRefArchived} ${noQuickNotes} ${kindFilter} ${WINDOW_CONDITION}
    `);
    // Place entries
    unions.push(`
      SELECT je.*, 'place'::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      JOIN trapper.sot_requests r ON r.request_id = $1
      WHERE je.primary_place_id = r.place_id
        AND r.place_id IS NOT NULL
        AND je.primary_request_id IS DISTINCT FROM $1
        ${crossRefArchived} ${noQuickNotes} ${kindFilter} ${WINDOW_CONDITION}
    `);
  } else if (entityType === "person") {
    // Direct entries on this person
    unions.push(`
      SELECT je.*, NULL::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      WHERE je.primary_person_id = $1 ${archivedFilter} ${kindFilter}
    `);
    // Request entries where person is requester
    unions.push(`
      SELECT je.*, 'request'::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      JOIN trapper.sot_requests r ON r.request_id = je.primary_request_id
      WHERE r.requester_person_id = $1
        AND je.primary_person_id IS DISTINCT FROM $1
        ${crossRefArchived} ${noQuickNotes} ${kindFilter} ${WINDOW_CONDITION}
    `);
  } else {
    // cat
    // Direct entries on this cat
    unions.push(`
      SELECT je.*, NULL::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      WHERE je.primary_cat_id = $1 ${archivedFilter} ${kindFilter}
    `);
    // Request entries from linked requests
    unions.push(`
      SELECT je.*, 'request'::TEXT AS cross_ref_source
      FROM trapper.journal_entries je
      JOIN trapper.request_cat_links rcl ON rcl.request_id = je.primary_request_id
      JOIN trapper.sot_requests r ON r.request_id = rcl.request_id
      WHERE rcl.cat_id = $1
        AND je.primary_cat_id IS DISTINCT FROM $1
        ${crossRefArchived} ${noQuickNotes} ${kindFilter} ${WINDOW_CONDITION}
    `);
  }

  const unionSql = unions.join("\nUNION ALL\n");

  params.push(limit, offset);

  const sql = `
    WITH all_entries AS (${unionSql}),
    deduped AS (
      SELECT DISTINCT ON (id) *
      FROM all_entries
      ORDER BY id, cross_ref_source NULLS FIRST
    )
    SELECT
      d.id,
      d.entry_kind::TEXT AS entry_kind,
      d.title,
      d.body,
      d.primary_cat_id,
      d.primary_person_id,
      d.primary_place_id,
      d.primary_request_id,
      d.primary_submission_id,
      d.primary_annotation_id,
      d.contact_method,
      d.contact_result,
      d.created_by,
      d.created_by_staff_id,
      d.created_at,
      d.updated_by,
      d.updated_by_staff_id,
      d.updated_at,
      d.occurred_at,
      d.is_archived,
      d.is_pinned,
      d.edit_count,
      d.tags,
      d.cross_ref_source,
      ${ENTITY_NAME_COLS}
    FROM deduped d
    ${ENTITY_NAME_JOINS}
    ORDER BY d.is_pinned DESC, COALESCE(d.occurred_at, d.created_at) DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;

  const countSql = `
    WITH all_entries AS (${unionSql}),
    deduped AS (
      SELECT DISTINCT ON (id) *
      FROM all_entries
      ORDER BY id, cross_ref_source NULLS FIRST
    )
    SELECT COUNT(*) as total FROM deduped
  `;

  return { sql, countSql, params };
}

// GET /api/journal - Fetch journal entries
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const catId = searchParams.get("cat_id");
  const personId = searchParams.get("person_id");
  const placeId = searchParams.get("place_id");
  const requestId = searchParams.get("request_id");
  const submissionId = searchParams.get("submission_id");
  const annotationId = searchParams.get("annotation_id");
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
    if (!isValidUUID(catId)) {
      return NextResponse.json({ entries: [], total: 0 });
    }
    conditions.push(`je.primary_cat_id = $${paramIndex}`);
    params.push(catId);
    paramIndex++;
  }

  if (personId) {
    if (!isValidUUID(personId)) {
      return NextResponse.json({ entries: [], total: 0 });
    }
    conditions.push(`je.primary_person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  if (placeId) {
    if (!isValidUUID(placeId)) {
      return NextResponse.json({ entries: [], total: 0 });
    }
    conditions.push(`je.primary_place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (requestId) {
    if (!isValidUUID(requestId)) {
      return NextResponse.json({ entries: [], total: 0 });
    }
    conditions.push(`je.primary_request_id = $${paramIndex}`);
    params.push(requestId);
    paramIndex++;
  }

  if (submissionId) {
    if (!isValidUUID(submissionId)) {
      return NextResponse.json({ entries: [], total: 0 });
    }
    conditions.push(`je.primary_submission_id = $${paramIndex}`);
    params.push(submissionId);
    paramIndex++;
  }

  if (annotationId) {
    if (!isValidUUID(annotationId)) {
      return NextResponse.json({ entries: [], total: 0 });
    }
    conditions.push(`je.primary_annotation_id = $${paramIndex}`);
    params.push(annotationId);
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
        je.primary_submission_id,
        je.primary_annotation_id,
        je.contact_method,
        je.contact_result,
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
        sub.first_name || ' ' || sub.last_name AS submission_name,
        ma.label AS annotation_label,
        s.display_name AS created_by_staff_name,
        s.role AS created_by_staff_role
      FROM trapper.journal_entries je
      LEFT JOIN trapper.sot_cats c ON c.cat_id = je.primary_cat_id
      LEFT JOIN trapper.sot_people p ON p.person_id = je.primary_person_id
      LEFT JOIN trapper.places pl ON pl.place_id = je.primary_place_id
      LEFT JOIN trapper.web_intake_submissions sub ON sub.submission_id = je.primary_submission_id
      LEFT JOIN trapper.map_annotations ma ON ma.annotation_id = je.primary_annotation_id
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
  submission_id?: string;
  annotation_id?: string;
  // Contact attempt fields (for entry_kind = 'contact_attempt')
  contact_method?: string;
  contact_result?: string;
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
    if (!data.cat_id && !data.person_id && !data.place_id && !data.request_id && !data.submission_id && !data.annotation_id) {
      return NextResponse.json(
        { error: "At least one of cat_id, person_id, place_id, request_id, submission_id, or annotation_id is required" },
        { status: 400 }
      );
    }

    const entryKind = data.entry_kind || "note";
    const user = getCurrentUser(request);
    const createdBy = data.created_by || user.displayName;
    const createdByStaffId = data.created_by_staff_id || user.staffId;

    const result = await queryOne<{ id: string }>(
      `INSERT INTO trapper.journal_entries (
        body,
        entry_kind,
        title,
        primary_cat_id,
        primary_person_id,
        primary_place_id,
        primary_request_id,
        primary_submission_id,
        primary_annotation_id,
        contact_method,
        contact_result,
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
        $11,
        $12,
        $13,
        $14,
        $15
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
        data.submission_id || null,
        data.annotation_id || null,
        data.contact_method || null,
        data.contact_result || null,
        createdBy,
        createdByStaffId,
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

    // If this is a contact_attempt on a submission, update the denormalized contact fields
    if (data.submission_id && entryKind === "contact_attempt") {
      await query(
        `UPDATE trapper.web_intake_submissions
         SET
           last_contacted_at = COALESCE($2, NOW()),
           last_contact_method = $3,
           contact_attempt_count = COALESCE(contact_attempt_count, 0) + 1,
           updated_at = NOW()
         WHERE submission_id = $1`,
        [
          data.submission_id,
          data.occurred_at || null,
          data.contact_method || null,
        ]
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
