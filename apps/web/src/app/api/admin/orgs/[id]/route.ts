import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

interface OrgDetail {
  id: string;
  name: string;
  short_name: string | null;
  org_type: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  place_id: string | null;
  facility_address: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  name_patterns: string[];
  aliases: string[];
  is_active: boolean;
  relationship_type: string;
  appointments_count: number;
  cats_count: number;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  source_system: string | null;
}

interface LinkedAppointment {
  appointment_id: string;
  appointment_date: string;
  cat_name: string | null;
  microchip: string | null;
  service_type: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get org details
    const org = await queryOne<OrgDetail>(
      `
      SELECT
        o.id,
        o.name,
        o.short_name,
        o.org_type,
        o.email,
        o.phone,
        o.website,
        o.place_id,
        pl.formatted_address AS facility_address,
        o.address,
        o.city,
        o.state,
        o.zip,
        o.lat,
        o.lng,
        o.name_patterns,
        o.aliases,
        o.is_active,
        o.relationship_type,
        o.appointments_count,
        o.cats_count,
        o.first_appointment_date,
        o.last_appointment_date,
        o.notes,
        o.created_at,
        o.updated_at,
        o.source_system
      FROM trapper.orgs o
      LEFT JOIN trapper.places pl ON pl.place_id = o.place_id
      WHERE o.id = $1
      `,
      [id]
    );

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Get recent appointments linked to this org
    const appointments = await queryRows<LinkedAppointment>(
      `
      SELECT
        a.appointment_id,
        a.appointment_date,
        c.display_name AS cat_name,
        c.microchip,
        a.service_type
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_cats c ON a.cat_id = c.cat_id
      WHERE a.org_id = $1
      ORDER BY a.appointment_date DESC
      LIMIT 20
      `,
      [id]
    );

    return NextResponse.json({
      organization: org,
      recent_appointments: appointments,
    });
  } catch (error) {
    console.error("Error fetching organization:", error);
    return NextResponse.json(
      { error: "Failed to fetch organization" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Build dynamic update
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const allowedFields = [
      "name",
      "short_name",
      "org_type",
      "email",
      "phone",
      "website",
      "address",
      "city",
      "state",
      "zip",
      "lat",
      "lng",
      "name_patterns",
      "aliases",
      "is_active",
      "relationship_type",
      "notes",
    ];

    for (const field of allowedFields) {
      if (field in body) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(body[field]);
        paramIndex++;
      }
    }

    // Handle place linking
    if ("place_id" in body) {
      updates.push(`place_id = $${paramIndex}`);
      values.push(body.place_id);
      paramIndex++;
    } else if (body.address && body.create_place) {
      // Create new place from address
      const placeResult = await queryOne<{ place_id: string }>(
        `SELECT trapper.find_or_create_place_deduped($1, $2, NULL, NULL, 'atlas_ui') AS place_id`,
        [body.address, body.name || "Organization"]
      );
      if (placeResult?.place_id) {
        updates.push(`place_id = $${paramIndex}`);
        values.push(placeResult.place_id);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(id);

    const result = await queryOne<{ id: string }>(
      `
      UPDATE trapper.orgs
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id
      `,
      values
    );

    if (!result) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // If patterns were updated, re-link appointments
    if ("name_patterns" in body || "aliases" in body) {
      await execute(`SELECT * FROM trapper.link_all_appointments_to_orgs(500)`);
    }

    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    console.error("Error updating organization:", error);
    return NextResponse.json(
      { error: "Failed to update organization" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const hardDelete = searchParams.get("hard") === "true";

    if (hardDelete) {
      // Hard delete - remove completely (only if no linked appointments)
      const hasAppointments = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM trapper.sot_appointments WHERE org_id = $1`,
        [id]
      );

      if (hasAppointments && hasAppointments.count > 0) {
        return NextResponse.json(
          {
            error: `Cannot delete: ${hasAppointments.count} appointments are linked to this organization`,
          },
          { status: 400 }
        );
      }

      await execute(`DELETE FROM trapper.orgs WHERE id = $1`, [id]);
    } else {
      // Soft delete - mark as inactive
      await execute(
        `UPDATE trapper.orgs SET is_active = FALSE WHERE id = $1`,
        [id]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting organization:", error);
    return NextResponse.json(
      { error: "Failed to delete organization" },
      { status: 500 }
    );
  }
}
