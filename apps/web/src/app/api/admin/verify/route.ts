import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import { apiSuccess } from "@/lib/api-response";
import { logFieldEdits, type EntityType } from "@/lib/audit";

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

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  colony_estimates: "place",
  birth_events: "cat",
  mortality_events: "cat",
  vitals: "cat",
  requests: "request",
  places: "place",
  people: "person",
  cats: "cat",
};

// POST - Mark a record as verified
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body: VerifyRequest = await request.json();
  const { table, record_id, staff_id } = body;

  if (!table || !record_id) {
    throw new ApiError("table and record_id are required", 400);
  }

  const tableName = ALLOWED_TABLES[table];
  if (!tableName) {
    throw new ApiError(`Invalid table: ${table}. Allowed: ${Object.keys(ALLOWED_TABLES).join(", ")}`, 400);
  }

  const idColumn = ID_COLUMNS[tableName];

  // Determine staff_id - use provided or null (for now until auth is integrated)
  const staffIdValue = staff_id || null;

  // Update the record with verification timestamp
  try {
    const result = await queryOne<{ verified_at: string }>(
      `UPDATE ${tableName}
       SET verified_at = NOW(),
           verified_by_staff_id = $1
       WHERE ${idColumn} = $2
       RETURNING verified_at`,
      [staffIdValue, record_id]
    );

    if (!result) {
      throw new ApiError("Record not found", 404);
    }

    // Audit trail for verification
    const entityType = ENTITY_TYPE_MAP[table];
    if (entityType) {
      await logFieldEdits(entityType, record_id, [
        { field: "verified_at", oldValue: null, newValue: result.verified_at },
        { field: "verified_by_staff_id", oldValue: null, newValue: staffIdValue },
      ], { editedBy: staffIdValue || "web_user", editSource: "web_ui", reason: "staff_verification" });
    }

    return apiSuccess({
      success: true,
      verified_at: result.verified_at,
    });
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    if (error?.code === '42P01') {
      throw new ApiError("Table not yet available", 501);
    }
    throw error;
  }
});

// DELETE - Unverify a record (remove verification)
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const record_id = searchParams.get("record_id");

  if (!table || !record_id) {
    throw new ApiError("table and record_id are required", 400);
  }

  const tableName = ALLOWED_TABLES[table];
  if (!tableName) {
    throw new ApiError(`Invalid table: ${table}`, 400);
  }

  const idColumn = ID_COLUMNS[tableName];

  try {
    // Fetch old values before clearing
    const oldValues = await queryOne<{ verified_at: string; verified_by_staff_id: string }>(
      `SELECT verified_at, verified_by_staff_id FROM ${tableName} WHERE ${idColumn} = $1`,
      [record_id]
    );

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
      throw new ApiError("Record not found", 404);
    }

    // Audit trail for unverification
    const entityType = ENTITY_TYPE_MAP[table];
    if (entityType) {
      await logFieldEdits(entityType, record_id, [
        { field: "verified_at", oldValue: oldValues?.verified_at ?? null, newValue: null },
        { field: "verified_by_staff_id", oldValue: oldValues?.verified_by_staff_id ?? null, newValue: null },
      ], { editedBy: "web_user", editSource: "web_ui", reason: "unverification" });
    }

    return apiSuccess({ success: true });
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    if (error?.code === '42P01') {
      throw new ApiError("Table not yet available", 501);
    }
    throw error;
  }
});

// GET - Get verification status for records
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const record_ids = searchParams.get("record_ids"); // comma-separated

  if (!table) {
    // Return unverified counts summary
    try {
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
           AND deleted_at IS NULL

         UNION ALL

         SELECT
           'mortality_events' AS data_type,
           COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified_count,
           COUNT(*) AS total_count,
           MAX(created_at) AS latest_created
         FROM sot.cat_mortality_events
         WHERE source_type = 'ai_parsed'
           AND deleted_at IS NULL

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
    } catch (error: any) {
      if (error?.code === '42P01') {
        // Table doesn't exist yet — return empty results
        return apiSuccess({ counts: [], unverified: [], records: [] });
      }
      throw error;
    }
  }

  const tableName = ALLOWED_TABLES[table];
  if (!tableName) {
    throw new ApiError(`Invalid table: ${table}`, 400);
  }

  const idColumn = ID_COLUMNS[tableName];

  if (record_ids) {
    // Get verification status for specific records
    const ids = record_ids.split(",").map((id) => id.trim());
    try {
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
    } catch (error: any) {
      if (error?.code === '42P01') {
        return apiSuccess({ counts: [], unverified: [], records: [] });
      }
      throw error;
    }
  }

  // Return unverified records for this table
  try {
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
      return apiSuccess({ counts: [], unverified: [], records: [] });
    }
    throw error;
  }
});
