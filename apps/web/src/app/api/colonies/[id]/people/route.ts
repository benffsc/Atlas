import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface ColonyPerson {
  colony_people_id: string;
  person_id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  role_type: string;
  role_label: string;
  is_active: boolean;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  assigned_by: string;
  assigned_at: string;
}

// GET /api/colonies/[id]/people - List people linked to colony
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const people = await queryRows<ColonyPerson>(
      `SELECT
        cp.colony_people_id,
        cp.person_id,
        p.display_name,
        p.primary_phone,
        p.primary_email,
        cp.role_type,
        CASE cp.role_type
          WHEN 'primary_feeder' THEN 'Primary Feeder'
          WHEN 'feeder' THEN 'Feeder'
          WHEN 'reporter' THEN 'Reporter'
          WHEN 'contact' THEN 'Contact'
          WHEN 'property_owner' THEN 'Property Owner'
          WHEN 'trapper_assigned' THEN 'Assigned Trapper'
          WHEN 'trapper_volunteer' THEN 'Volunteer Trapper'
          WHEN 'coordinator' THEN 'Coordinator'
          WHEN 'veterinary_contact' THEN 'Veterinary Contact'
          ELSE 'Other'
        END as role_label,
        cp.is_active,
        cp.started_at,
        cp.ended_at,
        cp.notes,
        cp.assigned_by,
        cp.assigned_at
      FROM sot.colony_people cp
      JOIN sot.people p ON p.person_id = cp.person_id
      WHERE cp.colony_id = $1
        AND p.merged_into_person_id IS NULL
      ORDER BY
        cp.is_active DESC,
        CASE cp.role_type
          WHEN 'primary_feeder' THEN 1
          WHEN 'coordinator' THEN 2
          WHEN 'trapper_assigned' THEN 3
          WHEN 'feeder' THEN 4
          ELSE 10
        END,
        cp.started_at DESC`,
      [colonyId]
    );

    return NextResponse.json({ people });
  } catch (error) {
    console.error("Error fetching colony people:", error);
    return NextResponse.json(
      { error: "Failed to fetch people" },
      { status: 500 }
    );
  }
}

// POST /api/colonies/[id]/people - Link a person to colony with role
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const body = await request.json();
    const { person_id, role_type, notes, assigned_by } = body;

    if (!person_id) {
      return NextResponse.json(
        { error: "person_id is required" },
        { status: 400 }
      );
    }

    if (!role_type) {
      return NextResponse.json(
        { error: "role_type is required" },
        { status: 400 }
      );
    }

    const validRoles = [
      "primary_feeder",
      "feeder",
      "reporter",
      "contact",
      "property_owner",
      "trapper_assigned",
      "trapper_volunteer",
      "coordinator",
      "veterinary_contact",
      "other",
    ];

    if (!validRoles.includes(role_type)) {
      return NextResponse.json(
        { error: `Invalid role_type. Must be one of: ${validRoles.join(", ")}` },
        { status: 400 }
      );
    }

    if (!assigned_by?.trim()) {
      return NextResponse.json(
        { error: "assigned_by is required" },
        { status: 400 }
      );
    }

    // Verify colony exists
    const colony = await queryOne<{ colony_id: string }>(
      `SELECT colony_id FROM sot.colonies WHERE colony_id = $1`,
      [colonyId]
    );

    if (!colony) {
      return NextResponse.json({ error: "Colony not found" }, { status: 404 });
    }

    // Verify person exists
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people
       WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [person_id]
    );

    if (!person) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    // Use the assign_colony_person function for idempotent assignment
    const result = await queryOne<{ assign_colony_person: string }>(
      `SELECT trapper.assign_colony_person($1, $2, $3, $4, $5)`,
      [colonyId, person_id, role_type, assigned_by.trim(), notes?.trim() || null]
    );

    return NextResponse.json({
      success: true,
      colony_people_id: result?.assign_colony_person,
    });
  } catch (error) {
    console.error("Error linking person to colony:", error);
    return NextResponse.json(
      { error: "Failed to link person" },
      { status: 500 }
    );
  }
}

// PATCH /api/colonies/[id]/people - Update a person's role or end their assignment
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const body = await request.json();
    const { person_id, role_type, action, end_reason } = body;

    if (!person_id || !role_type) {
      return NextResponse.json(
        { error: "person_id and role_type are required" },
        { status: 400 }
      );
    }

    if (action === "end") {
      // End the person's role at this colony
      const result = await queryOne<{ end_colony_person: boolean }>(
        `SELECT trapper.end_colony_person($1, $2, $3, $4)`,
        [colonyId, person_id, role_type, end_reason || null]
      );

      return NextResponse.json({
        success: result?.end_colony_person || false,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use action: 'end' to end a role." },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating colony person:", error);
    return NextResponse.json(
      { error: "Failed to update person" },
      { status: 500 }
    );
  }
}

// DELETE /api/colonies/[id]/people?personId=xxx&roleType=xxx - Remove person from colony
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;
  const { searchParams } = new URL(request.url);
  const personId = searchParams.get("personId");
  const roleType = searchParams.get("roleType");

  if (!personId || !roleType) {
    return NextResponse.json(
      { error: "personId and roleType query parameters are required" },
      { status: 400 }
    );
  }

  try {
    const result = await queryOne<{ colony_people_id: string }>(
      `DELETE FROM sot.colony_people
       WHERE colony_id = $1 AND person_id = $2 AND role_type = $3
       RETURNING colony_people_id`,
      [colonyId, personId, roleType]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Person-role link not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing person from colony:", error);
    return NextResponse.json(
      { error: "Failed to remove person" },
      { status: 500 }
    );
  }
}
