import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { logFieldEdit } from "@/lib/audit";
import { validatePersonName } from "@/lib/validation";

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

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    const aliases = await queryRows<AliasRow>(
      `SELECT alias_id, name_raw, name_key, source_system, source_table, created_at::text
       FROM sot.person_aliases
       WHERE person_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    return NextResponse.json({ aliases });
  } catch (error) {
    console.error("Error fetching aliases:", error);
    return NextResponse.json(
      { error: "Failed to fetch aliases" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const name = body.name?.trim();

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const validation = validatePersonName(name);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid name" },
        { status: 400 }
      );
    }

    // Verify person exists
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people WHERE person_id = $1`,
      [id]
    );
    if (!person) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    // Compute name_key and check for duplicates
    const nameKey = await queryOne<{ key: string }>(
      `SELECT trapper.norm_name_key($1) AS key`,
      [name]
    );

    if (nameKey?.key) {
      const existing = await queryOne<{ alias_id: string }>(
        `SELECT alias_id FROM sot.person_aliases
         WHERE person_id = $1 AND name_key = $2 LIMIT 1`,
        [id, nameKey.key]
      );
      if (existing) {
        return NextResponse.json(
          { error: "This name is already recorded as a previous name" },
          { status: 409 }
        );
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

    return NextResponse.json({ alias: result });
  } catch (error) {
    console.error("Error adding alias:", error);
    return NextResponse.json(
      { error: "Failed to add alias" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const aliasId = body.alias_id;

    if (!aliasId) {
      return NextResponse.json(
        { error: "alias_id is required" },
        { status: 400 }
      );
    }

    // Verify alias belongs to this person
    const alias = await queryOne<{ name_raw: string }>(
      `SELECT name_raw FROM sot.person_aliases
       WHERE alias_id = $1 AND person_id = $2`,
      [aliasId, id]
    );

    if (!alias) {
      return NextResponse.json(
        { error: "Alias not found for this person" },
        { status: 404 }
      );
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing alias:", error);
    return NextResponse.json(
      { error: "Failed to remove alias" },
      { status: 500 }
    );
  }
}
