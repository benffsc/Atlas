import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";

interface VerifyRequest {
  table: string;
  record_id: string;
  staff_id?: string;
}

const ALLOWED_TABLES: Record<string, string> = {
  colony_estimates: "sot.place_colony_estimates",
  birth_events: "sot.cat_birth_events",
  mortality_events: "sot.cat_mortality_events",
  vitals: "sot.cat_vitals",
  requests: "ops.requests",
  places: "sot.places",
  people: "sot.people",
  cats: "sot.cats",
};

const ID_COLUMNS: Record<string, string> = {
  "sot.place_colony_estimates": "estimate_id",
  "sot.cat_birth_events": "event_id",
  "sot.cat_mortality_events": "event_id",
  "sot.cat_vitals": "vital_id",
  "ops.requests": "request_id",
  "sot.places": "place_id",
  "sot.people": "person_id",
  "sot.cats": "cat_id",
};

// POST - Mark a record as verified
export async function POST(request: NextRequest) {
  try {
    const body: VerifyRequest = await request.json();
    const { table, record_id, staff_id } = body;

    if (!table || !record_id) {
      return apiError("table and record_id are required", 400);
    }

    const tableName = ALLOWED_TABLES[table];
    if (!tableName) {
      return apiError(`Invalid table: ${table}. Allowed: ${Object.keys(ALLOWED_TABLES).join(", ")}`, 400);
    }

    const idColumn = ID_COLUMNS[tableName];

    // Determine staff_id - use provided or null (for now until auth is integrated)
    const staffIdValue = staff_id || null;

    // Update the record with verification timestamp
    const result = await queryOne<{ verified_at: string }>(
      `UPDATE ${tableName}
       SET verified_at = NOW(),
           verified_by_staff_id = $1
       WHERE ${idColumn} = $2
       RETURNING verified_at`,
      [staffIdValue, record_id]
    );

    if (!result) {
      return apiError("Record not found", 404);
    }

    return apiSuccess({
      success: true,
      verified_at: result.verified_at,
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      // Table doesn't exist yet
      return apiError("Table not yet available", 501);
    }
    console.error("Error verifying record:", error);
    return apiError("Failed to verify record", 500);
  }
}

// DELETE - Unverify a record (remove verification)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table");
    const record_id = searchParams.get("record_id");

    if (!table || !record_id) {
      return apiError("table and record_id are required", 400);
    }

    const tableName = ALLOWED_TABLES[table];
    if (!tableName) {
      return apiError(`Invalid table: ${table}`, 400);
    }

    const idColumn = ID_COLUMNS[tableName];

    // Clear verification
    const result = await queryOne<{ [key: string]: string }>(
      `UPDATE ${tableName}
       SET verified_at = NULL,
           verified_by_staff_id = NULL
       WHERE ${idColumn} = $1
       RETURNING ${idColumn}`,
      [record_id]
    );

    if (!result) {
      return apiError("Record not found", 404);
    }

    return apiSuccess({ success: true });
  } catch (error: any) {
    if (error?.code === '42P01') {
      // Table doesn't exist yet
      return apiError("Table not yet available", 501);
    }
    console.error("Error unverifying record:", error);
    return apiError("Failed to unverify record", 500);
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

      return apiSuccess({ counts });
    }

    const tableName = ALLOWED_TABLES[table];
    if (!tableName) {
      return apiError(`Invalid table: ${table}`, 400);
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
         FROM ${tableName} t
         LEFT JOIN ops.staff s ON t.verified_by_staff_id = s.staff_id
         WHERE t.${idColumn} = ANY($1::uuid[])`,
        [ids]
      );

      return apiSuccess({ records });
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
       FROM ${tableName}
       WHERE verified_at IS NULL
       ORDER BY created_at DESC
       LIMIT 100`,
      []
    );

    return apiSuccess({ unverified });
  } catch (error: any) {
    if (error?.code === '42P01') {
      // Table doesn't exist yet — return empty results
      return apiSuccess({ counts: [], unverified: [], records: [] });
    }
    console.error("Error getting verification status:", error);
    return apiError("Failed to get verification status", 500);
  }
}
