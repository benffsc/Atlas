import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface VerifyRequest {
  table: string;
  record_id: string;
  staff_id?: string;
}

const ALLOWED_TABLES: Record<string, string> = {
  colony_estimates: "place_colony_estimates",
  birth_events: "cat_birth_events",
  mortality_events: "cat_mortality_events",
  vitals: "cat_vitals",
  requests: "sot_requests",
  places: "places",
  people: "sot_people",
  cats: "sot_cats",
};

const ID_COLUMNS: Record<string, string> = {
  place_colony_estimates: "estimate_id",
  cat_birth_events: "event_id",
  cat_mortality_events: "event_id",
  cat_vitals: "vital_id",
  sot_requests: "request_id",
  places: "place_id",
  sot_people: "person_id",
  sot_cats: "cat_id",
};

// POST - Mark a record as verified
export async function POST(request: NextRequest) {
  try {
    const body: VerifyRequest = await request.json();
    const { table, record_id, staff_id } = body;

    if (!table || !record_id) {
      return NextResponse.json(
        { error: "table and record_id are required" },
        { status: 400 }
      );
    }

    const tableName = ALLOWED_TABLES[table];
    if (!tableName) {
      return NextResponse.json(
        { error: `Invalid table: ${table}. Allowed: ${Object.keys(ALLOWED_TABLES).join(", ")}` },
        { status: 400 }
      );
    }

    const idColumn = ID_COLUMNS[tableName];

    // Determine staff_id - use provided or null (for now until auth is integrated)
    const staffIdValue = staff_id || null;

    // Update the record with verification timestamp
    const result = await queryOne<{ verified_at: string }>(
      `UPDATE trapper.${tableName}
       SET verified_at = NOW(),
           verified_by_staff_id = $1
       WHERE ${idColumn} = $2
       RETURNING verified_at`,
      [staffIdValue, record_id]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Record not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      verified_at: result.verified_at,
    });
  } catch (error) {
    console.error("Error verifying record:", error);
    return NextResponse.json(
      { error: "Failed to verify record" },
      { status: 500 }
    );
  }
}

// DELETE - Unverify a record (remove verification)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table");
    const record_id = searchParams.get("record_id");

    if (!table || !record_id) {
      return NextResponse.json(
        { error: "table and record_id are required" },
        { status: 400 }
      );
    }

    const tableName = ALLOWED_TABLES[table];
    if (!tableName) {
      return NextResponse.json(
        { error: `Invalid table: ${table}` },
        { status: 400 }
      );
    }

    const idColumn = ID_COLUMNS[tableName];

    // Clear verification
    const result = await queryOne<{ [key: string]: string }>(
      `UPDATE trapper.${tableName}
       SET verified_at = NULL,
           verified_by_staff_id = NULL
       WHERE ${idColumn} = $1
       RETURNING ${idColumn}`,
      [record_id]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Record not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unverifying record:", error);
    return NextResponse.json(
      { error: "Failed to unverify record" },
      { status: 500 }
    );
  }
}

// GET - Get verification status for records
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table");
    const record_ids = searchParams.get("record_ids"); // comma-separated

    if (!table) {
      // Return unverified counts summary
      const counts = await queryRows<{
        data_type: string;
        unverified_count: number;
        total_count: number;
        latest_created: string | null;
      }>(
        `SELECT
           'colony_estimates' AS data_type,
           COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
           COUNT(*) AS total_count,
           MAX(created_at) AS latest_created
         FROM sot.place_colony_estimates
         WHERE source_type = 'ai_parsed'

         UNION ALL

         SELECT
           'birth_events' AS data_type,
           COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
           COUNT(*) AS total_count,
           MAX(created_at) AS latest_created
         FROM sot.cat_birth_events
         WHERE source_type = 'ai_parsed'

         UNION ALL

         SELECT
           'mortality_events' AS data_type,
           COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
           COUNT(*) AS total_count,
           MAX(created_at) AS latest_created
         FROM sot.cat_mortality_events
         WHERE source_type = 'ai_parsed'

         UNION ALL

         SELECT
           'vitals' AS data_type,
           COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
           COUNT(*) AS total_count,
           MAX(created_at) AS latest_created
         FROM ops.cat_vitals
         WHERE source_type = 'ai_parsed'`
      );

      return NextResponse.json({ counts });
    }

    const tableName = ALLOWED_TABLES[table];
    if (!tableName) {
      return NextResponse.json(
        { error: `Invalid table: ${table}` },
        { status: 400 }
      );
    }

    const idColumn = ID_COLUMNS[tableName];

    if (record_ids) {
      // Get verification status for specific records
      const ids = record_ids.split(",").map((id) => id.trim());
      const records = await queryRows<{
        id: string;
        verified_at: string | null;
        verified_by_staff_id: string | null;
        staff_name: string | null;
      }>(
        `SELECT
           t.${idColumn} AS id,
           t.verified_at,
           t.verified_by_staff_id,
           s.display_name AS staff_name
         FROM trapper.${tableName} t
         LEFT JOIN ops.staff s ON t.verified_by_staff_id = s.staff_id
         WHERE t.${idColumn} = ANY($1::uuid[])`,
        [ids]
      );

      return NextResponse.json({ records });
    }

    // Return unverified records for this table
    const unverified = await queryRows<{
      id: string;
      created_at: string;
      source_type: string;
    }>(
      `SELECT
         ${idColumn} AS id,
         created_at,
         COALESCE(source_type, 'unknown') AS source_type
       FROM trapper.${tableName}
       WHERE verified_at IS NULL
       ORDER BY created_at DESC
       LIMIT 100`,
      []
    );

    return NextResponse.json({ unverified });
  } catch (error) {
    console.error("Error getting verification status:", error);
    return NextResponse.json(
      { error: "Failed to get verification status" },
      { status: 500 }
    );
  }
}
