import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface MortalityEvent {
  mortality_event_id: string;
  cat_id: string | null;
  cat_name: string | null;
  place_id: string | null;
  place_name: string | null;
  death_date: string | null;
  death_cause: string;
  death_age_category: string;
  source_system: string;
  notes: string | null;
  created_at: string;
}

export async function GET() {
  try {
    // Check if table exists
    const tableExists = await queryRows<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'cat_mortality_events'
      ) AS exists
    `);

    if (!tableExists[0]?.exists) {
      return NextResponse.json({ events: [], message: "Table not created yet" });
    }

    const sql = `
      SELECT
        cme.mortality_event_id::TEXT,
        cme.cat_id::TEXT,
        c.display_name AS cat_name,
        cme.place_id::TEXT,
        p.display_name AS place_name,
        cme.death_date::TEXT,
        cme.death_cause::TEXT,
        cme.death_age_category::TEXT,
        cme.source_system,
        cme.notes,
        cme.created_at::TEXT
      FROM sot.cat_mortality_events cme
      LEFT JOIN sot.cats c ON c.cat_id = cme.cat_id
      LEFT JOIN sot.places p ON p.place_id = cme.place_id
      ORDER BY cme.created_at DESC
      LIMIT 500
    `;

    const events = await queryRows<MortalityEvent>(sql);

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Mortality events fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch mortality events" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { mortality_event_id, death_cause, death_age_category, death_date, notes } = body;

    if (!mortality_event_id) {
      return NextResponse.json({ error: "Missing mortality event ID" }, { status: 400 });
    }

    const updates: string[] = [];
    const params: (string | null)[] = [];
    let paramIndex = 1;

    if (death_cause !== undefined) {
      updates.push(`death_cause = $${paramIndex++}`);
      params.push(death_cause);
    }
    if (death_age_category !== undefined) {
      updates.push(`death_age_category = $${paramIndex++}`);
      params.push(death_age_category);
    }
    if (death_date !== undefined) {
      updates.push(`death_date = $${paramIndex++}`);
      params.push(death_date || null);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(notes || null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    params.push(mortality_event_id);

    await query(
      `UPDATE sot.cat_mortality_events SET ${updates.join(", ")} WHERE mortality_event_id = $${paramIndex}`,
      params
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mortality update error:", error);
    return NextResponse.json(
      { error: "Failed to update mortality event" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("id");

    if (!eventId) {
      return NextResponse.json({ error: "Missing mortality event ID" }, { status: 400 });
    }

    await query(
      `DELETE FROM sot.cat_mortality_events WHERE mortality_event_id = $1`,
      [eventId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mortality delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete mortality event" },
      { status: 500 }
    );
  }
}
