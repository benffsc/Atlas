import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";

/**
 * Entity Edit API
 *
 * Handles safe editing of entities with full audit logging.
 *
 * Endpoints:
 *   GET  /api/entities/{type}/{id}/edit - Get edit lock status and suggestions
 *   POST /api/entities/{type}/{id}/edit - Acquire edit lock
 *   PATCH /api/entities/{type}/{id}/edit - Apply edit(s)
 *   DELETE /api/entities/{type}/{id}/edit - Release edit lock
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const VALID_ENTITY_TYPES = ["person", "cat", "place", "request"];

interface EditRequest {
  edits: Array<{
    field: string;
    value: unknown;
    reason?: string;
  }>;
  editor_id?: string;
  editor_name?: string;
}

interface TransferRequest {
  edit_type: "ownership_transfer";
  cat_id: string;
  new_owner_id: string;
  relationship_type?: string;
  reason?: string;
  notes?: string;
  editor_id?: string;
  editor_name?: string;
}

// GET - Check lock status and get suggestions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params;

  if (!VALID_ENTITY_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Get current lock status
    const lockResult = await client.query(`
      SELECT * FROM ops.v_active_locks
      WHERE entity_type = $1 AND entity_id = $2
    `, [type, id]);

    // Get recent edit history
    const historyResult = await client.query(`
      SELECT * FROM trapper.get_entity_history($1, $2, 20)
    `, [type, id]);

    // Get entity-specific suggestions
    const suggestions = await getEntitySuggestions(client, type, id);

    return NextResponse.json({
      lock: lockResult.rows[0] || null,
      history: historyResult.rows,
      suggestions,
    });
  } finally {
    client.release();
  }
}

// POST - Acquire edit lock
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params;

  if (!VALID_ENTITY_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
  }

  const body = await request.json();
  const userId = body.user_id || "anonymous";
  const userName = body.user_name || null;
  const reason = body.reason || "Editing";

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT trapper.acquire_edit_lock($1, $2, $3, $4, $5) as success
    `, [type, id, userId, userName, reason]);

    if (result.rows[0].success) {
      // Get lock details
      const lockResult = await client.query(`
        SELECT * FROM ops.v_active_locks
        WHERE entity_type = $1 AND entity_id = $2
      `, [type, id]);

      return NextResponse.json({
        success: true,
        lock: lockResult.rows[0],
      });
    } else {
      // Get who has the lock
      const lockResult = await client.query(`
        SELECT * FROM ops.v_active_locks
        WHERE entity_type = $1 AND entity_id = $2
      `, [type, id]);

      return NextResponse.json({
        success: false,
        error: "Entity is locked by another user",
        lock: lockResult.rows[0],
      }, { status: 409 });
    }
  } finally {
    client.release();
  }
}

// PATCH - Apply edits
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params;

  if (!VALID_ENTITY_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
  }

  const body = await request.json();

  // Check if this is a special edit type (transfer, merge, etc.)
  if (body.edit_type === "ownership_transfer") {
    return handleOwnershipTransfer(body as TransferRequest);
  }

  const editRequest = body as EditRequest;
  const editorId = editRequest.editor_id || "anonymous";
  const editorName = editRequest.editor_name || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const editIds: string[] = [];
    const tableName = getTableName(type);
    const idColumn = getIdColumn(type);

    // Get current values for audit
    const currentResult = await client.query(`
      SELECT * FROM ${tableName} WHERE ${idColumn} = $1
    `, [id]);

    if (currentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const currentRow = currentResult.rows[0];

    // Apply each edit
    for (const edit of editRequest.edits) {
      const { field, value, reason } = edit;

      // Validate field is editable
      if (!isFieldEditable(type, field)) {
        await client.query("ROLLBACK");
        return NextResponse.json({
          error: `Field '${field}' is not editable`,
        }, { status: 400 });
      }

      const oldValue = currentRow[field];

      // Skip if no change
      if (JSON.stringify(oldValue) === JSON.stringify(value)) {
        continue;
      }

      // Update the field
      await client.query(`
        UPDATE ${tableName}
        SET ${field} = $1, updated_at = NOW()
        WHERE ${idColumn} = $2
      `, [value, id]);

      // Log the edit
      const logResult = await client.query(`
        SELECT trapper.log_field_edit(
          $1, $2, $3, $4, $5, $6, $7, $8, 'web_ui'
        ) as edit_id
      `, [
        type, id, field,
        JSON.stringify(oldValue), JSON.stringify(value),
        reason, editorId, editorName
      ]);

      editIds.push(logResult.rows[0].edit_id);
    }

    await client.query("COMMIT");

    // Get updated entity
    const updatedResult = await client.query(`
      SELECT * FROM ${tableName} WHERE ${idColumn} = $1
    `, [id]);

    return NextResponse.json({
      success: true,
      edit_ids: editIds,
      entity: updatedResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Edit error:", error);
    return NextResponse.json({
      error: "Failed to apply edit",
    }, { status: 500 });
  } finally {
    client.release();
  }
}

// DELETE - Release edit lock
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params;

  if (!VALID_ENTITY_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id") || "anonymous";

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT trapper.release_edit_lock($1, $2, $3) as success
    `, [type, id, userId]);

    return NextResponse.json({
      success: result.rows[0].success,
    });
  } finally {
    client.release();
  }
}

// Helper: Handle ownership transfer
async function handleOwnershipTransfer(req: TransferRequest) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get current owner
    const currentResult = await client.query(`
      SELECT pcr.person_id as owner_id, p.display_name as owner_name
      FROM sot.person_cat_relationships pcr
      JOIN sot.people p ON p.person_id = pcr.person_id
      WHERE pcr.cat_id = $1
        AND pcr.relationship_type IN ('owner', 'caretaker', 'brought_by')
      ORDER BY
        CASE pcr.relationship_type
          WHEN 'owner' THEN 1
          WHEN 'caretaker' THEN 2
          ELSE 3
        END
      LIMIT 1
    `, [req.cat_id]);

    const oldOwnerId = currentResult.rows[0]?.owner_id || null;

    // Remove old relationship if exists
    if (oldOwnerId) {
      await client.query(`
        UPDATE sot.person_cat_relationships
        SET relationship_type = 'former_' || relationship_type,
            updated_at = NOW()
        WHERE cat_id = $1
          AND person_id = $2
          AND relationship_type NOT LIKE 'former_%'
      `, [req.cat_id, oldOwnerId]);
    }

    // Create new relationship via centralized function (INV-10)
    await client.query(`
      SELECT sot.link_person_to_cat(
        p_person_id := $1,
        p_cat_id := $2,
        p_relationship_type := $3,
        p_evidence_type := 'manual_transfer',
        p_source_system := 'atlas_ui',
        p_source_table := 'ownership_transfer',
        p_confidence := 'high',
        p_context_notes := $4
      )
    `, [req.new_owner_id, req.cat_id, req.relationship_type || "owner",
        req.reason || "Ownership transfer via UI"]);

    // Log the transfer
    const logResult = await client.query(`
      SELECT trapper.log_ownership_transfer(
        $1, $2, $3, $4, $5, $6, $7, $8
      ) as edit_id
    `, [
      req.cat_id, oldOwnerId, req.new_owner_id,
      req.relationship_type || "owner",
      req.reason, req.notes,
      req.editor_id || "anonymous",
      req.editor_name
    ]);

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      edit_id: logResult.rows[0].edit_id,
      old_owner_id: oldOwnerId,
      new_owner_id: req.new_owner_id,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Transfer error:", error);
    return NextResponse.json({
      error: "Failed to transfer ownership",
    }, { status: 500 });
  } finally {
    client.release();
  }
}

// Helper: Get table name for entity type
function getTableName(type: string): string {
  switch (type) {
    case "person": return "sot.people";
    case "cat": return "sot.cats";
    case "place": return "sot.places";
    case "request": return "ops.requests";
    default: throw new Error(`Unknown entity type: ${type}`);
  }
}

// Helper: Get ID column for entity type
function getIdColumn(type: string): string {
  switch (type) {
    case "person": return "person_id";
    case "cat": return "cat_id";
    case "place": return "place_id";
    case "request": return "request_id";
    default: throw new Error(`Unknown entity type: ${type}`);
  }
}

// Helper: Check if field is editable
function isFieldEditable(type: string, field: string): boolean {
  const nonEditable: Record<string, string[]> = {
    person: ["person_id", "created_at"],
    cat: ["cat_id", "created_at"],
    place: ["place_id", "created_at"],
    request: ["request_id", "created_at"],
  };

  return !nonEditable[type]?.includes(field);
}

// Helper: Get entity-specific suggestions
async function getEntitySuggestions(
  client: PoolClient,
  type: string,
  id: string
): Promise<Record<string, unknown>> {
  const suggestions: Record<string, unknown> = {};

  if (type === "cat") {
    // Get cat's location for nearby suggestions
    const catResult = await client.query(`
      SELECT c.cat_id, c.display_name, p.latitude, p.longitude
      FROM sot.cats c
      LEFT JOIN sot.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
      LEFT JOIN sot.places p ON p.place_id = cpr.place_id
      WHERE c.cat_id = $1
    `, [id]);

    if (catResult.rows[0]?.latitude) {
      const lat = catResult.rows[0].latitude;
      const lng = catResult.rows[0].longitude;

      // Nearby people (potential owners)
      const nearbyPeople = await client.query(`
        SELECT DISTINCT p.person_id, p.display_name,
          COUNT(DISTINCT pcr.cat_id) as cat_count
        FROM sot.people p
        JOIN sot.person_place_relationships ppr ON ppr.person_id = p.person_id
        JOIN sot.places pl ON pl.place_id = ppr.place_id
        LEFT JOIN sot.person_cat_relationships pcr ON pcr.person_id = p.person_id
        WHERE pl.latitude BETWEEN $1 - 0.01 AND $1 + 0.01
          AND pl.longitude BETWEEN $2 - 0.01 AND $2 + 0.01
        GROUP BY p.person_id, p.display_name
        ORDER BY cat_count DESC
        LIMIT 10
      `, [lat, lng]);

      suggestions.nearby_people = nearbyPeople.rows;

      // Nearby cats (for comparison)
      const nearbyCats = await client.query(`
        SELECT c.cat_id, c.display_name,
          pcr.person_id as owner_id,
          p.display_name as owner_name
        FROM sot.cats c
        LEFT JOIN sot.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
        LEFT JOIN sot.places pl ON pl.place_id = cpr.place_id
        LEFT JOIN sot.person_cat_relationships pcr ON pcr.cat_id = c.cat_id
          AND pcr.relationship_type IN ('owner', 'caretaker')
        LEFT JOIN sot.people p ON p.person_id = pcr.person_id
        WHERE c.cat_id != $3
          AND pl.latitude BETWEEN $1 - 0.01 AND $1 + 0.01
          AND pl.longitude BETWEEN $2 - 0.01 AND $2 + 0.01
        LIMIT 10
      `, [lat, lng, id]);

      suggestions.nearby_cats = nearbyCats.rows;
    }
  }

  if (type === "person") {
    // Get person's cats
    const catsResult = await client.query(`
      SELECT c.cat_id, c.display_name, pcr.relationship_type
      FROM sot.person_cat_relationships pcr
      JOIN sot.cats c ON c.cat_id = pcr.cat_id
      WHERE pcr.person_id = $1
        AND pcr.relationship_type NOT LIKE 'former_%'
    `, [id]);

    suggestions.cats = catsResult.rows;
  }

  return suggestions;
}
