import { NextRequest } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { logFieldEdit } from "@/lib/audit";
import { validatePersonName } from "@/lib/validation";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest, apiConflict } from "@/lib/api-response";

interface AliasRow {
  alias_id: string;
  name_raw: string;
  name_key: string;
  source_system: string | null;
  source_table: string | null;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const aliases = await queryRows<AliasRow>(
      `SELECT alias_id, name_raw, name_key, source_system, source_table, created_at::text
       FROM sot.person_aliases
       WHERE person_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    return apiSuccess({ aliases });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching aliases:", error);
    return apiServerError("Failed to fetch aliases");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const body = await request.json();
    const name = body.name?.trim();

    if (!name) {
      return apiBadRequest("Name is required");
    }

    const validation = validatePersonName(name);
    if (!validation.valid) {
      return apiBadRequest(validation.error || "Invalid name");
    }

    // Verify person exists
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people WHERE person_id = $1`,
      [id]
    );
    if (!person) {
      return apiNotFound("Person", id);
    }

    // Compute name_key and check for duplicates
    const nameKey = await queryOne<{ key: string }>(
      `SELECT sot.norm_name_key($1) AS key`,
      [name]
    );

    if (nameKey?.key) {
      const existing = await queryOne<{ alias_id: string }>(
        `SELECT alias_id FROM sot.person_aliases
         WHERE person_id = $1 AND name_key = $2 LIMIT 1`,
        [id, nameKey.key]
      );
      if (existing) {
        return apiConflict("This name is already recorded as a previous name");
      }
    }

    const result = await queryOne<AliasRow>(
      `INSERT INTO sot.person_aliases
       (person_id, name_raw, name_key, source_system, source_table)
       VALUES ($1, $2, $3, 'atlas_ui', 'manual_alias')
       RETURNING alias_id, name_raw, name_key, source_system, source_table, created_at::text`,
      [id, name, nameKey?.key || name.toLowerCase()]
    );

    // Audit trail
    await logFieldEdit("person", id, "alias_added", null, name, {
      editSource: "web_ui",
      reason: "manual_alias",
    });

    return apiSuccess({ alias: result });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error adding alias:", error);
    return apiServerError("Failed to add alias");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const body = await request.json();
    const aliasId = body.alias_id;

    if (!aliasId) {
      return apiBadRequest("alias_id is required");
    }

    // Verify alias belongs to this person
    const alias = await queryOne<{ name_raw: string }>(
      `SELECT name_raw FROM sot.person_aliases
       WHERE alias_id = $1 AND person_id = $2`,
      [aliasId, id]
    );

    if (!alias) {
      return apiNotFound("Alias", aliasId);
    }

    await query(
      `DELETE FROM sot.person_aliases WHERE alias_id = $1`,
      [aliasId]
    );

    // Audit trail
    await logFieldEdit("person", id, "alias_removed", alias.name_raw, null, {
      editSource: "web_ui",
      reason: "manual_removal",
    });

    return apiSuccess({ deleted: true });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error removing alias:", error);
    return apiServerError("Failed to remove alias");
  }
}
