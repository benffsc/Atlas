import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

interface Org {
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
}

interface OrgType {
  type_code: string;
  display_name: string;
  description: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeInactive = searchParams.get("include_inactive") === "true";
    const orgType = searchParams.get("type");

    // Get organizations from unified table
    const orgs = await queryRows<Org>(
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
        o.name_patterns,
        o.aliases,
        o.is_active,
        o.relationship_type,
        o.appointments_count,
        o.cats_count,
        o.first_appointment_date,
        o.last_appointment_date,
        o.notes,
        o.created_at
      FROM trapper.orgs o
      LEFT JOIN trapper.places pl ON pl.place_id = o.place_id
      WHERE ($1 OR o.is_active = TRUE)
        AND ($2::TEXT IS NULL OR o.org_type = $2)
      ORDER BY o.appointments_count DESC NULLS LAST, o.name
      `,
      [includeInactive, orgType || null]
    );

    // Get org types for dropdown
    const orgTypes = await queryRows<OrgType>(
      `
      SELECT type_code, display_name, description
      FROM trapper.org_types
      ORDER BY display_order, display_name
      `
    );

    // Get coverage stats
    const stats = await queryOne<{
      total_orgs: number;
      active_orgs: number;
      orgs_with_place: number;
      orgs_with_patterns: number;
      total_linked_appointments: number;
      total_linked_cats: number;
    }>(
      `
      SELECT
        COUNT(*)::int AS total_orgs,
        COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_orgs,
        COUNT(*) FILTER (WHERE place_id IS NOT NULL)::int AS orgs_with_place,
        COUNT(*) FILTER (WHERE name_patterns IS NOT NULL AND array_length(name_patterns, 1) > 0)::int AS orgs_with_patterns,
        COALESCE(SUM(appointments_count), 0)::int AS total_linked_appointments,
        COALESCE(SUM(cats_count), 0)::int AS total_linked_cats
      FROM trapper.orgs
      `
    );

    return NextResponse.json({
      organizations: orgs,
      org_types: orgTypes,
      stats: stats || {
        total_orgs: 0,
        active_orgs: 0,
        orgs_with_place: 0,
        orgs_with_patterns: 0,
        total_linked_appointments: 0,
        total_linked_cats: 0,
      },
    });
  } catch (error) {
    console.error("Error fetching organizations:", error);
    return NextResponse.json(
      { error: "Failed to fetch organizations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      short_name,
      org_type,
      email,
      phone,
      website,
      address,
      city,
      state,
      zip,
      name_patterns,
      aliases,
      relationship_type,
      notes,
    } = body;

    if (!name || !org_type) {
      return NextResponse.json(
        { error: "name and org_type are required" },
        { status: 400 }
      );
    }

    // Create place if address provided
    let place_id = null;
    if (address) {
      const placeResult = await queryOne<{ place_id: string }>(
        `SELECT trapper.find_or_create_place_deduped($1, $2, NULL, NULL, 'atlas_ui') AS place_id`,
        [address, name]
      );
      place_id = placeResult?.place_id;
    }

    // Build patterns from short_name and aliases if not provided
    let patterns = name_patterns || [];
    if (patterns.length === 0) {
      // Auto-generate patterns
      patterns.push(`%${name.toLowerCase()}%`);
      if (short_name) {
        patterns.push(`%${short_name.toLowerCase()}%`);
      }
      if (aliases && aliases.length > 0) {
        aliases.forEach((alias: string) => {
          patterns.push(`%${alias.toLowerCase()}%`);
        });
      }
    }

    // Create org
    const result = await queryOne<{ id: string }>(
      `
      INSERT INTO trapper.orgs (
        name, short_name, org_type, email, phone, website,
        place_id, address, city, state, zip,
        name_patterns, aliases, relationship_type, notes,
        created_by, source_system
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        'admin_ui', 'admin_ui'
      )
      RETURNING id
      `,
      [
        name,
        short_name || null,
        org_type,
        email || null,
        phone || null,
        website || null,
        place_id,
        address || null,
        city || null,
        state || "CA",
        zip || null,
        patterns,
        aliases || [],
        relationship_type || "partner",
        notes || null,
      ]
    );

    // Link existing appointments
    if (result?.id) {
      await execute(`SELECT * FROM trapper.link_all_appointments_to_orgs(500)`);
    }

    return NextResponse.json({ success: true, id: result?.id });
  } catch (error) {
    console.error("Error creating organization:", error);
    return NextResponse.json(
      { error: "Failed to create organization" },
      { status: 500 }
    );
  }
}
