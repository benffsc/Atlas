import { NextRequest, NextResponse } from "next/server";
import { queryRows, query, queryOne } from "@/lib/db";

interface JournalEntryRow {
  entry_id: string;
  content: string;
  entry_type: string;
  cat_id: string | null;
  person_id: string | null;
  place_id: string | null;
  appointment_id: string | null;
  created_by: string;
  created_at: string;
  observed_at: string | null;
  source_system: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const catId = searchParams.get("cat_id");
  const personId = searchParams.get("person_id");
  const placeId = searchParams.get("place_id");
  const appointmentId = searchParams.get("appointment_id");
  const entryType = searchParams.get("entry_type");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = ["NOT is_deleted"];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (catId) {
    conditions.push(`cat_id = $${paramIndex}`);
    params.push(catId);
    paramIndex++;
  }

  if (personId) {
    conditions.push(`person_id = $${paramIndex}`);
    params.push(personId);
    paramIndex++;
  }

  if (placeId) {
    conditions.push(`place_id = $${paramIndex}`);
    params.push(placeId);
    paramIndex++;
  }

  if (appointmentId) {
    conditions.push(`appointment_id = $${paramIndex}`);
    params.push(appointmentId);
    paramIndex++;
  }

  if (entryType) {
    conditions.push(`entry_type = $${paramIndex}::trapper.journal_entry_type`);
    params.push(entryType);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  try {
    const sql = `
      SELECT
        entry_id,
        content,
        entry_type::TEXT AS entry_type,
        cat_id,
        person_id,
        place_id,
        appointment_id,
        created_by,
        created_at,
        observed_at,
        source_system
      FROM trapper.journal_entries
      ${whereClause}
      ORDER BY COALESCE(observed_at, created_at) DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.journal_entries
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

interface CreateEntryBody {
  content: string;
  entry_type?: string;
  cat_id?: string;
  person_id?: string;
  place_id?: string;
  appointment_id?: string;
  observed_at?: string;
  created_by: string;
}

interface EntryRow {
  entry_id: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateEntryBody = await request.json();

    // Validation
    if (!body.content || body.content.trim() === "") {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 }
      );
    }

    if (!body.created_by) {
      return NextResponse.json(
        { error: "created_by is required" },
        { status: 400 }
      );
    }

    // At least one entity must be linked
    if (!body.cat_id && !body.person_id && !body.place_id && !body.appointment_id) {
      return NextResponse.json(
        { error: "At least one of cat_id, person_id, place_id, or appointment_id is required" },
        { status: 400 }
      );
    }

    const entryType = body.entry_type || "note";

    const result = await queryOne<EntryRow>(
      `INSERT INTO trapper.journal_entries (
        content,
        entry_type,
        cat_id,
        person_id,
        place_id,
        appointment_id,
        created_by,
        observed_at,
        source_system
      ) VALUES (
        $1,
        $2::trapper.journal_entry_type,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        'app'
      )
      RETURNING entry_id`,
      [
        body.content.trim(),
        entryType,
        body.cat_id || null,
        body.person_id || null,
        body.place_id || null,
        body.appointment_id || null,
        body.created_by,
        body.observed_at || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create journal entry" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      entry_id: result.entry_id,
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
