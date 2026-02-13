import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const org = await queryOne(
      `
      SELECT
        po.org_id,
        po.org_name,
        po.org_name_short,
        po.org_name_patterns,
        po.org_type,
        po.place_id,
        pl.formatted_address AS facility_address,
        po.address,
        po.contact_name,
        po.contact_email,
        po.contact_phone,
        po.website,
        po.relationship_type,
        po.is_active,
        po.appointments_count,
        po.cats_processed,
        po.first_appointment_date,
        po.last_appointment_date,
        po.notes,
        po.created_at,
        po.updated_at
      FROM trapper.partner_organizations po
      LEFT JOIN sot.places pl ON pl.place_id = po.place_id
      WHERE po.org_id = $1
      `,
      [id]
    );

    if (!org) {
      return NextResponse.json(
        { error: "Partner organization not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(org);
  } catch (error) {
    console.error("Error fetching partner organization:", error);
    return NextResponse.json(
      { error: "Failed to fetch partner organization" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      "org_name",
      "org_name_short",
      "org_name_patterns",
      "org_type",
      "address",
      "contact_name",
      "contact_email",
      "contact_phone",
      "website",
      "relationship_type",
      "is_active",
      "notes",
    ];

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(body[field]);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    updates.push("updated_at = NOW()");
    values.push(id);

    await execute(
      `
      UPDATE trapper.partner_organizations
      SET ${updates.join(", ")}
      WHERE org_id = $${paramIndex}
      `,
      values
    );

    // Re-link appointments if patterns changed
    if (body.org_name_patterns) {
      await execute(
        `SELECT * FROM sot.link_all_appointments_to_partner_orgs()`
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating partner organization:", error);
    return NextResponse.json(
      { error: "Failed to update partner organization" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Soft delete - just mark as inactive
    await execute(
      `
      UPDATE trapper.partner_organizations
      SET is_active = FALSE, updated_at = NOW()
      WHERE org_id = $1
      `,
      [id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting partner organization:", error);
    return NextResponse.json(
      { error: "Failed to delete partner organization" },
      { status: 500 }
    );
  }
}
