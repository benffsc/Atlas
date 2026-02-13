import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface ManualCatch {
  catch_id: string;
  cat_id: string | null;
  microchip: string | null;
  catch_date: string;
  catch_location: string | null;
  notes: string | null;
  cat_name: string | null;
  created_at: string;
}

// GET: List manual catches for this trapper
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
    const catches = await queryRows<ManualCatch>(
      `SELECT
        mc.catch_id,
        mc.cat_id,
        mc.microchip,
        mc.catch_date,
        mc.catch_location,
        mc.notes,
        c.display_name AS cat_name,
        mc.created_at
      FROM ops.trapper_manual_catches mc
      LEFT JOIN sot.cats c ON c.cat_id = mc.cat_id
      WHERE mc.trapper_person_id = $1
      ORDER BY mc.catch_date DESC`,
      [id]
    );

    return NextResponse.json({ catches });
  } catch (error) {
    console.error("Error fetching manual catches:", error);
    return NextResponse.json(
      { error: "Failed to fetch manual catches" },
      { status: 500 }
    );
  }
}

// POST: Add a new manual catch
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
    const { microchip, cat_id, catch_date, catch_location, notes } = body;

    if (!microchip && !cat_id) {
      return NextResponse.json(
        { error: "Either microchip or cat_id is required" },
        { status: 400 }
      );
    }

    // Use the add_trapper_catch function
    const result = await queryOne<{ add_trapper_catch: string }>(
      `SELECT trapper.add_trapper_catch(
        $1::uuid,
        $2::text,
        $3::uuid,
        $4::date,
        $5::text,
        $6::text,
        'web_user'
      ) AS add_trapper_catch`,
      [
        id,
        microchip || null,
        cat_id || null,
        catch_date || new Date().toISOString().split("T")[0],
        catch_location || null,
        notes || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to add catch" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      catch_id: result.add_trapper_catch,
    });
  } catch (error) {
    console.error("Error adding manual catch:", error);

    // Handle specific error messages from the function
    const errorMessage =
      error instanceof Error ? error.message : "";

    if (errorMessage.includes("not an active trapper")) {
      return NextResponse.json(
        { error: "Person is not an active trapper" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Failed to add catch" }, { status: 500 });
  }
}
