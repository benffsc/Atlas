import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

interface PartnerOrg {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  org_name_patterns: string[];
  org_type: string;
  place_id: string | null;
  facility_address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  relationship_type: string;
  is_active: boolean;
  appointments_count: number;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
  notes: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeInactive = searchParams.get("include_inactive") === "true";

    const orgs = await queryRows<PartnerOrg>(
      `
      SELECT
        po.org_id,
        po.org_name,
        po.org_name_short,
        po.org_name_patterns,
        po.org_type,
        po.place_id,
        pl.formatted_address AS facility_address,
        po.contact_name,
        po.contact_email,
        po.contact_phone,
        po.relationship_type,
        po.is_active,
        po.appointments_count,
        po.first_appointment_date,
        po.last_appointment_date,
        po.notes,
        po.created_at
      FROM trapper.partner_organizations po
      LEFT JOIN sot.places pl ON pl.place_id = po.place_id
      WHERE ($1 OR po.is_active = TRUE)
      ORDER BY po.appointments_count DESC NULLS LAST, po.org_name
      `,
      [includeInactive]
    );

    // Get coverage stats
    const stats = await queryOne<{
      total_org_appts: number;
      with_partner_org: number;
      with_place: number;
      fully_linked: number;
    }>(
      `
      WITH org_appts AS (
        SELECT
          a.appointment_id,
          a.partner_org_id,
          a.inferred_place_id
        FROM ops.appointments a
        JOIN sot.people p ON a.person_id = p.person_id
        WHERE p.is_canonical = FALSE
          AND (
            trapper.is_organization_name(p.display_name) OR
            p.display_name ~* 'FFSC|Forgotten Felines|SCAS|Rescue|Shelter|Humane'
          )
      )
      SELECT
        COUNT(*)::int AS total_org_appts,
        COUNT(*) FILTER (WHERE partner_org_id IS NOT NULL)::int AS with_partner_org,
        COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL)::int AS with_place,
        COUNT(*) FILTER (WHERE partner_org_id IS NOT NULL OR inferred_place_id IS NOT NULL)::int AS fully_linked
      FROM org_appts
      `
    );

    return NextResponse.json({
      organizations: orgs,
      stats: stats || {
        total_org_appts: 0,
        with_partner_org: 0,
        with_place: 0,
        fully_linked: 0,
      },
    });
  } catch (error) {
    console.error("Error fetching partner organizations:", error);
    return NextResponse.json(
      { error: "Failed to fetch partner organizations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      org_name,
      org_name_short,
      org_name_patterns,
      org_type,
      address,
      contact_name,
      contact_email,
      contact_phone,
      relationship_type,
      notes,
    } = body;

    if (!org_name || !org_type) {
      return NextResponse.json(
        { error: "org_name and org_type are required" },
        { status: 400 }
      );
    }

    // Create place if address provided
    let place_id = null;
    if (address) {
      const placeResult = await queryOne<{ place_id: string }>(
        `SELECT sot.find_or_create_place_deduped($1, $2, NULL, NULL, 'atlas_ui') AS place_id`,
        [address, org_name]
      );
      place_id = placeResult?.place_id;
    }

    // Create partner org
    const result = await queryOne<{ org_id: string }>(
      `
      INSERT INTO trapper.partner_organizations (
        org_name, org_name_short, org_name_patterns, org_type,
        place_id, address, contact_name, contact_email, contact_phone,
        relationship_type, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'admin_ui')
      RETURNING org_id
      `,
      [
        org_name,
        org_name_short || null,
        org_name_patterns || [],
        org_type,
        place_id,
        address || null,
        contact_name || null,
        contact_email || null,
        contact_phone || null,
        relationship_type || "partner",
        notes || null,
      ]
    );

    // Link existing appointments
    if (result?.org_id) {
      await execute(
        `SELECT * FROM sot.link_all_appointments_to_partner_orgs()`
      );
    }

    return NextResponse.json({ success: true, org_id: result?.org_id });
  } catch (error) {
    console.error("Error creating partner organization:", error);
    return NextResponse.json(
      { error: "Failed to create partner organization" },
      { status: 500 }
    );
  }
}
